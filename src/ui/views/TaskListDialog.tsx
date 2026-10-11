import * as Dialog from '@radix-ui/react-dialog';
import { useRef, useState } from 'react';
import type { TaskList } from '../../../shared/types';
import { Button } from '../design-system/primitives';
import { api } from './common';

export type TaskListAction = { kind: 'create' } | { kind: 'rename' | 'delete'; list: TaskList };

export function TaskListDialog({ action, onClose, onSaved }: {
  action: TaskListAction;
  onClose: () => void;
  onSaved: (listId: string | null) => void;
}) {
  const [name, setName] = useState(action.kind === 'create' ? '' : action.list.name);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState('');
  const opener = useRef(document.activeElement as HTMLElement | null);
  const deleting = action.kind === 'delete';
  const title = action.kind === 'create' ? 'New list' : deleting ? 'Delete list' : 'Rename list';
  const save = async () => {
    if (saving.current) return;
    saving.current = true; setBusy(true); setError('');
    try {
      if (action.kind === 'create') onSaved((await api.createTaskList(name)).id);
      else if (action.kind === 'rename') { await api.renameTaskList(action.list.id, name); onSaved(action.list.id); }
      else { await api.deleteTaskList(action.list.id); onSaved(null); }
      onClose();
    } catch (cause) {
      setError(String(cause).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, ''));
    } finally { saving.current = false; setBusy(false); }
  };
  return <Dialog.Root open onOpenChange={open => { if (!open && !saving.current) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="ws-list-dialog-overlay" />
      <Dialog.Content className="ws-list-dialog" onCloseAutoFocus={event => {
        event.preventDefault();
        const target = opener.current?.isConnected ? opener.current : document.querySelector<HTMLElement>('.ws-sidebar [aria-current="page"]');
        target?.focus();
      }}>
        <Dialog.Title>{title}</Dialog.Title>
        <Dialog.Description>{deleting
          ? `Delete “${action.list.name}”? Its tasks will return to Inbox. No tasks or conversations will be deleted.`
          : 'Organize tasks by project, topic, or whatever works for you.'}</Dialog.Description>
        <form onSubmit={event => { event.preventDefault(); void save(); }}>
          {!deleting && <label className="ws-field"><span>List name</span>
            <input autoFocus aria-label="List name" maxLength={80} value={name} disabled={busy}
              placeholder="e.g. Personal or Work" onChange={event => setName(event.target.value)} />
          </label>}
          {error && <p className="ws-field-error" role="alert">{error}</p>}
          <div className="ws-list-actions">
            <Button type="button" variant="ghost" disabled={busy} onClick={onClose} autoFocus={deleting}>Cancel</Button>
            <Button type="submit" disabled={busy || (!deleting && !name.trim())}>{busy ? 'Saving…' : title === 'New list' ? 'Create list' : title}</Button>
          </div>
        </form>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
