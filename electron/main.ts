import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  powerMonitor,
  shell,
  Tray,
} from 'electron';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readlinkSync, renameSync, rmSync, writeFileSync, lstatSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Agent, AppEvent, Approval, RemindersState, Snapshot, Task, TaskChange } from '../shared/types.js';
import { normalizeTaskLink } from '../shared/task-links.js';
import { documentLocation, listDocuments, readDocument, saveDocument } from './documents.js';
import { CodexProvider } from './codex.js';
import { ClaudeProvider } from './claude.js';
import { chooseEngine, engineNames, findClaudeBinary, type EngineId, type EngineProvider } from './engine.js';
import { ConnectorManager } from './connectors.js';
import { approveExternalWrite } from './external-write.js';
import { Store } from './db.js';
import { MemoryService } from './memory.js';
import { findGbrainBinary, GbrainMemoryService } from './gbrain-memory.js';
import { exportTasks, importInbox } from './brain-bridge.js';
import { readClaudeRoutines } from './claude-schedule.js';
import { findRemindersHelper, parseLedger, RemindersError, RemindersHelper, syncReminders } from './reminders.js';
import { Runtime } from './runtime.js';
import { BrowserManager } from './browser.js';
import { createBrowserBackend } from './browser-backend.js';
import { readPackage, fileBytes, parseSkill } from './skill-package.js';
import type { SkillCreate, SkillFile, SkillSettings } from '../shared/skills.js';
import { chatTranscript } from './chat-transcript.js';

const here = dirname(fileURLToPath(import.meta.url));
let window: BrowserWindow | null = null;
let tray: Tray | null = null;
let store: Store;
let codex: EngineProvider;
let engine: EngineId = 'codex';
let connectors: ConnectorManager;
let memory: MemoryService | GbrainMemoryService;
let runtime: Runtime;
let browser: BrowserManager;
let shuttingDown = false;
let brain: { dir: string; inbox: string; exportDir: string } | null = null;
let inboxTimer: NodeJS.Timeout | null = null;
let exportTimer: NodeJS.Timeout | null = null;
let pendingExport: Task[] | null = null;
let remindersTimer: NodeJS.Timeout | null = null;
let remindersBusy = false;
let remindersRerun = false;
let remindersImported = 0;
let remindersState: RemindersState = { enabled: false, list: 'Reminders', state: 'off', detail: '', lastSyncAt: null };
const approvals = new Map<string, Approval>();
const externalApprovalResolvers = new Map<string, (value: boolean) => void>();
const approvalThreads = new Map<string, string>();

