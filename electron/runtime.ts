import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type {
  Agent,
  AppEvent,
  Group,
  DraftState,
  Message,
  MessageDraft,
  Routine,
  RoutineRun,
  Step,
  Task,
  Thread,
} from '../shared/types.js';
import { addStep, describeStep } from './steps.js';
import type { Store } from './db.js';
import type { ModelProvider, Tool } from './codex.js';
import type { GatedOutcome } from './gated.js';
import type { ConnectorManager } from './connectors.js';
import type { MemoryService } from './memory.js';
import { modelTierForRole } from '../shared/model-policy.js';
import { describeSchedule, isDue } from '../shared/routines.js';
import { baseAgentInstructions, collaborationInstructions, memoryInstructions } from './agent-instructions.js';
import { BrowserManager, browserInstructions } from './browser.js';
import { SkillRegistry, type SkillSession } from './skills.js';
import { handleSkillTool, skillTools } from './skill-tools.js';
import type { SkillProposal } from '../shared/skills.js';
import { mentionsAgent } from '../shared/agent-mentions.js';
import { cleanThreadTitle, threadTitleInstructions, threadTitleTool } from './thread-title.js';
import {
  canSend, checkPlan, cleanDraftText, draftFromTool, draftHistory, learnFromToolResult, needsCheck, nothingKnown,
  readToolResponse, sameDestination, sendPlan, UNDO_MS, type Known, type SendPlan,
} from './message-drafts.js';
import {
  cleanRoutineChange,
  connectorToolsFor,
  draftMessageTool,
  jsonObject,
  logText,
  memoryRecallTool,
  memoryTool,
  mentionedAgents,
  mentionedRoutines,
  proposeRoutineTool,
  slug,
  suggestTaskTool,
  taskSourceKey,
  taskReadTools,
  type RunKind,
} from './agent-tools.js';

type Context = {
  kind: RunKind;
  skills?: SkillSession;
  browser?: boolean;
  threadId?: string;
  initialTitle?: string;
  runId?: string;
  counts?: { tasks: number; memories: number };
  // The reply being written in a chat or task run, so tool steps and approvals can be filed under it.
  reply?: { note: (step: Step) => void };
  // Aborted when the run is stopped or ends, so its pending approvals and external writes expire with it.
  abort?: AbortController;
  // Draft cards this reply made, and who wrote them. They move under the reply when it finishes.
  drafts?: string[];
  agentId?: string;
};

// Runs agents in threads (chat and handed-off tasks) and routines, and keeps the mapping from Codex threads back to them.
export class Runtime {
  readonly skills: SkillRegistry;
  private active = new Map<string, Context>(); // Codex thread id → what it is running for
  private runningThreads = new Map<string, { cancelled: boolean }>();
  private runningRoutines = new Set<string>();
  private handingOffTasks = new Set<string>();
  // What Slack and Superhuman returned in each conversation, so draft cards can show a confirmed destination at once.
  private known = new Map<string, Known>();
  // Draft sends in their undo window or in flight, by card id. Undo aborts them.
  private sends = new Map<string, AbortController>();
  // Destination checks run one at a time, each in its own locked run.
  private checks: Promise<void> = Promise.resolve();
  // The draft card undo window, and the pause before a destination check that came too early tries once more.
  // Tests shorten both.
  undoMs = UNDO_MS;
  checkRetryMs = 5000;
  private timer: NodeJS.Timeout | null = null;
  private startupTimer: NodeJS.Timeout | null = null;
  private stopped = false;

  private get available() { return !this.stopped && this.store.isOpen; }
  constructor(
    private store: Store,
    private codex: ModelProvider,
    private connectors: Pick<ConnectorManager, 'listTools' | 'states'>,
    private memory: Pick<MemoryService, 'recall' | 'remember'>,
    private refresh: () => void,
    private emit: (event: AppEvent) => void,
    private paths: { outputRoot: string; routineCwd: string },
    private browser?: BrowserManager,
  ) {
    this.skills = new SkillRegistry(store.db, join(paths.routineCwd, 'skills'), id => !!store.get('agents', id), id => store.routine(id)?.agentId);
    for (const proposal of this.skills.proposals())
      store.ensureSkillProposalMessage(proposal, this.skills.get(proposal.skillId).name);
    // Sends Legolas quit in the middle of. Before the send call was released nothing went out; after it, nobody knows.
    for (const message of store.draftsIn(['queued', 'sending'])) {
      const draft = message.meta as MessageDraft;
      store.setMessageMeta(message.id, draft.state === 'queued'
        ? { ...draft, state: 'failed', queuedAt: undefined, error: 'Legolas closed before sending it. Nothing went out.' }
        : { ...draft, state: 'unknown', error: `Legolas closed while sending it. Check ${draft.channel === 'email' ? 'Superhuman' : 'Slack'} before sending again.` });
    }
  }

  contextFor(codexThreadId: string) {
    return this.active.get(codexThreadId);
  }
  // The run's cancellation signal. Missing once the run has ended.
  runSignal(codexThreadId: string): AbortSignal | undefined {
    return this.active.get(codexThreadId)?.abort?.signal;
  }
  private track(codexThreadId: string, context: Context) {
    this.active.get(codexThreadId)?.abort?.abort();
    this.active.set(codexThreadId, { ...context, abort: new AbortController() });
  }
  private untrack(codexThreadId: string) {
    this.active.get(codexThreadId)?.abort?.abort();
    this.active.delete(codexThreadId);
  }
  // Files an answered approval under the reply that asked for it. False when that run has ended.
  recordApproval(codexThreadId: string, label: string, approved: boolean) {
    const reply = this.active.get(codexThreadId)?.reply;
    if (!reply) return false;
    reply.note({ kind: 'approval', label, at: new Date().toISOString(), outcome: approved ? 'approved' : 'declined' });
    return true;
  }
  appThreadFor(codexThreadId: string) {
    return this.active.get(codexThreadId)?.threadId;
  }

