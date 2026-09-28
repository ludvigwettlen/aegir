import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryService } from './memory.js';
import type { Store } from './db.js';
import type { Memory } from '../shared/types.js';

const mnemosyne = vi.hoisted(() => ({
  available: true,
  failPrivate: false,
  nextId: 0,
  banks: new Map<string, { id: string; content: string; source: string; timestamp: string }[]>()
}));

vi.mock('node:child_process', () => ({
  spawn: vi.fn((_binary: string, args: string[], options: { env: { MNEMOSYNE_BANK: string; MNEMOSYNE_DATA_DIR?: string } }) => {
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => void };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    queueMicrotask(() => {
      const bank = options.env.MNEMOSYNE_DATA_DIR ? 'hermes' : options.env.MNEMOSYNE_BANK;
      if (!mnemosyne.available || (mnemosyne.failPrivate && bank.includes('agent-'))) {
        child.emit('error', new Error('missing executable'));
        return;
      }
      const rows = mnemosyne.banks.get(bank) || [];
      if (args[0] === 'store') {
        const id = (++mnemosyne.nextId).toString(16).padStart(16, '0');
        rows.push({ id, content: args[1], source: args[2], timestamp: '2026-01-01T00:00:00Z' });
        mnemosyne.banks.set(bank, rows);
        child.stdout.emit('data', `Stored: ${id}`);
      } else if (args[0] === 'recall') {
        child.stdout.emit('data', JSON.stringify({ results: rows.filter(row => row.content.toLowerCase().includes(args[1].toLowerCase())) }));
      } else if (args[0] === 'update') {
        const row = rows.find(item => item.id === args[1]);
        if (!row) { child.stderr.emit('data', 'Memory not found'); child.emit('close', 1); return; }
        row.content = args[2];
      } else if (args[0] === 'delete') {
        const index = rows.findIndex(item => item.id === args[1]);
        if (index < 0) { child.stderr.emit('data', 'Memory not found'); child.emit('close', 1); return; }
        rows.splice(index, 1);
      }
      child.emit('close', 0);
    });
    return child;
  })
}));

afterEach(() => {
  mnemosyne.available = true;
  mnemosyne.failPrivate = false;
  mnemosyne.nextId = 0;
  mnemosyne.banks.clear();
  vi.clearAllMocks();
});

function fixture(legacy: Memory[] = []) {
  const rows = [...legacy];
  const settings = new Map<string, string>([['mnemosyneBinary', '/test/bin/mnemosyne']]);
  const store = {
    legacyMemories: () => [...rows],
    deleteLegacyMemory: (id: string) => { const index = rows.findIndex(row => row.id === id); if (index >= 0) rows.splice(index, 1); },
    list: (table: string) => table === 'agents' ? [{ id: 'a1b2' }, { id: 'c3d4' }] : [],
    getSetting: (key: string) => settings.get(key)
  } as unknown as Store;
  return { memory: new MemoryService(store), rows, settings };
}

