import { randomUUID } from 'node:crypto';
import { closeSync, constants, fstatSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { documentImageLimit, imageSourceKind } from '../shared/document-images.js';
import { documentLocation, workspaceFile } from './documents.js';

function imageType(bytes: Uint8Array) {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { mime: 'image/png', ext: 'png' };
  if (data[0] === 255 && data[1] === 216 && data[2] === 255) return { mime: 'image/jpeg', ext: 'jpg' };
  if (/^GIF8[79]a$/.test(data.toString('ascii', 0, 6))) return { mime: 'image/gif', ext: 'gif' };
  if (data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  if (data.toString('ascii', 4, 8) === 'ftyp' && /^(avif|avis)$/.test(data.toString('ascii', 8, 12))) return { mime: 'image/avif', ext: 'avif' };
  throw new Error('Choose a PNG, JPEG, GIF, WebP, or AVIF image');
}

export function readDocumentImage(root: string, document: string, src: string): string {
  const location = documentLocation(root, document);
  if (typeof src !== 'string' || imageSourceKind(src) !== 'local') throw new Error('Choose a local image');
  const reference = /^file:/i.test(src) ? fileURLToPath(src) : resolve(dirname(location), decodeURIComponent(src.split(/[?#]/)[0]));
  const path = workspaceFile(root, reference);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > documentImageLimit) throw new Error('Choose an image smaller than 10 MB');
    const bytes = readFileSync(fd);
    return `data:${imageType(bytes).mime};base64,${bytes.toString('base64')}`;
  } finally { closeSync(fd); }
}

export function importDocumentImage(root: string, document: string, name: string, bytes: Uint8Array): string {
  const location = documentLocation(root, document);
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > documentImageLimit) throw new Error('Choose an image smaller than 10 MB');
  if (typeof name !== 'string') throw new Error('Choose an image file');
  const type = imageType(bytes);
  const folder = join(dirname(location), `${basename(location, extname(location))}.assets`);
  try { mkdirSync(folder); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  workspaceFile(root, folder);
  const stem = basename(name, extname(name)).replace(/[^a-z\d_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'image';
  const target = join(folder, `${stem}-${randomUUID()}.${type.ext}`);
  writeFileSync(target, bytes, { flag: 'wx' });
  return relative(dirname(location), target).split('/').map(encodeURIComponent).join('/');
}