  // ---- Chat -------------------------------------------------------------
  async startThread(groupId: string, content: string): Promise<Thread> {
    if (!this.available) throw new Error('Runtime is stopped');
    const text = content.trim();
    if (!text) throw new Error('Write a first message');
    const thread = this.store.createThread(groupId, text.split('\n')[0].slice(0, 80));
    this.refresh();
    void this.sendMessage(thread.id, text).catch(() => {});
    return thread;
  }
  async sendMessage(threadId: string, content: string, waitForCompletion = true) {
    if (!this.available) throw new Error('Runtime is stopped');
    const text = content.trim();
    if (!text) return;
    const thread = this.thread(threadId);
    const group = this.group(thread.groupId);
    if (
      this.runningThreads.has(threadId) ||
      (thread.taskId && this.handingOffTasks.has(thread.taskId))
    )
      throw new Error('An agent is already working in this thread');
    const execution = { cancelled: false };
    this.runningThreads.set(threadId, execution);
    // Persist before acknowledging so rejected sends leave the draft intact.
    try {
      this.store.addMessage(threadId, null, 'user', text);
      if (thread.taskId) this.store.updateTask(thread.taskId, { status: 'running' });
      this.refresh();
    } catch (error) {
      this.runningThreads.delete(threadId);
      throw error;
    }
    const completion = this.respondToMessage(thread, group, text, execution);
    if (waitForCompletion) await completion;
    else void completion.catch(() => {}); // runAgent records failures in the conversation.
  }
  private async respondToMessage(thread: Thread, group: Group, text: string, execution: { cancelled: boolean }) {
    const threadId = thread.id;
    let ok = false;
    try {
      const kind: RunKind = thread.kind === 'task' ? 'task' : 'chat';
      ok = true;
      for (const agent of mentionedAgents(text, this.store.list('agents'), group)) {
        if (!this.available || execution.cancelled) {
          ok = false;
          break;
        }
        ok = (await this.runAgent(thread, group, agent, text, kind)) && ok;
      }
    } catch (error) {
      ok = false;
      throw error;
    } finally {
      this.runningThreads.delete(threadId);
      if (this.available && thread.taskId && this.store.get('tasks', thread.taskId)?.status === 'running')
        this.store.updateTask(thread.taskId, {
          status: ok && !execution.cancelled ? 'review' : 'blocked',
        });
      if (this.available) this.refresh();
    }
  }
  async stopThread(threadId: string) {
    const execution = this.runningThreads.get(threadId);
    if (execution) execution.cancelled = true;
    for (const [codexThreadId, context] of this.active)
      if (context.threadId === threadId) {
        context.abort?.abort();
        await this.browser?.finish(codexThreadId);
        await this.codex.stop(codexThreadId);
      }
  }

