import { DelegationService } from './delegation.js';
import { PhoneCapture } from './phone-capture.js';
import { findRemindersHelper } from './reminders.js';
import { readClaudeRoutines } from './claude-schedule.js';
import { homedir } from 'node:os';
import { windowLook } from './window-look.js';
import { importAttachment, readAttachment } from './attachments.js';
import { attachmentLimits } from '../shared/attachments.js';
import { reviewRequest } from '../shared/review.js';
import { CONTENT_WORDS, searchWords, mergeContent } from '../shared/task-search.js';
import { searchTaskDocuments } from './document-search.js';
import { readTypography, validateTypography } from '../shared/typography.js';
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  powerMonitor,
  shell,
  Tray,
} from 'electron';
import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, lstatSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Agent, AppEvent, Approval, DesktopApi, Snapshot, TaskChange } from '../shared/types.js';
import { normalizeTaskLink } from '../shared/task-links.js';
import { documentLocation, listDocuments, readDocument, saveDocument } from './documents.js';
import { importDocumentImage, readDocumentImage } from './document-images.js';
import { executeExternalWrite } from './external-write.js';
import { CodexProvider } from './codex.js';
import { ClaudeProvider } from './claude.js';
import { EngineRouter, findClaudeBinary } from './engine.js';
import { MemoryRouter } from './memory-provider.js';
import { GbrainMemoryService, findGbrainBinary } from './gbrain-memory.js';
import { readProviderSetup, type ProviderSetup } from '../shared/provider-setup.js';
import { ConnectorManager } from './connectors.js';
import { Store } from './db.js';
import { MemoryService } from './memory.js';
import { Runtime } from './runtime.js';
import { BrowserManager } from './browser.js';
import { createBrowserBackend } from './browser-backend.js';
import { readPackage, fileBytes, parseSkill } from './skill-package.js';
import type { SkillCreate, SkillFile, SkillSettings } from '../shared/skills.js';
import { chatTranscript } from './chat-transcript.js';
import { UiFeedbackStore } from './ui-feedback.js';
import { feedbackBrief } from '../shared/ui-feedback.js';
import { initializeOnboarding, OnboardingService } from './onboarding.js';

const here = dirname(fileURLToPath(import.meta.url));
let window: BrowserWindow | null = null;
let tray: Tray | null = null;
let store: Store;
let codex: EngineRouter;
let connectors: ConnectorManager;
let memory: MemoryRouter;
let runtime: Runtime;
let phoneCapture: PhoneCapture;
let delegation: DelegationService;
let phoneTimer: NodeJS.Timeout | undefined;
let browser: BrowserManager;
let onboarding: OnboardingService;
let shuttingDown = false;
const approvals = new Map<string, Approval>();
const externalApprovalResolvers = new Map<string, (value: boolean) => void>();
const approvalThreads = new Map<string, string>();

