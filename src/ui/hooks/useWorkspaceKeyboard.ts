import { useEffect } from 'react';
import { api, isTyping, type Route, type Run } from '../views/common';

const listShortcuts = { i: 'inbox', t: 'today', u: 'upcoming', w: 'team', n: 'needs', c: 'completed' } as const;

export function useWorkspaceKeyboard(
  run: Run,
  setRoute: (route: Route) => void,
  setNotice: (message: string) => void,
  enabled = true,
) {
  // One focus graph for the sidebar, list and detail panes. Text editors keep native keys.
  useEffect(() => {
    if (!enabled) return;
    let pending = false;
    let timer = 0;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (document.querySelector('.ui-feedback-shield') || (event.target instanceof Element && event.target.closest('[data-ui-feedback]'))) return;
      if (document.querySelector('[role="dialog"]')) return;
      // The Files popover consumes Escape before document/pane navigation.
      if (event.key === 'Escape' && document.querySelector('.ws-document-files')) return;
      const documentWorkspace = document.querySelector<HTMLElement>('.document-open');
      const documentPane = documentWorkspace?.querySelector<HTMLElement>('[data-keyboard-pane="document"]');
      const keyTarget = event.target instanceof Element ? event.target : null;
      if (keyTarget?.closest('.ws-task-divider')) return;
      if (keyTarget?.closest('.ws-document-companion') && event.key !== 'F6') {
        if (event.key === 'Escape' && !event.isComposing) {
          event.preventDefault();
          keyTarget.closest('.ws-document-companion')?.querySelector<HTMLButtonElement>('[data-close-companion]')?.click();
        }
        return;
      }
      if (documentPane && !event.isComposing) {
        if (documentWorkspace?.classList.contains('ws-document-first')) {
          const inEditor = !!keyTarget?.closest('[data-keyboard-pane="document"]');
          const focusChat = () => {
            const toggle = documentWorkspace.querySelector<HTMLButtonElement>('[data-document-chat]');
            if (toggle?.getAttribute('aria-pressed') !== 'true') toggle?.click();
            requestAnimationFrame(() => documentWorkspace.querySelector<HTMLElement>('textarea[aria-label="Message"]')?.focus());
          };
          if (event.key === 'Escape' && !document.querySelector('.ws-picker, .ws-document-insert')) {
            event.preventDefault(); documentWorkspace.querySelector<HTMLButtonElement>('[data-close-document]')?.click();
          } else if (event.key === 'F6') {
            event.preventDefault();
            if (inEditor) focusChat();
            else documentPane.querySelector<HTMLElement>('.ws-document-prose')?.focus();
          } else if (event.metaKey && event.key.toLowerCase() === 'n') {
            event.preventDefault(); setNotice('Return to the list before starting a new task or conversation');
          } else if (!isTyping(event) && !event.metaKey && !event.ctrlKey && !event.altKey) {
            if (inEditor && ['h', 'ArrowLeft'].includes(event.key)) { event.preventDefault(); focusChat(); }
            if (keyTarget?.closest('.ws-thread') && ['l', 'ArrowRight'].includes(event.key)) { event.preventDefault(); documentPane.focus(); }
          }
          return;
        }
        const focusMode = documentPane.classList.contains('ws-document-focus');
        if (event.key === 'Escape' && !document.querySelector('.ws-picker, .ws-document-insert')) {
          event.preventDefault();
          documentWorkspace?.querySelector<HTMLButtonElement>(focusMode ? '[data-document-focus]' : '[data-close-document]')?.click();
          return;
        }
        if (event.key === 'F6') {
          event.preventDefault();
          if (focusMode) { documentPane.querySelector<HTMLElement>('.ws-document-prose')?.focus(); return; }
          const inDocument = !!keyTarget?.closest('[data-keyboard-pane="document"]');
          const tab = documentWorkspace?.querySelector<HTMLButtonElement>(`.ws-document-tabs button:${inDocument ? 'first' : 'last'}-child`);
          tab?.click();
          documentWorkspace?.querySelector<HTMLElement>(inDocument ? 'textarea[aria-label="Message"]' : '.ws-document-prose')?.focus();
          return;
        }
        if (focusMode) return;
        if (keyTarget?.getAttribute('role') === 'separator') return;
        if (!isTyping(event) && !event.metaKey && !event.ctrlKey && !event.altKey) {
          if (keyTarget?.closest('.ws-sidebar') && ['l', 'ArrowRight'].includes(event.key)) {
            event.preventDefault();
            documentWorkspace?.querySelector<HTMLButtonElement>('.ws-document-tabs button:first-child')?.click();
            documentWorkspace?.querySelector<HTMLElement>('textarea[aria-label="Message"]')?.focus(); return;
          }
          if (keyTarget?.closest('[data-keyboard-pane="document"]') && ['h', 'ArrowLeft'].includes(event.key)) {
            event.preventDefault(); documentWorkspace?.querySelector<HTMLElement>('textarea[aria-label="Message"]')?.focus(); return;
          }
          if (keyTarget?.closest('.ws-thread') && ['h', 'ArrowLeft'].includes(event.key)) {
            event.preventDefault(); documentWorkspace?.querySelector<HTMLButtonElement>('[data-close-document]')?.click(); return;
          }
          if (keyTarget?.closest('.ws-thread') && ['l', 'ArrowRight'].includes(event.key)) {
            event.preventDefault(); documentPane.focus(); return;
          }
        }
      }
      if (event.metaKey && !event.ctrlKey && !event.altKey) {
        if (event.key.toLowerCase() === 'n') {
          event.preventDefault();
          const newThread = document.querySelector<HTMLInputElement>('[data-new-thread]');
          if (newThread) {
            if (newThread.getClientRects().length) newThread.focus();
            else setNotice('Close the document with Escape to start a new thread');
            return;
          }
          const taskView = document.querySelector<HTMLElement>('[data-quick-add]')?.dataset.taskView;
          if (taskView !== 'inbox' && !taskView?.startsWith('list:')) setRoute({ view: 'tasks', list: 'today' });
          window.requestAnimationFrame(() =>
            window.requestAnimationFrame(() =>
              document.querySelector<HTMLInputElement>('[data-quick-add]')?.focus(),
            ),
          );
          return;
        }
        if (event.key.toLowerCase() === 'z' && !event.shiftKey && !isTyping(event)) {
          event.preventDefault();
          void run(async () => {
            const undone = await api.undoTaskAction();
            setNotice(undone ? `Undid ${undone.action}` : 'Nothing to undo');
          });
        }
        return;
      }
      if (event.defaultPrevented || isTyping(event) || event.metaKey || event.ctrlKey || event.altKey)
        return;
      if (pending) {
        pending = false;
        window.clearTimeout(timer);
        const list = listShortcuts[event.key as keyof typeof listShortcuts];
        if (list) {
          event.preventDefault();
          setRoute({ view: 'tasks', list });
          window.requestAnimationFrame(() =>
            window.requestAnimationFrame(() => {
              const pane = document.querySelector<HTMLElement>('[data-keyboard-pane="list"]');
              (pane?.querySelector<HTMLElement>('[data-keyboard-current]') ||
                pane?.querySelector<HTMLElement>('[data-keyboard-item]') || pane)?.focus();
            }),
          );
        }
        return;
      }
      if (event.key === 'g') {
        pending = true;
        timer = window.setTimeout(() => {
          pending = false;
        }, 900);
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      const pane = target?.closest<HTMLElement>('[data-keyboard-pane]');
      const name = pane?.dataset.keyboardPane || (target === document.body
        ? document.querySelector('[data-keyboard-pane="list"]') ? 'list' : 'page'
        : '');
      const sidebar = document.querySelector<HTMLElement>('[data-keyboard-pane="sidebar"]');
      const list = document.querySelector<HTMLElement>('[data-keyboard-pane="list"]');
      const detail = document.querySelector<HTMLElement>('[data-keyboard-pane="detail"]');
      const page = document.querySelector<HTMLElement>('[data-keyboard-pane="page"]');
      const focusCurrent = (container: HTMLElement | null, selector: string) => {
        const item =
          container?.querySelector<HTMLElement>('[data-keyboard-current]') ||
          container?.querySelector<HTMLElement>(selector);
        (item || container)?.focus();
      };
      if (name === 'list' && list?.closest('.ws-tasks')) {
        if (event.key === 'l' || event.key === 'ArrowRight') { event.preventDefault(); return; }
      }
      if (event.key === 'h' || event.key === 'ArrowLeft') {
        if (name === 'list' || name === 'page') focusCurrent(sidebar, '[aria-current="page"]');
        else if (name === 'detail') focusCurrent(list, '[data-keyboard-item]');
        else return;
        event.preventDefault();
        return;
      }
      if (event.key === 'l' || event.key === 'ArrowRight') {
        if (name === 'sidebar') {
          const focusedItem = target?.closest<HTMLElement>('[data-nav-item]');
          if (focusedItem && focusedItem.getAttribute('aria-current') !== 'page')
            focusedItem.click();
          window.requestAnimationFrame(() =>
            focusCurrent(
              document.querySelector<HTMLElement>('[data-keyboard-pane="list"]') ||
                document.querySelector<HTMLElement>('[data-keyboard-pane="page"]'),
              '[data-keyboard-item], button:not(:disabled), a[href]',
            ),
          );
        } else if (name === 'list') {
          const current =
            list?.querySelector<HTMLElement>('[data-keyboard-current]') ||
            list?.querySelector<HTMLElement>('[data-keyboard-item]');
          if (!current) return;
          if (current.hasAttribute('data-task-row')) current.click();
          window.requestAnimationFrame(() => {
            const detail = document.querySelector<HTMLElement>('[data-keyboard-pane="detail"]');
            const chat = detail?.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]:not(:disabled)');
            (chat || detail?.querySelector<HTMLElement>('[aria-label="Task notes"]') || detail)?.focus();
          });
        } else return;
        event.preventDefault();
        return;
      }
      if (!['j', 'k', 'ArrowDown', 'ArrowUp'].includes(event.key)) return;
      const container =
        name === 'sidebar' ? sidebar : name === 'list' ? list : name === 'detail' ? detail : name === 'page' ? page : null;
      if (!container) return;
      const selector =
        name === 'sidebar'
          ? '[data-nav-item]'
          : name === 'list'
            ? '[data-keyboard-item]'
            : 'button:not(:disabled), a[href], input, textarea';
      const items = [...container.querySelectorAll<HTMLElement>(selector)].filter(item => item.getClientRects().length);
      if (!items.length) return;
      const current = target ? items.findIndex((item) => item === target || item.contains(target)) : -1;
      const down = event.key === 'j' || event.key === 'ArrowDown';
      const start = current < 0 ? (down ? -1 : items.length) : current;
      const next = items[Math.max(0, Math.min(items.length - 1, start + (down ? 1 : -1)))];
      next?.focus();
      if (name === 'list' && next?.tagName === 'BUTTON') next.click();
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [run, enabled, setRoute, setNotice]);
}
