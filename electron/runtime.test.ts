import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Store } from './db.js';
import { Runtime } from './runtime.js';
import type { CodexProvider, RunInput } from './codex.js';
import type { ConnectorManager } from './connectors.js';
import type { MemoryService } from './memory.js';
import type { Task } from '../shared/types.js';

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }));

// A fake Codex that calls one tool (if given) and then answers.
function setup(script: (input: RunInput, codexThreadId: string, runtime: Runtime) => Promise<string> = async () => 'Done') {
  const dir = mkdtempSync(join(tmpdir(), 'aegir-'));
  const store = new Store(join(dir, 'db.sqlite'));
  const runs: RunInput[] = [];
  let n = 0;
  let runtime!: Runtime;
  const codex = { run: async (input: RunInput) => { runs.push(input); const id = `codex-${++n}`; input.onThreadStarted?.(id); const text = await script(input, id, runtime); return { threadId: id, text, status: 'completed' }; }, stop: async () => {} } as unknown as CodexProvider;
  const connectors = { listTools: () => [{ name: 'slack__search', description: '', inputSchema: {}, readOnly: true }, { name: 'slack__post', description: '', inputSchema: {}, readOnly: false }], states: {} } as unknown as ConnectorManager;
  const memory = { recall: async () => '', remember: async () => ({ id: 'm' }), retryPending: vi.fn(async () => {}) } as unknown as MemoryService;
  runtime = new Runtime(store, codex, connectors, memory, () => {}, () => {}, { outputRoot: join(dir, 'out'), routineCwd: dir });
  return { store, runtime, runs, memory };
}

describe('runtime', () => {
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
      for (const query of ['', '   ', 42, 'x'.repeat(2001)]) {
        await expect(rt.handleInternalTool('memory', tool.name.slice('memory__'.length), { query }, id)).rejects.toThrow('Memory query');
      }
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

  it('returns an explicit empty result for an unmatched memory query', async () => {
    const { store, runtime } = setup();
    const agentId = store.groups()[0].leadAgentId;
    await expect(runtime.handleInternalTool('memory', `recall_${agentId.replace(/-/g, '_')}`, { query: 'unknown fact' }, 'test'))
      .resolves.toEqual({ memories: '', found: false });
    await expect(runtime.handleInternalTool('memory', 'recall_deadbeef', { query: 'fact' }, 'test')).rejects.toThrow('Unknown agent');
  });

  it('hands a task off into a task thread with a writable output folder and read-only connectors', async () => {
    const { store, runtime, runs } = setup();
    const task = store.createTask({ title: 'Competitor pricing' });
    await runtime.handOff(task.id, 'Compare five competitors');
    const updated = store.get<Task>('tasks', task.id)!;
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
    expect(store.messagesForThread(store.get<Task>('tasks', task.id)!.threadId!).filter(message => message.role === 'user')).toHaveLength(1);
  });

  it('reports a hand-off setup failure and leaves the task blocked', async () => {
    const { store, runtime, memory } = setup();
    vi.spyOn(memory, 'recall').mockRejectedValue(new Error('Recall failed'));
    const task = store.createTask({ title: 'Competitor pricing' });
    await expect(runtime.handOff(task.id, 'Compare competitors')).rejects.toThrow('Recall failed');
    expect(store.get<Task>('tasks', task.id)?.status).toBe('blocked');
  });

  it('retries pending memories on a scheduler tick without routines', () => {
    const { store, runtime, memory } = setup();
    for (const routine of store.routines()) store.updateRoutine(routine.id, { enabled: false });
    runtime.tick();
    runtime.tick();
    expect(memory.retryPending).toHaveBeenCalledTimes(1);
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
    expect(store.list<Task>('tasks').filter(x => x.status === 'proposed').map(x => x.title)).toEqual(['Reply to Anna']);
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
