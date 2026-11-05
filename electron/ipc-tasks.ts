import { shell } from 'electron';
import { fileURLToPath } from 'node:url';
import { normalizeTaskLink } from '../shared/task-links.js';
import { CONTENT_WORDS, mergeContent, searchWords } from '../shared/task-search.js';
import type { DesktopApi, TaskChange } from '../shared/types.js';
import { searchTaskDocuments } from './document-search.js';
import type { IpcDependencies, IpcHandle } from './ipc.js';

export function registerTasksIpc(handle: IpcHandle, dependencies: Pick<IpcDependencies, 'store' | 'runtime' | 'refresh'>) {
  const { store, runtime, refresh } = dependencies;

  handle('search-task-content', (query: unknown) => {
    if (typeof query !== 'string' || query.length > 200) return [];
    const words = searchWords(query).slice(0, CONTENT_WORDS);
    return mergeContent(store.searchTaskMessages(words), searchTaskDocuments(store.list('tasks').filter(task => task.status !== 'dismissed'), words));
  });

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
}
