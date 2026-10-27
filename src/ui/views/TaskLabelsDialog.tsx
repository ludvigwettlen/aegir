import * as Dialog from '@radix-ui/react-dialog';
import { useRef, useState } from 'react';
import type { Task } from '../../../shared/types';
import { parseLabels, taskLabels } from '../../../shared/task-labels';
import { Button } from '../design-system/primitives';
import { api } from './common';
export function TaskLabelsDialog({ task, tasks, onClose }: { task: Task; tasks: Task[]; onClose: () => void }) {
  const [text, setText] = useState(taskLabels(task).join(', '));
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  const saving = useRef(false), opener = useRef(document.activeElement as HTMLElement | null);
  const known = [...new Set(tasks.flatMap(taskLabels))].sort();
  let selected: string[] = []; try { selected = parseLabels(text); } catch { /* keep the editable text */ }
  const save = async () => {
    if (saving.current) return;
    let labels: string[]; try { labels = parseLabels(text); } catch (e) { setError((e as Error).message); return; }
    saving.current = true; setPending(true); setError('');
    try { await api.updateTask(task.id, { labels }); onClose(); } catch (e) { setError((e as Error).message); } finally { saving.current = false; setPending(false); }
  };
  return <Dialog.Root open onOpenChange={open => { if (!open && !saving.current) onClose(); }}><Dialog.Portal><Dialog.Overlay className="ws-list-dialog-overlay" />
    <Dialog.Content className="ws-list-dialog ws-task-labels-dialog" onEscapeKeyDown={e => { if (saving.current) e.preventDefault(); }} onPointerDownOutside={e => { if (saving.current) e.preventDefault(); }} onCloseAutoFocus={e => { e.preventDefault(); requestAnimationFrame(() => (opener.current?.isConnected ? opener.current : document.querySelector<HTMLElement>('.ws-task-detail'))?.focus()); }}>
      <Dialog.Title>Task labels</Dialog.Title><Dialog.Description>Use commas to separate labels, or choose existing ones. Empty clears all labels.</Dialog.Description>
      <form onSubmit={e => { e.preventDefault(); void save(); }}>
        <label>Labels<input aria-label="Labels" value={text} disabled={pending} onChange={e => { setText(e.target.value); setError(''); }} placeholder="work, board, follow-up" /></label>
        {known.length > 0 && <div className="ws-label-choices">{known.map(label => <label key={label}><input type="checkbox" disabled={pending} checked={selected.includes(label)} onChange={e => setText((e.target.checked ? [...selected, label] : selected.filter(item => item !== label)).join(', '))} />{label}</label>)}</div>}
        {error && <p role="alert">{error}</p>}
        <div className="ws-row-actions"><Button type="button" variant="ghost" size="sm" disabled={pending} onClick={onClose}>Cancel</Button><Button type="submit" size="sm" disabled={pending}>{pending ? 'Saving…' : 'Save labels'}</Button></div>
      </form>
    </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
