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
// One thing an agent did while working on a reply: a tool it used, or an approval you answered.
export type Step = { kind: 'tool' | 'approval'; label: string; at: string; outcome?: 'approved' | 'declined' };
// An email or Slack message the agent wrote for the user to send, shown as an editable card in the conversation.
// The user edits the text there, copies it, and sends it from Slack or Superhuman. Legolas itself sends nothing:
// "I sent it" only records that the user did, so the agent knows in later turns.
export type DraftState = 'pending' | 'sent' | 'discarded' | 'replaced';
export type SlackDestination = { channelId: string; threadTs?: string };
export type EmailDestination = {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  // The Superhuman draft the agent created, when it did, so the card can open it.
  draftId?: string;
  threadId?: string;
  account?: string;
};
export type MessageDraft = {
  type: 'message-draft';
  channel: 'slack' | 'email';
  // Where it goes, in the agent's words ("DM to Johan Lund", "#mgmt"). Shown as the agent's description, with the
  // raw ids or addresses beside it, for the user to check before sending.
  label: string;
  // The agent's text, and the text as the user last left it.
  original: string;
  text: string;
  state: DraftState;
  slack?: SlackDestination;
  email?: EmailDestination;
  // When the user marked it sent.
  sentAt?: string;
  replacedBy?: string;
};
export type MessageMeta = {
  type: 'steps';
  steps: Step[];
} | MessageDraft | {
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
export type Task = {
  id: string;
  title: string;
  notes: string;
  label: string | null;
  dueAt: string | null;
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
// Claude Code scheduled tasks, read from the Claude app's own files and shown read-only.
export type ClaudeRun = { startedAt: string; endedAt: string | null; status: 'completed' | 'failed' | 'needs_action' | 'unknown'; detail: string; needsAction: string | null };
export type ClaudeRoutine = { id: string; name: string; description: string; schedule: string; cron: string | null; enabled: boolean; lastRunAt: string | null; runs: ClaudeRun[] };
export type ClaudeRoutines = { tasks: ClaudeRoutine[]; source: string | null };
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
export type RemindersState = {
  enabled: boolean;
  list: string;
  state: 'off' | 'checking' | 'ok' | 'denied' | 'error';
  detail: string;
  lastSyncAt: string | null;
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
  taskLinks: TaskLink[];
  routines: Routine[];
  routineRuns: RoutineRun[];
  connectors: Connector[];
  approvals: Approval[];
  legacyMemoryCount: number;
  memoryInstructions: string;
  codexStatus: string;
  // Display names of the agent engine (Codex or Claude Code) and memory backend (Mnemosyne or gbrain).
  engine: string;
  memoryProvider: string;
  // Phone capture from an Apple Reminders list.
  reminders: RemindersState;
  launchAtLogin: boolean;
  browser: BrowserState;
  mcpSettings: { slackClientId: string; slackConfigured: boolean; composioConfigured?: boolean; composioSlackAccount?: string };
};
export type AppEvent =
  | { type: 'open-settings' }
  | { type: 'skills-changed' }
  | { type: 'snapshot'; value: Snapshot }
  | { type: 'message'; value: Message }
  | { type: 'run-event'; value: RunEvent };
export type TaskChange = Partial<Pick<Task, 'title' | 'notes' | 'status' | 'label' | 'dueAt'>>;

export interface DesktopApi extends SkillsApi {
  // Draft cards: save the text as you type, record that you sent it (with the text you sent), or discard it.
  updateDraft(messageId: string, text: string): Promise<void>;
  markDraftSent(messageId: string, text: string): Promise<void>;
  discardDraft(messageId: string): Promise<void>;
  listDocuments(threadId: string): Promise<string[]>;
  readDocument(threadId: string, path: string): Promise<import('./documents').WorkspaceDocument>;
  showDocumentInFinder(threadId: string, path: string): Promise<void>;
  saveDocument(threadId: string, path: string, expected: string, content: string): Promise<import('./documents').WorkspaceDocument>;
  snapshot(): Promise<Snapshot>;
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
  createTask(input: {
    title: string;
    notes?: string;
    label?: string | null;
    dueAt?: string | null;
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
  deleteRoutine(routineId: string): Promise<void>;
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
  setReminders(enabled: boolean, list: string): Promise<void>;
  setBrowserEnabled(enabled: boolean): Promise<void>;
  openBrowser(): Promise<void>;
  stopBrowser(): Promise<void>;
  openExternal(url: string): Promise<void>;
  claudeRoutines(): Promise<ClaudeRoutines>;
}
