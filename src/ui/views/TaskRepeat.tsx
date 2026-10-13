import * as Dialog from '@radix-ui/react-dialog';
import { Check, Repeat2, X } from 'lucide-react';
import { useRef, useState } from 'react';
import type { Task, TaskRecurrence } from '../../../shared/types';
import { taskRecurrenceLabels } from '../../../shared/tasks';
import { Button } from '../design-system/primitives';
import { api } from './common';

const options = [{ value: null, label: 'Does not repeat' }, ...Object.entries(taskRecurrenceLabels).map(([value, label]) => ({ value: value as TaskRecurrence, label }))];

export function TaskRepeat({ task }: { task: Task }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState('');
  const content = useRef<HTMLDivElement>(null);
  const archived = task.status === 'done' || task.status === 'dismissed' || !!task.nextOccurrenceId;
  const choose = async (recurrence: TaskRecurrence | null) => {
    if (savingRef.current || archived) return;
    if (recurrence === (task.recurrence ?? null)) { setOpen(false); return; }
    savingRef.current = true; setSaving(true); setError('');
    try { await api.updateTask(task.id, { recurrence }); setOpen(false); }
    catch (cause) { setError(String(cause).replace(/^Error: /, '')); }
    finally { savingRef.current = false; setSaving(false); }
  };
  return <Dialog.Root open={open} onOpenChange={value => { if (!savingRef.current) { setError(''); setOpen(value); } }}>
    <Dialog.Trigger asChild><Button variant="ghost" size="sm" className="ws-task-repeat-action" aria-label="Repeat task">
      <Repeat2 size={14} aria-hidden="true" />{task.recurrence ? taskRecurrenceLabels[task.recurrence] : 'Repeat'}
    </Button></Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Overlay className="ws-list-dialog-overlay" />
      <Dialog.Content ref={content} className="ws-list-dialog ws-repeat-dialog"
        onOpenAutoFocus={event => { event.preventDefault(); (content.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]:not(:disabled)') || content.current?.querySelector<HTMLButtonElement>('[aria-label="Close repeat picker"]'))?.focus(); }}
        onEscapeKeyDown={event => { if (savingRef.current) event.preventDefault(); }}
        onPointerDownOutside={event => { if (savingRef.current) event.preventDefault(); }}
        onKeyDown={event => {
          if (event.metaKey || event.ctrlKey || event.altKey || event.nativeEvent.isComposing || !['ArrowDown', 'ArrowUp', 'j', 'k'].includes(event.key)) return;
          event.preventDefault();
          const buttons = [...(content.current?.querySelectorAll<HTMLButtonElement>('[data-repeat-option]:not(:disabled)') || [])];
          if (!buttons.length) return;
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          buttons[(index + (['ArrowDown', 'j'].includes(event.key) ? 1 : -1) + buttons.length) % buttons.length].focus();
        }}>
        <div className="ws-move-title"><Dialog.Title>Repeat task</Dialog.Title><Button variant="ghost" size="sm" icon aria-label="Close repeat picker" disabled={saving} onClick={() => setOpen(false)}><X size={16} /></Button></div>
        <Dialog.Description>{task.title}</Dialog.Description>
        <div className="ws-repeat-options" role="group" aria-label="Repeat schedule" aria-busy={saving}>
          {options.map(option => <Button key={option.value || 'none'} variant="ghost" data-repeat-option aria-pressed={(task.recurrence ?? null) === option.value}
            disabled={saving || archived} onClick={() => void choose(option.value)}>
            <span>{option.label}</span>{(task.recurrence ?? null) === option.value && <><small>Current</small><Check size={15} aria-hidden="true" /></>}
          </Button>)}
        </div>
        <p className="ws-repeat-help">{archived ? 'Change future repeats on the next occurrence.' : 'Completing creates the next task. Missed dates are skipped.'}</p>
        {saving && <p role="status">Saving…</p>}
        {error && <p className="ws-field-error" role="alert">{error}</p>}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
