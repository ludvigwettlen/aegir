import type { TaskView } from '../../shared/tasks';
import { api, type Route, type Run } from './views/common';

export function goTo(go: (route: Route) => void, route: Route) {
  go(route);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const pane = document.querySelector<HTMLElement>('[data-keyboard-pane="list"], [data-keyboard-pane="page"]');
    (pane?.querySelector<HTMLElement>('[data-keyboard-current]') || pane?.querySelector<HTMLElement>('[data-keyboard-item]') || pane)?.focus();
  }));
}
export function goToList(go: (route: Route) => void, list: TaskView) { goTo(go, { view: 'tasks', list }); }
export function newTask(go: (route: Route) => void) {
  const current = document.querySelector<HTMLElement>('[data-quick-add]')?.dataset.taskView;
  if (current !== 'inbox' && !current?.startsWith('list:')) go({ view: 'tasks', list: 'today' });
  requestAnimationFrame(() => requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[data-quick-add]')?.focus()));
}
export function newThread(notify: (text: string) => void) {
  const input = document.querySelector<HTMLInputElement>('[data-new-thread]');
  if (input?.getClientRects().length) input.focus();
  else notify('Close the document to start a new thread');
}
export function undoTaskAction(run: Run, notify: (text: string) => void) {
  void run(async () => { const undone = await api.undoTaskAction(); notify(undone ? `Undid ${undone.action}` : 'Nothing to undo'); });
}