function notifyApproval(title: string) {
  if (window?.isFocused() || !Notification.isSupported()) return;
  const note = new Notification({ title: 'Legolas needs your approval', body: title });
  note.on('click', () => { window?.show(); window?.focus(); });
  note.show();
}
// ---- Phone capture from Apple Reminders ----------------------------------------------
function remindersSettings() {
  return { enabled: store.getSetting('remindersCapture') === 'on', list: store.getSetting('remindersList') || 'Reminders' };
}
function remindersHelperPath() {
  return findRemindersHelper(app.isPackaged
    ? [join(process.resourcesPath, 'aegir-reminders')]
    : [join(app.getAppPath(), 'build', 'aegir-reminders')]);
}
function scheduleReminders(delayMs: number) {
  if (remindersTimer) clearTimeout(remindersTimer);
  // A pass already running picks the request up as soon as it ends.
  if (remindersBusy) { remindersRerun = true; remindersTimer = null; return; }
  remindersTimer = shuttingDown ? null : setTimeout(() => { remindersTimer = null; void syncPhoneCapture(); }, delayMs);
}
async function syncPhoneCapture() {
  if (shuttingDown || !store?.isOpen || remindersBusy) return;
  const settings = remindersSettings();
  if (!settings.enabled) {
    remindersState = { ...settings, state: 'off', detail: 'Off', lastSyncAt: remindersState.lastSyncAt };
    refresh();
    return;
  }
  const binary = remindersHelperPath();
  if (!binary) {
    remindersState = { ...settings, state: 'error', detail: 'This build has no Reminders helper. Rebuild with pnpm build.', lastSyncAt: null };
    refresh();
    return;
  }
  remindersBusy = true;
  remindersRerun = false;
  let nextCheck = 60_000;
  // Stop mid-pass when the user turns capture off, switches list, or quits.
  const unchanged = () => {
    if (shuttingDown || !store?.isOpen) return false;
    const now = remindersSettings();
    return now.enabled && now.list === settings.list;
  };
  try {
    const ledger = parseLedger(store.getSetting('remindersLedger'), store.getSetting('remindersPending'));
    // Saved after every change, so quitting mid-pass loses nothing.
    const save = () => { if (!shuttingDown && store?.isOpen) store.setSetting('remindersLedger', JSON.stringify(ledger)); };
    save();
    if (store.getSetting('remindersPending')) store.deleteSetting('remindersPending');
    const result = await syncReminders(store, new RemindersHelper(binary), settings.list, ledger, { save, keepGoing: unchanged });
    if (!unchanged()) return;
    remindersImported += result.imported;
    const parts = [`${remindersImported} imported since start`];
    if (result.settling) parts.push(`${result.settling} waiting two minutes in case you're still editing`);
    if (result.keptForAlert) parts.push(`${result.keptForAlert} kept in Reminders for their alert`);
    if (result.failed) parts.push(`${result.failed} not ticked off yet`);
    remindersState = { ...settings, state: 'ok', detail: parts.join(' · '), lastSyncAt: new Date().toISOString() };
    if (result.settling) nextCheck = 30_000;
  } catch (error) {
    if (!unchanged()) return;
    const code = error instanceof RemindersError ? error.code : 'error';
    remindersState = {
      ...settings,
      state: code === 'denied' ? 'denied' : 'error',
      detail: error instanceof Error ? error.message : String(error),
      lastSyncAt: remindersState.lastSyncAt,
    };
    // Permission or list problems don't fix themselves within a minute.
    if (code === 'denied' || code === 'noList') nextCheck = 10 * 60_000;
  } finally {
    remindersBusy = false;
    if (!shuttingDown && store?.isOpen) {
      // Settings changed during the pass: show the current ones and check again right away.
      const current = remindersSettings();
      if (current.enabled !== settings.enabled || current.list !== settings.list) {
        remindersState = { ...current, state: current.enabled ? 'checking' : 'off', detail: current.enabled ? 'Checking…' : 'Off', lastSyncAt: remindersState.lastSyncAt };
        remindersRerun = current.enabled;
      }
      refresh();
      if (current.enabled) scheduleReminders(remindersRerun ? 0 : nextCheck);
      remindersRerun = false;
    }
  }
}
function syncInbox() {
  if (!brain || shuttingDown || !store?.isOpen) return;
  try {
    const counts = importInbox(store, brain.inbox);
    if (counts.rejected) console.warn(`Inbox: ${counts.rejected} file(s) rejected, see ${join(brain.inbox, 'rejected')}`);
    if (counts.created || counts.closed) refresh();
  } catch (error) {
    console.error('Inbox import failed:', error);
  }
}
// Exports reuse the task list the latest snapshot already read, so quitting can flush without touching SQLite.
function writeExport() {
  const tasks = pendingExport;
  pendingExport = null;
  if (!brain || !tasks) return;
  try { exportTasks(tasks, brain.exportDir); }
  catch (error) { console.error('Task export failed:', error); }
}
function scheduleExport(tasks: Task[]) {
  if (!brain) return;
  pendingExport = tasks;
  if (exportTimer) return;
  exportTimer = setTimeout(() => {
    exportTimer = null;
    if (!shuttingDown) writeExport();
  }, 2000);
}

