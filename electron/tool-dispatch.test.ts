import { expect, it, vi } from 'vitest';
import { createToolDispatcher } from './tool-dispatch.js';
import type { Runtime } from './runtime.js';

function fixture(readOnly: boolean) {
  let context: ReturnType<Runtime['contextFor']> = { kind: 'chat' };
  const controller = new AbortController();
  const call = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'result' }] }));
  const approve = vi.fn(async () => true);
  const dispatch = createToolDispatcher({
    store: { isOpen: true }, isShuttingDown: () => false,
    runtime: { contextFor: () => context, runSignal: () => controller.signal,
      handleInternalTool: async () => undefined, logToolCall: () => {}, logToolResult: () => {} },
    connectors: { toolInfo: () => ({ name: 'tool', description: '', inputSchema: {}, readOnly }), call },
    approvalForExternal: approve,
  });
  return { dispatch, call, approve, controller, setContext: (next: typeof context) => { context = next; } };
}
it('rechecks discovered permissions instead of trusting the provider-supplied read flag', async () => {
  const f = fixture(false);
  expect(await f.dispatch('notion', 'tool', {}, true, 'run')).toEqual({ content: [{ type: 'text', text: 'result' }] });
  expect(f.approve).toHaveBeenCalledOnce();
  expect(f.call).toHaveBeenCalledOnce();
});
it('denies stale reads and unattended writes at dispatch, even if exposed earlier', async () => {
  const read = fixture(true); read.setContext(undefined);
  await expect(read.dispatch('notion', 'tool', {}, true, 'ended')).rejects.toThrow('This run cannot');
  expect(read.call).not.toHaveBeenCalled();
  const write = fixture(false); write.setContext({ kind: 'routine' });
  await expect(write.dispatch('notion', 'tool', {}, true, 'routine')).rejects.toThrow('This run cannot');
  expect(write.approve).not.toHaveBeenCalled(); expect(write.call).not.toHaveBeenCalled();
});