  // ---- Tasks ------------------------------------------------------------
  // A hand-off is one instruction. Atlas-style routing picks the group; the group lead starts in a fresh task thread.
  async handOff(taskId: string, instruction: string) {
    if (!this.available) throw new Error('Runtime is stopped');
    const task = this.store.get('tasks', taskId);
    if (!task) throw new Error('Task not found');
    if (task.status === 'running' || this.handingOffTasks.has(taskId))
      throw new Error('The team is already working on this task');
    this.handingOffTasks.add(taskId);
    let started = false;
    let activeThreadId: string | undefined;
    try {
      const brief = instruction.trim() || task.notes || task.title;
      const group = await this.routeTask(task, brief);
      if (!this.available) return;
      const outputDir =
        task.outputDir || join(this.paths.outputRoot, `${slug(task.title)}-${task.id.slice(0, 6)}`);
      mkdirSync(outputDir, { recursive: true });
      let thread = task.threadId ? this.store.get('threads', task.threadId) : undefined;
      if (!thread) thread = this.store.createThread(group.id, task.title, 'task', task.id);
      if (this.runningThreads.has(thread.id))
        throw new Error('An agent is already working in this thread');
      activeThreadId = thread.id;
      this.runningThreads.set(thread.id, { cancelled: false });
      this.store.updateTask(taskId, {
        status: 'running',
        threadId: thread.id,
        outputDir,
        agentId: group.leadAgentId,
      });
      started = true;
      this.store.addMessage(thread.id, null, 'user', brief);
      this.refresh();
      const lead = this.store.get('agents', group.leadAgentId)!;
      const ok = await this.runAgent(thread, group, lead, brief, 'task');
      if (!this.available) return;
      const latest = this.store.get('tasks', taskId);
      if (latest?.status === 'running')
        this.store.updateTask(taskId, { status: ok ? 'review' : 'blocked' });
      this.refresh();
    } catch (error) {
      if (this.available && started && this.store.get('tasks', taskId)?.status === 'running') {
        this.store.updateTask(taskId, { status: 'blocked' });
        this.refresh();
      }
      throw error;
    } finally {
      if (activeThreadId) this.runningThreads.delete(activeThreadId);
      this.handingOffTasks.delete(taskId);
    }
  }
  async stopTask(taskId: string) {
    const task = this.store.get('tasks', taskId);
    if (task?.threadId) await this.stopThread(task.threadId);
  }
  private async routeTask(task: Task, brief: string): Promise<Group> {
    if (task.threadId) {
      const existing = this.store.get('threads', task.threadId);
      if (existing) return this.group(existing.groupId);
    }
    const groups = this.store.groups().filter((group) => group.kind === 'group');
    if (groups.length <= 1) return groups[0] || this.store.groups()[0];
    const agents = this.store.list('agents');
    const listing = groups
      .map(
        (group) =>
          `- id: ${group.id}\n  name: ${group.title}\n  agents: ${group.agentIds
            .map((id) => agents.find((agent) => agent.id === id)?.name)
            .filter(Boolean)
            .join(', ')}\n  purpose: ${group.instructions || '(none)'}`,
      )
      .join('\n');
    try {
      const result = await this.codex.run({
        kind: 'route',
        cwd: this.paths.routineCwd,
        instructions:
          'You route tasks to the best-suited group of agents. Reply with JSON only: {"groupId": "<id>"}.',
        prompt: `Groups:\n${listing}\n\nTask: ${task.title}${task.label ? ` (#${task.label})` : ''}\nInstruction: ${brief}`,
        tools: [],
        modelTier: 'lightweight',
        onDelta: () => {},
      });
      const chosen = groups.find(
        (group) => group.id === jsonObject<{ groupId: string }>(result.text).groupId,
      );
      if (chosen) return chosen;
    } catch {
      /* fall back below */
    }
    return groups[0];
  }

  // ---- Agent runs in threads ---------------------------------------------
  private async runAgent(
    thread: Thread,
    group: Group,
    agent: Agent,
    userText: string,
    kind: RunKind,
    depth = 0,
  ): Promise<boolean> {
    if (!this.available) return false;
    const message = this.store.addMessage(thread.id, agent.id, 'agent', '', 'streaming');
    this.refresh();
    let streamed = '';
    let activeId: string | undefined;
    const drafts: string[] = [];
    // Steps are saved on the reply at most every 1.5s while it works, and once more when it finishes.
    const steps: Step[] = [];
    let flushTimer: NodeJS.Timeout | null = null;
    const flushSteps = () => {
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      if (this.available && steps.length) this.store.setMessageMeta(message.id, { type: 'steps', steps: [...steps] });
    };
    const reply = {
      note: (step: Step) => {
        addStep(steps, step);
        if (!flushTimer) flushTimer = setTimeout(flushSteps, 1500);
      },
    };
    try {
      const agents = this.store.list('agents');
      const page = this.store.messagePage(thread.id, message.id, 30);
      const suggestTitle = kind === 'chat' && depth === 0 && !page.before
        && page.messages.length === 1 && page.messages[0].role === 'user';
      const proposals = new Map(this.skills.proposals().map(proposal => [proposal.id, proposal]));
      const history = page.messages.map((x) => {
        if (x.meta?.type === 'skill-change') {
          const proposal = proposals.get(x.meta.proposalId);
          return `System: Skill revision ${x.meta.skillName}, proposal ${x.meta.proposalId}, current state: ${proposal?.state || 'unavailable'}. Review changes in this conversation. Reason: ${x.content}`;
        }
        if (x.meta?.type === 'message-draft') return `System: ${draftHistory(x.id, x.meta)}`;
        return `${this.speaker(x, agents)}: ${x.content}`;
      }).join('\n');
      const recalled = await this.memory.recall(userText.slice(0, 160), agent.id);
      if (!this.available) return false;
      const routines = kind === 'chat' ? mentionedRoutines(userText, this.store.routines()) : [];
      const task = thread.taskId ? this.store.get('tasks', thread.taskId) : undefined;
      const tools: Tool[] = [
        ...connectorToolsFor(kind, this.connectors.listTools()),
        ...(await this.browser?.tools(kind) || []),
        memoryTool(agent),
        memoryRecallTool(agent),
        ...skillTools,
        ...taskReadTools,
        draftMessageTool,
        ...(kind === 'chat' ? [proposeRoutineTool] : []),
        ...(suggestTitle ? [threadTitleTool] : []),
      ];
      const skillContext = this.skills.session(agent.id, message.id, kind, tools.map(tool => tool.name), userText);
      const prompt = [
        `Relevant memory:\n${recalled || '(none)'}`,
        routines.length
          ? `Tagged routines:\n${routines.map((routine) => this.describeRoutine(routine, agents)).join('\n\n')}`
          : '',
        `Thread "${thread.title}" so far:\n${history || '(empty)'}`,
        task ? `Current todo (latest saved details):\n${JSON.stringify(task)}` : '',
        `Current message:\n${userText}`,
      ]
        .filter(Boolean)
        .join('\n\n');
      if (this.runningThreads.get(thread.id)?.cancelled) {
        this.store.updateMessage(message.id, 'Stopped', 'failed');
        this.refresh();
        return false;
      }
      const result = await this.codex.run({
        kind: kind === 'task' ? 'task' : 'chat',
        cwd: kind === 'task' && task?.outputDir ? task.outputDir : this.paths.routineCwd,
        sandbox: kind === 'task' ? 'workspace-write' : 'read-only',
        instructions: `${this.instructionsFor(kind, agent, group, depth)}\n${skillContext.instructions}\n${tools.some(tool => tool.name.startsWith('browser__')) ? browserInstructions : ''}\n${suggestTitle ? threadTitleInstructions : ''}`,
        prompt,
        tools,
        modelTier: modelTierForRole(agent.role),
        onThreadStarted: (codexThreadId) => {
          if (!this.available) return;
          activeId = codexThreadId;
          this.track(codexThreadId, { kind, threadId: thread.id, initialTitle: suggestTitle ? thread.title : undefined, skills: skillContext.session, browser: tools.some(tool => tool.name.startsWith('browser__')), reply, drafts, agentId: agent.id });
        },
        onItem: (item) => {
          const label = describeStep(item);
          if (label) reply.note({ kind: 'tool', label, at: new Date().toISOString() });
        },
        // Superhuman drafts and Slack names as the connectors returned them, for draft cards in this conversation.
        onToolResult: (name, toolInput, response) => learnFromToolResult(name, toolInput, response, this.knownFor(thread.id)),
        onDelta: (delta) => {
          if (!this.available) return;
          streamed += delta;
          this.store.updateMessage(message.id, streamed, 'streaming');
        },
      });
      this.untrack(result.threadId);
      await this.browser?.finish(result.threadId);
      if (!this.available) return false;
      const cancelled = !!this.runningThreads.get(thread.id)?.cancelled;
      const ok = result.status === 'completed' && !cancelled;
      // A run that ends with nothing to show still says why, so a stopped task never looks like a silent crash.
      const text = result.text || streamed || (cancelled || result.status === 'interrupted'
        ? 'Stopped before Claude wrote anything. Reply here to pick it up again.'
        : 'Claude Code ended without an answer. Reply here to try again.');
      this.store.updateMessage(message.id, text, ok ? 'complete' : 'failed');
      flushSteps();
      // The answer is the last thing in the thread, followed by any draft cards it made.
      this.store.moveMessagesToEnd([message.id, ...drafts]);
      this.refresh();
      if (depth === 0 && ok) {
        const next = agents.find(
          (other) =>
            other.id !== agent.id &&
            group.agentIds.includes(other.id) &&
            mentionsAgent(result.text, other.name),
        );
        if (next) {
          this.store.addMessage(
            thread.id,
            null,
            'system',
            `${agent.name} brought in ${next.name}.`,
          );
          this.refresh();
          return this.runAgent(
            thread,
            group,
            next,
            `${agent.name} asked you to contribute:\n${result.text}`,
            kind,
            1,
          );
        }
      }
      return ok;
    } catch (error) {
      if (!this.available) return false;
      this.store.updateMessage(
        message.id,
        streamed ? `${streamed}\n\n${String(error)}` : String(error),
        'failed',
      );
      flushSteps();
      // The answer is the last thing in the thread, followed by any draft cards it made.
      this.store.moveMessagesToEnd([message.id, ...drafts]);
      this.refresh();
      throw error;
    } finally {
      if (flushTimer) clearTimeout(flushTimer);
      if (activeId) {
        this.untrack(activeId);
        await this.browser?.finish(activeId);
      }
    }
  }
  private instructionsFor(kind: RunKind, agent: Agent, group: Group, depth = 0) {
    const memoryGuidance = memoryInstructions(this.store.getSetting('memoryInstructions') || '');
    const collaboration = collaborationInstructions(
      this.store.list('agents').filter(other => other.id !== agent.id && group.agentIds.includes(other.id)),
      depth > 0,
      kind === 'task',
    );
    const purpose = group.instructions ? `\nGroup purpose: ${group.instructions}` : '';
    if (kind === 'task')
      return `${baseAgentInstructions}\n${agent.instructions}\nYou are ${agent.name} (${agent.role}) working on a task the user handed to the agent team, in the "${group.title}" group.${purpose}
Your working directory is the task's output folder. Put every deliverable there as Markdown, HTML or code files, and name them clearly.
Slack and Notion tools are read-only; use them to research. Do not write to external systems through commands or connectors. If browser tools are available, browser interaction is a separate capability that requires explicit in-app browser control approval for this response.
${collaboration}
Finish with a short summary: the files you produced and anything that needs the user.
${memoryGuidance}`;
    return `${baseAgentInstructions}\n${agent.instructions}\nYou are ${agent.name} (${agent.role}) talking with the user in a thread of the "${group.title}" ${group.kind === 'private' ? 'direct chat' : 'group'} in Legolas.${purpose}
Address the user directly. Be clear about source links and tool failures. Connected Slack and Notion tools are available; writing to them requires the user's approval.
${collaboration}
To create or change a scheduled routine, call routines__propose_change; the user applies or discards it.
${memoryGuidance}`;
  }
  private describeRoutine(routine: Routine, agents: Agent[]) {
    const runs = this.store
      .routineRuns(500)
      .filter((run) => run.routineId === routine.id)
      .slice(0, 5);
    return `- id: ${routine.id}\n  name: ${routine.name}\n  agent: ${agents.find((agent) => agent.id === routine.agentId)?.name || 'unknown'} (id ${routine.agentId})\n  schedule: ${describeSchedule(routine.schedule)} ${JSON.stringify(routine.schedule)}\n  enabled: ${routine.enabled}\n  instructions: ${routine.instructions}\n  recent runs: ${runs.map((run) => `${run.startedAt} ${run.status} — ${run.summary}`).join('; ') || 'none'}`;
  }
  private speaker(message: Message, agents: Agent[]) {
    return message.role === 'user'
      ? 'User'
      : message.role === 'system'
        ? 'System'
        : agents.find((agent) => agent.id === message.agentId)?.name || 'Agent';
  }

  // ---- Internal tools ------------------------------------------------------
  // Handles tools that are not external connectors. Returns undefined when the tool is not ours.
  async handleInternalTool(
    provider: string,
    tool: string,
    args: Record<string, unknown>,
    codexThreadId: string,
  ): Promise<unknown> {
    if (!this.available) throw new Error('Runtime is stopped');
    const context = this.active.get(codexThreadId);
    if (provider === 'threads' && tool === 'set_title') {
      if (context?.kind !== 'chat' || !context.threadId || context.initialTitle === undefined
        || !this.runningThreads.has(context.threadId) || this.runningThreads.get(context.threadId)?.cancelled)
        throw new Error('Title suggestions are only available during the first response in a new chat');
      const title = cleanThreadTitle(args.title);
      const updated = this.store.setSuggestedThreadTitle(context.threadId, context.initialTitle, title);
      delete context.initialTitle;
      if (updated) this.refresh();
      return { updated };
    }
    if (provider === 'browser') {
      if (!this.browser || !context?.browser || !context.threadId || this.runningThreads.get(context.threadId)?.cancelled)
        throw new Error('Browser tools are unavailable in this run');
      return this.browser.call(codexThreadId, context.threadId, context.kind, tool, args);
    }
    if (provider === 'skills') {
      if (!context?.skills) throw new Error('No active skill session');
      const result = handleSkillTool(this.skills, context.skills, tool, args);
      let reviewLocation: string | undefined;
      if (tool === 'propose_change') {
        const proposal = result as SkillProposal;
        const message = this.store.ensureSkillProposalMessage(proposal, this.skills.get(proposal.skillId).name);
        reviewLocation = message ? 'Review changes card in this conversation' : 'Settings → Manage skills → Proposed changes';
      }
      this.emit({ type: 'skills-changed' });
      this.refresh();
      return reviewLocation ? { ...result, reviewLocation } : result;
    }
    if (provider === 'memory') {
      const match = tool.match(/^(remember|recall)_([0-9a-f_]+)$/i);
      if (!match) throw new Error('Unknown memory tool');
      const agentId = match[2].replace(/_/g, '-');
      if (!this.store.get('agents', agentId)) throw new Error('Unknown agent');
      if (match[1].toLowerCase() === 'recall') {
        if (typeof args.query !== 'string' || !args.query.trim() || args.query.length > 2000)
          throw new Error('Memory query must be 1–2000 characters');
        const result = await this.memory.recall(args.query.trim(), agentId);
        return { memories: result, found: Boolean(result.trim()) };
      }
      const scope = args.scope === 'private' ? `agent-${agentId}` : 'shared';
      const result = await this.memory.remember(
        scope,
        String(args.content || ''),
        typeof args.sourceUrl === 'string' && /^https?:\/\//.test(args.sourceUrl)
          ? args.sourceUrl
          : null,
      );
      if (context?.counts) context.counts.memories++;
      if (this.available) this.refresh();
      return { id: result?.id, saved: true };
    }
    if (provider === 'tasks' && (tool === 'list' || tool === 'read')) {
      if (!context) throw new Error('No active agent run');
      if (tool === 'read') {
        if (typeof args.id !== 'string') throw new Error('A todo id is required');
        const task = this.store.get('tasks', args.id);
        if (!task) throw new Error('Todo not found');
        return task;
      }
      const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : '';
      const offset = args.offset === undefined ? 0 : args.offset;
      if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid offset');
      const tasks = this.store.list('tasks').filter(task => !query || `${task.title}\n${task.notes}`.toLowerCase().includes(query));
      return { tasks: tasks.slice(offset, offset + 50).map(({ id, title, status, label }) => ({ id, title, status, label })), nextOffset: offset + 50 < tasks.length ? offset + 50 : null };
    }
    if (provider === 'tasks' && tool === 'suggest') {
      const title = String(args.title || '').trim();
      const sourceUrl = String(args.sourceUrl || '').trim();
      if (!title || !/^https?:\/\//.test(sourceUrl))
        throw new Error('A suggestion needs a title and a source link');
      const sourceKey = taskSourceKey('routine', sourceUrl, title);
      if (this.store.hasTaskSource(sourceKey))
        return { created: false, reason: 'Already suggested' };
      const task = this.store.createTask({
        title: title.slice(0, 240),
        notes: String(args.notes || ''),
        label:
          typeof args.label === 'string'
            ? args.label.replace(/^#/, '').toLowerCase() || null
            : null,
        status: 'proposed',
        sourceUrl,
        sourceKey,
      });
      if (context?.counts) context.counts.tasks++;
      this.refresh();
      return { created: true, id: task.id };
    }
    if (provider === 'messages' && tool === 'draft') {
      if (!context?.threadId || (context.kind !== 'chat' && context.kind !== 'task') || this.runningThreads.get(context.threadId)?.cancelled)
        throw new Error('Draft cards can only be shown in a conversation, while you answer');
      const draft = draftFromTool(args, this.knownFor(context.threadId));
      // Send waits until Slack or Superhuman confirm where it goes. Without Claude Code it can only be copied.
      if (needsCheck(draft) && this.codex.sendGated) draft.state = 'checking';
      const card = this.store.addMessage(context.threadId, context.agentId ?? null, 'system', `${draft.channel === 'email' ? 'Email' : 'Slack'} draft: ${draft.label}`, 'complete', draft);
      // A newer draft replaces one the user hasn't sent: the card named in `replaces`, or the same Superhuman draft.
      const replaces = typeof args.replaces === 'string' ? args.replaces : '';
      let replaced = false;
      for (const message of this.store.messagesForThread(context.threadId)) {
        if (message.id === card.id || message.meta?.type !== 'message-draft' || !['checking', 'pending', 'failed'].includes(message.meta.state)) continue;
        if (message.id === replaces || (!!draft.email?.draftId && message.meta.email?.draftId === draft.email.draftId)) {
          this.store.setMessageMeta(message.id, { ...message.meta, state: 'replaced', replacedBy: card.id });
          replaced = true;
        }
      }
      context.drafts?.push(card.id);
      if (draft.state === 'checking') this.queueCheck(card.id);
      this.refresh();
      return { card: card.id, replaced, note: 'The card is under your reply. The user edits it there and presses Send, or copies it and sends it themselves. It has not been sent, and you never send it yourself.' };
    }
    if (provider === 'routines' && tool === 'propose_change') {
      if (!context?.threadId)
        throw new Error('Routine changes can only be proposed in a chat thread');
      const routineId = typeof args.routineId === 'string' && args.routineId ? args.routineId : '';
      if (routineId && !this.store.routine(routineId)) throw new Error('Unknown routine');
      const change = cleanRoutineChange(args.change, this.store.list('agents'), !routineId);
      this.store.addMessage(
        context.threadId,
        null,
        'system',
        String(args.reason || 'Proposed routine change'),
        'complete',
        { type: 'routine-change', routineId, change, state: 'pending' },
      );
      this.refresh();
      return { proposed: true, note: 'The user will apply or discard this change.' };
    }
    return undefined;
  }
  // ---- Draft cards ------------------------------------------------------------
  // The user edits a card and presses Send (five seconds to undo), or sends it themselves and says so, or discards it.
  // Legolas sends only what the card says, to the destination Slack or Superhuman confirmed, after that click.
  private static editable: DraftState[] = ['checking', 'pending', 'failed', 'unknown'];
  private draftCard(messageId: string): MessageDraft {
    const message = this.store.message(messageId);
    if (!message || message.meta?.type !== 'message-draft') throw new Error('This draft no longer exists');
    return message.meta;
  }
  private knownFor(threadId: string): Known {
    let known = this.known.get(threadId);
    if (!known) this.known.set(threadId, known = nothingKnown());
    return known;
  }
  // Changes a card only while it is in one of `from`. Store calls are synchronous, so nothing can slip in between.
  private moveDraft(messageId: string, from: DraftState[], change: Partial<MessageDraft>): MessageDraft | null {
    const message = this.store.message(messageId);
    if (!this.available || message?.meta?.type !== 'message-draft' || !from.includes(message.meta.state)) return null;
    const next: MessageDraft = { ...message.meta, ...change };
    this.store.setMessageMeta(messageId, next);
    return next;
  }
  updateDraft(messageId: string, text: string) {
    const draft = this.draftCard(messageId);
    if (!Runtime.editable.includes(draft.state)) throw new Error('This draft can no longer be edited');
    const next = cleanDraftText(text);
    if (next !== draft.text) this.moveDraft(messageId, Runtime.editable, { text: next });
  }
  // Queues the send and returns. The locked run starts at once and waits at the send call until the undo window has
  // passed; the card follows the rest (sending, sent) through message events.
  async sendDraft(messageId: string, text: string) {
    if (!this.available) throw new Error('Runtime is stopped');
    const draft = this.draftCard(messageId);
    if (draft.state === 'queued' || draft.state === 'sending') throw new Error('This draft is already being sent');
    if (!['pending', 'failed', 'unknown'].includes(draft.state)) throw new Error('This draft can no longer be sent');
    if (!this.codex.sendGated) throw new Error('Sending from Legolas needs the Claude Code engine. Copy it instead.');
    if (!canSend(draft)) throw new Error(draft.channel === 'slack'
      ? "Legolas couldn't confirm where this goes, so it won't send it. Copy it instead."
      : 'Legolas only sends an email that is in Superhuman. Ask Claude to put it there, or copy it.');
    const body = cleanDraftText(text);
    if (!body.trim()) throw new Error('The draft is empty');
    const queued = this.moveDraft(messageId, ['pending', 'failed', 'unknown'], { text: body, state: 'queued', queuedAt: new Date().toISOString(), error: undefined });
    if (!queued) throw new Error('This draft is already being sent');
    const abort = new AbortController();
    this.sends.set(messageId, abort);
    void this.deliver(messageId, queued, abort).finally(() => { if (this.sends.get(messageId) === abort) this.sends.delete(messageId); });
  }
  private async deliver(messageId: string, draft: MessageDraft, abort: AbortController) {
    // The commit point: waits out the undo window, then marks the card sending, unless the user took it back.
    const commit = async () => {
      const wait = Date.parse(draft.queuedAt || '') + this.undoMs - Date.now();
      if (wait > 0) await new Promise((done) => setTimeout(done, wait));
      return !abort.signal.aborted && !!this.moveDraft(messageId, ['queued'], { state: 'sending' });
    };
    let plan: SendPlan;
    try { plan = sendPlan(draft, commit); }
    catch (error) { this.moveDraft(messageId, ['queued'], { state: 'failed', error: String(error).replace(/^Error: /, '') }); return; }
    let outcome: GatedOutcome;
    try { outcome = await this.codex.sendGated!(plan.calls, abort.signal, readToolResponse); }
    catch (error) { outcome = { results: [], released: 0, completed: false, error: String(error).replace(/^Error: /, '') }; }
    const now = this.store.isOpen ? this.store.message(messageId)?.meta : undefined;
    if (!this.available || now?.type !== 'message-draft') return;
    if (now.state === 'queued') {
      // Stopped before the send call was released, so nothing went out. For email, the draft may have moved.
      const live = plan.live?.(outcome.results);
      const moved = !!(live && draft.email && !sameDestination(draft.email, live));
      this.moveDraft(messageId, ['queued'], {
        state: 'failed', queuedAt: undefined,
        error: moved && live
          ? `The draft in Superhuman now goes to ${[...live.to, ...live.cc, ...live.bcc].join(', ')}, subject "${live.subject}". The card shows that now. Check it and send again.`
          : outcome.error || "It didn't go out",
        ...(moved && live ? { email: { ...draft.email!, ...live } } : {}),
      });
      return;
    }
    // Undone or discarded meanwhile. Otherwise the send call was released: only its own answer can say what happened.
    if (now.state !== 'sending') return;
    const result = outcome.results[plan.sendIndex];
    const verdict = outcome.completed && result !== undefined
      ? plan.verdict(result)
      : { state: 'unknown' as const, error: outcome.error || "Legolas didn't get an answer to the send" };
    this.moveDraft(messageId, ['sending'], verdict.state === 'sent'
      ? { state: 'sent', sentBy: 'legolas', sentAt: verdict.sentAt, ...(verdict.link ? { link: verdict.link } : {}), queuedAt: undefined, error: undefined }
      : { state: verdict.state, queuedAt: undefined, error: verdict.error });
  }
  undoDraftSend(messageId: string) {
    const draft = this.draftCard(messageId);
    if (draft.state === 'sending' || draft.state === 'sent') throw new Error(`Too late, it has gone to ${draft.channel === 'email' ? 'Superhuman' : 'Slack'}`);
    if (this.moveDraft(messageId, ['queued'], { state: 'pending', queuedAt: undefined })) this.sends.get(messageId)?.abort();
  }
  markDraftSent(messageId: string, text: string) {
    const draft = this.draftCard(messageId);
    if (draft.state === 'sent') return;
    if (!Runtime.editable.includes(draft.state)) throw new Error(draft.state === 'queued' || draft.state === 'sending' ? 'This draft is being sent' : 'This draft was discarded or replaced');
    this.moveDraft(messageId, Runtime.editable, { text: cleanDraftText(text), state: 'sent', sentBy: 'you', sentAt: new Date().toISOString(), error: undefined });
  }
  // Takes back "I sent it" when it didn't actually go out, so the card can be sent from Legolas after all. A card
  // Legolas sent can't be reopened: it went out.
  reopenDraft(messageId: string) {
    const draft = this.draftCard(messageId);
    if (draft.state !== 'sent') throw new Error('Only a draft marked sent can be reopened');
    if (draft.sentBy === 'legolas') throw new Error(`Legolas sent this one, so it has gone to ${draft.channel === 'email' ? 'Superhuman' : 'Slack'}`);
    const check = needsCheck(draft) && !!this.codex.sendGated;
    if (this.moveDraft(messageId, ['sent'], { state: check ? 'checking' : 'pending', sentAt: undefined, sentBy: undefined }) && check) this.queueCheck(messageId);
  }
  // Checks the destination again for a card Slack or Superhuman couldn't confirm, so it can be sent after all.
  recheckDraft(messageId: string) {
    const draft = this.draftCard(messageId);
    const unconfirmed = draft.slack?.name === null || (!!draft.email?.draftId && !draft.email.confirmed);
    if (draft.state !== 'pending' || !unconfirmed) throw new Error('This draft has nothing to check again');
    if (!this.codex.sendGated) throw new Error('Checking needs the Claude Code engine');
    if (this.moveDraft(messageId, ['pending'], { state: 'checking', error: undefined, ...(draft.slack ? { slack: { ...draft.slack, name: undefined } } : {}) }))
      this.queueCheck(messageId);
  }
  discardDraft(messageId: string) {
    this.draftCard(messageId);
    this.moveDraft(messageId, Runtime.editable, { state: 'discarded' });
  }
  // Confirms where a card goes with Slack or Superhuman itself: read-only calls in a locked run, one card at a time.
  private queueCheck(messageId: string) {
    this.checks = this.checks.then(() => this.checkDraft(messageId)).catch(() => {});
  }
  private async checkDraft(messageId: string) {
    const message = this.available ? this.store.message(messageId) : undefined;
    if (message?.meta?.type !== 'message-draft' || message.meta.state !== 'checking') return;
    const plan = checkPlan(message.meta);
    if (!plan || !this.codex.sendGated) { this.moveDraft(messageId, ['checking'], { state: 'pending' }); return; }
    let results: unknown[] = [];
    let error: string | undefined;
    // A check that got no answer at all (a connector still connecting, Claude Code ending early) tries once more.
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt) await new Promise((done) => setTimeout(done, this.checkRetryMs));
      try { ({ results, error } = await this.codex.sendGated(plan.calls, undefined, readToolResponse)); }
      catch (cause) { results = []; error = String(cause).replace(/^Error: /, ''); }
      if (results.length || !error || !this.available) break;
    }
    const found = plan.read(results);
    this.moveDraft(messageId, ['checking'], { ...found, state: 'pending', ...(found.error && error && error !== 'not found' ? { error: `${found.error} (${error})` } : {}) });
  }
  resolveRoutineChange(messageId: string, apply: boolean) {
    const message = this.store.message(messageId);
    if (
      !message?.meta ||
      message.meta.type !== 'routine-change' ||
      message.meta.state !== 'pending'
    )
      throw new Error('This change is no longer pending');
    const { routineId, change } = message.meta;
    if (apply) {
      if (routineId) this.store.updateRoutine(routineId, change);
      else
        this.store.createRoutine({
          name: change.name!,
          instructions: change.instructions!,
          schedule: change.schedule!,
          agentId: change.agentId || this.store.list('agents')[0].id,
          enabled: change.enabled ?? true,
        });
    }
    this.store.setMessageMeta(messageId, {
      ...message.meta,
      state: apply ? 'applied' : 'discarded',
    });
    this.refresh();
  }
  logToolCall(codexThreadId: string, name: string, args: unknown) {
    const runId = this.active.get(codexThreadId)?.runId;
    if (runId) this.log(runId, 'call', `${name} ${logText(args)}`);
  }
  logToolResult(codexThreadId: string, value: unknown, failed = false) {
    const runId = this.active.get(codexThreadId)?.runId;
    if (runId) this.log(runId, failed ? 'error' : 'result', logText(value, 300));
  }

  // ---- Routines ------------------------------------------------------------
  start() {
    if (!this.available || this.timer) return;
    this.timer = setInterval(() => this.tick(), 60_000);
    this.startupTimer = setTimeout(() => this.tick(), 5_000);
    // Draft cards whose destination check didn't finish before Legolas last quit, and cards from before Send
    // existed, so they can be sent from Legolas too.
    for (const message of this.store.draftsIn(['checking', 'pending'])) {
      const draft = message.meta as MessageDraft;
      if (draft.state === 'checking') this.queueCheck(message.id);
      else if (draft.slack?.name === null && this.codex.sendGated) this.recheckDraft(message.id); // a check that failed earlier
      else if (needsCheck(draft) && this.codex.sendGated && this.moveDraft(message.id, ['pending'], { state: 'checking' })) this.queueCheck(message.id);
    }
  }
  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    if (this.startupTimer) clearTimeout(this.startupTimer);
    this.timer = null;
    this.startupTimer = null;
    // A send still in its undo window never goes out; one already released is settled as unknown at the next start.
    for (const abort of this.sends.values()) abort.abort();
    for (const execution of this.runningThreads.values()) execution.cancelled = true;
    for (const id of [...this.active.keys()]) this.untrack(id);
  }
  tick() {
    if (!this.available) return;
    const now = new Date();
    for (const routine of this.store.routines())
      if (
        routine.enabled &&
        !this.runningRoutines.has(routine.id) &&
        isDue(routine.schedule, routine.lastRunAt, routine.createdAt, now)
      )
        void this.runRoutine(routine.id, 'schedule');
  }
  isRoutineRunning(routineId: string) { return this.runningRoutines.has(routineId); }
  async runRoutine(routineId: string, trigger: RoutineRun['trigger']) {
    if (!this.available) throw new Error('Runtime is stopped');
    const routine = this.store.routine(routineId);
    if (!routine) throw new Error('Routine not found');
    if (this.runningRoutines.has(routineId)) throw new Error('This routine is already running');
    const agent = this.store.get('agents', routine.agentId) || this.store.list('agents')[0];
    this.runningRoutines.add(routineId);
    const previous = this.store.lastRun(routineId);
    const run = this.store.startRun(routineId, trigger);
    this.store.updateRoutine(routineId, { lastRunAt: run.startedAt });
    const counts = { tasks: 0, memories: 0 };
    const started = Date.now();
    this.log(
      run.id,
      'run',
      `started · trigger=${trigger} · agent=${agent.name} · tier=${modelTierForRole(agent.role)}`,
    );
    this.log(run.id, 'system', routine.instructions);
    this.refresh();
    let status: RoutineRun['status'] = 'failed';
    let summary = '';
    try {
      const recalled = await this.memory.recall(
        `${routine.name} ${routine.instructions}`.slice(0, 160),
        agent.id,
      );
      if (!this.available) return;
      this.log(run.id, 'call', 'memory.recall');
      this.log(run.id, 'result', recalled ? logText(recalled, 300) : '(none)');
      const tools = [
        ...connectorToolsFor('routine', this.connectors.listTools()),
        memoryTool(agent),
        memoryRecallTool(agent),
        ...skillTools,
        ...taskReadTools,
        suggestTaskTool,
      ];
      const skillContext = this.skills.session(agent.id, run.id, 'routine', tools.map(tool => tool.name), routine.instructions, routine.id);
      for (const loaded of skillContext.session.loaded) this.log(run.id, 'system', `Skill loaded: ${loaded} · revision=${skillContext.session.entries.get(loaded.split(':')[0])?.skill.revision}`);
      const connected = Object.values(this.connectors.states)
        .filter((state) => state.status === 'connected')
        .map((state) => state.id);
      const instructions = `${baseAgentInstructions}\n${agent.instructions}\nYou are ${agent.name} running the scheduled routine "${routine.name}" in the background. No one is watching live; every step is logged for the user to audit.
Connected tools are read-only. Never send messages or write to external systems. Use tasks__suggest for actionable findings with source links. If blocked by missing access or required user input, record the blocker and finish; never wait for an unattended approval. Distinguish an empty search from a failed search; do not report 'Nothing new' when a source could not be checked.\n${memoryInstructions(this.store.getSetting('memoryInstructions') || '')}
Routine instructions:\n${routine.instructions}\n${skillContext.instructions}`;
      const prompt = `Now: ${new Date().toString()}\nPrevious run: ${previous ? `${previous.startedAt} (${previous.status}) — ${previous.summary}` : 'none'}\nConnected sources: ${connected.join(', ') || 'none'}\n\nRelevant memory:\n${recalled || '(none)'}`;
      const result = await this.codex.run({
        kind: 'routine',
        cwd: this.paths.routineCwd,
        sandbox: 'read-only',
        instructions,
        prompt,
        tools,
        modelTier: modelTierForRole(agent.role),
        onThreadStarted: (codexThreadId) => {
          if (this.available) this.track(codexThreadId, { kind: 'routine', runId: run.id, counts, skills: skillContext.session });
        },
        onDelta: () => {},
        onItem: (item) => this.logItem(run.id, item),
      });
      this.untrack(result.threadId);
      if (!this.available) return;
      if (result.text) this.log(run.id, 'agent', result.text);
      status = result.status === 'completed' ? 'ok' : 'failed';
      const outcome = [
        counts.tasks && `${counts.tasks} task${counts.tasks === 1 ? '' : 's'} suggested`,
        counts.memories && `${counts.memories} memor${counts.memories === 1 ? 'y' : 'ies'} saved`,
      ]
        .filter(Boolean)
        .join(' · ');
      summary =
        status === 'ok'
          ? outcome || result.text.trim().split('\n').pop()?.slice(0, 200) || 'Nothing new'
          : `Run ended: ${result.status}`;
    } catch (error) {
      summary = String(error)
        .replace(/^Error: /, '')
        .slice(0, 200);
      this.log(run.id, 'error', String(error));
    } finally {
      this.log(
        run.id,
        'run',
        `finished · status=${status} · ${Math.round((Date.now() - started) / 1000)}s`,
      );
      if (this.available) this.store.finishRun(run.id, status, summary);
      for (const [id, context] of this.active) if (context.runId === run.id) this.untrack(id);
      this.runningRoutines.delete(routineId);
      if (this.available) {
        this.store.pruneRuns();
        this.refresh();
      }
    }
  }
  private logItem(runId: string, item: Record<string, unknown>) {
    const type = String(item.type || 'item');
    if (type === 'agentMessage' || type === 'userMessage' || type === 'reasoning') return;
    if (type === 'dynamicToolCall' || type === 'mcpToolCall') return; // logged by the tool handler
    this.log(runId, 'call', `${type} ${logText(item, 400)}`);
  }
  private log(runId: string, kind: Parameters<Store['addRunEvent']>[1], text: string) {
    if (this.available) this.emit({ type: 'run-event', value: this.store.addRunEvent(runId, kind, text) });
  }

  private thread(id: string) {
    const thread = this.store.get('threads', id);
    if (!thread) throw new Error('Thread not found');
    return thread;
  }
  private group(id: string) {
    const group = this.store.group(id);
    if (!group) throw new Error('Group not found');
    return group;
  }
}
