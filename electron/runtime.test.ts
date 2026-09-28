import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Store } from './db.js';
import { Runtime } from './runtime.js';
import type { CodexProvider, RunInput } from './codex.js';
import type { ConnectorManager } from './connectors.js';
import type { MemoryService } from './memory.js';
import { BrowserManager } from './browser.js';

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }));

const cleanup: (() => void)[] = [];
afterEach(() => { for (const clean of cleanup.splice(0)) clean(); });

// A fake Codex that calls one tool (if given) and then answers.
function setup(script: (input: RunInput, codexThreadId: string, runtime: Runtime) => Promise<string> = async () => 'Done', browser?: BrowserManager) {
  const dir = mkdtempSync(join(tmpdir(), 'aegir-'));
  const store = new Store(join(dir, 'db.sqlite'));
  const runs: RunInput[] = [];
  let n = 0;
  let runtime!: Runtime;
  const codex = { run: async (input: RunInput) => { runs.push(input); const id = `codex-${++n}`; input.onThreadStarted?.(id); const text = await script(input, id, runtime); return { threadId: id, text, status: 'completed' }; }, stop: async () => {} } as unknown as CodexProvider;
  const connectors = { listTools: () => [{ name: 'slack__search', description: '', inputSchema: {}, readOnly: true }, { name: 'slack__post', description: '', inputSchema: {}, readOnly: false }], states: {} } as unknown as ConnectorManager;
  const memory = { recall: async () => '', remember: async () => ({ id: 'm' }) } as unknown as MemoryService;
  runtime = new Runtime(store, codex, connectors, memory, () => {}, () => {}, { outputRoot: join(dir, 'out'), routineCwd: dir }, browser);
  cleanup.push(() => { runtime.stop(); if (store.isOpen) store.close(); rmSync(dir, { recursive: true, force: true }); });
  return { store, runtime, runs, memory };
}

