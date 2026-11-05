import { app, BrowserWindow, Menu, nativeImage, nativeTheme, powerMonitor, shell, Tray, safeStorage, dialog } from 'electron';
import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readProviderSetup, type ProviderSetup } from '../shared/provider-setup.js';
import type { AppEvent, Approval, Snapshot } from '../shared/types.js';
import { readTypography } from '../shared/typography.js';
import { createBrowserBackend } from './browser-backend.js';
import { BrowserManager } from './browser.js';
import { ClaudeProvider } from './claude.js';
import { CodexProvider } from './codex.js';
import { ConnectorManager } from './connectors.js';
import { Store } from './db.js';
import { EngineRouter, findClaudeBinary } from './engine.js';
import { findGbrainBinary, GbrainMemoryService } from './gbrain-memory.js';
import { registerIpc, activeIpcCount } from './ipc.js';
import { UpdateService } from './updates.js';
import { prepareInstallation, startupTransaction, pendingInstallation, launchRecovery, confirmStartup, type Installation } from './update-install.js';
import updateConfiguration from '../config/updates.json';
import { writeFile } from 'node:fs/promises';
import { MemoryRouter } from './memory-provider.js';
import { MemoryService } from './memory.js';
import { initializeOnboarding, OnboardingService } from './onboarding.js';
import { PhoneCapture } from './phone-capture.js';
import { findRemindersHelper } from './reminders.js';
import { createRuntimeServices } from './runtime-services.js';
import { Runtime } from './runtime.js';
import { createToolDispatcher } from './tool-dispatch.js';
import { windowLook } from './window-look.js';

const profileArgument = process.argv.find(argument => argument.startsWith('--user-data-dir='));
if (profileArgument) app.setPath('userData', resolve(profileArgument.slice('--user-data-dir='.length)));

