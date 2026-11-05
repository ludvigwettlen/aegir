import { app, BrowserWindow, clipboard, ipcMain, shell } from 'electron';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { reviewRequest } from '../shared/review.js';
import { normalizeTaskLink } from '../shared/task-links.js';
import type { AppEvent, Approval, Snapshot } from '../shared/types.js';
import { validateTypography } from '../shared/typography.js';
import { feedbackBrief } from '../shared/ui-feedback.js';
import { BrowserManager } from './browser.js';
import { chatTranscript } from './chat-transcript.js';
import { ConnectorManager } from './connectors.js';
import { Store } from './db.js';
import { readDocument } from './documents.js';
import { EngineRouter } from './engine.js';
import { registerConversationsIpc } from './ipc-conversations.js';
import { registerIntegrationsIpc } from './ipc-integrations.js';
import { registerTasksIpc } from './ipc-tasks.js';
import { MemoryRouter } from './memory-provider.js';
import { OnboardingService } from './onboarding.js';
import { PhoneCapture } from './phone-capture.js';
import { Runtime } from './runtime.js';
import { UiFeedbackStore } from './ui-feedback.js';

import { assertTrustedSender, ipcArgumentSchema, validateIpcArgs } from './ipc-security.js';
import { registerWorkspaceIpc } from './ipc-workspace.js';

let pendingIpc = 0;
export const activeIpcCount = () => pendingIpc;
export type IpcDependencies = {
  updates?: import('./updates.js').UpdateService;
  isUpdating?: () => boolean;
  store: Store; runtime: Runtime; connectors: ConnectorManager; codex: EngineRouter; memory: MemoryRouter;
  browser: BrowserManager; onboarding: OnboardingService; phoneCapture: PhoneCapture;
  approvals: Map<string, Approval>; approvalThreads: Map<string, string>; externalApprovalResolvers: Map<string, (value: boolean) => void>;
  refresh: () => void; emit: (event: AppEvent) => void; snapshot: () => Snapshot; window: () => BrowserWindow | null; rendererUrl: string;
};
export type IpcHandle = (channel: string, fn: (...args: any[]) => unknown) => void;

export function registerIpc(dependencies: IpcDependencies) {
  const { store, runtime, connectors, codex, memory, browser, onboarding, phoneCapture,
    approvals, approvalThreads, externalApprovalResolvers, refresh, emit, snapshot } = dependencies;
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
  const handle = (channel: string, fn: (...args: any[]) => unknown) => {
    ipcArgumentSchema(channel);
    ipcMain.handle(channel, async (event, ...args) => {
      assertTrustedSender(event, dependencies.window(), dependencies.rendererUrl);
      if (dependencies.isUpdating?.() && channel !== 'snapshot') throw new Error('Aegir is restarting to update. Please wait.');
      pendingIpc++;
      let result: unknown;
      try { result = await fn(...validateIpcArgs(channel, args)); } finally { pendingIpc--; }
      if (channel.startsWith('skill-') && !['skill-library', 'skill-detail', 'skill-revision-files'].includes(channel)) emit({ type: 'skills-changed' });
      return result;
    });
  };
  registerTasksIpc(handle, { store, runtime, refresh });
  registerConversationsIpc(handle, { store, runtime, refresh, attachmentRoot });
  registerIntegrationsIpc(handle, { store, runtime, refresh, onboarding, phoneCapture, connectors, memory, documentRoot, attachmentRoot });
  handle('update-check', () => dependencies.updates?.check());
  handle('update-download', () => dependencies.updates?.download());
  handle('update-cancel', () => dependencies.updates?.cancel());
  handle('update-install', () => dependencies.updates?.install());
  handle('update-token', (token: string) => dependencies.updates?.saveToken(token));
  handle('snapshot', () => snapshot());
  const feedback = new UiFeedbackStore(join(app.getPath('userData'), 'ui-feedback.json'));
  handle('ui-feedback-list', () => feedback.list());
  handle('ui-feedback-add', input => feedback.add(input));
  handle('ui-feedback-resolve', (id, resolved) => feedback.resolve(id, resolved));
  handle('ui-feedback-copy', () => clipboard.writeText(feedbackBrief(feedback.list())));
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
  registerWorkspaceIpc(handle, { store, runtime, refresh, documentRoot, attachmentRoot });
  handle('copy-chat-transcript', (threadId: string) => {
    clipboard.writeText(chatTranscript(store, threadId, runtime.skills.proposals()));
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
  handle('capture-task', (text: string) => runtime.captureTask(text));
  handle('read-clipboard-text', () => clipboard.readText());
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
