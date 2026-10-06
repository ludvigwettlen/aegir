import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { TaskFile } from '../shared/types.js';
import {
  brainTarget, fileSize, identify, isBrainSlug, MAX_FILE_BYTES, RAW_IGNORE_RULE, safeFileName, uniqueFileName,
  type FileKind,
} from '../shared/task-files.js';

/** Inside its root, never out through `..`. The same containment rule the document workspace uses. */
export function inside(root: string, reference: string): string {
  if (typeof reference !== 'string' || reference.includes('\0')) throw new Error('Invalid attachment path');
  const path = resolve(root, reference);
  const local = relative(resolve(root), path);
  if (!local || local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local))
    throw new Error('This file is outside its attachment folder');
  return path;
}

export type SourceFile = {
  name: string;
  bytes: number;
  kind: FileKind;
  mime: string;
  sha256: string;
  data: Buffer;
  originalPath: string | null;
};

export function sourceFromBytes(name: string, data: Buffer, originalPath: string | null = null): SourceFile {
  const safe = safeFileName(name);
  return {
    name: safe,
    bytes: data.byteLength,
    ...identify(safe, data.subarray(0, 12)),
    sha256: createHash('sha256').update(data).digest('hex'),
    data,
    originalPath,
  };
}

// Reads the dropped file once: the bytes that are hashed are the bytes that get copied, so a file that
// changes underneath can never leave a hash that doesn't describe the copy.
export function readSource(path: string): SourceFile {
  if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0'))
    throw new Error('Drop a file from Finder or another app');
  if (!existsSync(path)) throw new Error(`${basename(path)} is no longer there`);
  const link = lstatSync(path);
  if (!link.isFile()) throw new Error('Drop the file itself, not a folder or alias');
  if (link.size > MAX_FILE_BYTES)
    throw new Error(`${basename(path)} is ${fileSize(link.size)}; the limit is ${fileSize(MAX_FILE_BYTES)}`);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile()) throw new Error('Drop the file itself, not a folder or alias');
    if (opened.size > MAX_FILE_BYTES)
      throw new Error(`${basename(path)} is ${fileSize(opened.size)}; the limit is ${fileSize(MAX_FILE_BYTES)}`);
    return sourceFromBytes(basename(path), readFileSync(fd), path);
  } finally { closeSync(fd); }
}

// The copy lands under a temporary name, is flushed, and is renamed into place, so a run never sees a
// half-copied attachment.
function writeOnce(dir: string, name: string, data: Buffer): string {
  mkdirSync(dir, { recursive: true });
  const target = join(dir, uniqueFileName(name, candidate => existsSync(join(dir, candidate))));
  const temp = join(dir, `.legolas-${randomUUID()}.tmp`);
  try {
    const fd = openSync(temp, 'wx');
    try { writeFileSync(fd, data); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temp, target);
  } finally { try { unlinkSync(temp); } catch { /* already renamed */ } }
  return target;
}

/** Copies a staged file into `<root>/<folder>` and returns its path relative to the root. */
export function writeAttachment(root: string, folder: string, file: SourceFile): string {
  const dir = inside(root, folder);
  return relative(resolve(root), writeOnce(dir, file.name, file.data));
}

export function folderBytes(dir: string): number {
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile()) total += statSync(join(dir, entry.name)).size;
    else if (entry.isDirectory()) total += folderBytes(join(dir, entry.name));
  }
  return total;
}

// Removing an attachment keeps the bytes in removed/, named by the row that owned them, so undo puts the
// file and the row back together.
const binName = (fileId: string, name: string) => `${fileId.slice(0, 8)}-${name}`;

export function hideAttachment(root: string, file: Pick<TaskFile, 'id' | 'path'>) {
  const path = inside(root, file.path);
  if (!existsSync(path)) return;
  const bin = join(dirname(path), 'removed');
  mkdirSync(bin, { recursive: true });
  renameSync(path, join(bin, binName(file.id, basename(path))));
}