describe('runtime', () => {
  it.each(['chat', 'task', 'routine'] as const)('enforces browser access and releases the session in a %s run', async kind => {
    const execute = vi.fn(async () => ({ content: [{ type: 'text', text: 'Browser result' }] }));
    const close = vi.fn(async () => {});
    const approve = vi.fn(async () => true);
    const browser = new BrowserManager(true, async () => ({
      listTools: async () => ({ tools: [{ name: 'browser_snapshot', inputSchema: { type: 'object', properties: {} } }] }),
      callTool: execute, close,
    }), approve, () => {});
    let toolAvailable = false;
    let result: unknown;
    let denied = '';
    const { store, runtime } = setup(async (input, id, rt) => {
      if (!input.tools.length) return 'Done';
      toolAvailable = input.tools.some(tool => tool.name === 'browser__browser_snapshot');
      try { result = await rt.handleInternalTool('browser', 'browser_snapshot', {}, id); }
      catch (error) { denied = String(error); }
      return 'Done';
    }, browser);
    if (kind === 'routine') await runtime.runRoutine(store.routines()[0].id, 'manual');
    else if (kind === 'task') await runtime.handOff(store.createTask({ title: 'Research in browser' }).id, 'Research');
    else await runtime.sendMessage(store.createThread(store.groups()[0].id, 'Browser').id, 'Research');
    expect(toolAvailable).toBe(kind !== 'routine');
    if (kind === 'routine') {
      expect(denied).toContain('unavailable');
      expect(execute).not.toHaveBeenCalled();
    } else {
      expect(result).toMatchObject({ success: true });
      expect(approve).toHaveBeenCalledOnce();
      expect(close).toHaveBeenCalledOnce();
      expect(browser.state.threadId).toBeNull();
    }
    await expect(runtime.handleInternalTool('browser', 'browser_snapshot', {}, 'ended-run')).rejects.toThrow('unavailable');
    await browser.close();
  });
  it.each(['chat', 'task', 'routine'] as const)('lets a %s agent retrieve memories during a run', async kind => {
    let checked = false;
    const { store, runtime, memory } = setup(async (input, id, rt) => {
      if (!input.tools.length) return 'Done'; // Task routing does not use memory tools.
      const tool = input.tools.find(tool => tool.name.startsWith('memory__recall_'))!;
      expect(tool).toMatchObject({ readOnly: true });
      expect(input.tools.some(tool => tool.name.startsWith('memory__remember_'))).toBe(true);
      const agentId = tool.name.slice('memory__recall_'.length).replace(/_/g, '-');
      const result = await rt.handleInternalTool('memory', tool.name.slice('memory__'.length), { query: '  prior project decisions  ' }, id);
      expect(memory.recall).toHaveBeenLastCalledWith('prior project decisions', agentId);
      expect(result).toEqual({ memories: '[shared] Use weekly reports', found: true });
      checked = true;
      return 'Done';
    });
    vi.spyOn(memory, 'recall').mockResolvedValue('[shared] Use weekly reports');
    if (kind === 'routine') await runtime.runRoutine(store.routines()[0].id, 'manual');
    else if (kind === 'task') await runtime.handOff(store.createTask({ title: 'Project decisions' }).id, 'Find prior decisions');
    else {
      const thread = store.createThread(store.groups()[0].id, 'Project decisions');
      await runtime.sendMessage(thread.id, 'Find prior decisions');
    }
    expect(checked).toBe(true);
    expect(memory.recall).toHaveBeenCalledWith('prior project decisions', expect.any(String));
  });

  it.each(['chat', 'task', 'routine'] as const)('loads scoped skills and records revisions in a %s run', async kind => {
    let checked = false;
    const { store, runtime } = setup(async (input, id, rt) => {
      if (!input.tools.length) return 'Done';
      expect(input.tools.some(tool => tool.name === 'skills__read' && tool.readOnly)).toBe(true);
      expect(input.tools.some(tool => tool.name === 'skills__create' && !tool.readOnly)).toBe(true);
      const session = rt.contextFor(id)!.skills!;
      const skill = [...session.entries.values()].find(item => item.skill.name === 'research')!.skill;
      const result = await rt.handleInternalTool('skills', 'read', { id: skill.id, agentId: 'forged-owner' }, id) as { revision: string; content: string };
      expect(result.revision).toBe(skill.revision);
      expect(result.content).toContain('compare evidence');
      expect(rt.skills.detail(skill.id).recentLoads[0].agentId).toBe(session.agentId);
      expect(input.instructions).toContain('Skill catalog');
      checked = true;
      return 'Done';
    });
    if (kind === 'routine') await runtime.runRoutine(store.routines()[0].id, 'manual');
    else if (kind === 'task') await runtime.handOff(store.createTask({ title: 'Research' }).id, 'Compare evidence');
    else await runtime.sendMessage(store.createThread(store.groups()[0].id, 'Research').id, 'Compare evidence');
    expect(checked).toBe(true);
    await expect(runtime.handleInternalTool('skills', 'list', {}, 'expired')).rejects.toThrow('No active skill session');
  });

  it.each(['chat', 'task', 'routine'] as const)('preserves user instructions and permission boundaries in %s', async kind => {
    const { store, runtime, runs } = setup();
    const group = store.groups()[0];
    const agent = store.get('agents', group.leadAgentId)!;
    store.updateAgent({ ...agent, instructions: 'Custom personality: use Swedish.' });
    store.setSetting('memoryInstructions', 'Keep project decisions with their dates.');
    if (kind === 'routine') {
      const routine = store.routines()[0];
      store.updateRoutine(routine.id, { agentId: agent.id });
      await runtime.runRoutine(routine.id, 'manual');
    } else if (kind === 'task') await runtime.handOff(store.createTask({ title: 'Review' }).id, 'Review the evidence');
    else await runtime.sendMessage(store.createThread(group.id, 'Review').id, 'Review the evidence');
    const run = runs.at(-1)!;
    expect(run.instructions).toContain('Keep project decisions with their dates.');
    expect(run.instructions).toContain('Custom personality: use Swedish.');
    expect(run.instructions).toContain('Skill catalog');
    expect(run.sandbox).toBe(kind === 'task' ? 'workspace-write' : 'read-only');
    expect(run.tools.some(tool => tool.name === 'slack__post')).toBe(kind === 'chat');
  });

  it('blocks a routine before execution when its required skill is disabled', async () => {
    const { store, runtime, runs } = setup(); const routine = store.routines()[0];
    const skill = runtime.skills.list()[0]; runtime.skills.bindRoutine(routine.id, [skill.id]);
    runtime.skills.configure(skill.id, { enabled: false });
    await runtime.runRoutine(routine.id, 'manual');
    expect(runs).toHaveLength(0);
    expect(store.lastRun(routine.id)?.status).toBe('failed');
    expect(store.lastRun(routine.id)?.summary).toContain('missing or disabled');
  });

  it('validates memory queries and distinguishes no matches from invalid requests', async () => {
    const { store, runtime } = setup();
    const agentId = store.groups()[0].leadAgentId;
    for (const query of ['', '   ', 42, 'x'.repeat(2001)]) {
      await expect(runtime.handleInternalTool('memory', `recall_${agentId.replace(/-/g, '_')}`, { query }, 'test')).rejects.toThrow('Memory query');
    }
    await expect(runtime.handleInternalTool('memory', `recall_${agentId.replace(/-/g, '_')}`, { query: 'unknown fact' }, 'test'))
      .resolves.toEqual({ memories: '', found: false });
    await expect(runtime.handleInternalTool('memory', 'recall_deadbeef', { query: 'fact' }, 'test')).rejects.toThrow('Unknown agent');
  });

  it('hands a task off into a task thread with a writable output folder and read-only connectors', async () => {
    const { store, runtime, runs } = setup();
    const task = store.createTask({ title: 'Competitor pricing' });
    await runtime.handOff(task.id, 'Compare five competitors');
    const updated = store.get('tasks', task.id)!;
    expect(updated.status).toBe('review');
    expect(updated.outputDir).toContain('competitor-pricing');
    const thread = store.threads().find(x => x.id === updated.threadId)!;
    expect(thread).toMatchObject({ kind: 'task', taskId: task.id });
    expect(store.messagesForThread(thread.id).map(x => x.content)).toEqual(['Compare five competitors', 'Done']);
    const run = runs.at(-1)!;
    expect(run).toMatchObject({ sandbox: 'workspace-write', cwd: updated.outputDir });
    expect(run.tools.map(tool => tool.name)).not.toContain('slack__post');
  });

  it('rejects a second hand-off while the first is still routing', async () => {
    let finishRouting!: (result: string) => void;
    const routing = new Promise<string>(resolve => { finishRouting = resolve; });
    const { store, runtime } = setup(async input => input.instructions.includes('route tasks') ? routing : 'Done');
    const group = store.groups().find(item => item.kind === 'group')!;
    store.createGroup('Second group', [group.leadAgentId]);
    const task = store.createTask({ title: 'Competitor pricing' });
    const first = runtime.handOff(task.id, 'Compare competitors');
    await expect(runtime.handOff(task.id, 'Compare again')).rejects.toThrow('already working');
    finishRouting(JSON.stringify({ groupId: group.id }));
    await first;
    expect(store.threads().filter(thread => thread.taskId === task.id)).toHaveLength(1);
    expect(store.messagesForThread(store.get('tasks', task.id)!.threadId!).filter(message => message.role === 'user')).toHaveLength(1);
  });

  it('reports a hand-off setup failure and leaves the task blocked', async () => {
    const { store, runtime, memory } = setup();
    vi.spyOn(memory, 'recall').mockRejectedValue(new Error('Recall failed'));
    const task = store.createTask({ title: 'Competitor pricing' });
    await expect(runtime.handOff(task.id, 'Compare competitors')).rejects.toThrow('Recall failed');
    expect(store.get('tasks', task.id)?.status).toBe('blocked');
  });

  it('logs a routine run and records suggested tasks once', async () => {
    const { store, runtime } = setup(async (_input, id, rt) => {
      for (let i = 0; i < 2; i++) await rt.handleInternalTool('tasks', 'suggest', { title: 'Reply to Anna', sourceUrl: 'https://slack.test/1' }, id);
      return 'Suggested one task';
    });
    const routine = store.routines()[0];
    await runtime.runRoutine(routine.id, 'manual');
    const run = store.routineRuns()[0];
    expect(run).toMatchObject({ status: 'ok', summary: '1 task suggested', trigger: 'manual' });
    expect(store.list('tasks').filter(x => x.status === 'proposed').map(x => x.title)).toEqual(['Reply to Anna']);
    const kinds = store.runEvents(run.id).map(x => x.kind);
    expect(kinds[0]).toBe('run'); expect(kinds.at(-1)).toBe('run'); expect(kinds).toContain('agent');
    expect(store.routine(routine.id)!.lastRunAt).toBe(run.startedAt);
  });

  it('applies a routine change an agent proposed in chat', async () => {
    const { store, runtime } = setup(async (_input, id, rt) => {
      const routine = store.routines()[0];
      await rt.handleInternalTool('routines', 'propose_change', { routineId: routine.id, reason: 'Skip weekends', change: { schedule: { every: 'hour', weekdaysOnly: true } } }, id);
      return 'Proposed';
    });
    const group = store.groups()[0];
    const thread = store.createThread(group.id, 'Tune discovery');
    await runtime.sendMessage(thread.id, 'Make @Hourly discovery skip weekends');
    const proposal = store.messagesForThread(thread.id).find(x => x.meta)!;
    expect(proposal.meta).toMatchObject({ type: 'routine-change', state: 'pending' });
    runtime.resolveRoutineChange(proposal.id, true);
    expect(store.routines()[0].schedule).toEqual({ every: 'hour', weekdaysOnly: true });
    expect(store.message(proposal.id)!.meta!.state).toBe('applied');
    expect(() => runtime.resolveRoutineChange(proposal.id, true)).toThrow('no longer pending');
  });
});

