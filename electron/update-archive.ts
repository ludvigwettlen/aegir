import { updateFs } from './update-files.js';
const { createWriteStream } = updateFs;
const { chmod, lstat, mkdir, realpath, symlink } = updateFs.promises;
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import * as yauzl from 'yauzl';

export function updateEntryPath(name: string): string {
  if (name.includes('\\') || name.includes('\0') || isAbsolute(name) || name.split('/').some(p => p === '..' || p === '.')) throw new Error('Unsafe update archive path.');
  if (!name.startsWith('Aegir.app/') && name !== 'Aegir.app') throw new Error('Unexpected file in update archive.');
  return name;
}
export async function extractUpdate(archive: string, root: string, signal: AbortSignal) {
  await mkdir(root, { recursive: false, mode: 0o700 });
  const zip = await new Promise<yauzl.ZipFile>((ok, fail) => yauzl.open(archive, { lazyEntries: true, autoClose: true, validateEntrySizes: true }, (error, file) => error || !file ? fail(error) : ok(file)));
  let total = 0, entries = 0;
  const links: { path: string; target: string }[] = [];
  const seen = new Set<string>();
  const abort = () => zip.close();
  signal.addEventListener('abort', abort, { once: true });
  try {
    await new Promise<void>((ok, fail) => {
      const aborted = () => fail(new Error('Update download cancelled.'));
      signal.addEventListener('abort', aborted, { once: true });
      const clean = () => signal.removeEventListener('abort', aborted);
      zip.once('error', error => { clean(); fail(error); });
      zip.once('end', () => { clean(); ok(); });
      zip.on('entry', async (entry: yauzl.Entry) => {
        try {
          signal.throwIfAborted();
          if (++entries > 100000 || (total += entry.uncompressedSize) > 3 * 1024 ** 3) throw new Error('Update archive exceeds extraction limits.');
          if (entry.fileName.startsWith('__MACOSX/')) { zip.readEntry(); return; }
          const name = updateEntryPath(entry.fileName);
          const key = name.replace(/\/$/, '').toLocaleLowerCase('en-US');
          if (seen.has(key)) throw new Error('Duplicate update archive path.');
          seen.add(key);
          const path = join(root, name), mode = entry.externalFileAttributes >>> 16, kind = mode & 0o170000;
          if (name.endsWith('/')) { await mkdir(path, { recursive: true, mode: 0o755 }); zip.readEntry(); return; }
          if (kind && kind !== 0o100000 && kind !== 0o120000) throw new Error('Unsupported update archive entry.');
          await mkdir(dirname(path), { recursive: true, mode: 0o755 });
          const stream = await new Promise<NodeJS.ReadableStream>((accept, reject) => zip.openReadStream(entry, (e, s) => e || !s ? reject(e) : accept(s)));
          let bytes = 0;
          const meter = new Transform({ transform(chunk, _encoding, done) { bytes += chunk.length; done(bytes > entry.uncompressedSize ? new Error('Invalid extracted size.') : null, chunk); } });
          if (kind === 0o120000) {
            if (entry.uncompressedSize > 4096) throw new Error('Invalid archive link.');
            const chunks: Buffer[] = [];
            for await (const chunk of stream as import('node:stream').Readable) { signal.throwIfAborted(); chunks.push(Buffer.from(chunk)); if (Buffer.concat(chunks).length > 4096) throw new Error('Invalid archive link.'); }
            const target = Buffer.concat(chunks).toString('utf8');
            const resolved = resolve(dirname(path), target), app = join(root, 'Aegir.app');
            if (isAbsolute(target) || target.includes('\0') || !resolved.startsWith(app + '/')) throw new Error('Archive link escapes application.');
            links.push({ path, target });
          } else {
            await pipeline(stream as import('node:stream').Readable, meter, createWriteStream(path, { flags: 'wx', mode: 0o600 }), { signal });
            await chmod(path, mode & 0o111 ? 0o755 : 0o644);
          }
          zip.readEntry();
        } catch (error) { clean(); zip.close(); fail(error); }
      });
      if (signal.aborted) aborted(); else zip.readEntry();
    });
    // Create links last so extraction can never follow an archive-supplied symlink.
    for (const link of links) { signal.throwIfAborted(); await symlink(link.target, link.path); }
    const app = await realpath(join(root, 'Aegir.app'));
    for (const link of links) if (!(await realpath(link.path)).startsWith(app + '/')) throw new Error('Archive link escapes application.');
    if (!(await lstat(join(app, 'Contents/MacOS/Aegir'))).isFile()) throw new Error('Missing Aegir executable.');
    return app;
  } finally { signal.removeEventListener('abort', abort); zip.close(); }
}
