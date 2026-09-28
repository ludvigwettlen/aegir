import { useEffect, useState } from 'react';
import { Kbd, type Route } from './common';

type Hint = [keys: string, action: string];
type Context = { title: string; hints: Hint[]; editing: boolean; dialog: boolean };

function contextFor(route: Route): Context {
  const target = document.activeElement;
  const dialog = target?.closest('[role="dialog"]');
  const editor = target?.matches('input, textarea, select, [contenteditable="true"]');
  if (dialog) return { title: dialog.getAttribute('aria-label') || 'Dialog', editing: true, dialog: true,
    hints: [['Tab / ⇧Tab', 'Move between controls'], ['Esc', 'Cancel'], ...(dialog.classList.contains('ws-popover') ? [['Enter', 'Save or hand off'] as Hint, ['⇧Enter', 'New line in instructions'] as Hint] : [])] };
  if (editor) {
    const label = target?.getAttribute('aria-label');
    const hints: Hint[] = [['⌘Z', 'Undo text edit'], ['Tab / ⇧Tab', 'Move between controls']];
    if (label === 'Message') hints.unshift(['Enter', 'Send message'], ['⇧Enter', 'New line'], ['@', 'Mention an agent or routine'], ['↑ / ↓', 'Choose a mention'], ['Enter / Tab', 'Insert selected mention'], ['Esc', 'Dismiss mention picker']);
    else if (label === 'New task') hints.unshift(['Enter', 'Create task'], ['Esc', 'Clear and leave quick add']);
    else if (label === 'Start a thread') hints.unshift(['Enter', 'Start thread']);
    else if (label === 'Task title') hints.unshift(['Enter', 'Save title'], ['Esc', 'Cancel title edit']);
    return { title: label || 'Editing', hints, editing: true, dialog: false };
  }
  const titles = { tasks: 'Tasks', group: 'Chat', routine: 'Routine', skills: 'Skills', settings: 'Settings', memory: 'Memory' };
  const hints: Hint[] = [['J / K · ↓ / ↑', 'Move through items'], ['H / ←', 'Move to the previous pane'], ['L / →', 'Move to the next pane'], ['Tab / ⇧Tab', 'Move between controls']];
  if (target?.closest('.ws-sidebar')) hints.push(['Enter', 'Open selected page']);
  else if (target?.closest('.ws-task-detail, .ws-thread') && route.view === 'tasks') hints.push(['Esc', 'Close task detail']);
  else if (route.view === 'tasks') hints.push(
    ['Enter', 'Edit selected task title'], ['Space', route.list === 'completed' ? 'Reopen task' : 'Complete or reopen task'],
    ['N', 'Edit notes'], ['B / ⇧B', 'Set / clear label'], ['D / ⇧D', 'Set / clear due date'],
    ['⌘V', 'Attach copied link'], ['Esc', 'Close task detail'],
    ...(route.list === 'completed' ? [] : [['A', 'Hand off selected task'] as Hint]),
    ...(route.list === 'needs' ? [['Y', 'Accept suggestion'] as Hint, ['⌫', 'Dismiss suggestion'] as Hint] : []),
  );
  else if (route.view === 'group') hints.push(['Enter', 'Start thread from the new-thread field'], ['Enter / ⇧Enter', 'Send / new line in the composer'], ['@', 'Mention an agent or routine in the composer']);
  return { title: target?.closest('.ws-sidebar') ? 'Sidebar' : titles[route.view], hints, editing: false, dialog: false };
}

export function ShortcutHints({ route }: { route: Route }) {
  const [context, setContext] = useState<Context | null>(null);
  useEffect(() => {
    let held: string | null = null;
    const hide = () => { held = null; setContext(null); };
    const down = (event: KeyboardEvent) => {
      if (event.key !== '§' || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (held !== null) return;
      held = event.code;
      setContext(contextFor(route));
    };
    const up = (event: KeyboardEvent) => {
      if (held !== null && (event.code === held || event.key === '§')) hide();
    };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    window.addEventListener('blur', hide);
    document.addEventListener('visibilitychange', hide);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
      window.removeEventListener('blur', hide);
      document.removeEventListener('visibilitychange', hide);
      hide();
    };
  }, [route]);
  if (!context) return null;
  const global: Hint[] = context.dialog ? [] : [['⌘N', 'New task'], ['⌘,', 'Settings'], ...(!context.editing ? [
    ['⌘Z', 'Undo task action'] as Hint,
    ['G then T / U / W / N / C', 'Today / Upcoming / With the team / Needs you / Completed'] as Hint,
  ] : [])];
  return <div className="ws-hints-overlay">
    <section className="ws-hints-panel" role="region" aria-label="Keyboard hints" aria-live="polite">
      <header><h2>{context.title}</h2><p>Keyboard hints · release <Kbd>§</Kbd> to dismiss</p></header>
      <dl>{[...context.hints, ...global].map(([keys, action]) => <div key={`${keys}:${action}`}><dt><Kbd>{keys}</Kbd></dt><dd>{action}</dd></div>)}</dl>
      <p className="ws-hints-note">Navigation shortcuts apply outside text fields.</p>
    </section>
  </div>;
}
