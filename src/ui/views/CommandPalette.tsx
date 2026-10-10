import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Archive, Bot, CalendarDays, Check, CheckCheck, Hash, Inbox, MessageCircle, Pause, Play, Plus, Repeat2, Search, Settings, Sun,
  Undo2, Users, Wand2, type LucideIcon,
} from 'lucide-react';
import type { ClaudeRoutines, Snapshot } from '../../../shared/types';
import { claudeRoutineName } from '../../../shared/cron';
import type { TaskView } from '../../../shared/tasks';
import { rankCommands } from '../../../shared/command-search';
import { searchTasks } from '../../../shared/task-search';
import { focusTask } from '../task-focus';
import { registeredCommands, setCommandPaletteOpener, type Command, type CommandOption, type CommandSection, type CommandStep } from '../commands';
import { goTo, goToList, newTask, newThread, undoTaskAction } from '../hooks/useWorkspaceKeyboard';
import { api, Kbd, routineStatus, type Route, type Run } from './common';

type Props = {
  data: Snapshot; claude?: ClaudeRoutines; route: Route; go: (route: Route) => void; run: Run; notify: (message: string) => void; onNewGroup: () => void;
};
type Row = Command | CommandOption;
// What the palette works from while it's open. It's read once when the palette opens, so a snapshot
// arriving meanwhile can't swap the task under a highlighted Delete.
type Frozen = { context?: string; commands: Command[]; forQuery: (query: string) => Command[] };
// rootQuery is null when a key like ⌘L opened the step directly; Esc then closes instead of going back.
type Step = { step: CommandStep; rootQuery: string | null };

const sections: CommandSection[] = ['task', 'go', 'create', 'routines', 'app'];
// The selected task's rows need no label: the "Task: …" line above them names what they act on.
const sectionTitles: Record<CommandSection, string> = { task: '', go: 'Go to', create: 'Create', routines: 'Routines', app: 'App' };
const lists: Array<[TaskView, string, LucideIcon, string]> = [
  ['needs', 'Needs you', Inbox, 'N'], ['inbox', 'Inbox', Archive, 'I'], ['today', 'Today', Sun, 'T'],
  ['upcoming', 'Upcoming', CalendarDays, 'U'], ['team', 'Delegated', Bot, 'W'], ['completed', 'Completed', CheckCheck, 'C'],
];

const listInfo = new Map(lists.map(([list, title, icon]) => [list, { title, icon }]));
const shortDate = (iso: string) => {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
};

// Find a task (⌘F, the sidebar's search bar, ⌘K): every list at once. A row says which list the task is on, its band,
// label and date, and a bit of its context when that is where the words matched. Choosing it opens that list with the
// task selected.
export const findTaskCommand = (data: Snapshot, go: Props['go']): Command => ({
  id: 'go.find', section: 'go', title: 'Find a task…', icon: Search, keys: '⌘ F', keywords: ['search', 'find', 'look up', 'all tasks', 'where'],
  step: {
    title: 'Find', placeholder: 'Search every task by title, label or context…', empty: 'No task matches.', standalone: true,
    options: (query) => searchTasks(data.tasks, query).map(({ task, list, snippet }) => {
      const info = listInfo.get(list)!;
      const facts = [info.title, task.priority ? `P${task.priority}` : '', task.label ? `#${task.label}` : '', task.dueAt ? shortDate(task.dueAt) : ''].filter(Boolean);
      return {
        id: `find.${task.id}`, title: task.title, icon: info.icon,
        subtitle: snippet ? `${facts.join(' · ')} · ${snippet}` : facts.join(' · '),
        run: () => { focusTask(list, task.id); goToList(go, list); },
      };
    }),
  },
});

