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
}));

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  fixture.root = mkdtempSync(join(tmpdir(), 'aegir-main-test-'));
  // Never let this suite find the developer's real brain (inbox import, task export, memory).
  process.env.AEGIR_BRAIN_DIR = join(fixture.root, 'no-brain');
  fixture.app = Object.assign(new EventEmitter(), {
    getPath: () => fixture.root,
    requestSingleInstanceLock: () => true,
    whenReady: () => Promise.resolve(),
    getLoginItemSettings: () => ({}),
    setBadgeCount: () => true,
  });
  class BrowserWindow extends EventEmitter {
    webContents = Object.assign(new EventEmitter(), {
      send: fixture.send, isDestroyed: () => false, setWindowOpenHandler: () => {},
    });
    isDestroyed() { return false; }
    async loadFile() {}
    async loadURL() {}
  }
  class Tray extends EventEmitter { setToolTip() {} setContextMenu() {} }
  class Notification extends EventEmitter { static isSupported() { return false; } show() {} }
  return {
    app: fixture.app, BrowserWindow, Tray, Notification,
    ipcMain: { handle: vi.fn() }, powerMonitor: new EventEmitter(),
    Menu: { buildFromTemplate: () => ({}), setApplicationMenu: () => {} },
    nativeImage: { createFromDataURL: () => ({}) }, clipboard: {}, dialog: {}, shell: {},
  };
});
// This suite covers the Codex engine and Mnemosyne memory, whatever is installed on the machine.
vi.mock('./engine.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('./engine.js')>()), findClaudeBinary: () => null }));
vi.mock('./gbrain-memory.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('./gbrain-memory.js')>()), findGbrainBinary: () => null }));
vi.mock('./codex.js', async () => {
  const { EventEmitter } = await import('node:events');
  return { CodexProvider: class extends EventEmitter {
    constructor() { super(); fixture.codex = this; }
    setToolHandler() {}
    async start() { fixture.started(); }
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
    close() { this.emit('change'); }
  } };
});
vi.mock('./runtime.js', () => ({ Runtime: class { start() {} stop() {} } }));
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
    await vi.waitFor(() => expect(fixture.started).toHaveBeenCalled());
    fixture.codex.emit('status');
    fixture.connectors.emit('change');
    expect(reads).toHaveBeenCalled();
    expect(fixture.send).toHaveBeenCalledWith('app-event', expect.objectContaining({ type: 'snapshot' }));
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
