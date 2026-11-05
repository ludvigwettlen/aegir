import { dialog } from 'electron';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { readAttachment } from './attachments.js';
import { readClaudeRoutines } from './claude-schedule.js';
import { readDocument } from './documents.js';
import type { IpcDependencies, IpcHandle } from './ipc.js';

export function registerIntegrationsIpc(handle: IpcHandle, dependencies: Pick<IpcDependencies, 'store' | 'runtime' | 'refresh' | 'onboarding' | 'delegation' | 'phoneCapture' | 'connectors' | 'memory'> & { documentRoot: (id: string) => string; attachmentRoot: (id: string) => string }) {
  const { store, runtime, refresh, onboarding, delegation, phoneCapture, connectors, memory, documentRoot, attachmentRoot } = dependencies;

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

  handle('one-on-ones-configure', (account: string, enabled: boolean) => {
    runtime.oneOnOnes.configure(account, enabled);
    if (enabled) void runtime.oneOnOnes.tick();
  });

  handle('one-on-ones-sync', () => runtime.oneOnOnes.sync());

  handle('meeting-conversation', (id: string) => runtime.meetingConversation(id));

  handle('one-on-ones-prepare', (id: string) => runtime.oneOnOnes.prepare(id));

  handle('one-on-ones-update', (id: string, change: { agenda?: string; hidden?: boolean; autoPrepare?: boolean }, expected?: string) => runtime.oneOnOnes.update(id, change, expected));

  handle('delegation-configure', (database: string) => delegation.configure(database));

  handle('delegation-people', (query: string) => delegation.people(query));

  handle('delegation-publish', (id: string, input: import('../shared/delegation.js').DelegationInput) => delegation.delegate(id, input));

  handle('delegation-sync', () => delegation.sync());

  handle('delegation-status', (id: string, status: import('../shared/delegation.js').DelegationStatus) => delegation.setStatus(id, status));

  let claudeRead: ReturnType<typeof readClaudeRoutines> | null = null;

  handle('claude-routines', () => claudeRead ||= readClaudeRoutines(join(homedir(), 'Library', 'Application Support', 'Claude', 'claude-code-sessions')).finally(() => { claudeRead = null; }));

  handle('configure-reminders', (enabled: boolean, list: string) => phoneCapture.configure(enabled, list));

  handle('sync-reminders', () => phoneCapture.sync());

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
}