export function restoreAttachment(root: string, file: Pick<TaskFile, 'id' | 'path'>) {
  const path = inside(root, file.path);
  const hidden = join(dirname(path), 'removed', binName(file.id, basename(path)));
  if (existsSync(hidden) && !existsSync(path)) renameSync(hidden, path);
}

export const chatFilesRoot = (outputRoot: string) => join(outputRoot, 'Chat files');

/** Where a registered file's bytes live: the task's own folder, or the shared chat-files folder. */
export function fileRoot(
  file: Pick<TaskFile, 'root' | 'taskId'>,
  outputRoot: string,
  taskDir: (taskId: string) => string | null | undefined,
): string | null {
  if (file.root === 'chat') return chatFilesRoot(outputRoot);
  return (file.taskId && taskDir(file.taskId)) || null;
}

/** The absolute path to hand the agent. Null while the task has no folder yet. */
export function filePath(
  file: Pick<TaskFile, 'root' | 'taskId' | 'path'>,
  outputRoot: string,
  taskDir: (taskId: string) => string | null | undefined,
): string | null {
  const root = fileRoot(file, outputRoot, taskDir);
  return root && inside(root, file.path);
}

// ---- Filing to the brain ---------------------------------------------------------------------
// Nothing reaches ~/brain without an explicit call: this runs from File to brain, never from a run.
export function fileToBrain(
  brainDir: string,
  slug: string,
  file: Pick<TaskFile, 'name' | 'kind' | 'bytes' | 'sha256' | 'originalPath'>,
  source: string,
  context: { taskTitle: string | null; taskId: string | null; now?: Date },
): string {
  if (!isBrainSlug(slug)) throw new Error('A brain slug is lower-case letters, digits and hyphens');
  if (!existsSync(brainDir)) throw new Error('There is no brain folder to file into');
  const data = readFileSync(source);
  const dir = inside(join(brainDir, 'sources'), slug);
  const raw = brainTarget(file.kind, file.bytes) === 'raw';
  const written = writeOnce(raw ? join(dir, '.raw') : dir, file.name, data);
  const ingested = (context.now || new Date()).toISOString();
  const page = join(dir, 'index.md');
  const where = relative(dir, written);
  const origin = context.taskTitle ? `the todo "${context.taskTitle}"` : 'a Legolas conversation';
  if (existsSync(page)) {
    writeFileSync(page, `${readFileSync(page, 'utf8').trimEnd()}\n\n## ${file.name}\n\nFiled from ${origin} on ${ingested.slice(0, 10)}. Raw file: \`${where}\`. sha256 \`${file.sha256}\`.\n`);
  } else {
    // Quoted, so a name or task title with a colon ("Legolas prd: …") stays valid YAML for the brain's fact store.
    const quoted = (value: string) => JSON.stringify(value);
    writeFileSync(page, [
      '---',
      `title: ${quoted(file.name)}`,
      'type: source',
      'source: legolas-attachment',
      `original_path: ${quoted(file.originalPath || 'unknown')}`,
      `legolas_task: ${quoted(`${context.taskTitle || 'none'}${context.taskId ? ` (${context.taskId})` : ''}`)}`,
      `sha256: ${file.sha256}`,
      `bytes: ${file.bytes}`,
      `ingested: ${ingested}`,
      '---',
      '',
      `# ${file.name}`,
      '',
      `Filed from ${origin} on ${ingested.slice(0, 10)}. Raw file: \`${where}\`.`,
      '',
      'What this is: not yet written.',
      '',
    ].join('\n'));
  }
  // One rule generalises the one the brain already has for a single slug, and keeps 50 MB blobs out of git.
  const ignore = join(brainDir, '.gitignore');
  const rules = existsSync(ignore) ? readFileSync(ignore, 'utf8') : '';
  if (raw && !rules.split(/\r?\n/).includes(RAW_IGNORE_RULE))
    writeFileSync(ignore, `${rules.replace(/\n*$/, '')}\n${RAW_IGNORE_RULE}\n`);
  return written;
}
