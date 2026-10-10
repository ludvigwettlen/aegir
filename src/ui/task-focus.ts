import type { TaskView } from '../../shared/tasks';

// A task to select in a list once that list is on screen: set by Find a task, taken by the task list as it renders.
// It waits for the list to be shown, because the finder navigates and asks in the same moment.
let pending: { list: TaskView; taskId: string } | null = null;

export function focusTask(list: TaskView, taskId: string) {
  pending = { list, taskId };
}

// The task list calls this as it renders: the id when one is waiting for this list and is in it.
export function takeTaskFocus(list: TaskView, ids: string[]): string | null {
  if (!pending || pending.list !== list || !ids.includes(pending.taskId)) return null;
  const { taskId } = pending;
  pending = null;
  return taskId;
}
