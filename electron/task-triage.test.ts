import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { RunInput } from './codex.js';
import { Store } from './db.js';
import { DEFAULT_RUBRIC, learnedThrough, readRubric, readTriage, TaskTriage, triageCandidates, triageInstructions, triagePrompt, weekStart } from './task-triage.js';

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }));
const path = () => join(mkdtempSync(join(tmpdir(), 'legolas-triage-')), 'test.sqlite');
const wednesday = new Date(2026, 9, 7, 9, 30);

// A fake engine: answers each run with what the test decides, and records what it was asked.
function engine(answer: (input: RunInput) => string | Promise<string>, status = 'completed') {
  const runs: RunInput[] = [];
  return {
    runs,
    run: vi.fn(async (input: RunInput) => { runs.push(input); input.onThreadStarted?.('run-1'); return { threadId: 'run-1', text: await answer(input), status }; }),
    stop: vi.fn(async () => {}),
  };
}
// Answers every "decide: yes" task with the same band.
const everything = (band: number) => (input: RunInput) => {
  const ids = [...input.prompt.matchAll(/- id: (t\d+)[\s\S]*?decide: (yes|no)/g)].filter((match) => match[2] === 'yes').map((match) => match[1]);
  return JSON.stringify({ priorities: ids.map((id) => ({ id, priority: band, reason: `Band ${band} — on purpose` })) });
};