describe('Mnemosyne-only memory', () => {
  it('saves durable memories in the correct bank with source metadata', async () => {
    const { memory } = fixture();
    const saved = await memory.remember('shared', 'Planning brief is due Friday', 'https://example.com/brief');
    expect(saved.scope).toBe('shared');
    expect(mnemosyne.banks.get('aegir-shared')).toMatchObject([{ id: saved.id, content: saved.content, source: 'https://example.com/brief' }]);
    const call = vi.mocked(spawn).mock.calls.find(item => item[1][0] === 'store');
    expect(call?.[2]?.env?.MNEMOSYNE_DEFAULT_SCOPE).toBe('global');
  });

  it('fails visibly when Mnemosyne is unavailable and retains legacy data', async () => {
    const legacy: Memory = { id: 'local-1', scope: 'shared', content: 'Legacy fact', sourceUrl: null, createdAt: '2026-01-01' };
    const { memory, rows } = fixture([legacy]);
    mnemosyne.available = false;
    await expect(memory.recall('Legacy')).rejects.toThrow('Mnemosyne is unavailable');
    expect(rows).toEqual([legacy]);
    expect(mnemosyne.banks.size).toBe(0);
  });

  it('propagates recall failure when there is no legacy migration work', async () => {
    const { memory } = fixture();
    mnemosyne.available = false;
    await expect(memory.recall('planning')).rejects.toThrow('Mnemosyne is unavailable');
  });

  it('migrates old memories once and preserves their bank and source', async () => {
    const legacy: Memory = { id: 'local-1', scope: 'agent-a1b2', content: 'Agent fact', sourceUrl: 'https://example.com/source', createdAt: '2026-01-01' };
    const { memory, rows } = fixture([legacy]);
    await Promise.all([memory.migrateLegacy(), memory.migrateLegacy()]);
    expect(rows).toHaveLength(0);
    expect(mnemosyne.banks.get('aegir-agent-a1b2')).toMatchObject([{ content: 'Agent fact', source: legacy.sourceUrl }]);
    expect(mnemosyne.banks.get('aegir-agent-a1b2')).toHaveLength(1);
    await memory.migrateLegacy();
    expect(mnemosyne.banks.get('aegir-agent-a1b2')).toHaveLength(1);
  });

  it('keeps an already synced Mnemosyne record instead of duplicating it', async () => {
    const legacy: Memory = { id: 'local-2', scope: 'shared', content: 'Saved decision', sourceUrl: 'https://example.com/decision', createdAt: '2026-01-01' };
    const { memory, rows, settings } = fixture([legacy]);
    settings.set('memorySynced:local-2', 'true');
    settings.set('memoryProviderId:local-2', 'f6110fa945e60c45');
    mnemosyne.banks.set('aegir-shared', [{ id: 'f6110fa945e60c45', content: 'Saved decision Source: https://example.com/decision', source: 'cli', timestamp: '2026-01-01' }]);
    await memory.migrateLegacy();
    expect(rows).toHaveLength(0);
    expect(mnemosyne.banks.get('aegir-shared')).toHaveLength(1);
    expect(vi.mocked(spawn).mock.calls.filter(call => call[1][0] === 'store')).toHaveLength(0);
  });

  it('recalls shared and own agent memories without reading another agent bank', async () => {
    const { memory } = fixture();
    await memory.remember('shared', 'Planning shared fact', null);
    await memory.remember('agent-a1b2', 'Planning private fact', null);
    await memory.remember('agent-c3d4', 'Planning other fact', null);
    const result = await memory.recall('Planning', 'a1b2');
    expect(result).toContain('[shared] Planning shared fact');
    expect(result).toContain('[agent-a1b2] Planning private fact');
    expect(result).not.toContain('Planning other fact');
  });

  it('searches all Ägir banks for the Memory screen and edits in Mnemosyne', async () => {
    const { memory } = fixture();
    const saved = await memory.remember('agent-a1b2', 'Draft strategy', 'https://example.com/draft');
    expect(await memory.search('Draft')).toMatchObject([{ id: saved.id, scope: 'agent-a1b2', sourceUrl: 'https://example.com/draft' }]);
    await memory.correct(saved.id, saved.scope, 'Final strategy');
    expect(await memory.search('Final')).toMatchObject([{ id: saved.id, content: 'Final strategy' }]);
    await memory.forget(saved.id, saved.scope);
    expect(await memory.search('Final')).toEqual([]);
  });

  it('keeps Hermes as an optional read-only Mnemosyne bank', async () => {
    const { memory, settings } = fixture();
    settings.set('hermesMemoryDataDir', '/test/hermes/data');
    mnemosyne.banks.set('hermes', [{ id: 'f6110fa945e60c45', content: 'Hermes preference', source: 'hermes', timestamp: '2026-01-01' }]);
    expect(await memory.recall('Hermes')).toContain('[hermes] Hermes preference');
    const calls = vi.mocked(spawn).mock.calls.filter(call => call[2]?.env?.MNEMOSYNE_DATA_DIR);
    expect(calls).toMatchObject([['/test/bin/mnemosyne', ['recall', 'Hermes', '20', '--json'], { env: { MNEMOSYNE_BANK: 'default' } }]]);
  });
});
