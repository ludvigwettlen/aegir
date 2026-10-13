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
import { calendarMeeting } from './one-on-one-calendar.js';
import { taskSourceKey } from './agent-tools.js';
import type { Task } from '../shared/types.js';

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

  it.each(['chat', 'task'] as const)('edits and dismisses proposals with undo and preserved provenance in a %s run', async kind => {
    let proposal!: Task;
    let saved: unknown;
    let dismissed: unknown;
    const { store, runtime, runs } = setup(async (input, id, rt) => {
      if (!input.tools.length) return 'Done';
      saved = await rt.handleInternalTool('tasks', 'update_proposal', {
        id: proposal.id, change: { title: '  Corrected follow-up  ', notes: 'Verified ownership', label: '#Work', dueAt: '2026-10-09' },
      }, id);
      dismissed = await rt.handleInternalTool('tasks', 'dismiss_proposal', { id: proposal.id }, id);
      return 'Done';
    });
    proposal = store.createTask({ title: 'Original follow-up', status: 'proposed', sourceUrl: 'https://slack.test/1', sourceKey: taskSourceKey('routine', 'https://slack.test/1', 'Original follow-up') });
    if (kind === 'chat') await runtime.sendMessage(store.createThread(store.groups()[0].id, 'Clean up proposals').id, 'Correct and dismiss this proposal');
    else await runtime.handOff(store.createTask({ title: 'Clean up proposals' }).id, 'Correct and dismiss this proposal');
    expect(runs.at(-1)?.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'tasks__update_proposal', readOnly: false }),
      expect.objectContaining({ name: 'tasks__dismiss_proposal', readOnly: false }),
    ]));
    expect(saved).toMatchObject({ updated: true, task: { id: proposal.id, title: 'Corrected follow-up', notes: 'Verified ownership', label: 'work', dueAt: '2026-10-09', status: 'proposed' } });
    expect(dismissed).toMatchObject({ updated: true, task: { id: proposal.id, status: 'dismissed', sourceUrl: proposal.sourceUrl, sourceKey: proposal.sourceKey } });
    expect(store.hasTaskSource(proposal.sourceKey!)).toBe(true);
    expect(store.get('tasks', proposal.id)?.status).toBe('dismissed');
    store.undoTaskAction();
    expect(store.get('tasks', proposal.id)?.status).toBe('proposed');
    store.undoTaskAction();
    expect(store.get('tasks', proposal.id)).toMatchObject({ ...proposal, updatedAt: expect.any(String) });
    await expect(runtime.handleInternalTool('tasks', 'dismiss_proposal', { id: proposal.id }, 'codex-1')).rejects.toThrow('active chat');
  });

  it('cleans up all matching proposals across pages while leaving accepted and unrelated tasks untouched', async () => {
    const receipts: unknown[] = [];
    const { store, runtime } = setup(async (_input, id, rt) => {
      const ids: string[] = [];
      let offset: number | null = 0;
      while (offset !== null) {
        const page = await rt.handleInternalTool('tasks', 'list', { query: 'Ericsson', status: 'proposed', offset }, id) as { tasks: Task[]; nextOffset: number | null };
        ids.push(...page.tasks.map(task => task.id));
        offset = page.nextOffset;
      }
      for (const taskId of ids) receipts.push(await rt.handleInternalTool('tasks', 'dismiss_proposal', { id: taskId }, id));
      return 'Cleaned up';
    });
    for (let i = 0; i < 55; i++) store.createTask({ title: `Ericsson ${i}`, status: 'proposed' });
    const accepted = store.createTask({ title: 'Ericsson accepted', status: 'ready' });
    const unrelated = store.createTask({ title: 'Other project', status: 'proposed' });
    await runtime.sendMessage(store.createThread(store.groups()[0].id, 'Cleanup').id, 'Dismiss the Ericsson proposals');
    expect(receipts).toHaveLength(55);
    expect(store.list('tasks').filter(task => task.status === 'dismissed')).toHaveLength(55);
    expect(store.get('tasks', accepted.id)).toEqual(accepted);
    expect(store.get('tasks', unrelated.id)).toEqual(unrelated);
  });

  it.each(['ready', 'running', 'review', 'blocked', 'done', 'dismissed'] as const)('protects %s tasks from proposal tools', async status => {
    const failures: string[] = [];
    let task!: Task;
    const { store, runtime } = setup(async (_input, id, rt) => {
      // Simulates the user changing the proposal after the agent read it.
      await rt.handleInternalTool('tasks', 'read', { id: task.id }, id);
      store.updateTask(task.id, { status });
      for (const tool of ['update_proposal', 'dismiss_proposal']) {
        try { await rt.handleInternalTool('tasks', tool, { id: task.id, change: { title: 'Wrong' } }, id); }
        catch (error) { failures.push(String(error)); }
      }
      return 'Done';
    });
    task = store.createTask({ title: 'Protected', notes: 'Keep me', status: 'proposed' });
    await runtime.sendMessage(store.createThread(store.groups()[0].id, 'Cleanup').id, 'Clean up proposals');
    expect(failures).toHaveLength(2);
    expect(failures.every(error => error.includes('Only pending task proposals'))).toBe(true);
    expect(store.get('tasks', task.id)).toMatchObject({ title: task.title, notes: task.notes, status });
    expect(store.undoTaskAction()).toBeNull();
  });

  it.each(['routine', 'stopped'] as const)('rejects proposal mutations from a %s run', async kind => {
    const failures: string[] = [];
    let task!: Task;
    const { store, runtime, runs } = setup(async (_input, id, rt) => {
      if (kind === 'stopped') await rt.stopThread(rt.appThreadFor(id)!);
      for (const tool of ['update_proposal', 'dismiss_proposal']) {
        try { await rt.handleInternalTool('tasks', tool, { id: task.id, change: { notes: 'Wrong' } }, id); }
        catch (error) { failures.push(String(error)); }
      }
      return 'Done';
    });
    task = store.createTask({ title: 'Protected', status: 'proposed' });
    if (kind === 'routine') await runtime.runRoutine(store.routines()[0].id, 'manual');
    else await runtime.sendMessage(store.createThread(store.groups()[0].id, 'Cleanup').id, 'Clean up proposals');
    expect(failures).toHaveLength(2);
    expect(failures.every(error => error.includes('active chat'))).toBe(true);
    expect(store.get('tasks', task.id)).toEqual(task);
    if (kind === 'routine') expect(runs[0].tools.some(tool => /tasks__(update|dismiss)_proposal/.test(tool.name))).toBe(false);
  });

  it('rejects invalid proposal changes without partial writes and allows clearing optional fields', async () => {
    const failures: string[] = [];
    let task!: Task;
    let cleared: unknown;
    const invalid = [null, [], {}, { status: 'ready' }, { sourceUrl: 'https://wrong.test' }, { title: ' ' }, { title: 'x'.repeat(241) }, { notes: null }, { label: 12 }, { dueAt: '2026-02-30' }, { dueAt: 'tomorrow' }];
    const { store, runtime } = setup(async (_input, id, rt) => {
      for (const change of invalid) {
        try { await rt.handleInternalTool('tasks', 'update_proposal', { id: task.id, change }, id); }
        catch (error) { failures.push(String(error)); }
      }
      try { await rt.handleInternalTool('tasks', 'dismiss_proposal', { id: 'missing' }, id); }
      catch (error) { failures.push(String(error)); }
      cleared = await rt.handleInternalTool('tasks', 'update_proposal', { id: task.id, change: { notes: '', label: null, dueAt: null } }, id);
      return 'Done';
    });
    task = store.createTask({ title: 'Preserved', notes: 'Notes', label: 'work', dueAt: '2026-10-09', status: 'proposed' });
    await runtime.sendMessage(store.createThread(store.groups()[0].id, 'Cleanup').id, 'Edit a proposal');
    expect(failures).toHaveLength(invalid.length + 1);
    expect(cleared).toMatchObject({ task: { title: task.title, notes: '', label: null, dueAt: null, status: 'proposed' } });
    store.undoTaskAction();
    expect(store.get('tasks', task.id)).toMatchObject({ ...task, updatedAt: expect.any(String) });
    expect(store.undoTaskAction()).toBeNull();
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
      expect(input.tools.some(tool => tool.name.startsWith('memory__remember_'))).toBe(kind !== 'routine');
      const agentId = tool.name.slice('memory__recall_'.length).replace(/_/g, '-');
      const result = await rt.handleInternalTool('memory', tool.name.slice('memory__'.length), { query: '  prior project decisions  ' }, id);
      expect(memory.recall).toHaveBeenLastCalledWith('prior project decisions', agentId, ...(kind === 'routine' ? [{ excludeDiscoveryReports: true }] : []));
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
    expect(memory.recall).toHaveBeenCalledWith('prior project decisions', expect.any(String), ...(kind === 'routine' ? [{ excludeDiscoveryReports: true }] : []));
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
    const { store, runtime } = setup(async (input, id, rt) => {
      if (!input.tools.length) return JSON.stringify({ approve: true, slackReplyOnly: false, reason: 'Explicit new request to the user' });
      for (let i = 0; i < 2; i++) await rt.handleInternalTool('tasks', 'suggest', { title: 'Approve the final draft', sourceUrl: 'https://slack.test/1', ownershipEvidence: 'Anna asks the user for approval', sourceEvidence: 'Please approve the final draft', freshnessEvidence: 'New request today' }, id);
      return 'Suggested one task';
    });
    const routine = store.routines()[0];
    await runtime.runRoutine(routine.id, 'manual');
    const run = store.routineRuns()[0];
    expect(run).toMatchObject({ status: 'ok', summary: '1 task suggested', trigger: 'manual' });
    expect(store.list('tasks').filter(x => x.status === 'proposed').map(x => x.title)).toEqual(['Approve the final draft']);
    const kinds = store.runEvents(run.id).map(x => x.kind);
    expect(kinds[0]).toBe('run'); expect(kinds.at(-1)).toBe('run'); expect(kinds).toContain('agent');
    expect(store.routine(routine.id)!.lastRunAt).toBe(run.startedAt);
  });

  it.each(['proposed', 'ready', 'done', 'dismissed'] as const)('reviews reworded suggestions against %s outcomes with full context', async status => {
    let receipt: unknown;
    const { store, runtime, runs } = setup(async (input, id, rt) => {
      if (!input.tools.length) {
        const data = JSON.parse(input.prompt);
        expect(data.existingTasks).toEqual([expect.objectContaining({ title: 'Follow up on Telecom lost-deal fit', status, notes: 'Same intended outcome', sourceUrl: 'https://notion.test/meeting' })]);
        expect(input.modelTier).toBe('default');
        return JSON.stringify({ approve: false, slackReplyOnly: false, reason: 'Same intended outcome already handled' });
      }
      receipt = await rt.handleInternalTool('tasks', 'suggest', {
        title: 'Follow up on lost Telecom deal', sourceUrl: 'https://notion.test/other-link',
        ownershipEvidence: 'User was asked to follow up', sourceEvidence: 'Follow up on the lost deal', freshnessEvidence: 'Meeting from yesterday',
      }, id);
      return 'No new tasks';
    });
    store.createTask({ title: 'Follow up on Telecom lost-deal fit', notes: 'Same intended outcome', status, sourceUrl: 'https://notion.test/meeting' });
    await runtime.runRoutine(store.routines()[0].id, 'manual');
    expect(receipt).toEqual({ created: false, reason: 'Same intended outcome already handled' });
    expect(store.list('tasks')).toHaveLength(1);
    expect(runs).toHaveLength(2);
  });

  it.each(['missing evidence', 'invalid review', 'failed review', 'changed history'] as const)('saves nothing with %s', async failure => {
    let receipt: unknown;
    const { store, runtime } = setup(async (input, id, rt) => {
      if (!input.tools.length) {
        if (failure === 'failed review') throw new Error('Review unavailable');
        if (failure === 'changed history') store.createTask({ title: 'Concurrent task' });
        return failure === 'invalid review' ? 'Looks fine' : '{"approve":true,"slackReplyOnly":false,"reason":"Personal request"}';
      }
      receipt = await rt.handleInternalTool('tasks', 'suggest', {
        title: 'Approve launch', sourceUrl: 'https://notion.test/launch',
        ...(failure === 'missing evidence' ? {} : { ownershipEvidence: 'Asked user', sourceEvidence: 'Approve launch', freshnessEvidence: 'Today' }),
      }, id);
      return 'Done';
    });
    await runtime.runRoutine(store.routines()[0].id, 'manual');
    expect(store.list('tasks').filter(task => task.status === 'proposed')).toHaveLength(0);
    if (failure === 'failed review') expect(store.lastRun(store.routines()[0].id)?.status).toBe('failed');
    else expect(receipt).toMatchObject({ created: false });
  });

  it('allows separately reviewed actions from the same source and includes user identity context', async () => {
    const { store, runtime, memory } = setup(async (input, id, rt) => {
      if (!input.tools.length) {
        const data = JSON.parse(input.prompt);
        expect(data.userContext).toBe('The user is Alex');
        expect(data.existingTasks).toHaveLength(1);
        expect(data.candidate.title).toBe('Approve launch budget');
        return '{"approve":true,"slackReplyOnly":false,"reason":"Distinct new personal request"}';
      }
      const result = await rt.handleInternalTool('tasks', 'suggest', {
        title: 'Approve launch budget', sourceUrl: 'https://notion.test/meeting',
        ownershipEvidence: 'Alex was explicitly asked to approve the budget', sourceEvidence: 'Alex: please approve the launch budget', freshnessEvidence: 'New request today',
      }, id);
      expect(result).toMatchObject({ created: true });
      return 'Saved';
    });
    vi.spyOn(memory, 'recall').mockResolvedValue('The user is Alex');
    store.createTask({ title: 'Send meeting agenda', status: 'done', sourceUrl: 'https://notion.test/meeting' });
    await runtime.runRoutine(store.routines()[0].id, 'manual');
    expect(store.list('tasks')).toHaveLength(2);
    expect(store.list('tasks').find(task => task.status === 'proposed')?.notes).toContain('Alex was explicitly asked');
  });

  it('does not advance discovery past a failed run', async () => {
    const { store, runtime, runs } = setup();
    const routine = store.routines()[0];
    const completed = store.startRun(routine.id, 'manual');
    store.finishRun(completed.id, 'ok', 'Prior successful coverage');
    store.db.prepare('UPDATE routine_runs SET startedAt=? WHERE id=?').run('2026-10-10T08:00:00Z', completed.id);
    const failed = store.startRun(routine.id, 'manual');
    store.finishRun(failed.id, 'failed', 'Source failed');
    await runtime.runRoutine(routine.id, 'manual');
    expect(runs[0].prompt).toContain('Previous run: 2026-10-10T08:00:00Z (ok)');
  });

  it('blocks discovery memory writes and retains normal routine memory access', async () => {
    const { store, runtime, memory, runs } = setup(async (input, id, rt) => {
      const tool = input.tools.find(tool => tool.name.startsWith('memory__recall_'))!;
      const name = tool.name.slice('memory__'.length).replace('recall_', 'remember_');
      if (input.tools.some(tool => tool.name.startsWith('memory__remember_')))
        await rt.handleInternalTool('memory', name, { content: 'Stable preference' }, id);
      else await expect(rt.handleInternalTool('memory', name, { content: 'Hourly discovery: pending follow-ups' }, id)).rejects.toThrow('read-only');
      return 'Done';
    });
    const remember = vi.spyOn(memory, 'remember');
    const discovery = store.routines()[0];
    await runtime.runRoutine(discovery.id, 'manual');
    expect(remember).not.toHaveBeenCalled();
    expect(runs[0].modelTier).toBe('default');
    const other = store.createRoutine({ name: 'Durable meeting decisions', instructions: 'Save durable facts', agentId: discovery.agentId, schedule: { every: 'day' }, enabled: false });
    await runtime.runRoutine(other.id, 'manual');
    expect(remember).toHaveBeenCalledOnce();
  });

  it('prepares 1:1 recaps from primary sources without recycling local notes or generated agendas', async () => {
    let checked = false;
    const { store, runtime, runs } = setup(async (input, id, rt) => {
      expect(rt.contextFor(id)?.kind).toBe('prep');
      expect(input.modelTier).toBe('default');
      expect(input.tools.every(tool => tool.readOnly)).toBe(true);
      expect(input.tools.some(tool => tool.name === 'slack__search')).toBe(true);
      expect(input.prompt).not.toContain('Discuss career growth');
      expect(input.prompt).not.toContain('An unverified previous suggestion');
      expect(input.prompt).not.toContain('priorMeetingNotes');
      expect(input.instructions).toContain('Notion is where the user keeps meeting notes');
      expect(input.instructions).toContain('Previously discussed (dated recap with source links)');
      expect(input.instructions).toContain('Never treat a previously generated agenda as evidence');
      const recall = input.tools.find(tool => tool.name.startsWith('memory__recall_'))!;
      await expect(rt.handleInternalTool('memory', recall.name.slice('memory__'.length).replace('recall_', 'remember_'), { content: 'Meeting report' }, id)).rejects.toThrow('read-only');
      checked = true; return '# Previously discussed\nNo prior conversations could be verified.\n\n## Suggested agenda\nWhat would be useful to discuss?';
    });
    const meeting = calendarMeeting({ id: 'prep', summary: 'Alex / Sam', start: { dateTime: new Date(Date.now() + 3600000).toISOString() }, end: { dateTime: new Date(Date.now() + 5400000).toISOString() }, attendees: [{ self: true, email: 'alex@example.com' }, { email: 'sam@example.com' }] }, 'work')!;
    meeting.notes = 'Discuss career growth';
    meeting.agenda = 'An unverified previous suggestion';
    meeting.previousAgenda = 'An unverified previous suggestion';
    store.db.prepare('INSERT INTO one_on_one_meetings VALUES (?,?)').run(meeting.id, JSON.stringify(meeting));
    runtime.oneOnOnes.configure('work', false);
    await runtime.oneOnOnes.prepare(meeting.id);
    expect(checked).toBe(true); expect(runs).toHaveLength(1);
    expect(runtime.oneOnOnes.snapshot().meetings[0]).toMatchObject({ status: 'ready', notes: 'Discuss career growth' });
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

describe('Gmail tool exposure', () => {
  it('makes Gmail reads and the inline draft editor available in chat with read-only filesystem permissions', async () => {
    const { store, runtime, runs } = setup(async (input, id, rt) => {
      expect(input.sandbox).toBe('read-only');
      expect(input.tools.map(tool => tool.name)).toEqual(expect.arrayContaining(['gmail__search', 'gmail__read_thread', 'gmail__draft', 'gmail__update_draft']));
      expect(input.instructions).toContain('You cannot send mail directly');
      await rt.handleInternalTool('gmail', 'draft', { to: 'peer@example.com', subject: 'Hello', body: 'Hi' }, id);
      return 'Draft opened';
    });
    store.setSetting('gmailAccount', 'gmail_work'); store.setSetting('gmailEmail', 'me@example.com');
    const call = vi.spyOn(runtime.gmail, 'call').mockResolvedValue({ sent: false });
    const thread = store.createThread(store.groups()[0].id, 'Email'); await runtime.sendMessage(thread.id, 'Draft an email');
    expect(call).toHaveBeenCalledWith('draft', expect.any(Object), thread.id);
    expect(runs).toHaveLength(1);
    await expect(runtime.handleInternalTool('gmail', 'search', { query: 'in:inbox' }, 'inactive')).rejects.toThrow('No active Gmail');
  });
  it('keeps unattended Gmail access read-only and refuses local draft mutation', async () => {
    const { store, runtime } = setup(async (input, id, rt) => {
      expect(input.tools.filter(tool => tool.name.startsWith('gmail__')).map(tool => tool.name)).toEqual(['gmail__search', 'gmail__read_thread']);
      await expect(rt.handleInternalTool('gmail', 'update_draft', {}, id)).rejects.toThrow('attended');
      return 'Nothing new';
    });
    store.setSetting('gmailAccount', 'gmail_work'); store.setSetting('gmailEmail', 'me@example.com');
    await runtime.runRoutine(store.routines()[0].id, 'manual');
  });
});

describe('Slack reply proposal suppression', () => {
  it.each(['Respond to Malcolm in Slack', "Resolve Malcolm's question about where the doc is"])('does not save conversation triage: %s', async title => {
    let receipt: unknown;
    const { store, runtime } = setup(async (input, id, rt) => {
      if (!input.tools.length) {
        expect(input.instructions).toContain('Do not propose Slack notification-triage tasks');
        // Even a contradictory approval cannot bypass the explicit triage verdict.
        return JSON.stringify({ approve: true, slackReplyOnly: true, reason: 'Only a routine Slack answer is needed.' });
      }
      expect(input.instructions).toContain('Do not propose Slack notification-triage tasks');
      receipt = await rt.handleInternalTool('tasks', 'suggest', { title, sourceUrl: 'https://work.slack.com/archives/C123/p123',
        ownershipEvidence: 'Malcolm addressed the user', sourceEvidence: 'Where is the document? Please reply.', freshnessEvidence: 'Unanswered question today' }, id);
      return 'Nothing new';
    });
    await runtime.runRoutine(store.routines()[0].id, 'manual');
    expect(receipt).toMatchObject({ created: false });
    expect(store.list('tasks')).toHaveLength(0);
    expect(store.runEvents(store.routineRuns()[0].id).some(event => event.text.includes('Routine Slack reply reminders belong in Slack'))).toBe(true);
  });
});
