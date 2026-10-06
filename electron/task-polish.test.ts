import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Store } from './db.js';
import { Runtime } from './runtime.js';
import type { CodexProvider, RunInput } from './codex.js';
import type { ConnectorManager } from './connectors.js';
import type { MemoryService } from './memory.js';
import { brainPeople, polishPrompt, readPolished } from './task-polish.js';

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }));

const cleanup: (() => void)[] = [];
afterEach(() => { for (const clean of cleanup.splice(0)) clean(); });
const tempDir = () => { const dir = mkdtempSync(join(tmpdir(), 'polish-')); cleanup.push(() => rmSync(dir, { recursive: true, force: true })); return dir; };

// Tuesday 6 October 2026
const today = new Date(2026, 9, 6);
const note = "Draft investor memo for September. Schedule for Friday. I'm waiting for the monthly report and close numbers from Tobias and Finance";

describe('add with Claude', () => {
  it('keeps the title, notes, an existing label and the date Claude gives', () => {
    const reply = 'Here you go: {"title": "Draft September investor memo.", "notes": "Waiting on the monthly report and close numbers from Tove (Finance).", "label": "Board", "dueAt": "2026-10-09"}';
    expect(readPolished(reply, note, ['board', 'mgmt'], today)).toEqual({
      title: 'Draft September investor memo',
      notes: 'Waiting on the monthly report and close numbers from Tove (Finance).',
      label: 'board',
      dueAt: '2026-10-09',
    });
  });

  it('never invents a label, and a #label you typed wins', () => {
    const reply = '{"title": "Draft memo", "notes": "", "label": "investors", "dueAt": null}';
    expect(readPolished(reply, note, ['board'], today).label).toBeNull();
    expect(readPolished(reply, `${note} #board`, ['board'], today).label).toBe('board');
  });

  it('falls back to a date word you typed when Claude gives no usable date', () => {
    const reply = '{"title": "Draft memo", "notes": "", "label": null, "dueAt": "friday"}';
    expect(readPolished(reply, 'Draft memo fri', [], today).dueAt).toBe('2026-10-09');
    expect(readPolished(reply, 'Draft memo', [], today).dueAt).toBeNull();
  });

  it('drops a date word Claude leaves at the end of the title once it is the due date', () => {
    expect(readPolished('{"title": "Ring Ludde om agent demot imorgon", "dueAt": "2026-10-07"}', 'ring ludde imorgon', [], today).title).toBe('Ring Ludde om agent demot');
    expect(readPolished('{"title": "Prep for the board on Friday", "dueAt": null}', 'prep for the board', [], today).title).toBe('Prep for the board on Friday');
  });

  it('fails without a usable title, so nothing half-written is saved', () => {
    expect(() => readPolished('I could not do that', note, [], today)).toThrow();
    expect(() => readPolished('{"title": "  "}', note, [], today)).toThrow();
  });

  it('lists people from brain pages with their role, skipping the README and pages without a name', () => {
    const dir = tempDir();
    mkdirSync(join(dir, 'people'));
    writeFileSync(join(dir, 'people', 'tove-cogrell.md'), '# Tove Hansen\n\n> Type: Person | Status: Active — Head of Finance (DR, not on mgmt forum) | Reviewed: 2026-08-12\n');
    writeFileSync(join(dir, 'people', 'noor.md'), '# Noor\n\nCTO.\n');
    writeFileSync(join(dir, 'people', 'README.md'), '# People\n');
    writeFileSync(join(dir, 'people', 'stub.md'), 'no heading here\n');
    expect(brainPeople(dir)).toEqual(['Noor', 'Tove Hansen (Head of Finance)']);
    expect(brainPeople(join(dir, 'missing'))).toEqual([]);
    expect(brainPeople(null)).toEqual([]);
  });

  it('gives the model today, the labels, the people and the note', () => {
    const prompt = polishPrompt(note, { today, labels: ['board'], people: ['Tove Hansen (Head of Finance)'] });
    expect(prompt).toContain('Tuesday 2026-10-06');
    expect(prompt).toContain('board');
    expect(prompt).toContain('Tove Hansen');
    expect(prompt).toContain(note);
  });

  it('runs as one quick call without tools and saves nothing itself', async () => {
    const dir = tempDir();
    const store = new Store(join(dir, 'db.sqlite'));
    store.createTask({ title: 'Existing', label: 'board' });
    const runs: RunInput[] = [];
    const codex = { run: async (input: RunInput) => { runs.push(input); return { threadId: 'q', text: '{"title": "Draft September investor memo", "notes": "Waiting on Tove.", "label": "board", "dueAt": "2026-10-09"}', status: 'completed' }; }, stop: async () => {} } as unknown as CodexProvider;
    const runtime = new Runtime(store, codex, { listTools: () => [], states: {} } as unknown as ConnectorManager, { recall: async () => '', remember: async () => ({ id: 'm' }) } as unknown as MemoryService, () => {}, () => {}, { outputRoot: join(dir, 'out'), routineCwd: dir });
    cleanup.unshift(() => { runtime.stop(); store.close(); });
    const polished = await runtime.polishTask(note, ['Tove Hansen (Head of Finance)'], today);
    expect(polished).toMatchObject({ title: 'Draft September investor memo', label: 'board', dueAt: '2026-10-09' });
    expect(runs).toHaveLength(1);
    expect(runs[0].tools).toEqual([]);
    expect(runs[0].prompt).toContain('board');
    expect(store.list('tasks')).toHaveLength(1);
  });
});
