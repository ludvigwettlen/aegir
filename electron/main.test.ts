import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EventEmitter } from 'node:events';
import { rmSync } from 'node:fs';
import { Store } from './db.js';

const fixture = vi.hoisted(() => ({
  root: '',
  app: null as unknown as EventEmitter,
  codex: null as unknown as EventEmitter,
  connectors: null as unknown as EventEmitter,
  send: vi.fn(),
  started: vi.fn(),
  toolHandler: null as any,
  context: null as any,
  window: null as any,
  preferences: null as any,
  controller: null as AbortController | null,
  handlers: new Map<string, (...args: any[]) => any>(),
  call: vi.fn(async () => ({ saved: true })),
}));

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  fixture.root = mkdtempSync(join(tmpdir(), 'aegir-main-test-'));
  fixture.app = Object.assign(new EventEmitter(), {
    getPath: () => fixture.root,
    getAppPath: () => fixture.root,
    requestSingleInstanceLock: () => true,
    whenReady: () => Promise.resolve(),
    getLoginItemSettings: () => ({}),
  });
  class BrowserWindow extends EventEmitter {
    webContents = Object.assign(new EventEmitter(), {
      send: fixture.send, isDestroyed: () => false, setWindowOpenHandler: () => {}, mainFrame: { url: '' },
    });
    constructor(options: any) { super(); fixture.window = this; fixture.preferences = options.webPreferences; }
    isDestroyed() { return false; }
    async loadFile(path: string) { this.webContents.mainFrame.url = (await import('node:url')).pathToFileURL(path).href; }
    async loadURL(url: string) { this.webContents.mainFrame.url = url; }
  }
  class Tray extends EventEmitter { setToolTip() {} setContextMenu() {} }
  return {
    app: fixture.app, BrowserWindow, Tray, nativeTheme: Object.assign(new EventEmitter(), { prefersReducedTransparency: false }),
    ipcMain: { handle: (name: string, handler: (...args: any[]) => any) => fixture.handlers.set(name, handler) }, powerMonitor: new EventEmitter(),
    Menu: { buildFromTemplate: () => ({}), setApplicationMenu: () => {} },
    nativeImage: { createFromDataURL: () => ({}) }, clipboard: {}, dialog: {}, shell: {},
  };
});
vi.mock('./codex.js', async () => {
  const { EventEmitter } = await import('node:events');
  return { CodexProvider: class extends EventEmitter {
    constructor() { super(); fixture.codex = this; }
    setToolHandler(handler: any) { fixture.toolHandler = handler; }
    async start() { fixture.started(); }
    resolveApproval() {}
    close() { this.emit('status'); } // A synchronous status during teardown.
  } };
});
vi.mock('./connectors.js', async () => {
  const { EventEmitter } = await import('node:events');
  return { ConnectorManager: class extends EventEmitter {
    states = {};
    constructor() { super(); fixture.connectors = this; }
    composioConfigured() { return false; }
    slackConfigured() { return false; }
    start() {}
    toolInfo() { return { readOnly: false }; }
    call(...args: any[]) { return fixture.call(); }
    close() { this.emit('change'); }
  } };
});
vi.mock('./runtime.js', () => ({ Runtime: class {
  start() {} stop() {}
  logToolCall() {} logToolResult() {}
  async handleInternalTool() { return undefined; }
  contextFor() { return fixture.context; }
  runSignal() { return fixture.controller?.signal; }
} }));
vi.mock('./memory.js', () => ({ MemoryService: class { async migrateLegacy() {} } }));

afterEach(() => {
  fixture.app.emit('before-quit');
  vi.restoreAllMocks();
  rmSync(fixture.root, { recursive: true, force: true });
});

describe('application shutdown', () => {
  it('stops real snapshot reads during teardown and after SQLite closes', async () => {
    const reads = vi.spyOn(Store.prototype, 'list');
    const close = vi.spyOn(Store.prototype, 'close');
    await import('./main.js');
    await vi.waitFor(() => expect(fixture.codex).toBeTruthy());
    expect(fixture.preferences).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false });
    expect(fixture.started).not.toHaveBeenCalled(); // Fresh installs require a setup choice.
    fixture.codex.emit('status');
    fixture.connectors.emit('change');
    expect(reads).toHaveBeenCalled();
    expect(fixture.send).toHaveBeenCalledWith('app-event', expect.objectContaining({ type: 'snapshot' }));
    // Exercise the actual main-process approval surface and connector dispatcher.
    for (const end of ['stop', 'complete', 'replace', 'approve'] as const) {
      fixture.context = { kind: 'chat' };
      fixture.controller = new AbortController();
      fixture.call.mockClear();
      const pending = fixture.toolHandler('notion', 'update-page', {}, false, 'provider-thread');
      const result = pending.then((value: unknown) => value, (error: Error) => error);
      await vi.waitFor(() => expect(fixture.send.mock.calls.some(([, event]) => event.value?.approvals?.length)).toBe(true));
      const snapshot = [...fixture.send.mock.calls].reverse().find(([, event]) => event.value?.approvals?.length)![1].value;
      const id = snapshot.approvals[0].id;
      if (end === 'stop') fixture.controller.abort();
      if (end === 'complete') { fixture.context = null; fixture.controller.abort(); }
      if (end === 'replace') fixture.context = { kind: 'chat' };
      if (end === 'approve') {
        const resolve = fixture.handlers.get('resolve-approval')!;
        const sender = fixture.window.webContents;
        await expect(resolve({ sender, senderFrame: { url: sender.mainFrame.url } }, id, true)).rejects.toThrow('Untrusted');
        await expect(resolve({ sender, senderFrame: sender.mainFrame }, id, 'false')).rejects.toThrow('Invalid arguments');
        expect(fixture.call).not.toHaveBeenCalled();
      }
      await fixture.handlers.get('resolve-approval')!({ sender: fixture.window.webContents, senderFrame: fixture.window.webContents.mainFrame }, id, true);
      if (end === 'approve') {
        expect(await result).toEqual({ saved: true });
        expect(fixture.call).toHaveBeenCalledTimes(1);
      } else {
        expect(await result).toBeInstanceOf(Error);
        expect(fixture.call).not.toHaveBeenCalled();
      }
      fixture.send.mockClear();
    }
    reads.mockClear();
    fixture.send.mockClear();
    fixture.app.emit('before-quit');
    expect(close).toHaveBeenCalled();
    expect(() => fixture.codex.emit('status')).not.toThrow();
    expect(() => fixture.connectors.emit('change')).not.toThrow();
    expect(reads).not.toHaveBeenCalled();
    expect(fixture.send).not.toHaveBeenCalled();
  });
});
