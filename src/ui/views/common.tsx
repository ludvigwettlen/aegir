import type { CSSProperties,ReactNode } from 'react';
import { describeSchedule,nextRunAfter } from '../../../shared/routines';
import type { Agent,Routine,RoutineRun,Task } from '../../../shared/types';
import type { TaskView } from '../../../shared/tasks';

export const api = window.aegir;
export type Run = (action: () => Promise<unknown>) => Promise<void>;
export type Route =
  | { view: 'tasks'; list: TaskView }
  | { view: 'chats'; threadId?: string; draft?: string }
  | { view: 'routine'; routineId: string }
  | { view: 'skills'; agentId?: string }
  | { view: 'one-on-ones' }
  | { view: 'memory' } | { view: 'settings' };

export const time = (value: string) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
export const day = (value: string) => new Date(value).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
export function relative(value: string) {
  const date = new Date(value); const today = new Date();
  if (date.toDateString() === today.toDateString()) return time(value);
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
  return date.toDateString() === yesterday.toDateString() ? 'Yesterday' : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
export function dueLabel(dueAt: string | null) {
  if (!dueAt) return '';
  const [y, m, d] = dueAt.split('-').map(Number); const date = new Date(y, m - 1, d);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((date.getTime() - today.getTime()) / 864e5);
  if (diff === 0) return 'Today'; if (diff === 1) return 'Tomorrow'; if (diff < 0) return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return diff < 7 ? date.toLocaleDateString([], { weekday: 'short' }) : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
export const isOverdue = (dueAt: string | null) => { if (!dueAt) return false; const [y, m, d] = dueAt.split('-').map(Number); const today = new Date(); today.setHours(0, 0, 0, 0); return new Date(y, m - 1, d) <= today; };

export function Avatar({ agent, size = 26 }: { agent?: Agent; size?: number }) {
  return <span className="ws-avatar" style={{ '--agent-color': agent?.color || '#8a8b95', width: size, height: size, fontSize: Math.round(size * 0.42) } as CSSProperties} aria-hidden="true">{agent?.name.slice(0, 1) || '?'}</span>;
}
export function YouAvatar({ size = 26 }: { size?: number }) {
  return <span className="ws-avatar you" style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }} aria-hidden="true">Y</span>;
}
export function Kbd({ children }: { children: ReactNode }) { return <kbd className="ws-kbd">{children}</kbd>; }

export const taskStatusText: Record<Task['status'], string> = { proposed: 'Suggested', ready: 'Open', running: 'Working', review: 'Ready for review', blocked: 'Needs you', done: 'Done', dismissed: 'Dismissed' };

export function TaskGlyph({ task }: { task: Task }) {
  if (task.status === 'running') return <svg className="ws-glyph" width="16" height="16" viewBox="0 0 16 16" role="img" aria-label="Assistant working"><circle cx="8" cy="8" r="6.5" fill="none" stroke="var(--ds-color-line)" strokeWidth="2"/><circle className="ws-glyph-spin" cx="8" cy="8" r="6.5" fill="none" stroke="var(--ds-color-lime-strong)" strokeWidth="2" strokeDasharray="14 41" strokeLinecap="round"/></svg>;
  if (task.status === 'review' || task.status === 'blocked') return <svg className="ws-glyph" width="16" height="16" viewBox="0 0 16 16" role="img" aria-label={taskStatusText[task.status]}><circle cx="8" cy="8" r="7" fill="var(--ds-color-lemon)" stroke="#d4ad00" strokeWidth="1.2"/><path d="M8 4.5v4.2" stroke="#4a3f00" strokeWidth="1.8" strokeLinecap="round"/><circle cx="8" cy="11.2" r="1" fill="#4a3f00"/></svg>;
  if (task.status === 'proposed') return <svg className="ws-glyph" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9a7c00" strokeWidth="2" strokeLinejoin="round" role="img" aria-label="Suggested"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/></svg>;
  if (task.status === 'done') return <svg className="ws-glyph" width="16" height="16" viewBox="0 0 16 16" role="img" aria-label="Done"><circle cx="8" cy="8" r="7.5" fill="var(--ds-color-lime-ink)"/><path d="m4.8 8.2 2.2 2.2 4.2-4.6" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round"/></svg>;
  return <span className="ws-glyph ws-glyph-open" role="img" aria-label="Open"/>;
}

export function routineStatus(routine: Routine, runs: RoutineRun[]): { text: string; tone: 'ok' | 'failed' | 'paused' | 'running' } {
  const last = runs.find(run => run.routineId === routine.id);
  if (last?.status === 'running') return { text: 'Running', tone: 'running' };
  if (!routine.enabled) return { text: 'Paused', tone: 'paused' };
  if (last?.status === 'failed') return { text: 'Failed', tone: 'failed' };
  const next = nextRunAfter(routine.schedule, new Date(routine.lastRunAt || routine.createdAt));
  const minutes = Math.round((next.getTime() - Date.now()) / 60000);
  return { text: minutes <= 0 ? 'Due' : minutes < 60 ? `in ${minutes}m` : minutes < 24 * 60 ? time(next.toISOString()) : next.toLocaleDateString([], { weekday: 'short' }), tone: 'ok' };
}
export { describeSchedule };

// True when a key event should drive list shortcuts rather than typing.
export function isTyping(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null;
  return !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
}
