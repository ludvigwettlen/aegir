import { afterEach, expect, it, vi } from 'vitest';
import { DraftSendQueue } from './draft-send-queue.js';
afterEach(() => vi.useRealTimers());
function fixture() {
  vi.useFakeTimers();
  let draft = { state: 'draft', revision: 1, queuedUntil: undefined as number | undefined };
  const queue = new DraftSendQueue(() => draft, (_id, value) => { draft = value; });
  const deliver = vi.fn(async () => { draft = { ...draft, state: 'sent' }; });
  return { queue, deliver, get draft() { return draft; } };
}
it('waits five seconds, locks duplicate actions and delivers once', async () => {
  const f = fixture(); f.queue.queue('id', 1, f.deliver);
  expect(f.draft.state).toBe('queued');
  expect(() => f.queue.queue('id', 1, f.deliver)).toThrow();
  expect(() => f.queue.markSentManually('id', 1)).toThrow();
  await vi.advanceTimersByTimeAsync(4999); expect(f.deliver).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1); expect(f.deliver).toHaveBeenCalledTimes(1);
  expect(() => f.queue.cancel('id', 1)).toThrow('already started');
});
it('undo and stopping the app cancel delivery; manual completion sends nothing', async () => {
  const f = fixture(); f.queue.queue('id', 1, f.deliver);
  f.queue.cancel('id', 1); await vi.advanceTimersByTimeAsync(6000);
  expect(f.deliver).not.toHaveBeenCalled(); expect(f.draft.state).toBe('draft');
  f.queue.queue('id', 1, f.deliver); f.queue.stop(); await vi.advanceTimersByTimeAsync(6000);
  expect(f.deliver).not.toHaveBeenCalled(); expect(f.draft.state).toBe('draft');
  expect(f.queue.markSentManually('id', 1)).toMatchObject({ state: 'sent-manually', manuallySentAt: expect.any(String) });
  expect(() => f.queue.queue('id', 1, f.deliver)).toThrow();
});
