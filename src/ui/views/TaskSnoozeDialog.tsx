import * as Dialog from '@radix-ui/react-dialog';
import { useRef, useState } from 'react';
import type { Task } from '../../../shared/types';
import { isoDate, validTaskDate } from '../../../shared/tasks';
import { Button } from '../design-system/primitives';
import { api } from './common';
export function TaskSnoozeDialog({ task, onClose }: { task: Task; onClose: () => void }) {
  const [date, setDate] = useState(task.snoozedUntil || '');
  const [error, setError] = useState(''), [pending, setPending] = useState(false);
  const saving = useRef(false);
  const opener = useRef(document.activeElement as HTMLElement | null);
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  // Move to the next Monday, including a full week when today is Monday.
  const monday = new Date(); monday.setDate(monday.getDate() + ((8 - monday.getDay()) % 7 || 7));
  const save = async (until: string | null) => {
    if (saving.current) return;
    if (until && (!validTaskDate(until) || until <= isoDate(new Date()))) { setError('Choose a future date.'); return; }
    saving.current = true; setPending(true); setError('');
    try { await api.updateTask(task.id, { snoozedUntil: until }); onClose(); }
    catch (cause) { setError(String(cause).replace(/^Error: /, '')); }
    finally { saving.current = false; setPending(false); }
  };
  return <Dialog.Root open onOpenChange={open => { if (!open && !saving.current) onClose(); }}><Dialog.Portal>
    <Dialog.Overlay className="ws-list-dialog-overlay" />
    <Dialog.Content className="ws-list-dialog" onCloseAutoFocus={event => {
      event.preventDefault(); requestAnimationFrame(() => (opener.current?.isConnected ? opener.current : document.querySelector<HTMLElement>('.ws-task-detail'))?.focus());
    }} onEscapeKeyDown={event => { if (saving.current) event.preventDefault(); }} onPointerDownOutside={event => { if (saving.current) event.preventDefault(); }}>
      <Dialog.Title>Snooze task</Dialog.Title>
      <Dialog.Description>Hide until this date. The deadline stays unchanged. Find snoozed tasks in Upcoming.</Dialog.Description>
      <div className="ws-row-actions"><Button variant="outline" size="sm" disabled={pending} onClick={() => void save(isoDate(tomorrow))}>Tomorrow</Button><Button variant="outline" size="sm" disabled={pending} onClick={() => void save(isoDate(monday))}>Next week</Button></div>
      <label>Snooze until<input type="date" aria-label="Snooze until" min={isoDate(tomorrow)} value={date} disabled={pending} onChange={event => setDate(event.target.value)} /></label>
      {error && <p role="alert">{error}</p>}
      <div className="ws-row-actions"><Button variant="ghost" size="sm" disabled={pending} onClick={onClose}>Cancel</Button>{task.snoozedUntil && <Button variant="outline" size="sm" disabled={pending} onClick={() => void save(null)}>Unsnooze</Button>}<Button size="sm" disabled={pending || !date} onClick={() => void save(date)}>{pending ? 'Saving…' : 'Snooze'}</Button></div>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}
