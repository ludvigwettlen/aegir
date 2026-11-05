import { attachmentLimits } from '../shared/attachments.js';
import type { Agent } from '../shared/types.js';
import { readAttachment } from './attachments.js';
import type { IpcDependencies, IpcHandle } from './ipc.js';

export function registerConversationsIpc(handle: IpcHandle, dependencies: Pick<IpcDependencies, 'store' | 'runtime' | 'refresh'> & { attachmentRoot: (id: string) => string }) {
  const { store, runtime, refresh, attachmentRoot } = dependencies;

  handle('thread-messages', (threadId: string, before?: string) =>
    store.messagePage(threadId, before),
  );

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

  handle('send-message', (threadId: string, content: string, paths: string[] = []) => {
    if (!Array.isArray(paths) || paths.length > attachmentLimits.count || paths.some(path => typeof path !== 'string')) throw new Error('Attach up to ten files per message');
    const files = paths.map(path => readAttachment(attachmentRoot(threadId), path));
    return runtime.sendMessage(threadId, content, false, files);
  });

  handle('stop-thread', (threadId: string) => runtime.stopThread(threadId));

  handle('close-thread', (threadId: string) => {
    store.setThreadStatus(threadId, 'closed');
    refresh();
  });
}