const here = dirname(fileURLToPath(import.meta.url));
const rendererUrl = process.env.VITE_DEV_SERVER_URL || pathToFileURL(join(here, '../dist/index.html')).href;
let window: BrowserWindow | null = null;
let tray: Tray | null = null;
let store: Store;
let codex: EngineRouter;
let connectors: ConnectorManager;
let memory: MemoryRouter;
let runtime: Runtime;
let phoneCapture: PhoneCapture;
let phoneTimer: NodeJS.Timeout | undefined;
let browser: BrowserManager;
let onboarding: OnboardingService;
let shuttingDown = false;
let updateBarrier = false;
let updates: UpdateService;
let updateRequest: Installation | undefined;
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
    updates: updates ? { ...updates.state(), ...(updateBarrier ? { status: 'installing' as const, message: 'Finishing the update. Please wait…' } : {}) } : undefined,
    reminders: phoneCapture?.state(),
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
      sandbox: true,
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
    const updateTokenIndex = process.argv.indexOf('--aegir-update-token');
    const startupUpdate = startupTransaction(app.getPath('userData'), updateTokenIndex >= 0 ? process.argv[updateTokenIndex + 1] : undefined);
    if (startupUpdate) await writeFile(join(startupUpdate.root, 'started.json'), JSON.stringify({ token: startupUpdate.token, pid: process.pid, executable: realpathSync(app.getPath('exe')) }), { mode: 0o600 });
    const pendingUpdate = pendingInstallation(app.getPath('userData'));
    if (!startupUpdate && pendingUpdate && !pendingUpdate.healthy &&
      (existsSync(pendingUpdate.request.target + '.aegir-update-old') || existsSync(pendingUpdate.request.target + '.aegir-update-new'))) {
      const choice = await dialog.showMessageBox({ type: 'warning', message: 'An Aegir update was interrupted', detail: 'Recover before opening your workspace. If replacement had started, recovery restores the pre-update app and database.', buttons: ['Recover and reopen', 'Quit'], defaultId: 0, cancelId: 1 });
      if (choice.response === 0) {
        try { await launchRecovery(pendingUpdate.request); } catch (error) { dialog.showErrorBox('Recovery paused', error instanceof Error ? error.message : 'Backups retained.'); }
      }
      app.exit(0); return;
    }
    updateBarrier = !!startupUpdate;
    if (startupUpdate && startupUpdate.version !== app.getVersion()) throw new Error('Update startup version mismatch.');
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
    }, createRuntimeServices(store, codex, refresh, app.getPath('userData')), browser);
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
    codex.setToolHandler(createToolDispatcher({ store, runtime, connectors, isShuttingDown: () => shuttingDown, approvalForExternal }));
    connectors.on('change', refresh);
    const updateActive = () => !!(phoneCapture?.hasActiveWork || runtime.hasActiveWork || codex.hasActiveWork || memory.hasActiveWork || approvals.size || onboarding.hasActiveWork || runtime.brainBridge.hasActiveWork || ['working', 'opening', 'approval'].includes(browser.state.status) || activeIpcCount() > 1);
    updates = new UpdateService({ ...updateConfiguration, version: app.getVersion(), initialMessage: pendingUpdate?.result?.message, architecture: process.arch,
      systemVersion: process.getSystemVersion(), root: join(app.getPath('userData'), 'updates'), supported: app.isPackaged && process.platform === 'darwin', changed: refresh,
      token: () => {
        const value = store.getSetting('secret:update-token');
        if (!value) return '';
        if (!safeStorage.isEncryptionAvailable()) throw new Error('Unlock macOS Keychain to access GitHub.');
        try { return safeStorage.decryptString(Buffer.from(value, 'base64')); } catch { throw new Error('Saved GitHub access could not be unlocked. Save your token again.'); }
      },
      saveToken: token => {
        if (!token) { store.deleteSetting('secret:update-token'); return; }
        if (!safeStorage.isEncryptionAvailable()) throw new Error('macOS Keychain encryption is unavailable.');
        store.setSetting('secret:update-token', safeStorage.encryptString(token).toString('base64'));
      },
      install: async (candidate, manifest) => {
        if (updateActive()) throw new Error('Finish active chats, tasks, approvals, setup and background work before restarting.');
        if (!app.isPackaged) throw new Error('Run a packaged Aegir app to test installation.');
        updateBarrier = true;
        let prepared: Awaited<ReturnType<typeof prepareInstallation>> | undefined;
        try {
          prepared = await prepareInstallation({ executable: app.getPath('exe'), helper: join(process.resourcesPath, 'aegir-updater'), userData: app.getPath('userData'), candidate, manifest });
          await prepared.start();
          if (updateActive()) throw new Error('Background work started while preparing the update. Wait for it to finish and try again.');
          updateRequest = prepared.request;
          app.quit();
        } catch (error) { await prepared?.cancel(); updateBarrier = false; throw error; }
      },
    });
    registerIpc({ updates, isUpdating: () => updateBarrier, store, runtime, connectors, codex, memory, browser, onboarding, phoneCapture, approvals, approvalThreads, externalApprovalResolvers, refresh, emit, snapshot, window: () => window, rendererUrl });
    createWindow();
    createApplicationMenu();
    createTray();
    if (startupUpdate) {
      if (window?.webContents.isLoadingMainFrame()) await new Promise<void>((resolve, reject) => {
        window!.webContents.once('did-finish-load', () => resolve());
        window!.webContents.once('did-fail-load', () => reject(new Error('Updated app could not load its window.')));
      });
      await window!.webContents.executeJavaScript('(async () => { if (!window.aegir) throw new Error("Updated preload is unavailable"); await window.aegir.snapshot(); })()');
      await confirmStartup(startupUpdate);
      updateBarrier = false;
      refresh();
    }
    connectors.start();
    runtime.start();
    if (store.getSetting('providerSetup')) void memory
      .migrateLegacy()
      .then(() => {
        if (store.isOpen) refresh();
      })
      .catch((error) => {
        console.error('Memory migration failed:', error);
        if (store.isOpen) refresh();
      });
    if (app.isPackaged && !profileArgument && !store.getSetting('loginConfigured')) {
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
    runtime?.stop();
    const updatesClosed = updates?.close();
    const setupClosed = onboarding?.close();
    const browserClosed = browser?.close();
    connectors?.close();
    codex?.close();
    if (event) void (async () => {
      try {
        await Promise.all([browserClosed, setupClosed, updatesClosed]);
        if (updateRequest) await store.db.backup(join(updateRequest.root, 'aegir.sqlite.backup'));
        store?.close();
        if (updateRequest) await writeFile(join(updateRequest.root, 'shutdown-ready'), updateRequest.token, { mode: 0o600 });
      } catch {
        store?.close();
        dialog.showErrorBox('Update paused', 'Aegir could not finish a safe shutdown. The original app was retained. Open Aegir again to retry.');
      } finally { app.quit(); }
    })();
    else store?.close();
  });
  app.on('activate', () => window?.show());
} else app.quit();
