import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  powerMonitor,
  shell,
  Tray,
} from 'electron';
import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, lstatSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Agent, AppEvent, Approval, Snapshot, TaskChange } from '../shared/types.js';
import { normalizeTaskLink } from '../shared/task-links.js';
import { CodexProvider } from './codex.js';
import { ConnectorManager } from './connectors.js';
import { Store } from './db.js';
import { MemoryService } from './memory.js';
import { Runtime } from './runtime.js';
import { readPackage, fileBytes, parseSkill } from './skill-package.js';
import type { SkillCreate, SkillFile, SkillSettings } from '../shared/skills.js';

const here = dirname(fileURLToPath(import.meta.url));
let window: BrowserWindow | null = null;
let tray: Tray | null = null;
let store: Store;
let codex: CodexProvider;
let connectors: ConnectorManager;
let memory: MemoryService;
let runtime: Runtime;
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
    launchAtLogin: app.getLoginItemSettings().openAtLogin,
    mcpSettings: {
      slackClientId: store.getSetting('slackClientId') || '',
      slackConfigured: connectors.slackConfigured(),
    },
  };
}
function emit(event: AppEvent) {
  if (window && !window.isDestroyed()) window.webContents.send('app-event', event);
}
function refresh() {
  emit({ type: 'snapshot', value: snapshot() });
}
function approvalForExternal(detail: string, threadId: string | undefined): Promise<boolean> {
  const id = randomUUID();
  approvals.set(id, {
    id,
    method: 'external-write',
    title: 'External write',
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
      'An agent wants to write to an external system. Review the approval.',
    );
    approvalThreads.set(id, threadId);
  }
  refresh();
  return new Promise((resolve) => externalApprovalResolvers.set(id, resolve));
}
function registerIpc() {
  const handle = (channel: string, fn: (...args: any[]) => unknown) =>
    ipcMain.handle(channel, async (_event, ...args) => {
      const result = await fn(...args);
      if (channel.startsWith('skill-') && !['skill-library', 'skill-detail', 'skill-revision-files'].includes(channel)) emit({ type: 'skills-changed' });
      return result;
    });
  handle('snapshot', () => snapshot());
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
    runtime.sendMessage(threadId, content),
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
    async (provider: 'slack' | 'notion', clientId?: string, clientSecret?: string) => {
      if (provider === 'slack' && clientId) store.setSetting('slackClientId', clientId);
      await connectors.connect(provider, clientId, clientSecret);
      refresh();
    },
  );
  handle('disconnect', async (provider: 'slack' | 'notion') => {
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
    app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: true });
    refresh();
  });
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
      label: 'Ägir',
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
  tray.setToolTip('Ägir');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Ägir', click: () => window?.show() },
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
    store = new Store();
    store.onMessage = (value) => emit({ type: 'message', value });
    codex = new CodexProvider();
    connectors = new ConnectorManager(store);
    memory = new MemoryService(store);
    const outputRoot = join(app.getPath('documents'), 'Ägir');
    runtime = new Runtime(store, codex, connectors, memory, refresh, emit, {
      outputRoot,
      routineCwd: app.getPath('userData'),
    });
    codex.on('status', refresh);
    codex.on('approval', (approval: Approval) => {
      const context = approval.threadId ? runtime.contextFor(approval.threadId) : undefined;
      // Routines run unattended; anything that needs approval is declined and left in the run log.
      if (context?.kind === 'routine') {
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
      runtime.logToolCall(codexThreadId, `${provider}.${tool}`, args);
      try {
        const internal = await runtime.handleInternalTool(provider, tool, args, codexThreadId);
        if (internal !== undefined) {
          runtime.logToolResult(codexThreadId, internal);
          return internal;
        }
        if (provider !== 'slack' && provider !== 'notion') throw new Error('Unknown tool');
        const context = runtime.contextFor(codexThreadId);
        // Tasks and routines only receive read-only tools; this is the backstop if one is called anyway.
        if (!readOnly && context && context.kind !== 'chat')
          throw new Error('Handed-off tasks and routines cannot write to external systems');
        if (
          !readOnly &&
          !(await approvalForExternal(
            `${provider}: ${tool}\n${JSON.stringify(args, null, 2)}`,
            context?.threadId,
          ))
        )
          throw new Error('External write declined');
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
    connectors.start();
    runtime.start();
    createWindow();
    createApplicationMenu();
    createTray();
    void memory
      .migrateLegacy()
      .then(() => {
        if (store.isOpen) refresh();
      })
      .catch((error) => {
        console.error('Memory migration failed:', error);
        if (store.isOpen) refresh();
      });
    if (app.isPackaged && !store.getSetting('loginConfigured')) {
      app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true });
      store.setSetting('loginConfigured', 'true');
      refresh();
    }
    powerMonitor.on('resume', () => runtime.tick());
    if (process.platform === 'darwin' && !app.isPackaged) app.dock?.show();
    void codex.start().catch((error) => {
      codex.status = `Error: ${String(error)}`;
      refresh();
    });
  });
  app.on('before-quit', () => {
    (app as typeof app & { isQuitting?: boolean }).isQuitting = true;
    runtime?.stop();
    connectors?.close();
    codex?.close();
    store?.close();
  });
  app.on('activate', () => window?.show());
} else app.quit();
