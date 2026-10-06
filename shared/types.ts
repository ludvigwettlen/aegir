import type { SkillsApi } from './skills.js';
import type { BrowserState } from './browser.js';
import type { FileKind } from './task-files.js';
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
// The user edits the text there and presses Send: after five seconds to undo, Legolas sends exactly the card's text
// through the user's own Slack or Superhuman connection (a locked run, see electron/gated.ts). Or they copy it, send
// it themselves, and press "I sent it", so the agent knows in later turns.
// checking: Legolas is confirming the destination with Slack or Superhuman itself; Send waits for it.
// queued: Send was pressed and the undo window is open; nothing has gone out.
// sending: the send call was released. If its answer is lost the card says 'unknown', never 'failed', so a retry
// can't send twice.
export type DraftState = 'checking' | 'pending' | 'queued' | 'sending' | 'sent' | 'failed' | 'unknown' | 'discarded' | 'replaced';
export type SlackDestination = {
  channelId: string;
  threadTs?: string;
  // Slack's own name for the destination ("Johan Lund", "mgmt"), once confirmed; null when it couldn't be confirmed.
  name?: string | null;
};
export type EmailDestination = {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  // The Superhuman draft the card sends and opens. Without one, the card can be copied but not sent from Legolas.
  draftId?: string;
  threadId?: string;
  account?: string;
  // What Superhuman's create_or_update_draft needs on every call.
  type?: 'new' | 'reply' | 'reply_all' | 'forward';
  // True once the rows above come from Superhuman itself rather than from the agent.
  confirmed?: boolean;
};
export type MessageDraft = {
  type: 'message-draft';
  channel: 'slack' | 'email';
  // Where it goes, in the agent's words ("DM to Johan Lund", "#mgmt"). Shown next to what Slack or Superhuman confirm.
  label: string;
  // The agent's text, and the text as the user last left it (or as it was sent).
  original: string;
  text: string;
  state: DraftState;
  slack?: SlackDestination;
  email?: EmailDestination;
  // Why the destination couldn't be confirmed, or why the last send didn't go out.
  error?: string;
  queuedAt?: string;
  sentAt?: string;
  // 'legolas' when Send sent it, 'you' when the user marked it sent.
  sentBy?: 'legolas' | 'you';
  // Open in Slack or Superhuman, once sent.
  link?: string;
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
} | {
  // Files sent with a user message, so the message shows its chips again on reload.
  type: 'attachments';
  files: TaskFile[];
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
// A file the user dropped in a conversation, copied into the task's folder (root 'task') or the chat
// files folder (root 'chat'). path is relative to that root. brainPath is set once it is filed in the brain.
export type TaskFile = {
  id: string;
  taskId: string | null;
  threadId: string | null;
  messageId: string | null;
  root: 'task' | 'chat';
  path: string;
  name: string;
  kind: FileKind;
  mime: string;
  bytes: number;
  sha256: string;
  originalPath: string | null;
  brainPath: string | null;
  brainFiledAt: string | null;
  createdAt: string;
};
// One dropped file, as the composer sees it: staged, pointing at a copy that is already there, or refused.
export type StagedAttachment = { name: string; file: TaskFile | null; error: string | null };
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
  taskFiles: TaskFile[];
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
  // The user's brain folder, when there is one: attachments can be filed into it.
  brainDir: string | null;
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
  // Draft cards: save the text as you type, send it (five seconds to undo), take the send back, record that you sent
  // it yourself (with the text you sent), or discard it.
  updateDraft(messageId: string, text: string): Promise<void>;
  sendDraft(messageId: string, text: string): Promise<void>;
  undoDraftSend(messageId: string): Promise<void>;
  markDraftSent(messageId: string, text: string): Promise<void>;
  // Takes back "I sent it" when it didn't actually go out. A card Legolas sent can't be reopened.
  reopenDraft(messageId: string): Promise<void>;
  // Checks the destination again when Slack or Superhuman couldn't confirm it.
  recheckDraft(messageId: string): Promise<void>;
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
  sendMessage(threadId: string, content: string, fileIds?: string[]): Promise<void>;
  // Dropped files: copy the bytes into this conversation's folder before the message goes out.
  stageFiles(threadId: string, paths: string[]): Promise<StagedAttachment[]>;
  stageClipboardFile(threadId: string): Promise<StagedAttachment | null>;
  // The renderer cannot read a dropped file's path on its own; Electron 44 removed File.path.
  pathForFile(file: File): string;
  stopThread(threadId: string): Promise<void>;
  closeThread(threadId: string): Promise<void>;
  createTask(input: {
    title: string;
    notes?: string;
    label?: string | null;
    dueAt?: string | null;
  }): Promise<Task>;
  // Add with Claude: turns a dictated note into a title, notes, label and date. Nothing is saved.
  polishTask(text: string): Promise<{ title: string; notes: string; label: string | null; dueAt: string | null }>;
  updateTask(taskId: string, change: TaskChange): Promise<void>;
  deleteTask(taskId: string): Promise<void>;
  addTaskLink(taskId: string, url: string): Promise<TaskLink>;
  attachFileToTask(fileId: string, taskId: string): Promise<TaskFile>;
  fileToBrain(fileId: string, slug: string): Promise<TaskFile>;
  removeTaskFile(fileId: string): Promise<void>;
  openTaskFile(fileId: string): Promise<void>;
  revealTaskFile(fileId: string): Promise<void>;
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
