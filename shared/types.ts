import type { Typography } from './typography.js';
import type { SkillsApi } from './skills.js';
import type { BrowserState } from './browser.js';
export type Agent = {
  id: string;
  name: string;
  role: string;
  color: string;
  instructions: string;
  createdAt: string;
};
// A group is a standing set of agents. Private groups hold exactly one agent and are that agent's direct chat.
export type Group = {
  id: string;
  title: string;
  kind: 'group' | 'private';
  agentIds: string[];
  leadAgentId: string;
  instructions: string;
  createdAt: string;
};
// Threads are the unit of conversation and context. A task thread belongs to exactly one task.
export type Thread = {
  id: string;
  groupId: string;
  title: string;
  kind: 'chat' | 'task';
  taskId: string | null;
  status: 'active' | 'closed';
  createdAt: string;
  updatedAt: string;
};
export type RoutineChange = {
  name?: string;
  instructions?: string;
  agentId?: string;
  schedule?: RoutineSchedule;
  enabled?: boolean;
};
export type MessageMeta = {
  type: 'routine-change';
  routineId: string;
  change: RoutineChange;
  state: 'pending' | 'applied' | 'discarded';
} | {
  type: 'skill-change';
  proposalId: string;
  skillId: string;
  skillName: string;
};
export type Message = {
  id: string;
  threadId: string;
  agentId: string | null;
  role: 'user' | 'agent' | 'system';
  content: string;
  status: 'complete' | 'streaming' | 'failed';
  meta: MessageMeta | null;
  createdAt: string;
};
export type TaskList = { id: string; name: string; createdAt: string };
export type Task = {
  id: string;
  title: string;
  notes: string;
  label: string | null;
  dueAt: string | null;
  listId: string | null;
  status: 'proposed' | 'ready' | 'running' | 'review' | 'blocked' | 'done' | 'dismissed';
  agentId: string | null;
  threadId: string | null;
  outputDir: string | null;
  sourceUrl: string | null;
  sourceKey: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};
export type TaskLink = { id: string; taskId: string; url: string; createdAt: string };
export type RoutineSchedule = {
  every: 'hour' | 'day' | 'week';
  at?: string;
  day?: number;
  weekdaysOnly?: boolean;
};
export type Routine = {
  id: string;
  name: string;
  instructions: string;
  agentId: string;
  schedule: RoutineSchedule;
  enabled: boolean;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
};
export type RoutineRun = {
  id: string;
  routineId: string;
  trigger: 'schedule' | 'manual';
  status: 'running' | 'ok' | 'failed';
  summary: string;
  startedAt: string;
  endedAt: string | null;
};
export type RunEvent = {
  id: string;
  runId: string;
  at: string;
  kind: 'run' | 'system' | 'call' | 'result' | 'agent' | 'error';
  text: string;
};
export type Connector = {
  id: 'slack' | 'notion' | 'composio';
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  detail: string;
  tools: string[];
  checkedAt: string | null;
};
export type Approval = {
  id: string;
  method: string;
  title: string;
  detail: string;
  agentId: string | null;
  threadId?: string;
  createdAt: string;
};
export type Memory = {
  id: string;
  scope: string;
  content: string;
  sourceUrl: string | null;
  createdAt: string;
};
export type ThreadSummary = Thread & {
  messageCount: number;
  agentIds: string[];
  busyAgentIds: string[];
  snippet: string;
};
export type MessagePage = { messages: Message[]; before: string | null };
export type Snapshot = {
  agents: Agent[];
  groups: Group[];
  threads: ThreadSummary[];
  tasks: Task[];
  taskLists: TaskList[];
  taskLinks: TaskLink[];
  routines: Routine[];
  routineRuns: RoutineRun[];
  connectors: Connector[];
  approvals: Approval[];
  legacyMemoryCount: number;
  memoryInstructions: string;
  codexStatus: string;
  launchAtLogin: boolean;
  typography: Typography;
  browser: BrowserState;
  mcpSettings: { slackClientId: string; slackConfigured: boolean; composioConfigured?: boolean; composioSlackAccount?: string };
};
export type AppEvent =
  | { type: 'open-settings' }
  | { type: 'skills-changed' }
  | { type: 'snapshot'; value: Snapshot }
  | { type: 'message'; value: Message }
  | { type: 'run-event'; value: RunEvent };
export type TaskChange = Partial<Pick<Task, 'title' | 'notes' | 'status' | 'label' | 'dueAt' | 'listId'>>;

export interface DesktopApi extends SkillsApi {
  listDocuments(threadId: string): Promise<string[]>;
  readDocument(threadId: string, path: string): Promise<import('./documents').WorkspaceDocument>;
  showDocumentInFinder(threadId: string, path: string): Promise<void>;
  saveDocument(threadId: string, path: string, expected: string, content: string): Promise<import('./documents').WorkspaceDocument>;
  snapshot(): Promise<Snapshot>;
  setTypography(value: Typography): Promise<void>;
  threadMessages(threadId: string, before?: string): Promise<MessagePage>;
  copyChatTranscript(threadId: string): Promise<void>;
  onEvent(callback: (event: AppEvent) => void): () => void;
  createGroup(title: string, agentIds: string[]): Promise<Group>;
  createAgent(input: Pick<Agent, 'name' | 'role' | 'color' | 'instructions'>): Promise<void>;
  updateAgent(agent: Agent): Promise<void>;
  startThread(groupId: string, content: string): Promise<Thread>;
  sendMessage(threadId: string, content: string): Promise<void>;
  stopThread(threadId: string): Promise<void>;
  closeThread(threadId: string): Promise<void>;
  createTaskList(name: string): Promise<TaskList>;
  renameTaskList(id: string, name: string): Promise<void>;
  deleteTaskList(id: string): Promise<void>;
  createTask(input: {
    title: string;
    notes?: string;
    label?: string | null;
    dueAt?: string | null;
    listId?: string | null;
  }): Promise<Task>;
  updateTask(taskId: string, change: TaskChange): Promise<void>;
  deleteTask(taskId: string): Promise<void>;
  addTaskLink(taskId: string, url: string): Promise<TaskLink>;
  openTaskLink(linkId: string): Promise<void>;
  readClipboardText(): Promise<string>;
  removeTaskLink(linkId: string): Promise<void>;
  undoTaskAction(): Promise<{ taskId: string; action: string } | null>;
  handOff(taskId: string, instruction: string): Promise<void>;
  stopTask(taskId: string): Promise<void>;
  openTaskOutput(taskId: string): Promise<void>;
  runRoutine(routineId: string): Promise<void>;
  setRoutineEnabled(routineId: string, enabled: boolean): Promise<void>;
  resolveRoutineChange(messageId: string, apply: boolean): Promise<void>;
  runEvents(runId: string): Promise<RunEvent[]>;
  resolveApproval(id: string, approved: boolean): Promise<void>;
  connect(
    provider: 'slack' | 'notion' | 'composio',
    slackClientId?: string,
    slackClientSecret?: string,
  ): Promise<void>;
  disconnect(provider: 'slack' | 'notion' | 'composio'): Promise<void>;
  setMemoryInstructions(value: string): Promise<void>;
  searchMemories(query: string): Promise<Memory[]>;
  forgetMemory(id: string, scope: string): Promise<void>;
  correctMemory(id: string, scope: string, content: string): Promise<void>;
  setLaunchAtLogin(enabled: boolean): Promise<void>;
  setBrowserEnabled(enabled: boolean): Promise<void>;
  openBrowser(): Promise<void>;
  stopBrowser(): Promise<void>;
  openExternal(url: string): Promise<void>;
}
