import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Agent, AppEvent, Group, Message, Routine, RoutineRun, Task, Thread } from '../shared/types.js';
import type { Store } from './db.js';
import type { CodexProvider, Tool } from './codex.js';
import type { ConnectorManager } from './connectors.js';
import type { MemoryService } from './memory.js';
import { modelTierForRole } from '../shared/model-policy.js';
import { describeSchedule, isDue } from '../shared/routines.js';
import { skillsFor } from './skills.js';
import { cleanRoutineChange, connectorToolsFor, jsonObject, logText, memoryTool, mentionedAgents, mentionedRoutines, proposeRoutineTool, slug, suggestTaskTool, taskSourceKey, type RunKind } from './agent-tools.js';

type Context = { kind: RunKind; threadId?: string; runId?: string; counts?: { tasks: number; memories: number } };

// Runs agents in threads (chat and handed-off tasks) and routines, and keeps the mapping from Codex threads back to them.
export class Runtime {
  private active = new Map<string, Context>(); // Codex thread id → what it is running for
  private runningRoutines = new Set<string>();
  private handingOffTasks = new Set<string>();
  private lastMemoryRetryAt = 0;
  private timer: NodeJS.Timeout | null = null;
  constructor(private store: Store, private codex: CodexProvider, private connectors: ConnectorManager, private memory: MemoryService, private refresh: () => void, private emit: (event: AppEvent) => void, private paths: { outputRoot: string; routineCwd: string }) {}

  contextFor(codexThreadId: string) { return this.active.get(codexThreadId); }
  appThreadFor(codexThreadId: string) { return this.active.get(codexThreadId)?.threadId; }

  // ---- Chat -------------------------------------------------------------
  async startThread(groupId: string, content: string): Promise<Thread> {
    const text = content.trim(); if (!text) throw new Error('Write a first message');
    const thread = this.store.createThread(groupId, text.split('\n')[0].slice(0, 80));
    this.refresh();
    void this.sendMessage(thread.id, text).catch(() => {});
    return thread;
  }
  async sendMessage(threadId: string, content: string) {
    const text = content.trim(); if (!text) return;
    const thread = this.thread(threadId); const group = this.group(thread.groupId);
    this.store.addMessage(threadId, null, 'user', text); this.refresh();
    const kind: RunKind = thread.kind === 'task' ? 'task' : 'chat';
    // A reply in a task thread continues the task, so its status follows the run.
    if (thread.taskId) this.store.updateTask(thread.taskId, { status: 'running' });
    let ok = true;
    for (const agent of mentionedAgents(text, this.store.list<Agent>('agents'), group)) ok = await this.runAgent(thread, group, agent, text, kind) && ok;
    if (thread.taskId && this.store.get<Task>('tasks', thread.taskId)?.status === 'running') { this.store.updateTask(thread.taskId, { status: ok ? 'review' : 'blocked' }); this.refresh(); }
  }
  async stopThread(threadId: string) {
    for (const [codexThreadId, context] of this.active) if (context.threadId === threadId) await this.codex.stop(codexThreadId);
  }

