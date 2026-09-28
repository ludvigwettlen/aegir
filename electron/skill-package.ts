import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { JSON_SCHEMA, load } from 'js-yaml';
import type { SkillFile } from '../shared/skills.js';

export const MAX_FILE_BYTES = 1024 * 1024;
const MAX_PACKAGE_BYTES = 8 * MAX_FILE_BYTES;
export function safeSkillPath(path: string) {
  if (typeof path !== 'string' || path.length > 240 || !path || path.startsWith('/') || path.includes('\\') || path.split('/').some(part => !part || part === '.' || part === '..' || !/^[\w .-]+$/.test(part)))
    throw new Error('Invalid skill file path');
  return path;
}
export function fileBytes(file: SkillFile) {
  safeSkillPath(file.path);
  if (typeof file.content !== 'string' || !['utf8', 'base64'].includes(file.encoding)) throw new Error('Invalid skill file');
  if (file.content.length > MAX_FILE_BYTES * 2) throw new Error('Skill file is too large');
  if (file.encoding === 'base64' && !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.content)) throw new Error('Invalid base64 file');
  const bytes = Buffer.from(file.content, file.encoding);
  if (bytes.length > MAX_FILE_BYTES) throw new Error('Skill file is too large');
  return bytes;
}
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
export function parseSkill(files: SkillFile[]) {
  if (!Array.isArray(files) || !files.length || files.length > 100) throw new Error('A skill needs 1–100 files');
  const names = new Set<string>(); let total = 0;
  for (const file of files) {
    const key = file.path.toLowerCase();
    if (names.has(key)) throw new Error('Duplicate skill file path');
    names.add(key); total += fileBytes(file).length;
  }
  for (const path of names) {
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) if (names.has(parts.slice(0, i).join('/'))) throw new Error('A package path cannot be both a file and a directory');
  }
  if (total > MAX_PACKAGE_BYTES) throw new Error('Skill package is too large');
  const main = files.find(file => file.path === 'SKILL.md');
  if (!main || main.encoding !== 'utf8') throw new Error('A skill needs a UTF-8 SKILL.md');
  if (Buffer.byteLength(main.content) > 64 * 1024) throw new Error('SKILL.md must be under 64 KB; move detail into reference files');
  const match = main.content.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error('SKILL.md needs YAML frontmatter with name and description');
  // Disallow aliases to avoid recursive metadata and alias expansion attacks.
  if (/(?:^|\s)[&*][\w-]+/.test(match[1])) throw new Error('YAML aliases are not supported');
  const metadata = record(load(match[1], { schema: JSON_SCHEMA }));
  const { name, description } = metadata;
  if (typeof name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64) throw new Error('Skill name must be a lowercase slug (up to 64 characters)');
  if (typeof description !== 'string' || !description.trim() || description.length > 1024) throw new Error('Skill description must be 1–1024 characters');
  const aegir = record(record(metadata.metadata).aegir);
  const strings = (value: unknown): string[] => {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.some(x => typeof x !== 'string')) throw new Error('Skill requirements must be lists of strings');
    return value;
  };
  return { name, description: description.trim(), platforms: strings(metadata.platforms), requiresTools: strings(aegir.requiresTools), runKinds: strings(aegir.runKinds) };
}
export function packageHash(files: SkillFile[]) {
  const hash = createHash('sha256');
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    hash.update(file.path); hash.update('\0'); hash.update(fileBytes(file)); hash.update('\0');
  }
  return hash.digest('hex');
}
export function readPackage(directory: string): SkillFile[] {
  if (lstatSync(directory).isSymbolicLink()) throw new Error('Skill directory cannot be a symlink');
  const root = realpathSync(directory); const files: SkillFile[] = []; let total = 0;
  const walk = (dir: string, prefix = '') => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.DS_Store') continue;
      const path = prefix + entry.name; safeSkillPath(path);
      const absolute = join(dir, entry.name); const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error('Skill symlinks are not supported');
      if (stat.isDirectory()) { walk(absolute, path + '/'); continue; }
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new Error('Invalid or oversized skill file');
      if (++total > 100) throw new Error('Too many skill files');
      const bytes = readFileSync(absolute); const text = bytes.toString('utf8');
      const isText = !bytes.includes(0) && Buffer.from(text, 'utf8').equals(bytes);
      files.push({ path, content: isText ? text : bytes.toString('base64'), encoding: isText ? 'utf8' : 'base64' });
      if (files.reduce((sum, f) => sum + fileBytes(f).length, 0) > MAX_PACKAGE_BYTES) throw new Error('Skill package is too large');
    }
  };
  walk(root); return files;
}