describe('runtime shutdown', () => {
  it('cancels both scheduler timers and ignores wake ticks after shutdown', () => {
    vi.useFakeTimers();
    const { store, runtime } = setup();
    try {
      runtime.start();
      runtime.stop();
      store.close();
      expect(vi.getTimerCount()).toBe(0);
      expect(() => { vi.advanceTimersByTime(120_000); runtime.tick(); }).not.toThrow();
    } finally { vi.useRealTimers(); }
  });

  it.each(['chat', 'task', 'routine'] as const)('ignores late %s callbacks and completion after the database closes', async kind => {
    let started!: (input: RunInput) => void;
    const ready = new Promise<RunInput>(resolve => { started = resolve; });
    let finish!: (text: string) => void;
    const pending = new Promise<string>(resolve => { finish = resolve; });
    const { store, runtime } = setup(async input => { started(input); return pending; });
    const run = kind === 'routine' ? runtime.runRoutine(store.routines()[0].id, 'manual')
      : kind === 'task' ? runtime.handOff(store.createTask({ title: 'Shutdown' }).id, 'Work')
      : runtime.sendMessage(store.createThread(store.groups()[0].id, 'Shutdown').id, 'Work');
    const input = await ready;
    runtime.stop();
    store.close();
    // Observe attempted access too: routines catch errors, so a resolved Promise
    // alone cannot prove that a closed database was never touched.
    const databaseAccess = vi.spyOn(store.db, 'prepare');
    try {
      expect(() => input.onDelta('Late text')).not.toThrow();
      expect(() => input.onItem?.({ type: 'commandExecution' })).not.toThrow();
      input.onThreadStarted?.('late-thread');
      expect(runtime.contextFor('late-thread')).toBeUndefined();
      await expect(runtime.handleInternalTool('tasks', 'suggest', { title: 'Late', sourceUrl: 'https://example.com' }, 'late-thread')).rejects.toThrow('Runtime is stopped');
    } finally { finish('Done'); }
    await run;
    expect(databaseAccess).not.toHaveBeenCalled();
  });

  it.each(['chat', 'task', 'routine'] as const)('does not start a %s model run when memory resolves after shutdown', async kind => {
    const { store, runtime, memory, runs } = setup();
    const databaseAccess = vi.spyOn(store.db, 'prepare');
    vi.spyOn(memory, 'recall').mockImplementation(async () => {
      runtime.stop(); store.close(); databaseAccess.mockClear(); return 'Late memory';
    });
    if (kind === 'routine') await runtime.runRoutine(store.routines()[0].id, 'manual');
    else if (kind === 'task') await runtime.handOff(store.createTask({ title: 'Shutdown' }).id, 'Work');
    else await runtime.sendMessage(store.createThread(store.groups()[0].id, 'Shutdown').id, 'Work');
    expect(runs).toHaveLength(0);
    expect(databaseAccess).not.toHaveBeenCalled();
  });

  it.each(['chat', 'task', 'routine'] as const)('settles a rejected %s run after shutdown without touching SQLite', async kind => {
    const { store, runtime } = setup(async () => {
      runtime.stop(); store.close(); databaseAccess.mockClear(); throw new Error('Provider stopped');
    });
    const databaseAccess = vi.spyOn(store.db, 'prepare');
    if (kind === 'routine') await runtime.runRoutine(store.routines()[0].id, 'manual');
    else if (kind === 'task') await runtime.handOff(store.createTask({ title: 'Shutdown' }).id, 'Work');
    else await runtime.sendMessage(store.createThread(store.groups()[0].id, 'Shutdown').id, 'Work');
    expect(databaseAccess).not.toHaveBeenCalled();
  });

  it('does not create a task thread when routing resolves after shutdown', async () => {
    const { store, runtime } = setup(async () => { runtime.stop(); store.close(); return '{}'; });
    store.createGroup('Second team', [store.groups()[0].leadAgentId]);
    await expect(runtime.handOff(store.createTask({ title: 'Shutdown' }).id, 'Work')).resolves.toBeUndefined();
  });
});
