import { app, BrowserWindow, ipcMain, Menu, nativeImage, powerMonitor, shell, Tray } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import type { Agent, Approval, AppEvent, Snapshot, Task, TaskChange } from '../shared/types.js';
import { Store } from './db.js';
import { CodexProvider } from './codex.js';
import { ConnectorManager } from './connectors.js';
import { MemoryService } from './memory.js';
import { Runtime } from './runtime.js';

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

function snapshot(): Snapshot {
  return {
    agents: store.list('agents'), groups: store.groups(), threads: store.threads(), messages: store.messages(), tasks: store.list('tasks'),
    routines: store.routines(), routineRuns: store.routineRuns(),
    connectors: Object.values(connectors.states), approvals: [...approvals.values()], memories: store.list('memories'),
    memoryInstructions: store.getSetting('memoryInstructions') || '', codexStatus: codex.status, launchAtLogin: app.getLoginItemSettings().openAtLogin,
    mcpSettings: { slackClientId: store.getSetting('slackClientId') || '', slackConfigured: connectors.slackConfigured() }
  };
}
function emit(event: AppEvent) { if (window && !window.isDestroyed()) window.webContents.send('app-event', event); }
function refresh() { emit({ type: 'snapshot', value: snapshot() }); }
function approvalForExternal(detail: string, threadId: string | undefined): Promise<boolean> {
  const id = randomUUID();
  approvals.set(id, { id, method: 'external-write', title: 'External write', detail, agentId: null, threadId, createdAt: new Date().toISOString() });
  if (threadId) { store.addMessage(threadId, null, 'system', 'An agent wants to write to an external system. Review the approval.'); approvalThreads.set(id, threadId); }
  refresh();
  return new Promise(resolve => externalApprovalResolvers.set(id, resolve));
}
function registerIpc() {
  const handle = (channel: string, fn: (...args: any[]) => unknown) => ipcMain.handle(channel, (_event, ...args) => fn(...args));
  handle('snapshot', () => snapshot());
  handle('create-group', (title: string, agentIds: string[]) => { const group = store.createGroup(title.trim() || 'New group', agentIds); refresh(); return group; });
  handle('create-agent', (input: Pick<Agent,'name'|'role'|'color'|'instructions'>) => { store.createAgent(input); refresh(); });
  handle('update-agent', (agent: Agent) => { store.updateAgent(agent); refresh(); });
  handle('start-thread', (groupId: string, content: string) => runtime.startThread(groupId, content));
  handle('send-message', (threadId: string, content: string) => runtime.sendMessage(threadId, content));
  handle('stop-thread', (threadId: string) => runtime.stopThread(threadId));
  handle('close-thread', (threadId: string) => { store.setThreadStatus(threadId, 'closed'); refresh(); });
  handle('create-task', (input: { title: string; notes?: string; label?: string | null; dueAt?: string | null }) => { const task = store.createTask(input); refresh(); return task; });
  handle('update-task', (id: string, change: TaskChange) => {
    const allowed: TaskChange = {}; for (const key of ['title', 'notes', 'status', 'label', 'dueAt'] as const) if (key in change) (allowed as Record<string, unknown>)[key] = change[key];
    store.updateTask(id, allowed); refresh();
  });
  handle('hand-off', (taskId: string, instruction: string) => { void runtime.handOff(taskId, instruction).catch(error => { store.updateTask(taskId, { status: 'blocked' }); refresh(); console.error(error); }); });
  handle('stop-task', (taskId: string) => runtime.stopTask(taskId));
  handle('open-task-output', async (taskId: string) => { const dir = store.get<Task>('tasks', taskId)?.outputDir; if (!dir) throw new Error('This task has no output folder yet'); const error = await shell.openPath(dir); if (error) throw new Error(error); });
  handle('run-routine', (routineId: string) => { void runtime.runRoutine(routineId, 'manual').catch(console.error); });
  handle('set-routine-enabled', (routineId: string, enabled: boolean) => { store.updateRoutine(routineId, { enabled }); refresh(); });
  handle('resolve-routine-change', (messageId: string, apply: boolean) => runtime.resolveRoutineChange(messageId, apply));
  handle('run-events', (runId: string) => store.runEvents(runId));
  handle('resolve-approval', (id: string, approved: boolean) => {
    const threadId = approvalThreads.get(id); if (threadId) { store.addMessage(threadId, null, 'system', `Approval ${approved ? 'granted' : 'declined'}.`); approvalThreads.delete(id); }
    if (externalApprovalResolvers.has(id)) { externalApprovalResolvers.get(id)!(approved); externalApprovalResolvers.delete(id); }
    else codex.resolveApproval(id, approved);
    approvals.delete(id); refresh();
  });
  handle('connect', async (provider: 'slack'|'notion', clientId?: string, clientSecret?: string) => { if (provider === 'slack' && clientId) store.setSetting('slackClientId', clientId); await connectors.connect(provider, clientId, clientSecret); refresh(); });
  handle('disconnect', async (provider: 'slack'|'notion') => { await connectors.disconnect(provider); refresh(); });
  handle('memory-instructions', (value: string) => { store.setSetting('memoryInstructions', value); refresh(); });
  handle('forget-memory', async (id: string) => { await memory.forget(id); refresh(); });
  handle('correct-memory', async (id: string, content: string) => { await memory.correct(id, content); refresh(); });
  handle('launch-at-login', (enabled: boolean) => { app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: true }); refresh(); });
  handle('open-external', (url: string) => { if (!/^https?:\/\//.test(url)) throw new Error('Invalid URL'); return shell.openExternal(url); });
}
function createWindow() {
  window = new BrowserWindow({ width: 1400, height: 900, minWidth: 950, minHeight: 620, titleBarStyle: 'hiddenInset', backgroundColor: '#111116', show: !app.getLoginItemSettings().wasOpenedAsHidden, webPreferences: { preload: join(here, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: false } });
  if (process.env.VITE_DEV_SERVER_URL) void window.loadURL(process.env.VITE_DEV_SERVER_URL);
  else void window.loadFile(join(here, '../dist/index.html'));
  window.webContents.on('console-message', (_event, level, message) => { console.log(`[renderer:${level}] ${message}`); });
  window.webContents.on('did-fail-load', (_event, code, description, url) => { console.error(`Renderer load failed (${code}): ${description} ${url}`); });
  window.on('close', event => { if (!(app as typeof app & { isQuitting?: boolean }).isQuitting) { event.preventDefault(); window?.hide(); } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('did-finish-load', refresh);
}
function createTray() {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18"><path fill="#111" d="M9 1 16 5v8l-7 4-7-4V5zm0 3L5 6v5l4 2 4-2V6z"/></svg>';
  tray = new Tray(nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`));
  tray.setToolTip('Agent Desk');
  tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Open Agent Desk', click: () => window?.show() }, { type: 'separator' }, { label: 'Quit', click: () => { (app as typeof app & { isQuitting?: boolean }).isQuitting = true; app.quit(); } }]));
  tray.on('double-click', () => window?.show());
}
if (app.requestSingleInstanceLock()) {
  app.on('second-instance', () => { window?.show(); window?.focus(); });
  app.whenReady().then(async () => {
    store = new Store(); codex = new CodexProvider(); connectors = new ConnectorManager(store); memory = new MemoryService(store);
    const outputRoot = join(app.getPath('documents'), 'Agent Desk');
    runtime = new Runtime(store, codex, connectors, memory, refresh, emit, { outputRoot, routineCwd: app.getPath('userData') });
    codex.on('status', refresh);
    codex.on('approval', (approval: Approval) => {
      const context = approval.threadId ? runtime.contextFor(approval.threadId) : undefined;
      // Routines run unattended; anything that needs approval is declined and left in the run log.
      if (context?.kind === 'routine') { codex.resolveApproval(approval.id, false); return; }
      approvals.set(approval.id, approval);
      if (context?.threadId) { store.addMessage(context.threadId, null, 'system', `${approval.title} requested. Review the approval.`); approvalThreads.set(approval.id, context.threadId); }
      refresh();
    });
    codex.on('approval-resolved', (id: string) => { approvals.delete(id); refresh(); });
    codex.setToolHandler(async (provider, tool, args, readOnly, codexThreadId) => {
      runtime.logToolCall(codexThreadId, `${provider}.${tool}`, args);
      try {
        const internal = await runtime.handleInternalTool(provider, tool, args, codexThreadId);
        if (internal !== undefined) { runtime.logToolResult(codexThreadId, internal); return internal; }
        if (provider !== 'slack' && provider !== 'notion') throw new Error('Unknown tool');
        const context = runtime.contextFor(codexThreadId);
        // Tasks and routines only receive read-only tools; this is the backstop if one is called anyway.
        if (!readOnly && context && context.kind !== 'chat') throw new Error('Handed-off tasks and routines cannot write to external systems');
        if (!readOnly && !(await approvalForExternal(`${provider}: ${tool}\n${JSON.stringify(args, null, 2)}`, context?.threadId))) throw new Error('External write declined');
        const result = await connectors.call(provider, tool, args);
        runtime.logToolResult(codexThreadId, result);
        return result;
      } catch (error) { runtime.logToolResult(codexThreadId, String(error), true); throw error; }
    });
    connectors.on('change', refresh);
    registerIpc(); connectors.start(); runtime.start(); createWindow(); createTray();
    if (app.isPackaged && !store.getSetting('loginConfigured')) { app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true }); store.setSetting('loginConfigured', 'true'); refresh(); }
    powerMonitor.on('resume', () => runtime.tick());
    if (process.platform === 'darwin' && !app.isPackaged) app.dock?.show();
    void codex.start().catch(error => { codex.status = `Error: ${String(error)}`; refresh(); });
  });
  app.on('before-quit', () => { (app as typeof app & { isQuitting?: boolean }).isQuitting = true; runtime?.stop(); connectors?.close(); codex?.close(); store?.close(); });
  app.on('activate', () => window?.show());
} else app.quit();
