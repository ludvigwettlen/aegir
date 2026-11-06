import type { IpcDependencies, IpcHandle } from './ipc.js';

export function registerIntegrationsIpc(handle: IpcHandle, dependencies: Pick<IpcDependencies, 'store' | 'runtime' | 'refresh' | 'onboarding' | 'phoneCapture' | 'connectors' | 'memory'>) {
  const { store, runtime, refresh, onboarding, phoneCapture, connectors, memory } = dependencies;

  handle('setup-check', () => onboarding.check());


  handle('setup-install', kind => onboarding.installComponent(kind));

  handle('setup-codex-login', () => onboarding.signIn());

  handle('setup-codex-cancel', () => onboarding.cancelSignIn());

  handle('setup-save', (step, action) => onboarding.save(step, action));

  handle('gmail-configure', (account: string, email: string, enabled: boolean) => runtime.gmail.configure(account, email, enabled));

  handle('gmail-sync', () => runtime.gmail.sync());

  handle('gmail-draft-update', (id: string, revision: number, fields: import('../shared/gmail.js').EmailFields) => runtime.gmail.update(id, revision, fields));

  // These renderer-only endpoints are the user's explicit approval of the displayed draft.
  handle('gmail-draft-cancel', (id: string, revision: number) => runtime.gmail.cancelSend(id, revision));

  handle('gmail-draft-manual', (id: string, revision: number) => runtime.gmail.markSentManually(id, revision));

  handle('gmail-draft-send', (id: string, revision: number, fields: import('../shared/gmail.js').EmailFields) => runtime.gmail.queueSend(id, revision, fields));

  handle('slack-draft-targets', (kind: 'people' | 'channels', query: string, cursor?: string) => runtime.slackMessages.findTargets(kind, query, cursor));

  handle('slack-draft-update', (id: string, revision: number, fields: import('../shared/slack-messages.js').SlackFields) => runtime.slackMessages.update(id, revision, fields));

  handle('slack-draft-cancel', (id: string, revision: number) => runtime.slackMessages.cancelSend(id, revision));

  handle('slack-draft-manual', (id: string, revision: number) => runtime.slackMessages.markSentManually(id, revision));

  handle('slack-draft-send', (id: string, revision: number, fields: import('../shared/slack-messages.js').SlackFields) => runtime.slackMessages.queueSend(id, revision, fields));

  handle('one-on-ones-configure', (account: string, enabled: boolean) => {
    runtime.oneOnOnes.configure(account, enabled);
    if (enabled) void runtime.oneOnOnes.tick();
  });

  handle('one-on-ones-sync', () => runtime.oneOnOnes.sync());

  handle('meeting-conversation', (id: string) => runtime.meetingConversation(id));

  handle('one-on-ones-prepare', (id: string) => runtime.oneOnOnes.prepare(id));

  handle('one-on-ones-update', (id: string, change: { agenda?: string; hidden?: boolean; autoPrepare?: boolean }, expected?: string) => runtime.oneOnOnes.update(id, change, expected));



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
