import { randomUUID } from 'node:crypto';
import { constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { attachmentLimits, type Attachment } from '../shared/attachments.js';
import { workspaceFile } from './documents.js';

export function importAttachment(root: string, name: string, bytes: Uint8Array): Attachment {
  if (typeof name !== 'string' || !name.trim() || !(bytes instanceof Uint8Array)) throw new Error('Choose a file to attach');
  if (bytes.byteLength > attachmentLimits.file) throw new Error('Each attachment must be 50 MB or smaller');
  root = realpathSync(root);
  const folder = join(root, 'attachments');
  mkdirSync(folder, { recursive: true });
  workspaceFile(root, folder); // Reject a symlink before reading or writing the directory.
  let total = 0;
  for (const name of readdirSync(folder)) {
    const stat = lstatSync(join(folder, name));
    if (stat.isFile()) total += stat.size;
  }
  if (total + bytes.byteLength > attachmentLimits.folder) throw new Error('This conversation has reached its 200 MB attachment limit');
  const safeName = basename(name.replace(/\\/g, '/')).replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(-160) || 'file';
  const path = join(folder, `${randomUUID()}-${safeName}`);
  writeFileSync(path, bytes, { flag: 'wx', mode: 0o600 });
  return { path, name: safeName, size: bytes.byteLength };
}
export function readAttachment(root: string, reference: string): Attachment {
  root = realpathSync(root);
  const path = workspaceFile(root, reference);
  const folder = workspaceFile(root, join(root, 'attachments'));
  if (join(folder, basename(path)) !== path || !/^[\da-f-]{36}-/.test(basename(path))) throw new Error('Choose an attachment from this conversation');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > attachmentLimits.file) throw new Error('Attachment is missing or too large');
    return { path, name: basename(path).slice(37), size: stat.size };
  } finally { closeSync(fd); }
}
