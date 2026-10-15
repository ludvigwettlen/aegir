import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { feedbackInputSchema, feedbackSchema, type UiFeedback, type UiFeedbackState } from '../shared/ui-feedback.js';

const fileSchema = z.object({ version: z.literal(1), comments: z.array(feedbackSchema).max(10000) });

// Read on every operation so comments resolved by a coding agent are picked up too.
// Synchronous read/modify/rename keeps renderer requests serialized in the main process.
export class UiFeedbackStore {
  constructor(readonly path: string) {}
  list(): UiFeedbackState {
    let contents: string;
    try { contents = readFileSync(this.path, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { path: this.path, comments: [] }; throw error; }
    const parsed = fileSchema.safeParse(JSON.parse(contents));
    if (!parsed.success) throw new Error('UI comments could not be read. The saved file has been preserved.');
    return { path: this.path, comments: parsed.data.comments };
  }
  private save(comments: UiFeedback[]) {
    const value = fileSchema.parse({ version: 1, comments });
    mkdirSync(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
      renameSync(temporary, this.path);
    } finally { rmSync(temporary, { force: true }); }
    return { path: this.path, comments };
  }
  add(input: unknown) {
    const value = feedbackInputSchema.parse(input);
    const { comments } = this.list();
    return this.save([...comments, { ...value, id: randomUUID(), createdAt: new Date().toISOString(), resolvedAt: null }]);
  }
  resolve(id: string, resolved: boolean) {
    z.string().uuid().parse(id); z.boolean().parse(resolved);
    const { comments } = this.list();
    if (!comments.some(comment => comment.id === id)) throw new Error('This UI comment no longer exists. Reopen UI comments to refresh.');
    return this.save(comments.map(comment => comment.id === id ? { ...comment, resolvedAt: resolved ? new Date().toISOString() : null } : comment));
  }
}