// Everything that doesn't depend on the selected task: navigation, creating things, routines and app actions.
function appCommands({ data, claude, route, go, run, notify, onNewGroup }: Props): Command[] {
  const commands: Command[] = [findTaskCommand(data, go), ...lists.map(([list, title, icon, key]): Command => ({
    id: `go.${list}`, section: 'go', title: `Go to ${title}`, icon, keys: `G then ${key}`,
    keywords: ['list', 'jump', 'open', 'show'], run: () => goToList(go, list),
  }))];
  for (const group of data.groups) {
    const agent = data.agents.find((item) => item.id === group.leadAgentId);
    commands.push(group.kind === 'group'
      ? { id: `go.group.${group.id}`, section: 'go', title: `Go to #${group.title}`, icon: Hash, keywords: ['group', 'channel', 'threads'],
        run: () => goTo(go, { view: 'group', groupId: group.id }) }
      : { id: `go.chat.${group.id}`, section: 'go', title: `Go to ${group.title}`, subtitle: agent?.role ? `Private chat · ${agent.role}` : 'Private chat',
        icon: MessageCircle, keywords: ['agent', 'chat', 'private'], run: () => goTo(go, { view: 'group', groupId: group.id }) });
  }
  // ⌘N starts a thread inside a chat and a task everywhere else, so the keycap follows the page.
  const inChat = route.view === 'group';
  commands.push({ id: 'create.task', section: 'create', title: 'New task', icon: Plus, keys: inChat ? undefined : '⌘ N', keywords: ['add', 'quick add', 'todo'], run: () => newTask(go) });
  if (inChat) commands.push({ id: 'create.thread', section: 'create', title: 'New thread', icon: MessageCircle, keys: '⌘ N', keywords: ['start', 'conversation'], run: () => { newThread(notify); } });
  commands.push({ id: 'create.group', section: 'create', title: 'New group…', icon: Users, keywords: ['channel', 'team', 'agents'], run: onNewGroup });
  for (const routine of data.routines) {
    const status = routineStatus(routine, data.routineRuns);
    // Run and Pause rows only show up when searched for, or on that routine's own page.
    const searchOnly = !(route.view === 'routine' && route.routineId === routine.id);
    commands.push({ id: `routine.go.${routine.id}`, section: 'routines', title: `Go to ${routine.name}`, subtitle: `Routine · ${status.text}`, icon: Repeat2,
      keywords: ['routine', 'schedule', 'log'], run: () => goTo(go, { view: 'routine', routineId: routine.id }) });
    if (status.tone !== 'running') commands.push({ id: `routine.run.${routine.id}`, section: 'routines', title: `Run ${routine.name} now`, icon: Play,
      keywords: ['routine', 'start', 'trigger'], searchOnly, run: () => void run(async () => { await api.runRoutine(routine.id); notify(`Started ${routine.name}`); }) });
    commands.push({ id: `routine.toggle.${routine.id}`, section: 'routines', title: `${routine.enabled ? 'Pause' : 'Resume'} ${routine.name}`,
      icon: routine.enabled ? Pause : Play, keywords: ['routine', routine.enabled ? 'stop' : 'start', routine.enabled ? 'disable' : 'enable'], searchOnly,
      run: () => void run(async () => { await api.setRoutineEnabled(routine.id, !routine.enabled); notify(`${routine.enabled ? 'Paused' : 'Resumed'} ${routine.name}`); }) });
  }
  // Claude Code's scheduled tasks are read-only pages. There can be many, so they show up when searched for.
  for (const task of claude?.tasks || []) {
    commands.push({ id: `claude.go.${task.id}`, section: 'routines', title: `Go to ${claudeRoutineName(task.name)}`,
      subtitle: `Claude Code · ${task.enabled ? 'On' : 'Paused'}`, icon: Repeat2, keywords: ['routine', 'schedule', 'cron', 'claude'],
      searchOnly: true, run: () => goTo(go, { view: 'claude-routine', id: task.id }) });
  }
  commands.push(
    { id: 'app.undo', section: 'app', title: 'Undo last task action', icon: Undo2, keys: '⌘ Z', keywords: ['revert', 'restore'], run: () => undoTaskAction(run, notify) },
    { id: 'app.settings', section: 'app', title: 'Settings', icon: Settings, keys: '⌘ ,', keywords: ['preferences', 'connections', 'approvals', 'reminders'], run: () => go({ view: 'settings' }) },
    { id: 'app.skills', section: 'app', title: 'Manage skills', icon: Wand2, keywords: ['library', 'skill'], run: () => go({ view: 'skills' }) },
  );
  return commands;
}

function Keys({ keys }: { keys: string }) {
  return <span className="ws-palette-keys">
    {keys.split(' ').map((key, at) => (key === 'then' ? <span key={at}>then</span> : <Kbd key={at}>{key}</Kbd>))}
  </span>;
}

