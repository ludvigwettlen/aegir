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
  return { store, runtime, runs, memory, reopen: () => new Runtime(store, codex, connectors, memory, () => {}, () => {}, { outputRoot: join(dir, 'out'), routineCwd: dir }) };
}

describe('runtime', () => {
  it('publishes a skill review card in its source chat and includes the saved outcome in later context', async () => {
    let receipt: unknown;
    let proposed = false;
    const { store, runtime, runs } = setup(async (_input, id, rt) => {
      if (!proposed) {
        proposed = true;
        const skill = rt.skills.list().find(s => s.name === 'follow-up-extraction')!;
        const files = rt.skills.detail(skill.id).files.map(f => ({ ...f, content: f.content + '\nRequire explicit ownership.' }));
        receipt = await rt.handleInternalTool('skills', 'propose_change', { id: skill.id, expectedRevision: skill.revision, files, reason: 'Require evidence of ownership' }, id);
      }
      return 'Done';
    });
    const thread = store.createThread(store.groups()[0].id, 'Improve follow-ups');
    const other = store.createThread(store.groups()[0].id, 'Unrelated');
    const emitted: unknown[] = [];
    store.onMessage = message => emitted.push(message);
    await runtime.sendMessage(thread.id, 'Propose better extraction rules');
    const proposal = runtime.skills.proposals()[0];
    expect(proposal).toMatchObject({ state: 'pending' });
    expect(receipt).toMatchObject({ id: proposal.id, reviewLocation: 'Review changes card in this conversation' });
    const card = store.messagePage(thread.id).messages.find(m => m.meta?.type === 'skill-change')!;
    expect(card).toMatchObject({ content: proposal.reason, meta: { proposalId: proposal.id, skillName: 'follow-up-extraction' } });
    expect(emitted).toContainEqual(expect.objectContaining({ id: card.id, meta: card.meta, threadId: thread.id }));
    expect(store.messagePage(other.id).messages).toHaveLength(0);
    runtime.skills.resolveProposal(proposal.id, true);
    await runtime.sendMessage(thread.id, 'Where is the proposal now?');
    expect(runs.at(-1)?.prompt).toContain('current state: applied');
    expect(runtime.skills.detail(proposal.skillId).files[0].content).toContain('Require explicit ownership.');
  });

  it('backfills existing skill proposals once without reopening or reordering closed conversations', () => {
    const { store, runtime, reopen } = setup();
    const group = store.groups()[0];
    const thread = store.createThread(group.id, 'Older conversation');
    const source = store.addMessage(thread.id, group.leadAgentId, 'agent', 'Proposed');
    const skill = runtime.skills.list()[0];
    const proposal = runtime.skills.propose(skill.id, skill.revision, runtime.skills.detail(skill.id).files, 'Review this', { agentId: group.leadAgentId, runId: source.id });
    runtime.skills.resolveProposal(proposal.id, false);
    store.db.prepare("UPDATE threads SET status='closed' WHERE id=?").run(thread.id);
    const original = store.get('threads', thread.id);
    reopen(); reopen();
    const cards = store.messagePage(thread.id).messages.filter(m => m.meta?.type === 'skill-change');
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ createdAt: proposal.createdAt, meta: { proposalId: proposal.id } });
    expect(store.get('threads', thread.id)).toEqual(original);
    expect(runtime.skills.proposals()[0].state).toBe('discarded');
  });

  it('creates no review card for a failed proposal', async () => {
    const { store, runtime } = setup(async (_input, id, rt) => {
      const skill = rt.skills.list()[0];
      await rt.handleInternalTool('skills', 'propose_change', { id: skill.id, expectedRevision: 'stale', files: rt.skills.detail(skill.id).files, reason: 'Invalid revision' }, id);
      return 'Should not succeed';
    });
    const thread = store.createThread(store.groups()[0].id, 'Failed proposal');
    await expect(runtime.sendMessage(thread.id, 'Try a stale proposal')).rejects.toThrow('changed since');
    expect(runtime.skills.proposals()).toHaveLength(0);
    const messages = store.messagePage(thread.id).messages;
    expect(messages.some(m => m.meta?.type === 'skill-change')).toBe(false);
    expect(messages.at(-1)?.status).toBe('failed');
  });

  it.each(['group', 'private'] as const)('lets the first agent title a new %s chat without adding a chat message', async kind => {
    const { store, runtime, runs } = setup(async (input, id, rt) => {
      if (input.tools.some(tool => tool.name === 'threads__set_title')) {
        expect(input.instructions).toContain('Before answering, call threads__set_title');
        expect(await rt.handleInternalTool('threads', 'set_title', { title: '  Designer competency mapping  ' }, id)).toEqual({ updated: true });
        await expect(rt.handleInternalTool('threads', 'set_title', { title: 'Another title' }, id)).rejects.toThrow('first response');
      }
      return 'Here is the mapping.';
    });
    const group = store.groups().find(group => group.kind === kind)!;
    const opening = 'Could you help me map our designers against the competencies in Proposal A?';
    const thread = await runtime.startThread(group.id, opening);
    await vi.waitFor(() => expect(store.messagesForThread(thread.id).at(-1)?.status).toBe('complete'));
    expect(store.get('threads', thread.id)?.title).toBe('Designer competency mapping');
    expect(store.threadSummaries().find(item => item.id === thread.id)?.title).toBe('Designer competency mapping');
    expect(store.messagesForThread(thread.id).map(message => message.content)).toEqual([opening, 'Here is the mapping.']);
    await runtime.sendMessage(thread.id, 'Now refine the criteria');
    expect(runs).toHaveLength(2);
    expect(runs[1].tools.some(tool => tool.name === 'threads__set_title')).toBe(false);
    expect(store.get('threads', thread.id)?.title).toBe('Designer competency mapping');
    await expect(runtime.handleInternalTool('threads', 'set_title', { title: 'Late title' }, 'codex-1')).rejects.toThrow('first response');
  });

  it('keeps the fallback title if no valid suggestion is supplied', async () => {
    const { store, runtime } = setup(async (_input, id, rt) => {
      for (const title of [null, '', '   ', 'x'.repeat(81), 'Invalid\u0000title'])
        await expect(rt.handleInternalTool('threads', 'set_title', { title }, id)).rejects.toThrow('title');
      return 'The answer still works.';
    });
    const thread = await runtime.startThread(store.groups()[0].id, 'Help with planning');
    await vi.waitFor(() => expect(store.messagesForThread(thread.id).at(-1)?.status).toBe('complete'));
    expect(store.get('threads', thread.id)?.title).toBe('Help with planning');
  });

  it('rejects title suggestions after the user stops a response', async () => {
    const { store, runtime } = setup(async (_input, id, rt) => {
      await rt.stopThread(rt.appThreadFor(id)!);
      await expect(rt.handleInternalTool('threads', 'set_title', { title: 'Too late' }, id)).rejects.toThrow('first response');
      return 'Stopped';
    });
    const thread = store.createThread(store.groups()[0].id, 'Original');
    await runtime.sendMessage(thread.id, 'Help with planning');
    expect(store.get('threads', thread.id)?.title).toBe('Original');
  });

  // Pending connector approvals listen to this signal, so they expire with the run (see external-write.ts).
  it('aborts a run signal when the user stops the run', async () => {
    let signal: AbortSignal | undefined;
    const { store, runtime } = setup(async (_input, id, rt) => {
      signal = rt.runSignal(id);
      expect(signal?.aborted).toBe(false);
      await rt.stopThread(rt.appThreadFor(id)!);
      expect(signal?.aborted).toBe(true);
      return 'Stopped';
    });
    const thread = store.createThread(store.groups()[0].id, 'Stop me');
    await runtime.sendMessage(thread.id, 'Post to Slack');
    expect(signal?.aborted).toBe(true);
  });

  it.each(['chat', 'task', 'routine'] as const)('aborts the run signal when a %s run completes', async kind => {
    let signal: AbortSignal | undefined;
    let codexId = '';
    const { store, runtime } = setup(async (_input, id, rt) => {
      codexId = id;
      signal = rt.runSignal(id);
      return 'Done';
    });
    if (kind === 'routine') await runtime.runRoutine(store.routines()[0].id, 'manual');
    else if (kind === 'task') await runtime.handOff(store.createTask({ title: 'Finish me' }).id, 'Research');
    else await runtime.sendMessage(store.createThread(store.groups()[0].id, 'Finish me').id, 'Hello');
    expect(signal).toBeDefined();
    expect(signal!.aborted).toBe(true);
    expect(runtime.runSignal(codexId)).toBeUndefined();
  });

  it.each(['task', 'routine'] as const)('does not offer or accept chat titles in %s runs', async kind => {
    const { store, runtime } = setup(async (input, id, rt) => {
      expect(input.tools.some(tool => tool.name === 'threads__set_title')).toBe(false);
      await expect(rt.handleInternalTool('threads', 'set_title', { title: 'Wrong scope' }, id)).rejects.toThrow('first response');
      return 'Done';
    });
    if (kind === 'routine') await runtime.runRoutine(store.routines()[0].id, 'manual');
    else {
      const task = store.createTask({ title: 'Keep task title' });
      await runtime.handOff(task.id, 'Research');
      expect(store.get('threads', store.get('tasks', task.id)!.threadId!)?.title).toBe(task.title);
    }
  });

  it('acknowledges a saved long message before the agent finishes and rejects duplicate sends', async () => {
    let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const { store, runtime, runs } = setup(async () => { await gate; return 'Done'; });
    const thread = store.createThread(store.groups()[0].id, 'Long message');
    const text = 'A long message with Unicode åäö. '.repeat(4000);
    await runtime.sendMessage(thread.id, text, false);
    expect(store.messagePage(thread.id).messages.find(message => message.role === 'user')?.content).toBe(text.trim());
    await expect(runtime.sendMessage(thread.id, 'Duplicate', false)).rejects.toThrow('already working');
    await vi.waitFor(() => expect(runs).toHaveLength(1));
    expect(runs[0].prompt).toContain(text.trim());
    finish();
    await vi.waitFor(() => expect(store.messagePage(thread.id).messages.some(message => message.role === 'agent' && message.status === 'complete')).toBe(true));
  });

  it('gives chat agents searchable todos and full saved notes', async () => {
    const notes = 'Detailed todo notes åäö. '.repeat(4000).trim();
    let taskId = '';
    const { store, runtime } = setup(async (input, id, rt) => {
      expect(input.tools).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'tasks__list', readOnly: true }),
        expect.objectContaining({ name: 'tasks__read', readOnly: true }),
      ]));
      expect(await rt.handleInternalTool('tasks', 'list', { query: 'Detailed todo' }, id)).toMatchObject({ tasks: [{ id: taskId }] });
      expect(await rt.handleInternalTool('tasks', 'read', { id: taskId }, id)).toMatchObject({ notes });
      await expect(rt.handleInternalTool('tasks', 'read', { id: 'missing' }, id)).rejects.toThrow('Todo not found');
      return 'Done';
    });
    taskId = store.createTask({ title: 'Research', notes }).id;
    await runtime.sendMessage(store.createThread(store.groups()[0].id, 'Read notes').id, 'Read my todo');
    await expect(runtime.handleInternalTool('tasks', 'list', {}, 'expired')).rejects.toThrow('No active');
  });

  it('includes current todo notes even when the hand-off has a separate instruction', async () => {
    const { store, runtime, runs } = setup();
    const task = store.createTask({ title: 'Research', notes: 'Essential background in the notes' });
    await runtime.handOff(task.id, 'Please work on this');
    expect(runs.at(-1)?.prompt).toContain(task.notes);
    store.updateTask(task.id, { notes: 'Updated background' });
    await runtime.sendMessage(store.get('tasks', task.id)!.threadId!, 'Continue');
    expect(runs.at(-1)?.prompt).toContain('Updated background');
  });

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

  it('keeps a task running through a teammate contribution and shares its output folder', async () => {
    let teammate = '';
    const { store, runtime, runs } = setup(async (_input, _id) => {
      if (runs.length === 1) return `Draft ready. @${teammate} verify the evidence and improve the report.`;
      expect(store.get('tasks', task.id)?.status).toBe('running');
      return 'Evidence checked and report updated.';
    });
    const group = store.groups().find(group => group.kind === 'group')!;
    const specialist = store.list('agents').find(agent => agent.id !== group.leadAgentId && group.agentIds.includes(agent.id))!;
    teammate = specialist.name;
    const task = store.createTask({ title: 'Compare competitors' });
    await runtime.handOff(task.id, 'Compare the evidence');
    expect(runs).toHaveLength(2);
    expect(runs[1].cwd).toBe(runs[0].cwd);
    expect(runs[1].prompt).toContain('verify the evidence');
    expect(runs[1].tools.some(tool => tool.name === 'slack__post')).toBe(false);
    expect(store.get('tasks', task.id)?.status).toBe('review');
    const messages = store.messagesForThread(store.get('tasks', task.id)!.threadId!);
    expect(messages.filter(message => message.role === 'agent').map(message => message.agentId)).toEqual([group.leadAgentId, specialist.id]);
  });

  it('does not start a teammate after the task is stopped', async () => {
    const { store, runtime, runs } = setup(async (_input, _id, rt) => {
      await rt.stopTask(task.id);
      return `@${teammate.name} please review.`;
    });
    const group = store.groups().find(group => group.kind === 'group')!;
    const teammate = store.list('agents').find(agent => agent.id !== group.leadAgentId && group.agentIds.includes(agent.id))!;
    const task = store.createTask({ title: 'Stopped collaboration' });
    await runtime.handOff(task.id, 'Review');
    expect(runs).toHaveLength(1);
    expect(store.get('tasks', task.id)?.status).toBe('blocked');
  });

  it('preloads a skill selected by the composer before the model runs', async () => {
    const { store, runtime, runs } = setup();
    const skill = runtime.skills.list().find(skill => skill.name === 'research')!;
    const thread = store.createThread(store.groups()[0].id, 'Use a skill');
    await runtime.sendMessage(thread.id, `Use skill research ($skill:${skill.id}).\n\nCompare evidence`);
    expect(runtime.skills.detail(skill.id).recentLoads).toHaveLength(1);
    expect(runs[0].instructions).toContain('compare evidence');
    runtime.skills.configure(skill.id, { enabled: false });
    await expect(runtime.sendMessage(thread.id, `Use skill research ($skill:${skill.id}).`)).rejects.toThrow('missing or disabled');
    expect(runs).toHaveLength(1);
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
    expect(store.message(proposal.id)!.meta).toMatchObject({ state: 'applied' });
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
