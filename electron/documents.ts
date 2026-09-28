import { createHash, randomUUID } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { WorkspaceDocument } from '../shared/documents.js';

const MAX_BYTES = 2 * 1024 * 1024;
const revision = (text: string) => createHash('sha256').update(text).digest('hex');

/** Resolve within the agent's working directory; never follow file or directory symlinks. */
function resolveDocument(root: string, reference: string): string {
  if (typeof reference !== 'string' || !/\.(md|markdown)$/i.test(reference) || reference.includes('\0')) throw new Error('Choose a Markdown file');
  root = realpathSync(root);
  const path = resolve(root, reference);
  const local = relative(root, path);
  if (!local || local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local)) throw new Error('This file is outside the task workspace');
  let current = root;
  for (const part of local.split(sep)) {
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink()) throw new Error('Symbolic links cannot be edited in the document workspace');
  }
  return path;
}

export function readDocument(root: string, reference: string): WorkspaceDocument {
  const path = resolveDocument(root, reference);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error('Choose a Markdown file smaller than 2 MB');
    const content = new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(fd));
    return { path: relative(realpathSync(root), path), content, revision: revision(content) };
  } finally { closeSync(fd); }
}

export function saveDocument(root: string, reference: string, expected: string, content: string): WorkspaceDocument {
  if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > MAX_BYTES) throw new Error('Document exceeds the 2 MB limit');
  const current = readDocument(root, reference);
  if (current.revision !== expected) throw new Error('The file changed on disk. Your edits are kept here. Reload the file to review the latest version.');
  const path = resolveDocument(root, reference);
  const temp = join(dirname(path), `.aegir-${randomUUID()}.tmp`);
  try {
    writeFileSync(temp, content, { flag: 'wx', mode: lstatSync(path).mode });
    if (readDocument(root, reference).revision !== expected) throw new Error('The file changed while saving. Your edits are kept here.');
    renameSync(temp, path);
  } finally { try { unlinkSync(temp); } catch { /* already renamed */ } }
  return { path: current.path, content, revision: revision(content) };
}

export function listDocuments(root: string): string[] {
  const files: string[] = [];
  let scanned = 0;
  const walk = (dir: string, depth: number) => {
    if (depth > 5 || scanned > 2000 || files.length >= 200) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (++scanned > 2000 || files.length >= 200) return;
      if (entry.name.startsWith('.') || ['node_modules', 'skills', 'Cache', 'logs'].includes(entry.name) || entry.isSymbolicLink()) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { try { walk(path, depth + 1); } catch { /* inaccessible subdirectory */ } }
      else if (entry.isFile() && /\.(md|markdown)$/i.test(entry.name)) files.push(relative(root, path));
    }
  };
  walk(root, 0);
  return files.sort((a, b) => a.localeCompare(b));
}
