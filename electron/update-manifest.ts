import { verify } from 'node:crypto';
import { z } from 'zod';

const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const manifestSchema = z.strictObject({
  schema: z.literal(1), version: z.string().regex(versionPattern), commit: z.string().regex(/^[a-f0-9]{40}$/),
  architecture: z.enum(['arm64', 'x64']), minimumSystemVersion: z.string().regex(/^\d+(?:\.\d+){0,2}$/),
  asset: z.string().regex(/^Aegir-[0-9A-Za-z.-]+\.zip$/), size: z.number().int().positive().max(1024 ** 3),
  sha256: z.string().regex(/^[a-f0-9]{64}$/), notes: z.string().max(20000),
});
export type UpdateManifest = z.infer<typeof manifestSchema>;
export function compareVersions(a: string, b: string): number {
  if (!versionPattern.test(a) || !versionPattern.test(b)) throw new Error('Invalid application version.');
  const parse = (v: string) => { const [core, ...pre] = v.split('-'); return { core: core.split('.').map(Number), pre: pre.join('-') }; };
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i] > y.core[i] ? 1 : -1;
  if (!x.pre || !y.pre) return x.pre === y.pre ? 0 : x.pre ? -1 : 1;
  const xp = x.pre.split('.'), yp = y.pre.split('.');
  for (let i = 0; i < Math.max(xp.length, yp.length); i++) {
    if (xp[i] === undefined || yp[i] === undefined) return xp[i] === undefined ? -1 : 1;
    if (xp[i] === yp[i]) continue;
    const xn = /^\d+$/.test(xp[i]), yn = /^\d+$/.test(yp[i]);
    return xn && yn ? (Number(xp[i]) > Number(yp[i]) ? 1 : -1) : xn !== yn ? (xn ? -1 : 1) : xp[i] > yp[i] ? 1 : -1;
  }
  return 0;
}
export function readSignedManifest(text: string, publicKey: string): UpdateManifest {
  if (Buffer.byteLength(text) > 100000) throw new Error('Update manifest is too large.');
  const envelope = z.strictObject({ payload: z.string().max(50000), signature: z.string().max(200) }).parse(JSON.parse(text));
  const payload = Buffer.from(envelope.payload, 'base64');
  if (!publicKey || !verify(null, payload, publicKey, Buffer.from(envelope.signature, 'base64'))) throw new Error('Update signature verification failed.');
  return manifestSchema.parse(JSON.parse(payload.toString('utf8')));
}
