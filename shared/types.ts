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
export type MessageMeta = { type: 'attachments'; files: import('./attachments.js').Attachment[] } | import('./slack-messages.js').SlackDraft | import('./gmail.js').EmailDraft | {
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
export type TaskRecurrence = 'daily' | 'weekdays' | 'weekly' | 'monthly';
export type Task = {
  delegation?: import('./delegation.js').Delegation;
  id: string;
  title: string;
  notes: string;
  label: string | null;
  labels?: string[];
  dueAt: string | null;
  snoozedUntil?: string | null;
  priority?: 1 | 2 | 3 | null;
  recurrence?: TaskRecurrence | null;
  recurrenceAnchor?: string | null;
  nextOccurrenceId?: string | null;
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
export type ClaudeRun = { startedAt: string; endedAt: string | null; status: 'completed' | 'failed' | 'needs_action' | 'unknown'; detail: string; needsAction: string | null };
export type ClaudeRoutine = { id: string; name: string; description: string; schedule: string; cron: string | null; enabled: boolean; lastRunAt: string | null; runs: ClaudeRun[] };
export type ClaudeRoutines = { tasks: ClaudeRoutine[]; source: string | null };
export type RemindersState = { enabled: boolean; list: string; detail: string; syncing: boolean; lastSyncAt: string | null };
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
  updates?: import('./updates.js').UpdateState;
  delegation?: import('./delegation.js').DelegationState;
  reminders?: RemindersState;
  brainBridge?: import('./brain-bridge.js').BrainBridgeState;
  onboarding?: import('./onboarding.js').OnboardingState;
  gmail?: import('./gmail.js').GmailState;
  oneOnOnes?: import('./one-on-ones.js').OneOnOneState;
  agents: Agent[];
  groups: Group[];
  threads: ThreadSummary[];
  tasks: Task[];
  taskLists: TaskList[];
  taskViews?: import('./task-filters.js').SavedTaskView[];
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
  browserReviewEnabled?: boolean;
  showTaskPriorities?: boolean;
  browser: BrowserState;
  mcpSettings: { slackClientId: string; slackConfigured: boolean; composioConfigured?: boolean; composioSlackAccount?: string };
};
export type AppEvent =
  | { type: 'open-settings' }
  | { type: 'skills-changed' }
  | { type: 'snapshot'; value: Snapshot }
  | { type: 'message'; value: Message }
  | { type: 'run-event'; value: RunEvent };
export type TaskChange = Partial<Pick<Task, 'title' | 'notes' | 'status' | 'label' | 'dueAt' | 'listId' | 'recurrence' | 'priority' | 'snoozedUntil' | 'labels'>>;

export interface DesktopApi extends SkillsApi {
  checkUpdates(): Promise<void>;
  downloadUpdate(): Promise<void>;
  cancelUpdate(): Promise<void>;
  installUpdate(): Promise<void>;
  saveUpdateToken(token: string): Promise<void>;
  configureDelegation(database: string): Promise<void>;
  findDelegationPeople(query: string): Promise<import('./delegation.js').NotionPerson[]>;
  delegateTask(taskId: string, input: import('./delegation.js').DelegationInput): Promise<void>;
  syncDelegations(): Promise<void>;
  setDelegationStatus(taskId: string, status: import('./delegation.js').DelegationStatus): Promise<void>;

  captureTask(text: string): Promise<{ title: string; notes: string; label: string | null; labels?: string[]; dueAt: string | null; recurrence?: TaskRecurrence }>;
  claudeRoutines(): Promise<ClaudeRoutines>;
  configureReminders(enabled: boolean, list: string): Promise<void>;
  syncReminders(): Promise<void>;
  readonly windowVibrancy?: boolean;
  checkSetup(): Promise<import('./onboarding.js').OnboardingState>;
  selectSetup(choice: import('./provider-setup.js').SetupChoice): Promise<import('./onboarding.js').OnboardingState>;
  configureBrainBridge(value: import('./brain-bridge.js').BrainBridgeConfig): Promise<import('./brain-bridge.js').BrainBridgeState>;
  runBrainBridge(): Promise<import('./brain-bridge.js').BrainBridgeState>;
  chooseBridgeFolder(purpose: 'import' | 'export' | 'filing'): Promise<string | null>;
  fileToBrain(workspaceId: string, path: string, kind: 'document' | 'attachment'): Promise<string>;
  chooseBrainFolder(): Promise<string | null>;
  installSetupComponent(kind: 'codex' | 'memory'): Promise<import('./onboarding.js').OnboardingState>;
  signInCodex(): Promise<import('./onboarding.js').OnboardingState>;
  cancelCodexSignIn(): Promise<import('./onboarding.js').OnboardingState>;
  saveSetup(step: import('./onboarding.js').SetupStep, action: 'continue' | 'later' | 'finish'): Promise<import('./onboarding.js').OnboardingState>;
  uiFeedback(): Promise<import('./ui-feedback').UiFeedbackState>;
  addUiFeedback(input: import('./ui-feedback').UiFeedbackInput): Promise<import('./ui-feedback').UiFeedbackState>;
  resolveUiFeedback(id: string, resolved: boolean): Promise<import('./ui-feedback').UiFeedbackState>;
  copyUiFeedback(): Promise<void>;
  configureGmail(account: string, email: string, enabled: boolean): Promise<void>;
  syncGmail(): Promise<void>;
  updateEmailDraft(id: string, revision: number, fields: import('./gmail.js').EmailFields): Promise<import('./gmail.js').EmailDraft>;
  cancelEmailDraft(id: string, revision: number): Promise<import('./gmail.js').EmailDraft>;
  markEmailDraftSent(id: string, revision: number): Promise<import('./gmail.js').EmailDraft>;
  sendEmailDraft(id: string, revision: number, fields: import('./gmail.js').EmailFields): Promise<void>;
  findSlackTargets(kind: 'people' | 'channels', query: string, cursor?: string, draftId?: string): Promise<import('./slack-messages.js').SlackTargets>;
  updateSlackDraft(id: string, revision: number, fields: import('./slack-messages.js').SlackFields): Promise<import('./slack-messages.js').SlackDraft>;
  cancelSlackDraft(id: string, revision: number): Promise<import('./slack-messages.js').SlackDraft>;
  markSlackDraftSent(id: string, revision: number): Promise<import('./slack-messages.js').SlackDraft>;
  sendSlackDraft(id: string, revision: number, fields: import('./slack-messages.js').SlackFields): Promise<void>;
  configureOneOnOnes(account: string, enabled: boolean): Promise<void>;
  syncOneOnOnes(): Promise<void>;
  meetingConversation(id: string): Promise<string>;
  prepareOneOnOne(id: string): Promise<void>;
  updateOneOnOne(id: string, change: { agenda?: string; hidden?: boolean; autoPrepare?: boolean }, expectedAgenda?: string): Promise<void>;

  listDocuments(threadId: string): Promise<import('./documents').WorkspaceDocumentEntry[]>;
  /** Document APIs accept a task ID for personal tasks, or a conversation ID after handoff. */
  createDocument(workspaceId: string, name: string): Promise<import('./documents').WorkspaceDocument>;
  readDocument(threadId: string, path: string): Promise<import('./documents').WorkspaceDocument>;
  readDocumentImage(threadId: string, path: string, src: string): Promise<string>;
  importDocumentImage(threadId: string, path: string, name: string, bytes: Uint8Array): Promise<string>;
  showDocumentInFinder(threadId: string, path: string): Promise<void>;
  saveDocument(threadId: string, path: string, expected: string, content: string): Promise<import('./documents').WorkspaceDocument>;
  searchTaskContent(query: string): Promise<ContentMatch[]>;
  snapshot(): Promise<Snapshot>;
  setTypography(value: Typography): Promise<void>;
  threadMessages(threadId: string, before?: string): Promise<MessagePage>;
  copyChatTranscript(threadId: string): Promise<void>;
  onEvent(callback: (event: AppEvent) => void): () => void;
  createAgent(input: Pick<Agent, 'name' | 'role' | 'color' | 'instructions'>): Promise<void>;
  updateAgent(agent: Agent): Promise<void>;
  startThread(content: string): Promise<Thread>;
  sendMessage(threadId: string, content: string, attachments?: string[]): Promise<void>;
  importAttachment(threadId: string, name: string, bytes: Uint8Array): Promise<import('./attachments.js').Attachment>;
  openAttachment(threadId: string, path: string): Promise<void>;
  setBrowserReviewEnabled(enabled: boolean): Promise<void>;
  setShowTaskPriorities(show: boolean): Promise<void>;
  reviewInBrowser(threadId: string, path: string): Promise<void>;
  stopThread(threadId: string): Promise<void>;
  closeThread(threadId: string): Promise<void>;
  saveTaskView(view: import('./task-filters.js').SavedTaskView): Promise<void>;
  deleteTaskView(id: string): Promise<void>;
  createTaskList(name: string): Promise<TaskList>;
  renameTaskList(id: string, name: string): Promise<void>;
  deleteTaskList(id: string): Promise<void>;
  createTask(input: {
    title: string;
    notes?: string;
    label?: string | null;
    labels?: string[];
    dueAt?: string | null;
    recurrence?: TaskRecurrence | null;
    listId?: string | null;
  }): Promise<Task>;
  updateTask(taskId: string, change: TaskChange): Promise<void>;
  markTaskReviewed(taskId: string): Promise<void>;
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

export type ContentMatch = {
  taskId: string; words: number[]; snippet: string; where: 'conversation' | 'document';
  role: Message['role'] | null; agentId: string | null; draft: boolean; messageId: string | null; document: string | null;
};
