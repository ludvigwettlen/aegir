import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryService } from './memory.js';
import type { Store } from './db.js';
import type { Memory } from '../shared/types.js';

const mnemosyne = vi.hoisted(() => ({ available: false, failPrivate: false }));

// Exercise both the local fallback and a partial Mnemosyne response without an installation.
vi.mock('node:child_process', () => ({
  spawn: (_binary: string, args: string[], options: { env: { MNEMOSYNE_BANK: string } }) => {
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    queueMicrotask(() => {
      if (!mnemosyne.available || (mnemosyne.failPrivate && options.env.MNEMOSYNE_BANK.includes('agent-'))) {
        child.emit('error', new Error('Mnemosyne unavailable'));
      } else {
        if (args[0] === 'recall') child.stdout.emit('data', 'Remote planning result');
        child.emit('close', 0);
      }
    });
    return child;
  }
}));

afterEach(() => { mnemosyne.available = false; mnemosyne.failPrivate = false; });

function fixture() {
  const rows: Memory[] = [];
  const settings = new Map<string, string>();
  let nextId = 0;
  const store = {
    db: { prepare(sql: string) {
      if (sql.startsWith('SELECT id FROM memories')) return { get: (scope: string, content: string) => rows.find(row => row.scope === scope && row.content === content) };
      if (sql.startsWith('SELECT scope,sourceUrl,content FROM memories')) return { get: (id: string) => rows.find(row => row.id === id) };
      if (sql.startsWith('SELECT scope FROM memories')) return { get: (id: string) => rows.find(row => row.id === id) };
      if (sql.startsWith('DELETE FROM settings')) return { run: (first: string, second: string) => { settings.delete(first); settings.delete(second); } };
      throw new Error(`Unexpected query: ${sql}`);
    } },
    list: () => [...rows],
    remember: (scope: string, content: string, sourceUrl: string | null) => {
      const row: Memory = { id: `memory-${++nextId}`, scope, content, sourceUrl, createdAt: '2026-01-01T00:00:00Z' };
      rows.push(row);
      return row;
    },
    forgetMemory: (id: string) => { const index = rows.findIndex(row => row.id === id); if (index >= 0) rows.splice(index, 1); },
    getSetting: (key: string) => settings.get(key),
    setSetting: (key: string, value: string) => { settings.set(key, value); }
  } as unknown as Store;
  return { memory: new MemoryService(store), rows, settings };
}

describe('memory local fallback', () => {
  it('rejects invalid memories before storing them', async () => {
    const { memory, rows } = fixture();
    await expect(memory.remember('another-user', 'A fact', null)).rejects.toThrow('Invalid memory scope');
    await expect(memory.remember('shared', ' ', null)).rejects.toThrow('1–2000 characters');
    expect(rows).toHaveLength(0);
  });

  it('keeps one local copy and marks it pending when Mnemosyne is unavailable', async () => {
    const { memory, rows, settings } = fixture();
    const first = await memory.remember('shared', 'Planning brief is due Friday', 'https://example.com/brief');
    const repeated = await memory.remember('shared', 'Planning brief is due Friday', 'https://example.com/brief');
    expect(repeated?.id).toBe(first?.id);
    expect(rows).toHaveLength(1);
    expect(settings.get(`memorySynced:${first?.id}`)).toBe('false');
  });

  it('recalls shared and own private memories, but not another agent’s', async () => {
    const { memory } = fixture();
    await memory.remember('shared', 'Planning brief is due Friday', null);
    await memory.remember('agent-a1b2', 'Planning draft belongs to first agent', null);
    await memory.remember('agent-c3d4', 'Planning notes belong to second agent', null);
    const recalled = await memory.recall('planning', 'a1b2');
    expect(recalled).toContain('Planning brief is due Friday');
    expect(recalled).toContain('Planning draft belongs to first agent');
    expect(recalled).not.toContain('Planning notes belong to second agent');
  });

  it('includes pending local memories even when another scope recalls remotely', async () => {
    const { memory } = fixture();
    await memory.remember('shared', 'Planning brief is due Friday', null);
    await memory.remember('agent-a1b2', 'Planning draft belongs to first agent', null);
    mnemosyne.available = true;
    mnemosyne.failPrivate = true;
    const recalled = await memory.recall('planning', 'a1b2');
    expect(recalled).toContain('[shared] Remote planning result');
    expect(recalled).toContain('[shared] Planning brief is due Friday');
    expect(recalled).toContain('[agent-a1b2] Planning draft belongs to first agent');
  });

  it('syncs pending memories once Mnemosyne becomes available', async () => {
    const { memory, settings } = fixture();
    const row = await memory.remember('shared', 'Planning brief is due Friday', null);
    expect(settings.get(`memorySynced:${row?.id}`)).toBe('false');
    mnemosyne.available = true;
    await memory.retryPending();
    expect(settings.get(`memorySynced:${row?.id}`)).toBe('true');
  });

  it('corrects and forgets pending local memories', async () => {
    const { memory, rows, settings } = fixture();
    const original = await memory.remember('shared', 'Old project fact', 'https://example.com/source');
    await memory.correct(original!.id, 'Updated project fact');
    expect(rows).toMatchObject([{ content: 'Updated project fact', sourceUrl: 'https://example.com/source' }]);
    expect(settings.has(`memorySynced:${original!.id}`)).toBe(false);
    await memory.forget(rows[0].id);
    expect(rows).toHaveLength(0);
  });
});