  // ---- Tasks ------------------------------------------------------------
  // A hand-off is one instruction. Atlas-style routing picks the group; the group lead starts in a fresh task thread.
  async handOff(taskId: string, instruction: string) {
    const task = this.store.get<Task>('tasks', taskId); if (!task) throw new Error('Task not found');
    if (task.status === 'running' || this.handingOffTasks.has(taskId)) throw new Error('The team is already working on this task');
    this.handingOffTasks.add(taskId);
    let started = false;
    try {
      const brief = instruction.trim() || task.notes || task.title;
      const group = await this.routeTask(task, brief);
      const outputDir = task.outputDir || join(this.paths.outputRoot, `${slug(task.title)}-${task.id.slice(0, 6)}`);
      mkdirSync(outputDir, { recursive: true });
      let thread = task.threadId ? this.store.get<Thread>('threads', task.threadId) : undefined;
      if (!thread) thread = this.store.createThread(group.id, task.title, 'task', task.id);
      this.store.updateTask(taskId, { status: 'running', threadId: thread.id, outputDir, agentId: group.leadAgentId });
      started = true;
      this.store.addMessage(thread.id, null, 'user', brief); this.refresh();
      const lead = this.store.get<Agent>('agents', group.leadAgentId)!;
      const ok = await this.runAgent(thread, group, lead, brief, 'task');
      const latest = this.store.get<Task>('tasks', taskId);
      if (latest?.status === 'running') this.store.updateTask(taskId, { status: ok ? 'review' : 'blocked' });
      this.refresh();
    } catch (error) {
      if (started && this.store.get<Task>('tasks', taskId)?.status === 'running') {
        this.store.updateTask(taskId, { status: 'blocked' }); this.refresh();
      }
      throw error;
    } finally { this.handingOffTasks.delete(taskId); }
  }
  async stopTask(taskId: string) {
    const task = this.store.get<Task>('tasks', taskId);
    if (task?.threadId) await this.stopThread(task.threadId);
  }
  private async routeTask(task: Task, brief: string): Promise<Group> {
    if (task.threadId) { const existing = this.store.get<Thread>('threads', task.threadId); if (existing) return this.group(existing.groupId); }
    const groups = this.store.groups().filter(group => group.kind === 'group');
    if (groups.length <= 1) return groups[0] || this.store.groups()[0];
    const agents = this.store.list<Agent>('agents');
    const listing = groups.map(group => `- id: ${group.id}\n  name: ${group.title}\n  agents: ${group.agentIds.map(id => agents.find(agent => agent.id === id)?.name).filter(Boolean).join(', ')}\n  purpose: ${group.instructions || '(none)'}`).join('\n');
    try {
      const result = await this.codex.run({ cwd: this.paths.routineCwd, instructions: 'You route tasks to the best-suited group of agents. Reply with JSON only: {"groupId": "<id>"}.', prompt: `Groups:\n${listing}\n\nTask: ${task.title}${task.label ? ` (#${task.label})` : ''}\nInstruction: ${brief}`, tools: [], modelTier: 'lightweight', onDelta: () => {} });
      const chosen = groups.find(group => group.id === jsonObject<{ groupId: string }>(result.text).groupId);
      if (chosen) return chosen;
    } catch { /* fall back below */ }
    return groups[0];
  }

  // ---- Agent runs in threads ---------------------------------------------
  private async runAgent(thread: Thread, group: Group, agent: Agent, userText: string, kind: RunKind, depth = 0): Promise<boolean> {
    const message = this.store.addMessage(thread.id, agent.id, 'agent', '', 'streaming'); this.refresh();
    const agents = this.store.list<Agent>('agents');
    const history = this.store.messagesForThread(thread.id).filter(x => x.id !== message.id).slice(-30).map(x => `${this.speaker(x, agents)}: ${x.content}`).join('\n');
    const recalled = await this.memory.recall(userText.slice(0, 160), agent.id);
    const routines = kind === 'chat' ? mentionedRoutines(userText, this.store.routines()) : [];
    const task = thread.taskId ? this.store.get<Task>('tasks', thread.taskId) : undefined;
    const tools: Tool[] = [...connectorToolsFor(kind, this.connectors.listTools()), memoryTool(agent), ...(kind === 'chat' ? [proposeRoutineTool] : [])];
    const prompt = [`Relevant memory:\n${recalled || '(none)'}`, routines.length ? `Tagged routines:\n${routines.map(routine => this.describeRoutine(routine, agents)).join('\n\n')}` : '', `Thread "${thread.title}" so far:\n${history || '(empty)'}`, `Current message:\n${userText}`].filter(Boolean).join('\n\n');
    let streamed = '';
    try {
      const result = await this.codex.run({
        cwd: kind === 'task' && task?.outputDir ? task.outputDir : this.paths.routineCwd,
        sandbox: kind === 'task' ? 'workspace-write' : 'read-only',
        instructions: this.instructionsFor(kind, agent, group, userText),
        prompt, tools, modelTier: modelTierForRole(agent.role),
        onThreadStarted: codexThreadId => this.active.set(codexThreadId, { kind, threadId: thread.id }),
        onDelta: delta => { streamed += delta; this.store.updateMessage(message.id, streamed, 'streaming'); this.emit({ type: 'message-delta', threadId: thread.id, messageId: message.id, delta }); }
      });
      this.active.delete(result.threadId);
      const ok = result.status === 'completed';
      this.store.updateMessage(message.id, result.text || streamed, ok ? 'complete' : 'failed'); this.refresh();
      if (depth === 0 && ok) {
        const next = agents.find(other => other.id !== agent.id && group.agentIds.includes(other.id) && new RegExp(`@${other.name}\\b`, 'i').test(result.text));
        if (next) {
          this.store.addMessage(thread.id, null, 'system', `${agent.name} brought in ${next.name}.`); this.refresh();
          return this.runAgent(thread, group, next, `${agent.name} asked you to contribute:\n${result.text}`, kind, 1);
        }
      }
      return ok;
    } catch (error) {
      this.store.updateMessage(message.id, streamed ? `${streamed}\n\n${String(error)}` : String(error), 'failed'); this.refresh();
      return false;
    } finally {
      for (const [id, context] of this.active) if (context.threadId === thread.id && context.kind === kind) this.active.delete(id);
    }
  }
  private instructionsFor(kind: RunKind, agent: Agent, group: Group, text: string) {
    const memoryGuidance = `Save durable facts with your memory tool. Memory guidance: ${this.store.getSetting('memoryInstructions') || ''}`;
    const purpose = group.instructions ? `\nGroup purpose: ${group.instructions}` : '';
    if (kind === 'task') return `${agent.instructions}\nYou are ${agent.name} (${agent.role}) working on a task the user handed to the agent team, in the "${group.title}" group.${purpose}
Your working directory is the task's output folder. Put every deliverable there as Markdown, HTML or code files, and name them clearly.
Never write to, post in or send through external systems (Slack, Notion, email or anything else). Connected tools are read-only; use them to research.
If another agent in the group should do part of the work, mention them as @Name in your final reply.
Finish with a short summary: the files you produced and anything that needs the user.
${memoryGuidance}\n${skillsFor(text)}`;
    return `${agent.instructions}\nYou are ${agent.name} (${agent.role}) talking with the user in a thread of the "${group.title}" ${group.kind === 'private' ? 'direct chat' : 'group'} in Ägir.${purpose}
Address the user directly. If another agent should contribute, mention them as @Name in your final reply. Be clear about source links and tool failures. Connected Slack and Notion tools are available; writing to them requires the user's approval.
To create or change a scheduled routine, call routines__propose_change; the user applies or discards it.
${memoryGuidance}\n${skillsFor(text)}`;
  }
  private describeRoutine(routine: Routine, agents: Agent[]) {
    const runs = this.store.routineRuns(500).filter(run => run.routineId === routine.id).slice(0, 5);
    return `- id: ${routine.id}\n  name: ${routine.name}\n  agent: ${agents.find(agent => agent.id === routine.agentId)?.name || 'unknown'} (id ${routine.agentId})\n  schedule: ${describeSchedule(routine.schedule)} ${JSON.stringify(routine.schedule)}\n  enabled: ${routine.enabled}\n  instructions: ${routine.instructions}\n  recent runs: ${runs.map(run => `${run.startedAt} ${run.status} — ${run.summary}`).join('; ') || 'none'}`;
  }
  private speaker(message: Message, agents: Agent[]) { return message.role === 'user' ? 'User' : message.role === 'system' ? 'System' : agents.find(agent => agent.id === message.agentId)?.name || 'Agent'; }

  // ---- Internal tools ------------------------------------------------------
  // Handles tools that are not external connectors. Returns undefined when the tool is not ours.
  async handleInternalTool(provider: string, tool: string, args: Record<string, unknown>, codexThreadId: string): Promise<unknown> {
    const context = this.active.get(codexThreadId);
    if (provider === 'memory') {
      const match = tool.match(/^remember_([0-9a-f_]+)$/i); if (!match) throw new Error('Unknown memory tool');
      const agentId = match[1].replace(/_/g, '-'); if (!this.store.get<Agent>('agents', agentId)) throw new Error('Unknown agent');
      const scope = args.scope === 'private' ? `agent-${agentId}` : 'shared';
      const result = await this.memory.remember(scope, String(args.content || ''), typeof args.sourceUrl === 'string' && /^https?:\/\//.test(args.sourceUrl) ? args.sourceUrl : null);
      if (context?.counts) context.counts.memories++;
      this.refresh(); return { id: result?.id, saved: true };
    }
    if (provider === 'tasks' && tool === 'suggest') {
      const title = String(args.title || '').trim(); const sourceUrl = String(args.sourceUrl || '').trim();
      if (!title || !/^https?:\/\//.test(sourceUrl)) throw new Error('A suggestion needs a title and a source link');
      const sourceKey = taskSourceKey('routine', sourceUrl, title);
      if (this.store.db.prepare('SELECT id FROM tasks WHERE sourceKey=?').get(sourceKey)) return { created: false, reason: 'Already suggested' };
      const task = this.store.createTask({ title: title.slice(0, 240), notes: String(args.notes || ''), label: typeof args.label === 'string' ? args.label.replace(/^#/, '').toLowerCase() || null : null, status: 'proposed', sourceUrl, sourceKey });
      if (context?.counts) context.counts.tasks++;
      this.refresh(); return { created: true, id: task.id };
    }
    if (provider === 'routines' && tool === 'propose_change') {
      if (!context?.threadId) throw new Error('Routine changes can only be proposed in a chat thread');
      const routineId = typeof args.routineId === 'string' && args.routineId ? args.routineId : '';
      if (routineId && !this.store.routine(routineId)) throw new Error('Unknown routine');
      const change = cleanRoutineChange(args.change, this.store.list<Agent>('agents'), !routineId);
      this.store.addMessage(context.threadId, null, 'system', String(args.reason || 'Proposed routine change'), 'complete', { type: 'routine-change', routineId, change, state: 'pending' });
      this.refresh(); return { proposed: true, note: 'The user will apply or discard this change.' };
    }
    return undefined;
  }
  resolveRoutineChange(messageId: string, apply: boolean) {
    const message = this.store.message(messageId);
    if (!message?.meta || message.meta.type !== 'routine-change' || message.meta.state !== 'pending') throw new Error('This change is no longer pending');
    const { routineId, change } = message.meta;
    if (apply) {
      if (routineId) this.store.updateRoutine(routineId, change);
      else this.store.createRoutine({ name: change.name!, instructions: change.instructions!, schedule: change.schedule!, agentId: change.agentId || this.store.list<Agent>('agents')[0].id, enabled: change.enabled ?? true });
    }
    this.store.setMessageMeta(messageId, { ...message.meta, state: apply ? 'applied' : 'discarded' });
    this.refresh();
  }
  logToolCall(codexThreadId: string, name: string, args: unknown) { const runId = this.active.get(codexThreadId)?.runId; if (runId) this.log(runId, 'call', `${name} ${logText(args)}`); }
  logToolResult(codexThreadId: string, value: unknown, failed = false) { const runId = this.active.get(codexThreadId)?.runId; if (runId) this.log(runId, failed ? 'error' : 'result', logText(value, 300)); }

  // ---- Routines ------------------------------------------------------------
  start() { this.timer = setInterval(() => this.tick(), 60_000); setTimeout(() => this.tick(), 5_000); }
  stop() { if (this.timer) clearInterval(this.timer); }
  tick() {
    const now = new Date();
    if (now.getTime() - this.lastMemoryRetryAt >= 60 * 60 * 1000) {
      this.lastMemoryRetryAt = now.getTime();
      void this.memory.retryPending().catch(error => console.error('Memory sync retry failed:', error));
    }
    for (const routine of this.store.routines()) if (routine.enabled && !this.runningRoutines.has(routine.id) && isDue(routine.schedule, routine.lastRunAt, routine.createdAt, now)) void this.runRoutine(routine.id, 'schedule');
  }
  async runRoutine(routineId: string, trigger: RoutineRun['trigger']) {
    const routine = this.store.routine(routineId); if (!routine) throw new Error('Routine not found');
    if (this.runningRoutines.has(routineId)) throw new Error('This routine is already running');
    const agent = this.store.get<Agent>('agents', routine.agentId) || this.store.list<Agent>('agents')[0];
    this.runningRoutines.add(routineId);
    const previous = this.store.lastRun(routineId);
    const run = this.store.startRun(routineId, trigger);
    this.store.updateRoutine(routineId, { lastRunAt: run.startedAt });
    const counts = { tasks: 0, memories: 0 };
    const started = Date.now();
    this.log(run.id, 'run', `started · trigger=${trigger} · agent=${agent.name} · tier=${modelTierForRole(agent.role)}`);
    this.log(run.id, 'system', routine.instructions); this.refresh();
    let status: RoutineRun['status'] = 'failed'; let summary = '';
    try {
      const recalled = await this.memory.recall(`${routine.name} ${routine.instructions}`.slice(0, 160), agent.id);
      this.log(run.id, 'call', 'memory.recall'); this.log(run.id, 'result', recalled ? logText(recalled, 300) : '(none)');
      const tools = [...connectorToolsFor('routine', this.connectors.listTools()), memoryTool(agent), suggestTaskTool];
      const connected = Object.values(this.connectors.states).filter(state => state.status === 'connected').map(state => state.id);
      const instructions = `${agent.instructions}\nYou are ${agent.name} running the scheduled routine "${routine.name}" in the background. No one is watching live; every step is logged for the user to audit.
Connected tools are read-only. Use tasks__suggest to put items in front of the user and your memory tool for durable facts. Memory guidance: ${this.store.getSetting('memoryInstructions') || ''}
Routine instructions:\n${routine.instructions}`;
      const prompt = `Now: ${new Date().toString()}\nPrevious run: ${previous ? `${previous.startedAt} (${previous.status}) — ${previous.summary}` : 'none'}\nConnected sources: ${connected.join(', ') || 'none'}\n\nRelevant memory:\n${recalled || '(none)'}`;
      const result = await this.codex.run({
        cwd: this.paths.routineCwd, sandbox: 'read-only', instructions, prompt, tools, modelTier: modelTierForRole(agent.role),
        onThreadStarted: codexThreadId => this.active.set(codexThreadId, { kind: 'routine', runId: run.id, counts }),
        onDelta: () => {},
        onItem: item => this.logItem(run.id, item)
      });
      this.active.delete(result.threadId);
      if (result.text) this.log(run.id, 'agent', result.text);
      status = result.status === 'completed' ? 'ok' : 'failed';
      const outcome = [counts.tasks && `${counts.tasks} task${counts.tasks === 1 ? '' : 's'} suggested`, counts.memories && `${counts.memories} memor${counts.memories === 1 ? 'y' : 'ies'} saved`].filter(Boolean).join(' · ');
      summary = status === 'ok' ? outcome || result.text.trim().split('\n').pop()?.slice(0, 200) || 'Nothing new' : `Run ended: ${result.status}`;
    } catch (error) {
      summary = String(error).replace(/^Error: /, '').slice(0, 200);
      this.log(run.id, 'error', String(error));
    } finally {
      this.log(run.id, 'run', `finished · status=${status} · ${Math.round((Date.now() - started) / 1000)}s`);
      this.store.finishRun(run.id, status, summary);
      for (const [id, context] of this.active) if (context.runId === run.id) this.active.delete(id);
      this.runningRoutines.delete(routineId);
      this.store.pruneRuns();
      this.refresh();
    }
  }
  private logItem(runId: string, item: Record<string, unknown>) {
    const type = String(item.type || 'item');
    if (type === 'agentMessage' || type === 'userMessage' || type === 'reasoning') return;
    if (type === 'dynamicToolCall' || type === 'mcpToolCall') return; // logged by the tool handler
    this.log(runId, 'call', `${type} ${logText(item, 400)}`);
  }
  private log(runId: string, kind: Parameters<Store['addRunEvent']>[1], text: string) {
    this.emit({ type: 'run-event', value: this.store.addRunEvent(runId, kind, text) });
  }

  private thread(id: string) { const thread = this.store.get<Thread>('threads', id); if (!thread) throw new Error('Thread not found'); return thread; }
  private group(id: string) { const group = this.store.group(id); if (!group) throw new Error('Group not found'); return group; }
}
