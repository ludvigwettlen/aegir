import { app, BrowserWindow, ipcMain, Menu, nativeImage, powerMonitor, shell, Tray } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import type { Agent, Approval, AppEvent, Scan, Snapshot, Task } from '../shared/types.js';
import { Store } from './db.js';
import { CodexProvider } from './codex.js';
import { ConnectorManager } from './connectors.js';
import { MemoryService } from './memory.js';
import { Reviewer } from './reviewer.js';
import { skillsFor } from './skills.js';

const here = dirname(fileURLToPath(import.meta.url));
let window: BrowserWindow | null = null;
let tray: Tray | null = null;
let store: Store;
let codex: CodexProvider;
let connectors: ConnectorManager;
let memory: MemoryService;
let reviewer: Reviewer;
const approvals = new Map<string, Approval>();
const externalApprovalResolvers = new Map<string, (value: boolean) => void>();
const activeRoomThreads = new Map<string, string>();
const approvalRooms = new Map<string, string>();
let cwd: string;

function snapshot(): Snapshot {
  return {
    agents: store.list('agents'), rooms: store.list('rooms'), messages: store.list('messages'), tasks: store.list('tasks'), goals: store.list('goals'), scans: store.list<Scan>('scans').slice(0, 60),
    connectors: Object.values(connectors.states), approvals: [...approvals.values()], memories: store.list('memories'),
    memoryInstructions: store.getSetting('memoryInstructions') || '', codexStatus: codex.status, launchAtLogin: app.getLoginItemSettings().openAtLogin,
    mcpSettings: { slackClientId: store.getSetting('slackClientId') || '', slackConfigured: connectors.slackConfigured() }
  };
}
function emit(event: AppEvent) { if (window && !window.isDestroyed()) window.webContents.send('app-event', event); }
function refresh() { emit({ type: 'snapshot', value: snapshot() }); }
function approvalForExternal(detail: string): Promise<boolean> {
  const id = randomUUID();
  approvals.set(id, { id, method: 'external-write', title: 'External write', detail, agentId: null, createdAt: new Date().toISOString() }); refresh();
  return new Promise(resolve => externalApprovalResolvers.set(id, resolve));
}
function agentForText(text: string, roomLead: string): Agent[] {
  const agents = store.list<Agent>('agents');
  const mentioned = agents.filter(agent => new RegExp(`@${agent.name}\\b`, 'i').test(text));
  return mentioned.length ? mentioned : agents.filter(agent => agent.id === roomLead);
}
function memoryTool(agent: Agent) {
  return { name: `memory__remember_${agent.id.replace(/-/g, '_')}`, description: 'Save one durable user or project memory. Choose shared for facts useful to all agents, private for your own working context. Follow the workspace memory guidance and never store secrets or guesses.', inputSchema: { type: 'object', properties: { content: { type: 'string' }, scope: { type: 'string', enum: ['shared', 'private'] }, sourceUrl: { type: 'string' } }, required: ['content', 'scope'] }, readOnly: false };
}
async function runAgent(roomId: string, agent: Agent, userText: string, depth = 0) {
  const message = store.addMessage(roomId, agent.id, 'agent', '', 'streaming'); refresh();
  const roomHistory = store.messagesForRoom(roomId).slice(-16).filter(x => x.id !== message.id).map(x => `${x.role === 'agent' ? store.get<Agent>('agents', x.agentId || '')?.name || 'Agent' : 'User'}: ${x.content}`).join('\n');
  const recalled = await memory.recall(userText.slice(0, 120), agent.id);
  const instructions = `${agent.instructions}\nYou are ${agent.name} (${agent.role}) in a room with other named agents. Address the user directly. If a specialist should contribute, mention them as @Name in your final reply. Be clear about source links and tool failures. Use connected tools for Slack and Notion. Select durable facts to save using your memory tool. Memory guidance: ${store.getSetting('memoryInstructions') || ''}\n${skillsFor(userText)}`;
  let streamed = '';
  try {
    const result = await codex.run({ cwd, instructions, prompt: `Relevant memory:\n${recalled || '(none)'}\n\nRecent room transcript:\n${roomHistory}\n\nCurrent request:\n${userText}`, tools: [...connectors.listTools(), memoryTool(agent)], onThreadStarted: threadId => activeRoomThreads.set(roomId, threadId), onDelta: delta => { streamed += delta; store.updateMessage(message.id, streamed, 'streaming'); emit({ type: 'message-delta', roomId, messageId: message.id, delta }); } });
    store.updateMessage(message.id, result.text || streamed, result.status === 'completed' ? 'complete' : 'failed'); refresh();
    if (depth === 0 && result.status === 'completed') {
      const next = store.list<Agent>('agents').find(other => other.id !== agent.id && new RegExp(`@${other.name}\\b`, 'i').test(result.text));
      if (next) { store.addMessage(roomId, null, 'system', `${agent.name} handed off to ${next.name}.`); refresh(); await runAgent(roomId, next, `Please contribute to the discussion. ${agent.name} said:\n${result.text}`, 1); }
    }
  } catch (error) { store.updateMessage(message.id, streamed ? `${streamed}\n\n${String(error)}` : String(error), 'failed'); refresh(); }
  finally { activeRoomThreads.delete(roomId); }
}
async function startGoal(taskId: string, agentId: string) {
  const task = store.get<Task>('tasks', taskId); const agent = store.get<Agent>('agents', agentId);
  if (!task || !agent) throw new Error('Select a task and agent');
  if (task.status === 'running') throw new Error('This goal is already running');
  const goal = store.createGoal(taskId, agentId); refresh();
  try {
    const instructions = `${agent.instructions}\nYou are working on an assigned goal. Act on local files and connected tools as needed. Report what you changed, what remains, and any blockers. Ask for approval before deletion, credential access, app automation, or external writes. Save durable facts using your memory tool. Memory guidance: ${store.getSetting('memoryInstructions') || ''}\n${skillsFor(`${task.title} ${task.notes}`, true)}`;
    let streamed = '';
    const result = await codex.run({ cwd, instructions, prompt: `Goal: ${task.title}\n${task.notes}\nSource: ${task.sourceUrl || '(none)'}`, tools: [...connectors.listTools(), memoryTool(agent)], onThreadStarted: threadId => { store.updateGoal(goal.id, 'running', '', threadId); refresh(); }, onDelta: delta => { streamed += delta; store.updateGoal(goal.id, 'running', streamed); refresh(); } });
    const status = result.status === 'completed' ? 'done' : 'blocked';
    store.updateGoal(goal.id, status, result.text, result.threadId);
    store.updateTask(taskId, { status });
  } catch (error) { store.updateGoal(goal.id, 'failed', String(error)); store.updateTask(taskId, { status: 'blocked' }); }
  refresh();
}
function registerIpc() {
  ipcMain.handle('snapshot', () => snapshot());
  ipcMain.handle('create-room', (_e, title: string, lead: string) => { store.createRoom(title.trim() || 'New room', lead); refresh(); });
  ipcMain.handle('create-agent', (_e, input: Pick<Agent,'name'|'role'|'color'|'instructions'>) => { store.createAgent(input); refresh(); });
  ipcMain.handle('update-agent', (_e, agent: Agent) => { store.updateAgent(agent); refresh(); });
  ipcMain.handle('send-message', async (_e, roomId: string, content: string) => {
    const room = store.get<{ id: string; leadAgentId: string }>('rooms', roomId); if (!room) throw new Error('Room not found');
    const text = content.trim(); if (!text) return;
    store.addMessage(roomId, null, 'user', text); refresh();
    if (text.startsWith('/goal ')) { const task = store.createTask(text.slice(6).trim()); refresh(); await startGoal(task.id, room.leadAgentId); return; }
    for (const agent of agentForText(text, room.leadAgentId)) await runAgent(roomId, agent, text);
  });
  ipcMain.handle('stop-room', async (_e, roomId: string) => { const threadId = activeRoomThreads.get(roomId); if (threadId) await codex.stop(threadId); });
  ipcMain.handle('create-task', (_e, title: string, notes: string) => { store.createTask(title.trim(), notes.trim()); refresh(); });
  ipcMain.handle('update-task', (_e, id: string, change: Partial<Task>) => { store.updateTask(id, change); refresh(); });
  ipcMain.handle('start-goal', (_e, id: string, agentId: string) => startGoal(id, agentId));
  ipcMain.handle('stop-goal', async (_e, taskId: string) => { const goal = store.list<{ taskId: string; status: string; threadId: string | null }>('goals').find(x => x.taskId === taskId && ['running','awaiting_approval'].includes(x.status)); if (goal?.threadId) await codex.stop(goal.threadId); });
  ipcMain.handle('resolve-approval', (_e, id: string, approved: boolean) => {
    const roomId = approvalRooms.get(id); if (roomId) { store.addMessage(roomId, null, 'system', `Approval ${approved ? 'granted' : 'declined'}.`); approvalRooms.delete(id); }
    if (externalApprovalResolvers.has(id)) { externalApprovalResolvers.get(id)!(approved); externalApprovalResolvers.delete(id); }
    else codex.resolveApproval(id, approved);
    approvals.delete(id); refresh();
  });
  ipcMain.handle('connect', async (_e, provider: 'slack'|'notion', clientId?: string, clientSecret?: string) => { if (provider === 'slack' && clientId) store.setSetting('slackClientId', clientId); await connectors.connect(provider, clientId, clientSecret); refresh(); });
  ipcMain.handle('disconnect', async (_e, provider: 'slack'|'notion') => { await connectors.disconnect(provider); refresh(); });
  ipcMain.handle('run-review', () => reviewer.run());
  ipcMain.handle('memory-instructions', (_e, value: string) => { store.setSetting('memoryInstructions', value); refresh(); });
  ipcMain.handle('forget-memory', async (_e, id: string) => { await memory.forget(id); refresh(); });
  ipcMain.handle('correct-memory', async (_e, id: string, content: string) => { await memory.correct(id, content); refresh(); });
  ipcMain.handle('launch-at-login', (_e, enabled: boolean) => { app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: true }); refresh(); });
  ipcMain.handle('open-external', (_e, url: string) => { if (!/^https?:\/\//.test(url)) throw new Error('Invalid URL'); return shell.openExternal(url); });
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
  tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Open Agent Desk', click: () => window?.show() }, { label: 'Review now', click: () => void reviewer.run() }, { type: 'separator' }, { label: 'Quit', click: () => { (app as typeof app & { isQuitting?: boolean }).isQuitting = true; app.quit(); } }]));
  tray.on('double-click', () => window?.show());
}
if (app.requestSingleInstanceLock()) {
  app.on('second-instance', () => { window?.show(); window?.focus(); });
  app.whenReady().then(async () => {
    cwd = app.getPath('home'); store = new Store(); codex = new CodexProvider(); connectors = new ConnectorManager(store); memory = new MemoryService(store); reviewer = new Reviewer(store, connectors, codex, memory, cwd);
    codex.on('status', refresh); codex.on('approval', (approval: Approval) => { approvals.set(approval.id, approval); const roomId = [...activeRoomThreads].find(([, threadId]) => threadId === approval.threadId)?.[0]; if (roomId) { store.addMessage(roomId, null, 'system', `${approval.title} requested. Review the approval dock.`); approvalRooms.set(approval.id, roomId); } const goal = store.list<{ id: string; threadId: string }>('goals').find(x => x.threadId === approval.threadId); if (goal) store.updateGoal(goal.id, 'awaiting_approval', `${approval.title} requested`); refresh(); }); codex.on('approval-resolved', (id: string) => { approvals.delete(id); refresh(); });
    codex.setToolHandler(async (provider, tool, args, readOnly) => {
      if (provider === 'memory') {
        const match = tool.match(/^remember_([0-9a-f_]+)$/i); if (!match) throw new Error('Unknown memory tool');
        const agentId = match[1].replace(/_/g, '-'); if (!store.get<Agent>('agents', agentId)) throw new Error('Unknown agent');
        const scope = args.scope === 'private' ? `agent-${agentId}` : 'shared';
        const result = await memory.remember(scope, String(args.content || ''), typeof args.sourceUrl === 'string' && /^https?:\/\//.test(args.sourceUrl) ? args.sourceUrl : null); refresh(); return { id: result?.id, saved: true };
      }
      if (provider !== 'slack' && provider !== 'notion') throw new Error('Unknown connector');
      if (!readOnly && !(await approvalForExternal(`${provider}: ${tool}\n${JSON.stringify(args, null, 2)}`))) throw new Error('External write declined');
      return connectors.call(provider, tool, args);
    });
    connectors.on('change', () => { refresh(); if (Object.values(connectors.states).some(x => x.status === 'connected')) void reviewer.run(); });
    reviewer.on('change', refresh); registerIpc(); connectors.start(); reviewer.start(); createWindow(); createTray();
    if (app.isPackaged && !store.getSetting('loginConfigured')) { app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true }); store.setSetting('loginConfigured', 'true'); refresh(); }
    powerMonitor.on('resume', () => void reviewer.run());
    if (process.platform === 'darwin' && !app.isPackaged) app.dock?.show();
    void codex.start().catch(error => { codex.status = `Error: ${String(error)}`; refresh(); });
  });
  app.on('before-quit', () => { (app as typeof app & { isQuitting?: boolean }).isQuitting = true; reviewer?.stop(); connectors?.close(); codex?.close(); store?.close(); });
  app.on('activate', () => window?.show());
} else app.quit();
