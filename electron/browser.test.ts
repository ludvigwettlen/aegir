import { describe, expect, it, vi } from 'vitest';
import { BrowserManager } from './browser.js';
import type { BrowserBackend } from './browser-backend.js';

function fixture(approve = vi.fn(async (_thread: string, _detail: string, _signal: AbortSignal) => true)) {
  const backend: BrowserBackend = {
    listTools: vi.fn(async () => ({ tools: [
      { name: 'browser_snapshot', inputSchema: { type: 'object', properties: { filename: { type: 'string' } } } },
      { name: 'browser_evaluate', inputSchema: {} },
      { name: 'browser_file_upload', inputSchema: {} },
    ] })),
    callTool: vi.fn(async () => ({ content: [{ type: 'text', text: 'Page loaded' }] })),
    close: vi.fn(async () => {}),
  };
  const factory = vi.fn(async () => backend);
  const manager = new BrowserManager(true, factory, approve, vi.fn());
  const call = (id = 'run-1', tool = 'browser_snapshot', args = {}) => manager.call(id, 'app-thread', 'chat', tool, args);
  return { manager, factory, backend, approve, call };
}

describe('browser access and lifecycle', () => {
  it('requires one approval per response and excludes unrestricted code and file tools', async () => {
    const { manager, call, approve, backend } = fixture();
    const definitions = await manager.tools('chat');
    expect(definitions.map(tool => tool.name)).toEqual(['browser__browser_snapshot']);
    expect(definitions[0].inputSchema).toEqual({ type: 'object', properties: {} });
    await call();
    await call();
    expect(approve).toHaveBeenCalledTimes(1);
    await expect(call('other-run')).rejects.toThrow('Another agent');
    await manager.finish('run-1');
    expect(backend.close).toHaveBeenCalledOnce();
    await call('other-run');
    expect(approve).toHaveBeenCalledTimes(2);
    await manager.close();
  });

  it('does not execute or reprompt after denial', async () => {
    const { call, backend, approve, manager } = fixture(vi.fn(async () => false));
    await expect(call()).rejects.toThrow('declined');
    await expect(call()).rejects.toThrow('declined');
    expect(approve).toHaveBeenCalledOnce();
    expect(backend.callTool).not.toHaveBeenCalled();
    await manager.finish('run-1');
  });

  it('cancels pending approval and does not accept late approval', async () => {
    let resolve!: (value: boolean) => void;
    const { call, manager, backend, approve } = fixture(vi.fn(() => new Promise<boolean>(r => { resolve = r; })));
    const pending = call();
    await vi.waitFor(() => expect(approve).toHaveBeenCalledOnce());
    const signal = approve.mock.calls[0][2];
    await manager.stop();
    expect(signal.aborted).toBe(true);
    resolve(true);
    await expect(pending).rejects.toThrow('stopped');
    expect(backend.callTool).not.toHaveBeenCalled();
    await expect(call()).rejects.toThrow('stopped');
  });

  it('aborts an in-flight operation and blocks further actions in that response', async () => {
    const { call, manager, backend } = fixture();
    vi.mocked(backend.callTool).mockImplementation((_name, _args, signal) => new Promise((_resolve, reject) => {
      signal!.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
    }));
    const pending = call().catch(error => error);
    await vi.waitFor(() => expect(backend.callTool).toHaveBeenCalledOnce());
    await manager.stop();
    expect((await pending).message).toBe('cancelled');
    expect(backend.close).toHaveBeenCalledOnce();
    await expect(call()).rejects.toThrow('stopped');
  });

  it('does not launch the browser after a user cancels opening during backend creation', async () => {
    const { manager, backend, factory } = fixture();
    let resolve!: (value: BrowserBackend) => void;
    factory.mockImplementation(() => new Promise(r => { resolve = r; }));
    const opening = manager.open().catch(error => error);
    const stopping = manager.stop();
    resolve(backend);
    expect((await opening).message).toContain('cancelled');
    await stopping;
    expect(backend.callTool).not.toHaveBeenCalled();
    expect(backend.close).toHaveBeenCalledOnce();
  });

  it('enforces disabled, unattended, unsafe path and URL boundaries before execution', async () => {
    const { manager, call, backend, approve } = fixture();
    expect(await manager.tools('routine')).toEqual([]);
    await expect(manager.call('run', 'thread', 'routine', 'browser_snapshot', {})).rejects.toThrow('routines');
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'https://user:pass@example.com'])
      await expect(call('run-1', 'browser_navigate', { url })).rejects.toThrow();
    await expect(call('run-1', 'browser_snapshot', { filename: '/tmp/arbitrary' })).rejects.toThrow('paths');
    await expect(call('run-1', 'browser_evaluate', { function: '() => 1' })).rejects.toThrow('Unsupported');
    expect(approve).not.toHaveBeenCalled();
    expect(backend.callTool).not.toHaveBeenCalled();
    await manager.setEnabled(false);
    expect(await manager.tools('chat')).toEqual([]);
    await expect(call()).rejects.toThrow('off');
  });

  it('reports backend errors and allows a later retry', async () => {
    const { manager, call, backend } = fixture();
    vi.mocked(backend.callTool).mockResolvedValueOnce({ isError: true, content: [{ type: 'text', text: 'Chrome is not installed' }] });
    expect((await call()).success).toBe(false);
    expect(manager.state).toMatchObject({ status: 'error', detail: 'Chrome is not installed' });
    expect((await call()).success).toBe(true);
    await manager.close();
  });
});
