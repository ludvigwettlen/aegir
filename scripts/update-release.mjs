#!/usr/bin/env node
// Explicit local release preparation. Never uploads or publishes automatically.
import { generateKeyPairSync, createHash, sign } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, createReadStream } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
const args = process.argv.slice(2);
const privatePath = resolve(homedir(), '.config/aegir-release/private.pem');
if (args[0] === 'keygen') {
  if (existsSync('config/updates.json')) throw new Error('Public release configuration already exists. Restore its matching private key instead of generating another.');
  if (existsSync(privatePath)) throw new Error('Release key already exists; refusing to replace it.');
  const keys = generateKeyPairSync('ed25519', { privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  mkdirSync(dirname(privatePath), { recursive: true, mode: 0o700 });
  writeFileSync(privatePath, keys.privateKey, { mode: 0o600, flag: 'wx' });
  writeFileSync('config/updates.json', JSON.stringify({ repository: 'ludvigwettlen/aegir', publicKey: keys.publicKey }, null, 2) + '\n', { flag: 'wx' });
  console.log('Release key created outside the repository; public configuration written. Back up the private key securely.');
} else if (args[0] === 'manifest') {
  const [_, archive, version, architecture, notesPath, output] = args;
  if (!output || !['arm64', 'x64'].includes(architecture) || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) throw new Error('Usage: manifest archive version arm64|x64 notes-file output-file');
  if (execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()) throw new Error('Commit and verify the release source before signing a manifest.');
  const { basename } = await import('node:path');
  if (!/^Aegir-[0-9A-Za-z.-]+\.zip$/.test(basename(archive))) throw new Error('Use an Aegir-version-architecture.zip asset name.');
  const hash = createHash('sha256'); let size = 0;
  for await (const chunk of createReadStream(archive)) { size += chunk.length; hash.update(chunk); }
  const payload = Buffer.from(JSON.stringify({ schema: 1, version, commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), architecture,
    minimumSystemVersion: '14.0', asset: basename(archive), size, sha256: hash.digest('hex'), notes: readFileSync(notesPath, 'utf8') }));
  writeFileSync(output, JSON.stringify({ payload: payload.toString('base64'), signature: sign(null, payload, readFileSync(privatePath)).toString('base64') }) + '\n');
  console.log('Signed manifest prepared. Publishing is a separate explicit step.');
} else throw new Error('Use keygen or manifest.');