function migrateLegacyData() {
  const currentDir = app.getPath('userData');
  const currentDb = join(currentDir, 'aegir.sqlite');
  if (existsSync(currentDb)) return;
  const legacyDb = join(app.getPath('appData'), 'Agent Desk', 'agent-desk.sqlite');
  if (!existsSync(legacyDb)) return;
  mkdirSync(currentDir, { recursive: true });
  for (const suffix of ['', '-wal', '-shm']) {
    const source = `${legacyDb}${suffix}`;
    if (existsSync(source)) copyFileSync(source, `${currentDb}${suffix}`);
  }
}
function snapshot(): Snapshot {
  return {
    reminders: phoneCapture?.state(),
    delegation: delegation?.state(),
    onboarding: onboarding?.state(),
    brainBridge: runtime?.brainBridge?.state(),
    oneOnOnes: runtime?.oneOnOnes?.snapshot(),
    gmail: runtime?.gmail?.snapshot(),
    agents: store.list('agents'),
    groups: store.groups(),
    threads: store.threadSummaries(),
    tasks: store.list('tasks'),
    taskLists: store.taskLists(),
    taskViews: store.taskViews(),
    taskLinks: store.taskLinks(),
    routines: store.routines(),
    routineRuns: store.routineRuns(),
    connectors: Object.values(connectors.states),
    approvals: [...approvals.values()],
    legacyMemoryCount: store.legacyMemoryCount(),
    memoryInstructions: store.getSetting('memoryInstructions') || '',
    codexStatus: codex.status,
    launchAtLogin: app.getLoginItemSettings().openAtLogin,
    typography: readTypography(store.getSetting('typography')),
    browser: browser.state,
    browserReviewEnabled: store.getSetting('browserReviewEnabled') === 'true',
    showTaskPriorities: store.getSetting('showTaskPriorities') !== 'false',
    mcpSettings: {
      slackClientId: store.getSetting('slackClientId') || '',
      slackConfigured: connectors.slackConfigured(),
      composioConfigured: connectors.composioConfigured(),
      composioSlackAccount: store.getSetting('composioSlackAccount') || '',
    },
  };
}
function emit(event: AppEvent) {
  if (!shuttingDown && window && !window.isDestroyed() && !window.webContents.isDestroyed())
    window.webContents.send('app-event', event);
}
function refresh() {
  if (shuttingDown || !store?.isOpen) return;
  emit({ type: 'snapshot', value: snapshot() });
}
function approvalForExternal(detail: string, threadId: string | undefined, options?: { title: string; signal?: AbortSignal; method?: string }): Promise<boolean> {
  if (options?.signal?.aborted) return Promise.resolve(false);
  const id = randomUUID();
  approvals.set(id, {
    id,
    method: options?.method || (options ? 'browser-control' : 'external-write'),
    title: options?.title || 'External write',
    detail,
    agentId: null,
    threadId,
    createdAt: new Date().toISOString(),
  });
  if (threadId) {
    store.addMessage(
      threadId,
      null,
      'system',
      options ? `${options.title} requested. Review the approval.` : 'An agent wants to write to an external system. Review the approval.',
    );
    approvalThreads.set(id, threadId);
  }
  return new Promise((resolve) => {
    const cancel = () => {
      externalApprovalResolvers.delete(id);
      approvals.delete(id);
      approvalThreads.delete(id);
      resolve(false);
      refresh();
    };
    externalApprovalResolvers.set(id, approved => {
      options?.signal?.removeEventListener('abort', cancel);
      resolve(approved);
    });
    options?.signal?.addEventListener('abort', cancel, { once: true });
    refresh();
  });
}
function registerIpc() {
  // Document workspaces accept a task ID before handoff, or the existing conversation ID.
  const documentRoot = (workspaceId: string) => {
    const task = store.get('tasks', workspaceId);
    if (task?.outputDir) return task.outputDir;
    const thread = store.get('threads', workspaceId);
    if (!thread) throw new Error('This conversation no longer exists');
    return (thread.taskId && store.get('tasks', thread.taskId)?.outputDir) || app.getPath('userData');
  };
  const attachmentRoot = (id: string) => {
    const thread = store.get('threads', id);
    if (!thread) throw new Error('This conversation no longer exists');
    const task = thread.taskId ? store.get('tasks', thread.taskId) : null;
    const root = task?.outputDir || join(app.getPath('userData'), 'conversation-files', thread.id);
    mkdirSync(root, { recursive: true });
    return root;
  };
  const handle = (channel: string, fn: (...args: any[]) => unknown) =>
    ipcMain.handle(channel, async (_event, ...args) => {
      const result = await fn(...args);
      if (channel.startsWith('skill-') && !['skill-library', 'skill-detail', 'skill-revision-files'].includes(channel)) emit({ type: 'skills-changed' });
      return result;
    });
  handle('snapshot', () => snapshot());
  handle('brain-bridge-configure', value => runtime.brainBridge.configure(value));
  handle('brain-bridge-run', () => runtime.brainBridge.run());
  handle('brain-bridge-folder', async (purpose: string) => {
    if (!['import', 'export', 'filing'].includes(purpose)) throw new Error('Choose a workflow folder.');
    const result = await dialog.showOpenDialog({ title: purpose === 'import' ? 'Choose the external task intake folder' : purpose === 'export' ? 'Choose the task export folder' : 'Choose the brain filing folder', properties: ['openDirectory', 'createDirectory'] });
    return result.canceled ? null : result.filePaths[0] || null;
  });
  handle('brain-bridge-file', (id: string, path: string, kind: string) => {
    if (kind === 'document') {
      const document = readDocument(documentRoot(id), path);
      return runtime.brainBridge.file(join(documentRoot(id), document.path), basename(document.path));
    }
    if (kind === 'attachment') {
      const file = readAttachment(attachmentRoot(id), path);
      if (!store.messagesForThread(id).some(message => message.meta?.type === 'attachments' && message.meta.files.some(item => item.path === file.path))) throw new Error('Choose an attachment already sent in this conversation.');
      return runtime.brainBridge.file(file.path, file.name);
    }
    throw new Error('Choose a task document or conversation attachment.');
  });
  handle('setup-check', () => onboarding.check());
  handle('setup-select', choice => onboarding.select(choice));
  handle('setup-brain-folder', async () => {
    const result = await dialog.showOpenDialog({ title: 'Choose your Obsidian brain folder', properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0] || null;
  });
  handle('setup-install', kind => onboarding.installComponent(kind));
  handle('setup-codex-login', () => onboarding.signIn());
  handle('setup-codex-cancel', () => onboarding.cancelSignIn());
  handle('setup-save', (step, action) => onboarding.save(step, action));
  const feedback = new UiFeedbackStore(join(app.getPath('userData'), 'ui-feedback.json'));
  handle('ui-feedback-list', () => feedback.list());
  handle('ui-feedback-add', input => feedback.add(input));
  handle('ui-feedback-resolve', (id, resolved) => feedback.resolve(id, resolved));
  handle('ui-feedback-copy', () => clipboard.writeText(feedbackBrief(feedback.list())));
  handle('gmail-configure', (account: string, email: string, enabled: boolean) => runtime.gmail.configure(account, email, enabled));
  handle('gmail-sync', () => runtime.gmail.sync());
  handle('gmail-draft-update', (id: string, revision: number, fields: import('../shared/gmail.js').EmailFields) => (runtime.claudeDrafts.owns(id) ? runtime.claudeDrafts : runtime.gmail).update(id, revision, fields));
  // These renderer-only endpoints are the user's explicit approval of the displayed draft.
  handle('gmail-draft-cancel', (id: string, revision: number) => (runtime.claudeDrafts.owns(id) ? runtime.claudeDrafts : runtime.gmail).cancelSend(id, revision));
  handle('gmail-draft-manual', (id: string, revision: number) => (runtime.claudeDrafts.owns(id) ? runtime.claudeDrafts : runtime.gmail).markSentManually(id, revision));
  handle('gmail-draft-send', (id: string, revision: number, fields: import('../shared/gmail.js').EmailFields) => (runtime.claudeDrafts.owns(id) ? runtime.claudeDrafts : runtime.gmail).queueSend(id, revision, fields));
  handle('slack-draft-targets', (kind: 'people' | 'channels', query: string, cursor?: string, draftId?: string) => (draftId && runtime.claudeDrafts.owns(draftId) ? runtime.claudeDrafts : runtime.slackMessages).findTargets(kind, query, cursor));
  handle('slack-draft-update', (id: string, revision: number, fields: import('../shared/slack-messages.js').SlackFields) => (runtime.claudeDrafts.owns(id) ? runtime.claudeDrafts : runtime.slackMessages).update(id, revision, fields));
  handle('slack-draft-cancel', (id: string, revision: number) => (runtime.claudeDrafts.owns(id) ? runtime.claudeDrafts : runtime.slackMessages).cancelSend(id, revision));
  handle('slack-draft-manual', (id: string, revision: number) => (runtime.claudeDrafts.owns(id) ? runtime.claudeDrafts : runtime.slackMessages).markSentManually(id, revision));
  handle('slack-draft-send', (id: string, revision: number, fields: import('../shared/slack-messages.js').SlackFields) => (runtime.claudeDrafts.owns(id) ? runtime.claudeDrafts : runtime.slackMessages).queueSend(id, revision, fields));
  handle('set-typography', (value: unknown) => {
    store.setSetting('typography', JSON.stringify(validateTypography(value)));
    refresh();
  });
  handle('browser-enabled', async (enabled: boolean) => {
    if (typeof enabled !== 'boolean') throw new Error('Invalid browser setting');
    store.setSetting('browserEnabled', String(enabled));
    await browser.setEnabled(enabled);
  });
  handle('browser-open', () => browser.open());
  handle('browser-stop', () => browser.stop());
  handle('search-task-content', (query: unknown) => {
    if (typeof query !== 'string' || query.length > 200) return [];
    const words = searchWords(query).slice(0, CONTENT_WORDS);
    return mergeContent(store.searchTaskMessages(words), searchTaskDocuments(store.list('tasks').filter(task => task.status !== 'dismissed'), words));
  });
  handle('document-list', (id: string) => listDocuments(documentRoot(id)));
  handle('document-create', (id: string, name: string) => {
    const taskId = store.get('tasks', id)?.id || store.get('threads', id)?.taskId;
    if (!taskId) throw new Error('Choose a task to create a document');
    return runtime.createTaskDocument(taskId, name);
  });
  handle('document-read', (id: string, path: string) => readDocument(documentRoot(id), path));
  handle('document-image-read', (id: string, path: string, src: string) => readDocumentImage(documentRoot(id), path, src));
  handle('document-image-import', (id: string, path: string, name: string, bytes: Uint8Array) => importDocumentImage(documentRoot(id), path, name, bytes));
  handle('document-show-in-finder', (id: string, path: string) => shell.showItemInFolder(documentLocation(documentRoot(id), path)));
  handle('document-save', (id: string, path: string, expected: string, content: string) => saveDocument(documentRoot(id), path, expected, content));
  handle('skill-library', () => runtime.skills.library());
  handle('skill-detail', (id: string) => runtime.skills.detail(id));
  handle('skill-create', (input: SkillCreate) => runtime.skills.create(input));
  handle('skill-update', (id: string, expected: string, files: SkillFile[], reason: string) => runtime.skills.update(id, expected, files, reason));
  handle('skill-configure', (id: string, settings: SkillSettings) => runtime.skills.configure(id, settings));
  handle('skill-copy', (id: string, owner: string | null) => runtime.skills.copy(id, owner));
  handle('skill-restore', (id: string, expected: string, revision: string) => runtime.skills.restoreRevision(id, expected, revision));
  handle('skill-revision-files', (id: string, revision: string) => runtime.skills.revisionFiles(id, revision));
  handle('skill-resolve', (id: string, apply: boolean) => runtime.skills.resolveProposal(id, apply));
  handle('skill-bind-routine', (id: string, skills: string[]) => runtime.skills.bindRoutine(id, skills));
  handle('skill-import', async (owner: string | null) => {
    const choice = await dialog.showOpenDialog({ title: 'Import a skill folder or SKILL.md', properties: ['openFile', 'openDirectory'] });
    if (choice.canceled || !choice.filePaths[0]) return null;
    const path = choice.filePaths[0]; const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error('Choose the original folder or file, not a symlink');
    if (stat.isFile() && stat.size > 1024 * 1024) throw new Error('Skill file is too large');
    const files: SkillFile[] = stat.isDirectory() ? readPackage(path) : [{ path: 'SKILL.md', encoding: 'utf8', content: readFileSync(path, 'utf8') }];
    parseSkill(files);
    return runtime.skills.create({ ownerAgentId: owner, files }, {}, 'imported', path);
  });
  handle('skill-export', async (id: string) => {
    const { skill, files } = runtime.skills.detail(id); parseSkill(files);
    const choice = await dialog.showOpenDialog({ title: 'Choose a folder for the exported skill', properties: ['openDirectory', 'createDirectory'] });
    if (choice.canceled || !choice.filePaths[0]) return;
    const destination = join(choice.filePaths[0], skill.name);
    if (existsSync(destination)) throw new Error('A folder with this skill name already exists. Choose another destination.');
    mkdirSync(destination);
    for (const file of files) { const path = join(destination, file.path); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, fileBytes(file)); }
  });
  handle('one-on-ones-configure', (account: string, enabled: boolean) => {
    runtime.oneOnOnes.configure(account, enabled);
    if (enabled) void runtime.oneOnOnes.tick();
  });
  handle('one-on-ones-sync', () => runtime.oneOnOnes.sync());
  handle('meeting-conversation', (id: string) => runtime.meetingConversation(id));
  handle('one-on-ones-prepare', (id: string) => runtime.oneOnOnes.prepare(id));
  handle('one-on-ones-update', (id: string, change: { agenda?: string; hidden?: boolean; autoPrepare?: boolean }, expected?: string) => runtime.oneOnOnes.update(id, change, expected));
  handle('thread-messages', (threadId: string, before?: string) =>
    store.messagePage(threadId, before),
  );
  handle('copy-chat-transcript', (threadId: string) => {
    clipboard.writeText(chatTranscript(store, threadId, runtime.skills.proposals()));
  });
  handle('create-agent', (input: Pick<Agent, 'name' | 'role' | 'color' | 'instructions'>) => {
    store.createAgent(input);
    refresh();
  });
  handle('update-agent', (agent: Agent) => {
    store.updateAgent(agent);
    refresh();
  });
  handle('start-thread', (content: string) =>
    runtime.startThread(content),
  );
  handle('attachment-import', (id: string, name: string, bytes: Uint8Array) => importAttachment(attachmentRoot(id), name, bytes));
  handle('attachment-open', async (id: string, path: string) => {
    const file = readAttachment(attachmentRoot(id), path);
    // Reveal files instead of executing arbitrary attachment types.
    shell.showItemInFolder(file.path);
  });
  handle('send-message', (threadId: string, content: string, paths: string[] = []) => {
    if (!Array.isArray(paths) || paths.length > attachmentLimits.count || paths.some(path => typeof path !== 'string')) throw new Error('Attach up to ten files per message');
    const files = paths.map(path => readAttachment(attachmentRoot(threadId), path));
    return runtime.sendMessage(threadId, content, false, files);
  });
  handle('set-show-task-priorities', (show: boolean) => {
    if (typeof show !== 'boolean') throw new Error('Choose whether to show task priorities');
    store.setSetting('showTaskPriorities', String(show));
    refresh();
  });
  handle('browser-review-enabled', (enabled: boolean) => {
    if (typeof enabled !== 'boolean') throw new Error('Choose whether to enable browser review');
    store.setSetting('browserReviewEnabled', String(enabled)); refresh();
  });
  handle('browser-review-start', (id: string, path: string) => {
    if (store.getSetting('browserReviewEnabled') !== 'true') throw new Error('Enable browser review in Settings first');
    const thread = store.get('threads', id);
    if (!thread?.taskId || !store.get('tasks', thread.taskId)?.outputDir) throw new Error('Browser review needs a task workspace');
    const document = readDocument(documentRoot(id), path);
    return runtime.sendMessage(id, reviewRequest(document.path), false);
  });
  handle('stop-thread', (threadId: string) => runtime.stopThread(threadId));
  handle('close-thread', (threadId: string) => {
    store.setThreadStatus(threadId, 'closed');
    refresh();
  });
  handle('delegation-configure', (database: string) => delegation.configure(database));
  handle('delegation-people', (query: string) => delegation.people(query));
  handle('delegation-publish', (id: string, input: import('../shared/delegation.js').DelegationInput) => delegation.delegate(id, input));
  handle('delegation-sync', () => delegation.sync());
  handle('delegation-status', (id: string, status: import('../shared/delegation.js').DelegationStatus) => delegation.setStatus(id, status));
  handle('capture-task', (text: string) => runtime.captureTask(text));
  let claudeRead: ReturnType<typeof readClaudeRoutines> | null = null;
  handle('claude-routines', () => claudeRead ||= readClaudeRoutines(join(homedir(), 'Library', 'Application Support', 'Claude', 'claude-code-sessions')).finally(() => { claudeRead = null; }));
  handle('configure-reminders', (enabled: boolean, list: string) => phoneCapture.configure(enabled, list));
  handle('sync-reminders', () => phoneCapture.sync());
  handle('save-task-view', (input: unknown) => { store.saveTaskView(input); refresh(); });
  handle('delete-task-view', (id: string) => { store.deleteTaskView(id); refresh(); });
  handle('create-task-list', (name: string) => {
    const list = store.createTaskList(name);
    refresh();
    return list;
  });
  handle('rename-task-list', (id: string, name: string) => {
    store.renameTaskList(id, name);
    refresh();
  });
  handle('delete-task-list', (id: string) => {
    store.deleteTaskList(id);
    refresh();
  });
  handle(
    'create-task',
    (input: Parameters<DesktopApi['createTask']>[0]) => {
      const task = store.createTask(input, true);
      refresh();
      return task;
    },
  );
  handle('update-task', (id: string, change: TaskChange) => {
    const allowed: TaskChange = {};
    for (const key of ['title', 'notes', 'status', 'label', 'dueAt', 'listId', 'recurrence', 'priority', 'snoozedUntil', 'labels'] as const)
      if (key in change) (allowed as Record<string, unknown>)[key] = change[key];
    store.updateTask(id, allowed, true);
    refresh();
  });
  handle('mark-task-reviewed', (id: string) => {
    store.markTaskReviewed(id);
    refresh();
  });
  handle('delete-task', (id: string) => {
    store.deleteTask(id, true);
    refresh();
  });
  handle('add-task-link', (taskId: string, url: string) => {
    const link = store.addTaskLink(taskId, url);
    refresh();
    return link;
  });
  handle('read-clipboard-text', () => clipboard.readText());
  handle('open-task-link', async (linkId: string) => {
    const link = store.taskLinks().find(item => item.id === linkId);
    if (!link) throw new Error('This attachment no longer exists');
    if (link.url.startsWith('file:')) {
      const error = await shell.openPath(fileURLToPath(link.url));
      if (error) throw new Error(error);
    } else {
      const safe = normalizeTaskLink(link.url);
      if (!safe) throw new Error('Invalid attachment URL');
      await shell.openExternal(safe);
    }
  });
  handle('remove-task-link', (linkId: string) => {
    store.removeTaskLink(linkId);
    refresh();
  });
  handle('undo-task-action', () => {
    const action = store.undoTaskAction();
    if (action) refresh();
    return action;
  });
  handle('hand-off', (taskId: string, instruction: string) => runtime.handOff(taskId, instruction));
  handle('stop-task', (taskId: string) => runtime.stopTask(taskId));
  handle('open-task-output', async (taskId: string) => {
    const dir = store.get('tasks', taskId)?.outputDir;
    if (!dir) throw new Error('This task has no output folder yet');
    const error = await shell.openPath(dir);
    if (error) throw new Error(error);
  });
  handle('run-routine', (routineId: string) => {
    void runtime.runRoutine(routineId, 'manual').catch(console.error);
  });
  handle('set-routine-enabled', (routineId: string, enabled: boolean) => {
    store.updateRoutine(routineId, { enabled });
    refresh();
  });
  handle('resolve-routine-change', (messageId: string, apply: boolean) =>
    runtime.resolveRoutineChange(messageId, apply),
  );
  handle('run-events', (runId: string) => store.runEvents(runId));
  handle('resolve-approval', (id: string, approved: boolean) => {
    const threadId = approvalThreads.get(id);
    if (threadId) {
      store.addMessage(threadId, null, 'system', `Approval ${approved ? 'granted' : 'declined'}.`);
      approvalThreads.delete(id);
    }
    if (externalApprovalResolvers.has(id)) {
      externalApprovalResolvers.get(id)!(approved);
      externalApprovalResolvers.delete(id);
    } else codex.resolveApproval(id, approved);
    approvals.delete(id);
    refresh();
  });
  handle(
    'connect',
    async (provider: 'slack' | 'notion' | 'composio', clientId?: string, clientSecret?: string) => {
      if (provider === 'slack' && clientId) store.setSetting('slackClientId', clientId);
      await connectors.connect(provider, clientId, clientSecret);
      refresh();
    },
  );
  handle('disconnect', async (provider: 'slack' | 'notion' | 'composio') => {
    await connectors.disconnect(provider);
    refresh();
  });
  handle('memory-instructions', (value: string) => {
    store.setSetting('memoryInstructions', value);
    refresh();
  });
  handle('search-memories', async (query: string) => {
    const results = await memory.search(query);
    refresh();
    return results;
  });
  handle('forget-memory', async (id: string, scope: string) => {
    await memory.forget(id, scope);
    refresh();
  });
  handle('correct-memory', async (id: string, scope: string, content: string) => {
    await memory.correct(id, scope, content);
    refresh();
  });
  handle('launch-at-login', (enabled: boolean) => {
    app.setLoginItemSettings({ openAtLogin: enabled });
    refresh();
  });
  handle('open-external', (url: string) => {
    const safe = normalizeTaskLink(url);
    if (!safe) throw new Error('Invalid URL');
    return shell.openExternal(safe);
  });
}
function createWindow() {
  nativeTheme.themeSource = 'light';
  const look = windowLook(process.platform, nativeTheme.prefersReducedTransparency);
  window = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 950,
    minHeight: 620,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 20 },
    vibrancy: look.vibrancy,
    visualEffectState: look.visualEffectState,
    backgroundColor: look.backgroundColor,
    show: !app.getLoginItemSettings().wasOpenedAtLogin,
    webPreferences: {
      additionalArguments: look.args,
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  const updateGlass = () => {
    if (!window || window.isDestroyed()) return;
    const next = windowLook(process.platform, nativeTheme.prefersReducedTransparency);
    if (process.platform === 'darwin') window.setVibrancy(next.vibrancy ?? null);
    window.setBackgroundColor(next.backgroundColor!);
  };
  nativeTheme.on('updated', updateGlass);
  window.once('closed', () => nativeTheme.removeListener('updated', updateGlass));
  if (process.env.VITE_DEV_SERVER_URL) void window.loadURL(process.env.VITE_DEV_SERVER_URL);
  else void window.loadFile(join(here, '../dist/index.html'));
  window.webContents.on('console-message', (_event, level, message) => {
    console.log(`[renderer:${level}] ${message}`);
  });
  window.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error(`Renderer load failed (${code}): ${description} ${url}`);
  });
  window.on('close', (event) => {
    if (!(app as typeof app & { isQuitting?: boolean }).isQuitting) {
      event.preventDefault();
      window?.hide();
    }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('did-finish-load', refresh);
}
function openSettings() {
  window?.show();
  window?.focus();
  emit({ type: 'open-settings' });
}
function createApplicationMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'Aegir',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: openSettings },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ]));
}
function createTray() {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18"><path fill="#111" d="M9 1 16 5v8l-7 4-7-4V5zm0 3L5 6v5l4 2 4-2V6z"/></svg>';
  tray = new Tray(
    nativeImage.createFromDataURL(
      `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
    ),
  );
  tray.setToolTip('Aegir');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Aegir', click: () => window?.show() },
      { label: 'Settings…', click: openSettings },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          (app as typeof app & { isQuitting?: boolean }).isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on('double-click', () => window?.show());
}
if (app.requestSingleInstanceLock()) {
  app.on('second-instance', () => {
    window?.show();
    window?.focus();
  });
  app.whenReady().then(async () => {
    migrateLegacyData();
    const existingWorkspace = existsSync(join(app.getPath('userData'), 'aegir.sqlite'));
    store = new Store();
    initializeOnboarding(store, existingWorkspace);
    store.onMessage = (value) => emit({ type: 'message', value });
    const codexProvider = new CodexProvider(() => store.getSetting('codexBinary'));
    const mnemosyne = new MemoryService(store);
    let claudeProvider: ClaudeProvider;
    let brain: GbrainMemoryService;
    const adapters = (setup: ProviderSetup) => {
      claudeProvider = new ClaudeProvider(findClaudeBinary(store.getSetting('claudeBinary')));
      brain = new GbrainMemoryService(findGbrainBinary(store.getSetting('gbrainBinary')), setup);
      return { engine: setup.engine === 'claude' ? claudeProvider : codexProvider, memory: setup.memory === 'gbrain' ? brain : mnemosyne };
    };
    const initialAdapters = adapters(readProviderSetup(store.getSetting('providerSetup')));
    codex = new EngineRouter(initialAdapters.engine, () => !!store.getSetting('providerSetup'));
    connectors = new ConnectorManager(store);
    memory = new MemoryRouter(initialAdapters.memory, () => !!store.getSetting('providerSetup'));
    browser = new BrowserManager(store.getSetting('browserEnabled') === 'true',
      () => createBrowserBackend(join(app.getPath('userData'), 'browser')),
      (threadId, detail, signal) => approvalForExternal(detail, threadId, { title: 'Browser control for this response', signal }), refresh);
    const outputRoot = join(app.getPath('documents'), 'Aegir');
    runtime = new Runtime(store, codex, connectors, memory, refresh, emit, {
      outputRoot,
      routineCwd: app.getPath('userData'),
    }, browser);
    onboarding = new OnboardingService(store, codexProvider, mnemosyne, join(app.getPath('userData'), 'runtime'), refresh, url => shell.openExternal(url), undefined, undefined, {
      apply: setup => {
        if (phoneCapture?.hasActiveWork || runtime.hasActiveWork || codex.hasActiveWork || memory.hasActiveWork || approvals.size) throw new Error('Stop active agents and routines, and wait for background work to finish before switching setup.');
        const next = adapters(setup);
        store.setSetting('providerSetup', JSON.stringify(setup));
        store.setSetting('setupAutomationPaused', 'true');
        codex.replace(next.engine); memory.replace(next.memory);
      },
      checkClaude: signal => claudeProvider.checkAccess(signal),
      checkBrain: signal => brain.check(signal),
    });
    codex.on('status', refresh);
    codex.on('approval', (approval: Approval) => {
      if (shuttingDown || !store.isOpen) return;
      const context = approval.threadId ? runtime.contextFor(approval.threadId) : undefined;
      // Routines run unattended; anything that needs approval is declined and left in the run log.
      if (context?.kind === 'routine' || context?.kind === 'prep') {
        codex.resolveApproval(approval.id, false);
        return;
      }
      approvals.set(approval.id, approval);
      if (context?.threadId) {
        store.addMessage(
          context.threadId,
          null,
          'system',
          `${approval.title} requested. Review the approval.`,
        );
        approvalThreads.set(approval.id, context.threadId);
      }
      refresh();
    });
    codex.on('approval-resolved', (id: string) => {
      approvals.delete(id);
      refresh();
    });
    codex.setToolHandler(async (provider, tool, args, readOnly, codexThreadId) => {
      if (shuttingDown || !store.isOpen) throw new Error('App is shutting down');
      runtime.logToolCall(codexThreadId, `${provider}.${tool}`, args);
      try {
        const internal = await runtime.handleInternalTool(provider, tool, args, codexThreadId);
        if (internal !== undefined) {
          runtime.logToolResult(codexThreadId, internal);
          return internal;
        }
        if (provider !== 'slack' && provider !== 'notion' && provider !== 'composio') throw new Error('Unknown tool');
        const info = connectors.toolInfo(provider, tool);
        if (!info) throw new Error('Tool is not available');
        readOnly = info.readOnly;
        const context = runtime.contextFor(codexThreadId);
        // Tasks and routines only receive read-only tools; this is the backstop if one is called anyway.
        if (!readOnly && context && context.kind !== 'chat')
          throw new Error('Handed-off tasks and routines cannot write to external systems');
        const call = () => {
          if (shuttingDown || !store.isOpen) throw new Error('App is shutting down');
          return connectors.call(provider, tool, args);
        };
        const result = readOnly ? await call() : await executeExternalWrite(
          { signal: runtime.runSignal(codexThreadId), isCurrent: () => !!context && runtime.contextFor(codexThreadId) === context },
          signal => approvalForExternal(
            `${provider}: ${tool}\n${JSON.stringify(args, null, 2)}\nGrant: this one write only`,
            context?.threadId,
            { title: `Write to ${provider}`, signal, method: 'external-write' },
          ),
          call,
        );
        runtime.logToolResult(codexThreadId, result);
        return result;
      } catch (error) {
        runtime.logToolResult(codexThreadId, String(error), true);
        throw error;
      }
    });
    delegation = new DelegationService(store, connectors, refresh);
    connectors.on('change', refresh);
    registerIpc();
    createWindow();
    createApplicationMenu();
    createTray();
    connectors.start();
    runtime.start();
    delegation.start();
    if (store.getSetting('providerSetup')) void memory
      .migrateLegacy()
      .then(() => {
        if (store.isOpen) refresh();
      })
      .catch((error) => {
        console.error('Memory migration failed:', error);
        if (store.isOpen) refresh();
      });
    if (app.isPackaged && !store.getSetting('loginConfigured')) {
      app.setLoginItemSettings({ openAtLogin: true });
      store.setSetting('loginConfigured', 'true');
      refresh();
    }
    phoneCapture = new PhoneCapture(store, process.platform === 'darwin' ? findRemindersHelper([app.isPackaged ? join(process.resourcesPath, 'aegir-reminders') : join(app.getAppPath(), 'build', 'aegir-reminders')]) : null, refresh);
    phoneTimer = setInterval(() => void phoneCapture.sync(), 60_000);
    powerMonitor.on('resume', () => { runtime.tick(); void phoneCapture.sync(); });
    if (process.platform === 'darwin' && !app.isPackaged) app.dock?.show();
    if (store.getSetting('providerSetup')) void codex.start().catch((error) => {
      codex.status = `Error: ${String(error)}`;
      refresh();
    });
  });
  app.on('before-quit', (event) => {
    if (shuttingDown) return;
    event?.preventDefault();
    shuttingDown = true;
    for (const resolve of externalApprovalResolvers.values()) resolve(false);
    externalApprovalResolvers.clear();
    (app as typeof app & { isQuitting?: boolean }).isQuitting = true;
    if (phoneTimer) clearInterval(phoneTimer);
    phoneCapture?.stop();
    delegation?.close();
    runtime?.stop();
    const setupClosed = onboarding?.close();
    const browserClosed = browser?.close();
    connectors?.close();
    codex?.close();
    store?.close();
    if (event) void Promise.allSettled([browserClosed, setupClosed]).finally(() => app.quit());
  });
  app.on('activate', () => window?.show());
} else app.quit();