// ⌘K: one box that finds any action by name, shows its shortcut and runs it. Modelled on Godspeed's command palette.
export function CommandPalette(props: Props) {
  const [frozen, setFrozen] = useState<Frozen | null>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [step, setStep] = useState<Step | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  // Where the mouse was when the palette opened, then where it last really moved.
  const pointer = useRef('');
  const mouse = useRef('');
  const latestProps = useRef(props);
  latestProps.current = props;
  // Changes at once, before React re-renders, so handlers and the focus guard always see the real state.
  const isOpen = useRef(false);

  const open = (commandId?: string) => {
    // Another box keeps the keyboard until it closes, and an open document keeps ⌘K for its links.
    if (isOpen.current || document.querySelector('[role="dialog"], .document-open')) return;
    const sets = registeredCommands();
    const commands = [...sets.flatMap((set) => set.commands), ...appCommands(latestProps.current)]
      .sort((a, b) => sections.indexOf(a.section) - sections.indexOf(b.section));
    const direct = commandId ? commands.find((command) => command.id === commandId)?.step : undefined;
    if (commandId && !direct) return;
    returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    pointer.current = mouse.current;
    isOpen.current = true;
    setFrozen({ context: sets.find((set) => set.context)?.context, commands, forQuery: (text) => sets.flatMap((set) => set.forQuery?.(text) || []) });
    setStep(direct ? { step: direct, rootQuery: null } : null);
    setQuery('');
    setActive(0);
  };
  const close = () => {
    isOpen.current = false;
    setFrozen(null);
    setStep(null);
    const target = returnTo.current;
    returnTo.current = null;
    // Focus goes back at once, so J/K carry on from the same row. A command that moves focus does so after this.
    if (target?.isConnected) target.focus();
    else document.querySelector<HTMLElement>('.ws-rows [data-keyboard-current]')?.focus();
  };

  // While open, the palette owns the keyboard. Keys are handled at the window, so they still work if some
  // other part of the app grabs focus in the moment after ⌘K, and typed letters always land in the field.
  const handleKey = useRef<(event: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isOpen.current) { handleKey.current(event); return; }
      const key = event.key.toLowerCase();
      if (!(event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && (key === 'k' || key === 'f'))) return;
      if (event.isComposing || event.defaultPrevented || event.repeat) return;
      // In a rich-text editor ⌘K belongs to the editor (the document editor inserts links with it).
      if (event.target instanceof Element && event.target.closest('[contenteditable="true"]')) return;
      event.preventDefault();
      event.stopPropagation();
      // ⌘F opens the palette straight at Find a task, the way ⌘L opens it at Set label.
      open(key === 'f' ? 'go.find' : undefined);
    };
    const onMouse = (event: MouseEvent) => { mouse.current = `${event.clientX},${event.clientY}`; };
    const onFocus = (event: FocusEvent) => {
      if (isOpen.current && event.target instanceof Node && !input.current?.closest('.ws-palette')?.contains(event.target)) input.current?.focus();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousemove', onMouse, { capture: true, passive: true });
    document.addEventListener('focusin', onFocus, true);
    setCommandPaletteOpener((commandId) => open(commandId));
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousemove', onMouse, true);
      document.removeEventListener('focusin', onFocus, true);
      setCommandPaletteOpener(null);
    };
  }, []);

  const typed = frozen && !step && query.trim() ? frozen.forQuery(query.trim()) : [];
  const rows: Row[] = !frozen ? []
    : step ? step.step.options(query)
      : query.trim() ? [...typed, ...rankCommands(frozen.commands, query)]
        : frozen.commands.filter((command) => !command.searchOnly);
  const index = rows.length ? Math.min(active, rows.length - 1) : -1;
  useLayoutEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [index, frozen, step, query]);

  const back = () => {
    if (step?.rootQuery === null) { close(); return; }
    setQuery(step?.rootQuery || '');
    setStep(null);
    setActive(0);
  };
  // Some commands re-render the row they act on (a new label moves it to another group), which drops focus once the
  // snapshot lands. For a second after a command runs, focus goes back to the selected row, but only if nothing has it.
  const settleFocus = () => {
    const until = performance.now() + 1000;
    const check = () => {
      if (isOpen.current || performance.now() > until) return;
      if (document.activeElement === document.body) document.querySelector<HTMLElement>('.ws-rows [data-keyboard-current]')?.focus();
      window.requestAnimationFrame(check);
    };
    window.requestAnimationFrame(check);
  };
  const execute = (row: Row | undefined) => {
    if (!row) return;
    if ('step' in row && row.step) { setStep({ step: row.step, rootQuery: query }); setQuery(''); setActive(0); return; }
    if (!row.run) return;
    close();
    row.run();
    settleFocus();
  };
  handleKey.current = (event) => {
    if (event.isComposing) return;
    const handled = () => { event.preventDefault(); event.stopPropagation(); };
    const move = (by: number) => { handled(); if (rows.length) setActive((index + by + rows.length) % rows.length); };
    if (event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') { handled(); if (!event.repeat) close(); }
    else if (event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f') handled();
    else if (event.key === 'ArrowDown' || (event.ctrlKey && event.key === 'n')) move(1);
    else if (event.key === 'ArrowUp' || (event.ctrlKey && event.key === 'p')) move(-1);
    else if (event.key === 'Enter') { handled(); if (!event.repeat) execute(rows[index]); }
    else if (event.key === 'Escape') { handled(); if (step) back(); else close(); }
    else if (event.key === 'Backspace' && step && step.rootQuery !== null && !query) { handled(); back(); }
    else if (event.key === 'Tab') handled();
    else if (document.activeElement !== input.current) input.current?.focus();
  };
  if (!frozen) return null;
  // With an empty field the rows sit under section labels; once you type it's one ranked list.
  const sectioned = !step && !query.trim();
  return createPortal(
    <div className="ws-modal-backdrop ws-palette-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <div className="ws-palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="ws-palette-search">
          {step ? <span className="ws-palette-step">{step.step.title}</span> : <Search size={15} aria-hidden="true" />}
          <input ref={input} autoFocus spellCheck={false} role="combobox" aria-expanded="true" aria-controls="ws-palette-list"
            aria-autocomplete="list" aria-activedescendant={index >= 0 ? `ws-palette-${index}` : undefined}
            aria-label={step ? step.step.title : 'Search commands'} placeholder={step ? step.step.placeholder : 'Search commands…'}
            value={query} onChange={(event) => { setQuery(event.target.value); setActive(0); }} />
        </div>
        {frozen.context && !step?.step.standalone && <p className="ws-palette-context">{frozen.context}</p>}
        <div className="ws-palette-list" id="ws-palette-list" role="listbox" aria-label={step ? step.step.title : 'Commands'} ref={list}>
          {rows.map((row, at) => {
            const section = 'section' in row ? row.section : undefined;
            const previous = rows[at - 1];
            const label = sectioned && section && sectionTitles[section] && (!previous || !('section' in previous) || previous.section !== section);
            const Icon = row.icon;
            return <Fragment key={row.id}>
              {label && <div className="ws-palette-section" aria-hidden="true">{sectionTitles[section]}</div>}
              <div id={`ws-palette-${at}`} role="option" aria-selected={at === index} className={`ws-palette-row ${at === index ? 'active' : ''}`}
                // Only a real pointer move changes the highlight, never rows sliding under a resting pointer.
                onMouseMove={(event) => {
                  const position = `${event.clientX},${event.clientY}`;
                  if (position === pointer.current) return;
                  pointer.current = position;
                  if (at !== index) setActive(at);
                }}
                onMouseDown={(event) => event.preventDefault()} onClick={() => execute(row)}>
                {Icon ? <Icon size={15} aria-hidden="true" /> : <span className="ws-palette-icon" aria-hidden="true" />}
                <span className="ws-palette-text"><span>{row.title}</span>{row.subtitle && <small>{row.subtitle}</small>}</span>
                {'current' in row && row.current && <Check size={14} aria-label="Current" />}
                {'keys' in row && row.keys && <Keys keys={row.keys} />}
              </div>
            </Fragment>;
          })}
          {!rows.length && <p className="ws-palette-empty" role="status">
            {step ? step.step.empty : `No command matches “${query.trim()}”.`}
          </p>}
        </div>
        <footer className="ws-palette-foot">↑↓ move · ↵ {step ? 'choose' : 'run'} · esc {step && step.rootQuery !== null ? 'back' : 'close'}</footer>
      </div>
    </div>,
    document.body,
  );
}
