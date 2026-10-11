import * as Dialog from '@radix-ui/react-dialog';
import { Check, Inbox, List, Search, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { Task, TaskList } from '../../../shared/types';
import { Button } from '../design-system/primitives';
import { api } from './common';

export function MoveTaskDialog({ task, lists, onClose, onMoved }: {
  task: Task;
  lists: TaskList[];
  onClose: () => void;
  onMoved: (name: string) => void;
}) {
  const id = useId();
  const opener = useRef(document.activeElement as HTMLElement | null);
  const search = useRef<HTMLInputElement>(null);
  const optionsPane = useRef<HTMLDivElement>(null);
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(task.listId || '');
  const [error, setError] = useState('');
  const [searching, setSearching] = useState(false);
  const options = [{ id: '', name: 'Inbox' }, ...lists].filter(list => list.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const activeIndex = Math.max(0, options.findIndex(option => option.id === active));
  const current = options[activeIndex];
  const optionId = current ? `${id}-option-${current.id || 'inbox'}` : undefined;
  useEffect(() => { if (optionId) document.getElementById(optionId)?.scrollIntoView({ block: 'nearest' }); }, [optionId]);
  const choose = async (option: { id: string; name: string }) => {
    if (saving.current) return;
    if (option.id === (task.listId || '')) { onClose(); return; }
    saving.current = true; setBusy(true); setError('');
    try {
      await api.updateTask(task.id, { listId: option.id || null });
      onMoved(option.name);
      onClose();
    } catch (cause) {
      setError(String(cause).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, ''));
    } finally { saving.current = false; setBusy(false); }
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.isPropagationStopped() || event.nativeEvent.isComposing) return;
    const inSearch = event.target === search.current;
    const navigation = ['ArrowDown', 'ArrowUp'].includes(event.key)
      || ((!inSearch || event.ctrlKey) && ['j', 'k'].includes(event.key) && !event.metaKey && !event.altKey);
    if (navigation) {
      event.preventDefault();
      if (!busy && options.length) {
        const down = event.key === 'j' || event.key === 'ArrowDown';
        setActive(options[(activeIndex + (down ? 1 : -1) + options.length) % options.length].id);
      }
    } else if (event.key === 'Enter' && (inSearch || event.target === optionsPane.current)) {
      event.preventDefault(); if (current) void choose(current);
    } else if (!inSearch && event.target === optionsPane.current && !event.metaKey && !event.ctrlKey && !event.altKey && event.key.length === 1 && !busy) {
      event.preventDefault();
      if (event.key !== '/') { setQuery(event.key); setActive(''); }
      search.current?.focus();
    }
  };
  return <Dialog.Root open onOpenChange={open => { if (!open && !saving.current) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="ws-list-dialog-overlay" />
      <Dialog.Content className="ws-list-dialog ws-move-dialog" onKeyDown={onKeyDown}
        onOpenAutoFocus={event => { event.preventDefault(); optionsPane.current?.focus(); }}
        onCloseAutoFocus={event => {
          event.preventDefault();
          const target = opener.current?.isConnected ? opener.current
            : document.querySelector<HTMLElement>('.ws-rows [data-keyboard-current], .ws-rows');
          target?.focus();
        }}>
        <div className="ws-move-title"><Dialog.Title>Move to list</Dialog.Title>
          <Button variant="ghost" size="sm" icon aria-label="Close list picker" disabled={busy} onClick={onClose}><X size={16} /></Button>
        </div>
        <Dialog.Description>{task.title}</Dialog.Description>
        <div className="ws-move-search"><Search size={16} aria-hidden="true" />
          <input ref={search} role="combobox" aria-label="Search lists" aria-expanded="true" aria-controls={`${id}-options`}
            aria-activedescendant={optionId} aria-autocomplete="list" placeholder="Type to search lists…" value={query} disabled={busy}
            onFocus={() => setSearching(true)} onBlur={() => setSearching(false)}
            onChange={event => { setQuery(event.target.value); setActive(''); }} />
        </div>
        <div ref={optionsPane} className="ws-move-options" id={`${id}-options`} role="listbox" aria-label="Task lists"
          aria-activedescendant={optionId} aria-busy={busy} tabIndex={0}>
          {options.map(option => <div key={option.id} id={`${id}-option-${option.id || 'inbox'}`} role="option"
            aria-selected={current?.id === option.id} aria-disabled={busy} className="ws-move-option"
            onPointerMove={() => { if (!busy) setActive(option.id); }} onClick={() => void choose(option)}>
            {option.id ? <List size={17} aria-hidden="true" /> : <Inbox size={17} aria-hidden="true" />}
            <span>{option.name}</span>
            {option.id === (task.listId || '') && <><small>Current</small><Check size={15} aria-hidden="true" /></>}
          </div>)}
        </div>
        {!options.length && <p className="ws-move-empty" role="status">No matching lists</p>}
        {error && <p className="ws-field-error" role="alert">{error}</p>}
        <div className="ws-move-footer"><span>{searching ? '↑ ↓ or Ctrl+J/K to navigate' : 'J / K to navigate · / to search'}</span><span>Enter to move · Esc to cancel</span></div>
        {busy && <p role="status">Moving…</p>}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