describe('prioritizing', () => {
  it('decides new tasks, and in a full run also its own earlier bands, never the user\'s or closed ones', () => {
    const store = new Store(path());
    try {
      const fresh = store.createTask({ title: 'Fresh' });
      const claude = store.createTask({ title: 'Claude' });
      const mine = store.createTask({ title: 'Mine', priority: 1 });
      const done = store.createTask({ title: 'Done', status: 'done' });
      store.setPriority(claude.id, 2, 'agent', { reason: 'r' });
      const tasks = store.list('tasks');
      expect(triageCandidates(tasks, 'new').map((task) => task.id)).toEqual([fresh.id]);
      expect(triageCandidates(tasks, 'full').map((task) => task.id).sort()).toEqual([fresh.id, claude.id].sort());
      expect(triageCandidates(tasks, 'full').some((task) => task.id === mine.id || task.id === done.id)).toBe(false);
    } finally { store.close(); }
  });

  it('shows Claude the whole list, which tasks to decide, and how Malcolm corrected it', () => {
    const store = new Store(path());
    try {
      const corrected = store.createTask({ title: 'Prep Greenfield call with Dana Whitfield', label: 'investor', dueAt: '2026-10-07', sourceKey: 'inbox:calendar-1' });
      store.setPriority(corrected.id, 2, 'agent', { reason: 'Prep can wait a day' });
      store.setPriority(corrected.id, 1, 'user');
      const fresh = store.createTask({ title: 'Investor AB follow-up', dueAt: '2026-10-12', sourceKey: 'reminders:9' });
      const tasks = store.list('tasks');
      const { prompt, ids } = triagePrompt(tasks, new Set([fresh.id]), store.priorityOverrides(), wednesday);
      expect(prompt).toContain('Today: Wednesday 2026-10-07. This week ends Sunday 2026-10-11.');
      expect(prompt).toContain('"Prep Greenfield call with Dana Whitfield" (#investor, due 2026-10-07, from calendar): you said P2 ("Prep can wait a day"); he moved it to P1.');
      expect(prompt).toMatch(/priority now: P1 \(set by Malcolm on \d{4}-\d{2}-\d{2}\)/);
      expect(prompt).toContain('P1 slots: Malcolm holds 1 P1 himself, so 2 of 3 are yours to fill.');
      expect(prompt).toContain('due: 2026-10-12 (in 5 days)');
      expect(prompt).toContain('phone capture (Reminders)');
      expect([...ids.values()].sort()).toEqual([corrected.id, fresh.id].sort());
      const decided = [...ids].find(([, taskId]) => taskId === fresh.id)![0];
      expect(prompt).toMatch(new RegExp(`- id: ${decided}[\\s\\S]*?decide: yes`));
    } finally { store.close(); }
  });

  it('keeps only usable answers: known ids it was asked about, bands 1 to 3, one-line reasons without em dashes', () => {
    const ids = new Map([['t1', 'a'], ['t2', 'b'], ['t3', 'c']]);
    const decide = new Set(['a', 'b']);
    const reply = `Here you go:\n${JSON.stringify({ priorities: [
      { id: 't1', priority: 'P1', reason: 'Board pack due Friday — blocks the meeting' },
      { id: 't2', priority: 4, reason: 'nope' },
      { id: 't3', priority: 2, reason: 'not asked' },
      { id: 't9', priority: 2, reason: 'unknown' },
    ] })}`;
    expect(readTriage(reply, ids, decide)).toEqual([{ taskId: 'a', priority: 1, reason: 'Board pack due Friday, blocks the meeting' }]);
    expect(() => readTriage('I could not decide.', ids, decide)).toThrow('list of priorities');
  });

  it('puts the brain rubric in the instructions and falls back when it is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rubric-'));
    writeFileSync(join(dir, 'priority-rubric.md'), '# Rubric\n\n## Learned from Malcolm\'s overrides\n- Investor prep is P1 the day before.\n');
    expect(triageInstructions(readRubric(join(dir, 'priority-rubric.md')))).toContain('Investor prep is P1 the day before.');
    expect(readRubric(join(dir, 'missing.md'))).toBe(DEFAULT_RUBRIC);
    expect(learnedThrough('---\ntitle: x\nlearnedThrough: 2026-10-11T04:00:00Z\n---\n# Rubric')).toBe('2026-10-11T04:00:00Z');
    expect(learnedThrough('# No front matter')).toBeNull();
    expect(triageInstructions(DEFAULT_RUBRIC)).toContain('At most 3 P1s across the whole list');
  });

  it('runs read-only in the background, applies the bands and upgrades the first run of a day to a full one', async () => {
    const store = new Store(path());
    try {
      const old = store.createTask({ title: 'Banded yesterday' });
      store.setPriority(old.id, 3, 'agent', { reason: 'r' });
      const fresh = store.createTask({ title: 'New today' });
      const fake = engine(everything(2));
      const onChange = vi.fn();
      const triage = new TaskTriage({ store, engine: fake, cwd: '/tmp', rubricPath: () => null, onChange, now: () => wednesday });
      expect(await triage.run('new')).toEqual({ set: 2, changed: 2 });
      expect(fake.runs[0]).toMatchObject({ kind: 'triage', tools: [], cwd: '/tmp' });
      expect(store.get('tasks', fresh.id)).toMatchObject({ priority: 2, prioritySource: 'agent', priorityReason: 'Band 2, on purpose' });
      expect(store.get('tasks', old.id)?.priority).toBe(2);
      expect(store.priorityEvents().filter((event) => event.runId === 'run-1')).toHaveLength(2);
      expect(triage.state).toMatchObject({ state: 'idle', detail: 'Claude prioritized 2 · 09:30' });
      expect(onChange).toHaveBeenCalled();
      // Later the same day only new tasks are decided, and nothing new means no run at all.
      expect(await triage.run('new')).toEqual({ set: 0, changed: 0 });
      expect(fake.runs).toHaveLength(1);
    } finally { store.close(); }
  });

  it('leaves a band alone that the user set while Claude was thinking', async () => {
    const store = new Store(path());
    try {
      const task = store.createTask({ title: 'Raced' });
      let release!: () => void;
      const fake = engine(async (input) => { await new Promise<void>((done) => { release = done; }); return everything(3)(input); });
      const triage = new TaskTriage({ store, engine: fake, cwd: '/tmp', rubricPath: () => null, onChange: () => {}, now: () => wednesday });
      const running = triage.run('new');
      await vi.waitFor(() => expect(fake.runs).toHaveLength(1));
      store.setPriority(task.id, 1, 'user');
      release();
      expect(await running).toEqual({ set: 1, changed: 0 });
      expect(store.get('tasks', task.id)).toMatchObject({ priority: 1, prioritySource: 'user' });
    } finally { store.close(); }
  });

  it('queues one more run when asked during a run, and reports a failed run without changing anything', async () => {
    const store = new Store(path());
    try {
      store.createTask({ title: 'First' });
      let release!: () => void;
      const fake = engine(async (input) => { if (fake.runs.length === 1) await new Promise<void>((done) => { release = done; }); return everything(2)(input); });
      const triage = new TaskTriage({ store, engine: fake, cwd: '/tmp', rubricPath: () => null, onChange: () => {}, now: () => wednesday });
      const first = triage.run('new');
      await vi.waitFor(() => expect(fake.runs).toHaveLength(1));
      store.createTask({ title: 'Arrived during the run' });
      expect(await triage.run('new')).toBeNull();
      release();
      await first;
      await vi.waitFor(() => expect(fake.runs).toHaveLength(2));
      await vi.waitFor(() => expect(store.list('tasks').every((task) => task.priority === 2)).toBe(true));

      store.createTask({ title: 'Will fail' });
      const broken = new TaskTriage({ store, engine: engine(() => 'Claude Code stopped: error_max_turns', 'failed'), cwd: '/tmp', rubricPath: () => null, onChange: () => {}, now: () => wednesday });
      expect(await broken.run('new')).toBeNull();
      expect(broken.state.state).toBe('failed');
      expect(broken.state.detail).toContain('error_max_turns');
      expect(store.list('tasks').find((task) => task.title === 'Will fail')?.priority).toBeNull();
    } finally { store.close(); }
  });

  it('looks again at a band of its own when the task changed after it looked, and puts its P1s on the table', async () => {
    const store = new Store(path());
    try {
      const escalated = store.createTask({ title: 'Prep Nordvik', sourceKey: 'inbox:calendar-nordvik' });
      const p1s = ['One', 'Two', 'Three'].map((title) => store.createTask({ title }));
      const fake = engine(everything(2));
      const triage = new TaskTriage({ store, engine: fake, cwd: '/tmp', rubricPath: () => null, onChange: () => {}, now: () => wednesday });
      store.setSetting('priorityFullRunDay', '2026-10-07');
      store.setSetting('priorityWeek', weekStart(wednesday));
      store.setPriority(escalated.id, 3, 'agent', { reason: 'Meeting next month' });
      for (const task of p1s) store.setPriority(task.id, 1, 'agent', { reason: 'r' });
      expect(triageCandidates(store.list('tasks'), 'new')).toEqual([]);
      await new Promise((done) => setTimeout(done, 5));
      store.updateTask(escalated.id, { dueAt: '2026-10-08', notes: '#### Latest from the sweep\nMoved to tomorrow 09:00' });
      expect(triageCandidates(store.list('tasks'), 'new').map((task) => task.title)).toEqual(['Prep Nordvik']);
      await triage.run('new');
      const prompt = fake.runs[0].prompt;
      expect(prompt).toContain('Latest from the sweep: Moved to tomorrow 09:00');
      // Its three P1s are decided too, so it can free a slot for the escalation.
      expect(prompt.match(/decide: yes/g)).toHaveLength(4);
      expect(store.get('tasks', escalated.id)?.priority).toBe(2);
    } finally { store.close(); }
  });

  it('gives up on a run that never answers, and frees itself for the next one', async () => {
    const store = new Store(path());
    try {
      store.createTask({ title: 'Stuck' });
      const stuck = { run: vi.fn((input: RunInput) => { input.onThreadStarted?.('stuck-run'); return new Promise<never>(() => {}); }), stop: vi.fn(async () => {}) };
      const triage = new TaskTriage({ store, engine: stuck, cwd: '/tmp', rubricPath: () => null, onChange: () => {}, now: () => wednesday, timeoutMs: 20 });
      expect(await triage.run('new')).toBeNull();
      expect(triage.state).toMatchObject({ state: 'failed' });
      expect(triage.state.detail).toContain('timed out');
      expect(stuck.stop).toHaveBeenCalledWith('stuck-run');
      expect(await triage.run('new')).toBeNull();
      expect(stuck.run).toHaveBeenCalledTimes(2);
    } finally { store.close(); }
  });

  it('hands his P1s from earlier weeks back to Claude at the first run of a new week', async () => {
    const store = new Store(path());
    try {
      const old = store.createTask({ title: 'Last week commitment', priority: 1 });
      store.db.prepare('UPDATE tasks SET prioritySetAt=? WHERE id=?').run('2026-09-30T08:00:00.000Z', old.id);
      const fresh = store.createTask({ title: 'This week commitment', priority: 1 });
      const p2 = store.createTask({ title: 'His P2', priority: 2 });
      store.db.prepare('UPDATE tasks SET prioritySetAt=? WHERE id=?').run('2026-09-30T08:00:00.000Z', p2.id);
      store.db.prepare('UPDATE tasks SET prioritySetAt=? WHERE id=?').run('2026-10-06T08:00:00.000Z', fresh.id);
      const fake = engine(everything(2));
      const triage = new TaskTriage({ store, engine: fake, cwd: '/tmp', rubricPath: () => null, onChange: () => {}, now: () => wednesday });
      await triage.run('new');
      expect(store.get('tasks', old.id)).toMatchObject({ prioritySource: 'agent', priority: 2 });
      expect(store.get('tasks', fresh.id)).toMatchObject({ prioritySource: 'user', priority: 1 });
      expect(store.get('tasks', p2.id)).toMatchObject({ prioritySource: 'user', priority: 2 });
      expect(store.priorityEvents().some((event) => event.actor === 'system' && event.taskId === old.id)).toBe(true);
      expect(store.getSetting('priorityWeek')).toBe('2026-10-05');
    } finally { store.close(); }
  });
});
