import { useLayoutEffect, type RefObject } from 'react';
import type { Editor } from '@tiptap/react';

/** Keep each file's caret and reading position independent of the workspace layout. */
export function useDocumentPosition(editor: Editor | null, scroll: RefObject<HTMLDivElement | null>, key: string, enabled: boolean) {
  useLayoutEffect(() => {
    if (!enabled || !editor || !scroll.current) return;
    const element = scroll.current;
    const storageKey = `${key}:position`;
    let frame = 0;
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (saved && Number.isFinite(saved.from) && Number.isFinite(saved.to) && Number.isFinite(saved.scrollTop)) {
        const limit = editor.state.doc.content.size;
        editor.commands.setTextSelection({ from: Math.min(limit, Math.max(0, saved.from)), to: Math.min(limit, Math.max(0, saved.to)) });
        frame = requestAnimationFrame(() => { element.scrollTop = Math.max(0, saved.scrollTop); });
      }
    } catch { /* An invalid or unavailable preference never blocks editing. */ }
    let position = { from: editor.state.selection.from, to: editor.state.selection.to, scrollTop: element.scrollTop };
    const capture = () => { if (!editor.isDestroyed) position = { from: editor.state.selection.from, to: editor.state.selection.to, scrollTop: element.scrollTop }; };
    editor.on('selectionUpdate', capture);
    element.addEventListener('scroll', capture);
    return () => {
      cancelAnimationFrame(frame);
      editor.off('selectionUpdate', capture); element.removeEventListener('scroll', capture);
      capture();
      try { localStorage.setItem(storageKey, JSON.stringify(position)); } catch { /* Optional reading position. */ }
    };
  }, [editor, key, enabled, scroll]);
}
