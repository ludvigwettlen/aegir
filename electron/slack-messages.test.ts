import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from './db.js';
import { SlackMessages } from './slack-messages.js';
import { slackMessagePayload, SlackApiError, type SlackRequest } from './slack-api.js';
import type { SlackDraft } from '../shared/slack-messages.js';
vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }));
const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach(fn => fn()));
const fields = { destination: 'C123456', threadTs: '', text: 'Hello, team.', includeFooter: true };
const identity = { ok: true, team_id: 'T123456', user_id: 'U123456', team: 'Team', user: 'alex' };
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'slack-drafts-')); const store = new Store(join(dir, 'db.sqlite'));
  store.setSetting('composioSlackAccount', 'slack_work');
  const request = vi.fn<SlackRequest>(async (_account, method, args) => {
    if (method === 'auth.test') return identity;
    if (method === 'conversations.info') return { channel: { id: args?.channel, name: 'general' } };
    if (method === 'users.info') return { user: { id: args?.user, name: 'sam', profile: { display_name: 'Sam' } } };
    if (method === 'conversations.replies') return { messages: [{ ts: args?.ts, text: 'Original thread' }] };
    if (method === 'conversations.open') return { channel: { id: 'D123456' } };
    if (method === 'chat.postMessage') return { ts: '1730000000.000001', channel: args?.channel };
    if (method === 'users.list') return { members: [{ id: 'U234567', name: 'sam', profile: { display_name: 'Sam Lee' } }], response_metadata: { next_cursor: 'next-page' } };
    return { channels: [] };
  });
  const service = new SlackMessages(store, () => {}, request); const chat = store.createThread(store.groups()[0].id, 'Slack');
  cleanup.push(() => { service.stop(); store.close(); rmSync(dir, { recursive: true, force: true }); });
  const draft = async (value = fields) => (await service.call('draft', value, chat.id) as { draftId: string }).draftId;
  return { store, service, request, chat, draft };
}
describe('Slack message drafts', () => {
  it('defaults the footer on, preserves user choices through agent edits and binds approval to the choice', async () => {
    const { service, store, request, draft, chat } = setup(); const id = await draft();
    expect(store.message(id)?.meta).toMatchObject({ includeFooter: true });
    await expect(service.send(id, 1, { ...fields, includeFooter: false })).rejects.toThrow('displayed Slack');
    await service.update(id, 1, { ...fields, includeFooter: false });
    await service.call('update_draft', { id, revision: 2, ...fields, text: 'Agent revision' }, chat.id);
    expect(store.message(id)?.meta).toMatchObject({ includeFooter: false, revision: 3 });
    await service.send(id, 3, { ...fields, text: 'Agent revision', includeFooter: false });
    const payload = request.mock.calls.find(c => c[1] === 'chat.postMessage')?.[2];
    expect(payload?.text).toBe('Agent revision'); expect(payload).not.toHaveProperty('blocks');
  });
  it('includes the exact footer in visual blocks and accessible fallback without changing long or Unicode text', () => {
    const text = 'a'.repeat(2999) + '🌱' + '\nHello <@U123456>';
    const payload = slackMessagePayload({ ...fields, text });
    expect(payload.text).toBe(text + '\n\nSent using Aegir');
    const blocks = payload.blocks as any[];
    expect(blocks.slice(0, -1).map(b => b.text.text).join('')).toBe(text);
    expect(blocks.slice(0, -1).every(b => b.text.type === 'plain_text' && Array.from(b.text.text).length <= 3000)).toBe(true);
    expect(blocks.at(-1)).toEqual({ type: 'context', elements: [{ type: 'plain_text', text: 'Sent using Aegir', emoji: false }] });
    expect(() => slackMessagePayload({ ...fields, text: 'a'.repeat(40000) })).toThrow('Shorten');
    expect(slackMessagePayload({ ...fields, text: 'a'.repeat(40000), includeFooter: false }).text).toHaveLength(40000);
  });
  it('enables the footer on older editable drafts without changing sent-message history', async () => {
    const { store, request, draft } = setup(); const id = await draft(), sent = await draft();
    const { includeFooter: _unused, ...legacy } = store.message(id)!.meta as SlackDraft;
    store.setMessageMeta(id, legacy as SlackDraft);
    store.setMessageMeta(sent, { ...legacy, state: 'sent' } as SlackDraft);
    new SlackMessages(store, () => {}, request);
    expect(store.message(id)?.meta).toMatchObject({ includeFooter: true, revision: 1 });
    expect(store.message(sent)?.meta).toMatchObject({ includeFooter: false, state: 'sent' });
  });
  it('creates and edits local drafts without posting, opening a DM or accepting an agent send call', async () => {
    const { service, store, request, draft, chat } = setup(); const id = await draft({ ...fields, destination: 'U234567' });
    expect(store.message(id)?.meta).toMatchObject({ destinationName: '@Sam', workspace: 'Team', sender: 'alex', state: 'draft' });
    await service.update(id, 1, { ...fields, destination: 'U234567', text: 'Edited message' });
    await expect(service.call('send', { id }, chat.id)).rejects.toThrow('user to click Send');
    expect(request.mock.calls.some(c => ['chat.postMessage', 'conversations.open'].includes(c[1]))).toBe(false);
  });
  it('binds a single Send click to the exact revision and text and prevents duplicate delivery', async () => {
    const { service, store, request, draft } = setup(); const id = await draft();
    await expect(service.send(id, 2, fields)).rejects.toThrow('changed');
    await expect(service.send(id, 1, { ...fields, text: 'Not the displayed text' })).rejects.toThrow('displayed Slack');
    let resolve!: (value: unknown) => void;
    request.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const sending = service.send(id, 1, fields);
    expect(store.message(id)?.meta).toMatchObject({ state: 'sending', approvedRevision: 1 });
    await expect(service.send(id, 1, fields)).rejects.toThrow();
    await expect(service.update(id, 1, { ...fields, text: 'Changed' })).rejects.toThrow();
    resolve(identity); await sending;
    expect(store.message(id)?.meta).toMatchObject({ state: 'sent', approvedAt: expect.any(String) });
    expect(request.mock.calls.filter(c => c[1] === 'chat.postMessage')).toHaveLength(1);
    expect(request.mock.calls.find(c => c[1] === 'chat.postMessage')?.[2]).toMatchObject({ channel: fields.destination, text: fields.text + '\n\nSent using Aegir', mrkdwn: false, unfurl_links: false, reply_broadcast: false });
    await expect(service.send(id, 1, fields)).rejects.toThrow();
  });
  it('opens a DM only after Send and preserves parent thread destinations', async () => {
    const { service, request, draft } = setup(); const dm = { ...fields, destination: 'U234567' }; const id = await draft(dm);
    await service.send(id, 1, dm);
    expect(request.mock.calls.find(c => c[1] === 'conversations.open')?.[2]).toEqual({ users: 'U234567' });
    expect(request.mock.calls.find(c => c[1] === 'chat.postMessage')?.[2]?.channel).toBe('D123456');
    request.mockClear(); const reply = { ...fields, threadTs: '1730000000.000002' }; const replyId = await draft(reply); await service.send(replyId, 1, reply);
    expect(request.mock.calls.find(c => c[1] === 'chat.postMessage')?.[2]?.thread_ts).toBe(reply.threadTs);
  });
  it.each(['account', 'identity', 'destination'])('blocks sends when the %s changes after drafting', async cause => {
    const { service, store, request, draft } = setup(); const id = await draft();
    if (cause === 'account') store.setSetting('composioSlackAccount', 'another');
    if (cause === 'identity') request.mockResolvedValueOnce({ ...identity, user_id: 'U999999' });
    if (cause === 'destination') request.mockResolvedValueOnce(identity).mockResolvedValueOnce({ channel: { id: fields.destination, name: 'renamed' } });
    await expect(service.send(id, 1, fields)).rejects.toThrow('changed');
    expect(request.mock.calls.some(c => c[1] === 'chat.postMessage')).toBe(false);
  });
  it('keeps ambiguous delivery locked but allows a corrected retry after a definite API rejection', async () => {
    const { service, store, request, draft } = setup(); const id = await draft();
    request.mockResolvedValueOnce(identity).mockResolvedValueOnce({ channel: { id: fields.destination, name: 'general' } }).mockRejectedValueOnce(new Error('timeout'));
    await expect(service.send(id, 1, fields)).rejects.toThrow('timeout'); expect(store.message(id)?.meta).toMatchObject({ state: 'uncertain' });
    await expect(service.send(id, 1, fields)).rejects.toThrow();
    const next = await draft();
    request.mockResolvedValueOnce(identity).mockResolvedValueOnce({ channel: { id: fields.destination, name: 'general' } }).mockRejectedValueOnce(new SlackApiError('not_in_channel'));
    await expect(service.send(next, 1, fields)).rejects.toThrow('not_in_channel'); expect(store.message(next)?.meta).toMatchObject({ state: 'draft' });
  });
  it('recovers interrupted sends without retrying and forbids editing another conversation', async () => {
    const { service, store, request, draft } = setup(); const id = await draft();
    await expect(service.call('update_draft', { ...fields, id, revision: 1 }, 'other-chat')).rejects.toThrow('this conversation');
    store.setMessageMeta(id, { ...(store.message(id)!.meta as SlackDraft), state: 'sending' });
    new SlackMessages(store, () => {}, request); expect(store.message(id)?.meta).toMatchObject({ state: 'uncertain' });
    expect(request.mock.calls.some(c => c[1] === 'chat.postMessage')).toBe(false);
  });
  it('supports recipient search with cursor continuation', async () => {
    const { service, request } = setup(); const found = await service.findTargets('people', 'sam');
    expect(found).toMatchObject({ targets: [{ id: 'U234567', name: '@Sam Lee' }], nextCursor: 'next-page' });
    await service.findTargets('people', 'sam', found.nextCursor);
    expect(request.mock.calls.at(-1)?.[2]).toMatchObject({ cursor: 'next-page' });
  });
});

it('queues Slack delivery for five seconds and preserves the reviewed fields through Undo', async () => {
  const { service, store, draft, request } = setup(), id = await draft(); vi.useFakeTimers();
  try {
    service.queueSend(id, 1, fields);
    await expect(service.update(id, 1, { ...fields, text: 'Changed' })).rejects.toThrow();
    expect(() => service.markSentManually(id, 1)).toThrow();
    await vi.advanceTimersByTimeAsync(4999);
    expect(request.mock.calls.filter(c => c[1] === 'chat.postMessage')).toHaveLength(0);
    service.cancelSend(id, 1); expect(store.message(id)?.meta).toMatchObject({ state: 'draft', text: fields.text });
    service.queueSend(id, 1, fields); await vi.advanceTimersByTimeAsync(5000);
    expect(store.message(id)?.meta).toMatchObject({ state: 'sent' });
    expect(request.mock.calls.filter(c => c[1] === 'chat.postMessage')).toHaveLength(1);
  } finally { vi.useRealTimers(); }
});