// Legolas keeps its data in Application Support/Legolas. Earlier builds of this fork ran as Aegir.
app.setPath?.('userData', join(app.getPath('appData'), 'Legolas'));
function processAlive(lockDir: string) {
  try {
    const pid = Number(readlinkSync(join(lockDir, 'SingletonLock')).split('-').pop());
    if (!pid) return false;
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
// Moves the Aegir database over once. SQLite's backup API gives a consistent copy; it lands under a
// temporary name and is renamed into place only when complete, so a failed move retries next start.
// The Aegir folder is left untouched.
async function migrateFromAegir(): Promise<'none' | 'migrated' | 'busy'> {
  const currentDir = app.getPath('userData');
  const currentDb = join(currentDir, 'aegir.sqlite');
  const aegirDir = join(app.getPath('appData'), 'Aegir');
  const source = join(aegirDir, 'aegir.sqlite');
  if (existsSync(currentDb) || !existsSync(source)) return 'none';
  if (processAlive(aegirDir)) return 'busy';
  mkdirSync(currentDir, { recursive: true });
  const temp = `${currentDb}.migrating`;
  rmSync(temp, { force: true });
  const old = new Database(source, { readonly: true, fileMustExist: true });
  try { await old.backup(temp); } finally { old.close(); }
  if (existsSync(join(aegirDir, 'skills')) && !existsSync(join(currentDir, 'skills')))
    cpSync(join(aegirDir, 'skills'), join(currentDir, 'skills'), { recursive: true });
  renameSync(temp, currentDb);
  return 'migrated';
}
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
    agents: store.list('agents'),
    groups: store.groups(),
    threads: store.threadSummaries(),
    tasks: store.list('tasks'),
    taskLinks: store.taskLinks(),
    routines: store.routines(),
    routineRuns: store.routineRuns(),
    connectors: Object.values(connectors.states),
    approvals: [...approvals.values()],
    legacyMemoryCount: store.legacyMemoryCount(),
    memoryInstructions: store.getSetting('memoryInstructions') || '',
    codexStatus: codex.status,
    engine: engineNames[engine],
    memoryProvider: memory instanceof GbrainMemoryService ? 'gbrain' : 'Mnemosyne',
    reminders: remindersState,
    launchAtLogin: app.getLoginItemSettings().openAtLogin,
    browser: browser.state,
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
  const value = snapshot();
  emit({ type: 'snapshot', value });
  app.setBadgeCount(approvals.size);
  scheduleExport(value.tasks);
}
function approvalForExternal(detail: string, threadId: string | undefined, options?: { title: string; signal: AbortSignal; method?: string }): Promise<boolean> {
  if (options?.signal.aborted) return Promise.resolve(false);
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
  // The approval bar shows what is pending; the thread only records the decision (see resolve-approval).
  if (threadId) approvalThreads.set(id, threadId);
  notifyApproval(options?.title || 'An agent wants to write to an external system');
  return new Promise((resolve) => {
    const cancel = () => {
      externalApprovalResolvers.delete(id);
      approvals.delete(id);
      approvalThreads.delete(id);
      resolve(false);
      refresh();
    };
    externalApprovalResolvers.set(id, approved => {
      options?.signal.removeEventListener('abort', cancel);
      resolve(approved);
    });
    options?.signal.addEventListener('abort', cancel, { once: true });
    refresh();
  });
}
function registerIpc() {
  const documentRoot = (threadId: string) => {
    const thread = store.get('threads', threadId);
    if (!thread) throw new Error('This conversation no longer exists');
    return (thread.taskId && store.get('tasks', thread.taskId)?.outputDir) || app.getPath('userData');
  };
  const handle = (channel: string, fn: (...args: any[]) => unknown) =>
    ipcMain.handle(channel, async (_event, ...args) => {
      const result = await fn(...args);
      if (channel.startsWith('skill-') && !['skill-library', 'skill-detail', 'skill-revision-files'].includes(channel)) emit({ type: 'skills-changed' });
      return result;
    });
  handle('snapshot', () => snapshot());
  handle('browser-enabled', async (enabled: boolean) => {
    if (typeof enabled !== 'boolean') throw new Error('Invalid browser setting');
    store.setSetting('browserEnabled', String(enabled));
    await browser.setEnabled(enabled);
  });
  handle('browser-open', () => browser.open());
  handle('browser-stop', () => browser.stop());
  handle('document-list', (id: string) => listDocuments(documentRoot(id)));
  handle('document-read', (id: string, path: string) => readDocument(documentRoot(id), path));
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
  handle('thread-messages', (threadId: string, before?: string) =>
    store.messagePage(threadId, before),
  );
  handle('copy-chat-transcript', (threadId: string) => {
    clipboard.writeText(chatTranscript(store, threadId, runtime.skills.proposals()));
  });
  handle('create-group', (title: string, agentIds: string[]) => {
    const group = store.createGroup(title.trim() || 'New group', agentIds);
    refresh();
    return group;
  });
  handle('create-agent', (input: Pick<Agent, 'name' | 'role' | 'color' | 'instructions'>) => {
    store.createAgent(input);
    refresh();
  });
  handle('update-agent', (agent: Agent) => {
    store.updateAgent(agent);
    refresh();
  });
  handle('start-thread', (groupId: string, content: string) =>
    runtime.startThread(groupId, content),
  );
  handle('send-message', (threadId: string, content: string) =>
    runtime.sendMessage(threadId, content, false),
  );
  handle('stop-thread', (threadId: string) => runtime.stopThread(threadId));
  handle('close-thread', (threadId: string) => {
    store.setThreadStatus(threadId, 'closed');
    refresh();
  });
  handle(
    'create-task',
    (input: { title: string; notes?: string; label?: string | null; dueAt?: string | null }) => {
      const task = store.createTask(input, true);
      refresh();
      return task;
    },
  );
  handle('update-task', (id: string, change: TaskChange) => {
    const allowed: TaskChange = {};
    for (const key of ['title', 'notes', 'status', 'label', 'dueAt'] as const)
      if (key in change) (allowed as Record<string, unknown>)[key] = change[key];
    store.updateTask(id, allowed, true);
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
  handle('delete-routine', (routineId: string) => {
    if (runtime.isRoutineRunning(routineId)) throw new Error('Stop this routine before deleting it');
    store.deleteRoutine(routineId);
    refresh();
  });
  handle('resolve-routine-change', (messageId: string, apply: boolean) =>
    runtime.resolveRoutineChange(messageId, apply),
  );
  handle('run-events', (runId: string) => store.runEvents(runId));
  handle('resolve-approval', (id: string, approved: boolean) => {
    const threadId = approvalThreads.get(id);
    const approval = approvals.get(id);
    // Engine approvals go into the reply's folded steps; anything else is logged in the thread.
    const filed = !!approval?.threadId && runtime.recordApproval(approval.threadId, approval.title, approved);
    if (threadId && !filed) store.addMessage(threadId, null, 'system', `${approved ? 'Approved' : 'Declined'}: ${approval?.title || 'agent action'}`);
    if (threadId) approvalThreads.delete(id);
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
  handle('reminders-settings', (enabled: boolean, list: string) => {
    if (typeof enabled !== 'boolean') throw new Error('Invalid Reminders setting');
    const name = typeof list === 'string' ? list.trim() : '';
    if (!name || name.length > 100) throw new Error('Name the Reminders list to capture from');
    store.setSetting('remindersCapture', enabled ? 'on' : 'off');
    store.setSetting('remindersList', name);
    remindersState = { ...remindersState, enabled, list: name, state: enabled ? 'checking' : 'off', detail: enabled ? 'Checking…' : 'Off' };
    refresh();
    scheduleReminders(0);
  });
  handle('launch-at-login', (enabled: boolean) => {
    app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: true });
    refresh();
  });
  // Read-only mirror of the Claude app's scheduler; concurrent requests share one read.
  let claudeRead: Promise<unknown> | null = null;
  handle('claude-routines', () => claudeRead ||= readClaudeRoutines(join(homedir(), 'Library', 'Application Support', 'Claude', 'claude-code-sessions')).finally(() => { claudeRead = null; }));
  handle('open-external', (url: string) => {
    const safe = normalizeTaskLink(url);
    if (!safe) throw new Error('Invalid URL');
    return shell.openExternal(safe);
  });
}
function createWindow() {
  window = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 950,
    minHeight: 620,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 20 },
    backgroundColor: '#111116',
    show: !app.getLoginItemSettings().wasOpenedAsHidden,
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
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
      label: app.name,
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
  tray.setToolTip(app.name);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Open ${app.name}`, click: () => window?.show() },
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
    let moved: 'none' | 'migrated' | 'busy' = 'none';
    try { moved = await migrateFromAegir(); }
    catch (error) { dialog.showErrorBox('Could not move your tasks from Aegir', `${String(error)}\n\nYour Aegir data is untouched. Quit Legolas and open it again to retry.`); }
    if (moved === 'busy') {
      dialog.showMessageBoxSync({ type: 'info', message: 'Quit Aegir first', detail: 'Legolas moves your tasks over from Aegir the first time it opens. Quit Aegir from its menu-bar icon, then open Legolas again.' });
      app.exit(0);
      return;
    }
    migrateLegacyData();
    store = new Store();
    store.onMessage = (value) => emit({ type: 'message', value });
    const claudeBinary = findClaudeBinary(store.getSetting('claudeBinary'));
    engine = chooseEngine(store.getSetting('engine'), claudeBinary);
    const brainDir = process.env.AEGIR_BRAIN_DIR || store.getSetting('brainDir') || join(homedir(), 'brain');
    codex = engine === 'claude' && claudeBinary
      ? new ClaudeProvider(claudeBinary, { workDirs: existsSync(brainDir) ? [brainDir] : [], approvals: () => (store.getSetting('approvalMode') === 'ask' ? 'ask' : 'auto') })
      : new CodexProvider();
    if (!(codex instanceof ClaudeProvider)) engine = 'codex';
    // Seeded routines run hourly on the user's default model. On first start with Claude Code they
    // begin paused, so background runs only happen once the user switches them on in the sidebar.
    if (engine === 'claude' && !store.getSetting('claudeEngineSetup')) {
      for (const routine of store.routines()) store.updateRoutine(routine.id, { enabled: false });
      store.setSetting('claudeEngineSetup', 'true');
    }
    // Claude Code runs its own subagents, so a named team of four only confuses who does the work.
    if (engine === 'claude' && !store.getSetting('singleAgentSetup')) {
      store.focusSingleAgent('Claude');
      store.setSetting('singleAgentSetup', 'true');
    }
    connectors = new ConnectorManager(store);
    // The user's gbrain, when present: memory, the suggestion inbox and the task export live there.
    const gbrainBinary = findGbrainBinary(store.getSetting('gbrainBinary'));
    const useGbrain = store.getSetting('memoryProvider') !== 'mnemosyne' && !!gbrainBinary && existsSync(brainDir);
    memory = useGbrain ? new GbrainMemoryService(gbrainBinary!, brainDir) : new MemoryService(store);
    if (existsSync(brainDir)) {
      brain = {
        dir: brainDir,
        inbox: store.getSetting('inboxDir') || join(brainDir, 'queues', 'legolas-inbox'),
        exportDir: store.getSetting('exportDir') || join(brainDir, 'queues'),
      };
      mkdirSync(brain.inbox, { recursive: true });
    }
    browser = new BrowserManager(store.getSetting('browserEnabled') === 'true',
      () => createBrowserBackend(join(app.getPath('userData'), 'browser')),
      (threadId, detail, signal) => approvalForExternal(detail, threadId, { title: 'Browser control for this response', signal }), refresh);
    const outputRoot = join(app.getPath('documents'), 'Legolas');
    runtime = new Runtime(store, codex, connectors, memory, refresh, emit, {
      outputRoot,
      routineCwd: app.getPath('userData'),
    }, browser);
    codex.on('status', refresh);
    codex.on('approval', (approval: Approval) => {
      if (shuttingDown || !store.isOpen) return;
      const context = approval.threadId ? runtime.contextFor(approval.threadId) : undefined;
      // Routines run unattended; anything that needs approval is declined and left in the run log.
      if (context?.kind === 'routine') {
        codex.resolveApproval(approval.id, false);
        return;
      }
      approvals.set(approval.id, approval);
      if (context?.threadId) approvalThreads.set(approval.id, context.threadId);
      notifyApproval(approval.title);
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
        if (!readOnly)
          await approveExternalWrite(
            { signal: runtime.runSignal(codexThreadId), isCurrent: () => !!context && runtime.contextFor(codexThreadId) === context },
            (signal) => approvalForExternal(
              `${provider}: ${tool}\n${JSON.stringify(args, null, 2)}\nGrant: this one write only`,
              context?.threadId,
              { title: `Write to ${provider}`, signal, method: 'external-write' },
            ),
          );
        if (shuttingDown || !store.isOpen) throw new Error('App is shutting down');
        const result = await connectors.call(provider, tool, args);
        runtime.logToolResult(codexThreadId, result);
        return result;
      } catch (error) {
        runtime.logToolResult(codexThreadId, String(error), true);
        throw error;
      }
    });
    connectors.on('change', refresh);
    registerIpc();
    createWindow();
    createApplicationMenu();
    createTray();
    connectors.start();
    runtime.start();
    remindersState = { ...remindersSettings(), state: remindersSettings().enabled ? 'checking' : 'off', detail: remindersSettings().enabled ? 'Checking…' : 'Off', lastSyncAt: null };
    if (remindersSettings().enabled) scheduleReminders(3000);
    if (brain) {
      syncInbox();
      inboxTimer = setInterval(syncInbox, 30_000);
    }
    void memory
      .migrateLegacy()
      .then(() => {
        if (store.isOpen) refresh();
      })
      .catch((error) => {
        console.error('Memory migration failed:', error);
        if (store.isOpen) refresh();
      });
    if (app.isPackaged && !store.getSetting('legolasLoginConfigured')) {
      app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true });
      store.setSetting('legolasLoginConfigured', 'true');
      refresh();
    }
    powerMonitor.on('resume', () => {
      if (shuttingDown || !store?.isOpen) return;
      runtime.tick();
      if (remindersSettings().enabled) scheduleReminders(5000);
    });
    if (process.platform === 'darwin' && !app.isPackaged) app.dock?.show();
    void codex.start().catch((error) => {
      codex.status = `Error: ${String(error)}`;
      refresh();
    });
  });
  app.on('before-quit', (event) => {
    if (shuttingDown) return;
    event?.preventDefault();
    shuttingDown = true;
    if (inboxTimer) clearInterval(inboxTimer);
    if (remindersTimer) clearTimeout(remindersTimer);
    if (exportTimer) {
      clearTimeout(exportTimer);
      writeExport(); // the brain copy should match what the user last saw
    }
    for (const resolve of externalApprovalResolvers.values()) resolve(false);
    externalApprovalResolvers.clear();
    (app as typeof app & { isQuitting?: boolean }).isQuitting = true;
    runtime?.stop();
    const browserClosed = browser?.close();
    connectors?.close();
    codex?.close();
    store?.close();
    if (event) void browserClosed?.finally(() => app.quit());
  });
  app.on('activate', () => window?.show());
} else app.quit();
