import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from './db.js';
import { GmailService } from './gmail.js';
import { cleanEmailFields, rawEmail, replyCandidate, type GmailThread, type GmailRequest } from './gmail-api.js';
import type { EmailDraft } from '../shared/gmail.js';
vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }));
const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach(fn => fn()));
const fields = { to: 'peer@example.com', cc: '', bcc: '', subject: 'A decision', body: 'Yes, let’s do it.' };
const thread = (): GmailThread => ({ id: 'abc123', messages: [{ id: 'def456', threadId: 'abc123', internalDate: '123456789', labelIds: ['INBOX'], payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: 'peer@example.com' }, { name: 'To', value: 'me@example.com' }, { name: 'Subject', value: 'A decision' }, { name: 'Message-ID', value: '<one@example.com>' }], body: { data: Buffer.from('Can you approve this today?').toString('base64url') } } }] });
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'gmail-test-')); const store = new Store(join(dir, 'db.sqlite'));
  store.setSetting('gmailAccount', 'gmail_work'); store.setSetting('gmailEmail', 'me@example.com');
  let current = thread();
  const request = vi.fn<GmailRequest>(async (_account, path) => {
    if (path === 'profile') return { emailAddress: 'me@example.com' };
    if (path === 'messages/send') return { id: 'sent123' };
    if (path.startsWith('threads?')) return { threads: [{ id: current.id }] };
    return structuredClone(current);
  });
  const review = vi.fn(async () => [{ threadId: current.id, needsReply: true, reason: 'The sender asks you to approve the decision today.' }]);
  const service = new GmailService(store, review, () => {}, request);
  const chat = store.createThread(store.groups()[0].id, 'Email');
  cleanup.push(() => { service.stop(); store.close(); rmSync(dir, { recursive: true, force: true }); });
  const draft = async () => (await service.call('draft', fields, chat.id) as { draftId: string }).draftId;
  return { service, store, request, review, chat, draft, setThread: (value: GmailThread) => { current = value; } };
}
describe('Gmail reply filters and MIME', () => {
  it('keeps read direct requests but excludes bulk, calendar, other recipients and already replied threads', () => {
    expect(replyCandidate(thread(), 'me@example.com')).not.toBeNull();
    for (const label of ['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_UPDATES', 'SENT', 'TRASH']) {
      const t = thread(); t.messages[0].labelIds!.push(label); expect(replyCandidate(t, 'me@example.com')).toBeNull();
    }
    for (const [name, value] of [['List-Unsubscribe', '<url>'], ['Auto-Submitted', 'auto-generated'], ['From', 'no-reply@example.com'], ['To', 'someone@example.com']]) {
      const t = thread(); t.messages[0].payload!.headers = t.messages[0].payload!.headers!.filter(h => h.name !== name).concat({ name, value });
      expect(replyCandidate(t, 'me@example.com')).toBeNull();
    }
    const t = thread(); t.messages[0].payload!.parts = [{ mimeType: 'text/calendar' }]; expect(replyCandidate(t, 'me@example.com')).toBeNull();
  });
  it('rejects header injection and encodes unicode and reply headers', () => {
    expect(() => cleanEmailFields({ ...fields, to: 'a@b.com\r\nBcc: bad@b.com' })).toThrow();
    const draft = { ...fields, type: 'email-draft', revision: 1, account: 'work', email: 'me@example.com', state: 'draft', inReplyTo: '<one@example.com>' } as EmailDraft;
    const raw = Buffer.from(rawEmail(draft), 'base64url').toString();
    expect(raw).toContain('In-Reply-To: <one@example.com>'); expect(raw).toContain('References: <one@example.com>');
    expect(raw).toContain(Buffer.from(fields.body).toString('base64'));
    expect(() => rawEmail({ ...draft, to: 'Name <a@b.com>' })).toThrow();
  });
});
describe('Gmail approval boundary', () => {
  it('pins reads to the expected identity and has no agent-accessible send tool', async () => {
    const { service, request, chat } = setup();
    expect(service.tools(false).every(t => t.readOnly)).toBe(true);
    await expect(service.call('send', fields, chat.id)).rejects.toThrow('Sending requires');
    request.mockResolvedValueOnce({ emailAddress: 'wrong@example.com' });
    await expect(service.call('search', { query: 'in:inbox' })).rejects.toThrow('does not match');
    expect(request.mock.calls.filter(c => c[1] === 'messages/send')).toHaveLength(0);
  });
  it('never posts on denial and preserves edits with optimistic revision checks', async () => {
    const { service, store, draft, request } = setup(); const id = await draft();
    const updated = service.update(id, 1, { ...fields, body: 'Changed' });
    expect(() => service.update(id, 1, fields)).toThrow('changed');
    await service.send(id, updated.revision, async detail => { expect(detail).toContain('Changed'); return false; });
    expect(store.message(id)?.meta).toMatchObject({ body: 'Changed', state: 'draft' });
    expect(request.mock.calls.filter(c => c[2] === 'POST')).toHaveLength(0);
  });
  it('locks the exact email during approval and prevents duplicate sends', async () => {
    const { service, store, draft, request } = setup(); const id = await draft();
    let resolve!: (approved: boolean) => void;
    const pending = service.send(id, 1, () => new Promise(r => { resolve = r; }));
    expect(store.message(id)?.meta).toMatchObject({ state: 'awaiting-approval' });
    expect(() => service.update(id, 1, { ...fields, to: 'attacker@example.com' })).toThrow();
    await expect(service.send(id, 1, async () => true)).rejects.toThrow();
    expect(request.mock.calls.filter(c => c[2] === 'POST')).toHaveLength(0);
    resolve(true); await pending;
    expect(store.message(id)?.meta).toMatchObject({ state: 'sent', sentId: 'sent123' });
    expect(request.mock.calls.filter(c => c[2] === 'POST')).toHaveLength(1);
    await expect(service.send(id, 1, async () => true)).rejects.toThrow();
  });
  it('rechecks identity after approval and does not send when it changes', async () => {
    const { service, draft, request } = setup(); const id = await draft(); request.mockResolvedValueOnce({ emailAddress: 'wrong@example.com' });
    await expect(service.send(id, 1, async () => true)).rejects.toThrow('does not match');
    expect(request.mock.calls.filter(c => c[2] === 'POST')).toHaveLength(0);
  });
  it('does not retry ambiguous delivery and recovers interrupted sends safely', async () => {
    const { service, store, draft, request, review } = setup(); const id = await draft();
    request.mockImplementation(async (_account, path) => { if (path === 'profile') return { emailAddress: 'me@example.com' }; throw new Error('timeout'); });
    await expect(service.send(id, 1, async () => true)).rejects.toThrow('timeout');
    expect(store.message(id)?.meta).toMatchObject({ state: 'uncertain' });
    await expect(service.send(id, 1, async () => true)).rejects.toThrow();
    store.setMessageMeta(id, { ...(store.message(id)!.meta as EmailDraft), state: 'sending' });
    new GmailService(store, review, () => {}, request);
    expect(store.message(id)?.meta).toMatchObject({ state: 'uncertain' });
  });
  it('retains source reply headers and ignores model-supplied header overrides', async () => {
    const { service, store, chat } = setup(); const { draftId } = await service.call('draft', { ...fields, subject: 'Unrelated', replyThreadId: 'abc123', inReplyTo: '<fake>' }, chat.id) as { draftId: string };
    expect(store.message(draftId)?.meta).toMatchObject({ subject: 'A decision', inReplyTo: '<one@example.com>', replyThreadId: 'abc123' });
  });
});
describe('Gmail inbox', () => {
  it('deduplicates all task statuses, finishes replied tasks, and permits a new request after completion', async () => {
    const { service, store, setThread } = setup(); await service.sync();
    const tasks = () => store.list('tasks').filter(t => t.sourceKey?.startsWith('gmail:'));
    expect(tasks()).toHaveLength(1); expect(tasks()[0]).toMatchObject({ status: 'ready', listId: null, label: 'email' });
    await service.sync(); expect(tasks()).toHaveLength(1);
    store.updateTask(tasks()[0].id, { status: 'dismissed' }); await service.sync(); expect(tasks()).toHaveLength(1);
    store.updateTask(tasks()[0].id, { status: 'ready' });
    const sent = thread(); sent.messages.push({ ...sent.messages[0], id: 'aaa', internalDate: '123456790', labelIds: ['SENT'] }); setThread(sent);
    await service.sync(); expect(tasks()[0].status).toBe('done');
    const next = thread(); next.messages[0].id = 'def789'; setThread(next); await service.sync(); expect(tasks()).toHaveLength(2);
  });
  it('caches negative decisions and never creates a task from an unclassified message', async () => {
    const { service, store, review } = setup(); review.mockResolvedValue([{ threadId: 'abc123', needsReply: false, reason: 'Only an FYI' }]);
    await service.sync(); await service.sync(); expect(review).toHaveBeenCalledTimes(1);
    expect(store.list('tasks').filter(t => t.sourceKey?.startsWith('gmail:'))).toHaveLength(0);
  });
  it('rechecks positive decisions against replies arriving during classification', async () => {
    const { service, store, review, setThread } = setup();
    review.mockImplementation(async () => { const t = thread(); t.messages[0].labelIds = ['SENT']; setThread(t); return [{ threadId: 'abc123', needsReply: true, reason: 'Reply owed' }]; });
    await service.sync(); expect(store.list('tasks').filter(t => t.sourceKey?.startsWith('gmail:'))).toHaveLength(0);
  });
  it('preserves tasks on partial failures and handles pagination', async () => {
    const { service, store, request } = setup(); await service.sync(); const before = store.list('tasks');
    request.mockImplementation(async (_a, path) => path === 'profile' ? { emailAddress: 'me@example.com' } : { threads: [], nextPageToken: 'same' });
    await expect(service.sync()).rejects.toThrow('repeated'); expect(store.list('tasks')).toEqual(before);
    expect(service.snapshot().error).toContain('repeated'); expect(service.snapshot().syncing).toBe(false);
  });
});
