import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from './db.js';
import { ClaudeDrafts, emailHtml } from './claude-drafts.js';
import { CallGate } from './gated.js';
import type { ModelProvider } from './codex.js';
import type { EmailDraft, EmailFields } from '../shared/gmail.js';
import { providerSetup } from '../shared/provider-setup.js';
vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }));
const cleanup: (() => void)[] = [];
afterEach(() => { cleanup.splice(0).forEach(fn => fn()); vi.useRealTimers(); });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'claude-drafts-')), store = new Store(join(dir, 'db'));
  store.setSetting('providerSetup', JSON.stringify(providerSetup({ preset: 'legolas', brainDir: '/brain', brainId: 'host', sourceId: 'default' })));
  let external = { draft_id: 'draft1', thread_id: 'thread1', to: ['peer@example.com'], cc: [], bcc: [], subject: 'Hello', body: '<div>Original</div>' };
  let failSend = false;
  const calls: { tool: string; input: Record<string, unknown> }[] = [];
  const engine = { sendGated: vi.fn(async plan => {
    const gate = new CallGate(plan);
    for (const call of plan) {
      const decision = await gate.before(call.tool);
      if (!decision.allow) break;
      const input = decision.input!; calls.push({ tool: call.tool, input });
      if (call.tool.endsWith('send_draft') && failSend) { gate.failed(call.tool, 'Connection lost'); break; }
      const response = call.tool.endsWith('get_draft') ? { ...external }
        : call.tool.endsWith('create_or_update_draft') ? (external = { ...external, ...input } as typeof external)
        : call.tool.endsWith('slack_search_channels') ? { channels: [{ id: input.query, name: 'team' }] }
        : call.tool.endsWith('slack_send_message') ? { ok: true, ts: '123.456' } : { success: true };
      gate.after(call.tool, input, response);
      if (gate.done) break;
    }
    return gate.outcome();
  }) } as unknown as ModelProvider;
  const service = new ClaudeDrafts(store, engine, () => {}), chat = store.createThread(store.groups()[0].id, 'Drafts');
  cleanup.push(() => { service.stop(); store.close(); rmSync(dir, { recursive: true, force: true }); });
  const email = async () => (await service.call('draft', { channel: 'email', text: 'My reviewed reply', draft_id: 'draft1', thread_id: 'thread1', acting_email: 'me@example.com', kind: 'reply' }, chat.id) as { draftId: string }).draftId;
  return { store, service, engine, chat, calls, email, changeExternal: () => { external.subject = 'Changed outside Aegir'; }, failSend: () => { failSend = true; } };
}
it('sends the latest edited email fields through the locked Superhuman plan after the countdown', async () => {
  const f = fixture(), id = await f.email(); vi.useFakeTimers();
  const fields: EmailFields = { to: 'different@example.com', cc: 'copy@example.com', bcc: '', subject: 'Updated', body: 'Hi <Sam>\nApproved.' };
  await f.service.update(id, 1, fields); f.service.queueSend(id, 2, fields);
  expect(f.service.hasActiveWork).toBe(true);
  await vi.advanceTimersByTimeAsync(4999); expect(f.calls.some(c => c.tool.endsWith('send_draft'))).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(f.store.message(id)?.meta).toMatchObject({ state: 'sent', to: fields.to, subject: fields.subject });
  expect(f.calls.find(c => c.tool.endsWith('create_or_update_draft'))?.input).toMatchObject({ to: ['different@example.com'], cc: ['copy@example.com'], bcc: [], subject: 'Updated', body: emailHtml(fields.body), acting_email: 'me@example.com' });
  expect(f.calls.filter(c => c.tool.endsWith('send_draft'))).toHaveLength(1);
  expect(() => f.service.queueSend(id, 2, fields)).toThrow();
});
it('refuses changed external drafts and never retries an uncertain send', async () => {
  const f = fixture(), id = await f.email(), draft = f.store.message(id)!.meta as EmailDraft;
  f.changeExternal(); vi.useFakeTimers(); f.service.queueSend(id, 1, draft); await vi.advanceTimersByTimeAsync(5000);
  expect(f.store.message(id)?.meta).toMatchObject({ state: 'draft', error: expect.stringContaining('external draft changed') });
  expect(f.calls.some(c => c.tool.endsWith('create_or_update_draft'))).toBe(false);
  const next = await f.email(), nextDraft = f.store.message(next)!.meta as EmailDraft;
  f.failSend(); f.service.queueSend(next, 1, nextDraft); await vi.advanceTimersByTimeAsync(5000);
  expect(f.store.message(next)?.meta).toMatchObject({ state: 'uncertain' });
  expect(() => f.service.queueSend(next, 1, nextDraft)).toThrow();
});
it('uses Claude Slack for exact reviewed text including the footer and does not send manual completions', async () => {
  const f = fixture();
  const { draftId } = await f.service.call('draft', { channel: 'slack', destination: 'C123456', text: 'Hello team' }, f.chat.id) as { draftId: string };
  const draft = f.store.message(draftId)!.meta as import('../shared/slack-messages.js').SlackDraft;
  vi.useFakeTimers(); f.service.queueSend(draftId, 1, draft); f.service.cancelSend(draftId, 1); await vi.advanceTimersByTimeAsync(5000);
  expect(f.calls.some(c => c.tool.endsWith('slack_send_message'))).toBe(false);
  f.service.queueSend(draftId, 1, draft); await vi.advanceTimersByTimeAsync(5000);
  expect(f.store.message(draftId)?.meta).toMatchObject({ state: 'sent' });
  expect(f.calls.find(c => c.tool.endsWith('slack_send_message'))?.input).toMatchObject({ text: 'Hello team\n\nSent using Aegir', channel_id: 'C123456' });
  const id = await f.email(); f.service.markSentManually(id, 1);
  expect(f.store.message(id)?.meta).toMatchObject({ state: 'sent-manually' });
});
it('rejects stale revisions, cross-chat edits and connection switching; restart cancels queued sends', async () => {
  const f = fixture(), id = await f.email(), draft = f.store.message(id)!.meta as EmailDraft;
  await expect(f.service.call('update_draft', { id, revision: 1, text: 'Changed' }, 'other-chat')).rejects.toThrow('another conversation');
  expect(() => f.service.queueSend(id, 0, draft)).toThrow();
  vi.useFakeTimers(); f.service.queueSend(id, 1, draft); f.service.stop();
  const reopened = new ClaudeDrafts(f.store, f.engine, () => {});
  expect(f.store.message(id)?.meta).toMatchObject({ state: 'draft' }); reopened.stop();
  f.store.setSetting('providerSetup', JSON.stringify(providerSetup({ preset: 'aegir', brainDir: '', brainId: 'host', sourceId: 'default' })));
  const switched = new ClaudeDrafts(f.store, f.engine, () => {});
  expect(() => switched.queueSend(id, 1, draft)).toThrow('Claude setup'); switched.stop();
  await vi.advanceTimersByTimeAsync(5000); expect(f.calls.some(c => c.tool.endsWith('send_draft'))).toBe(false);
});
