import { useLayoutEffect, type RefObject } from 'react';
import type { Editor } from '@tiptap/react';
import type { Transaction } from '@tiptap/pm/state';

// Measure the visual caret line (including wrapped paragraphs), not its block.
export function useTypewriter(editor: Editor | null, scrollRef: RefObject<HTMLDivElement | null>, enabled: boolean) {
  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    if (!editor || !scroll || !enabled) return;
    let frame = 0;
    let selecting = false;
    const center = () => {
      frame = 0;
      if (editor.isDestroyed || !editor.isFocused || selecting || !editor.state.selection.empty || !scroll.clientHeight) return;
      const caret = editor.view.coordsAtPos(editor.state.selection.head);
      const viewport = scroll.getBoundingClientRect();
      scroll.scrollTop += (caret.top + caret.bottom) / 2 - viewport.top - scroll.clientHeight / 2;
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(center); };
    const resize = () => {
      // Space at both ends lets even the first and last lines reach the center.
      scroll.style.setProperty('--document-typewriter-space', `${scroll.clientHeight / 2}px`);
      schedule();
    };
    const transaction = ({ transaction }: { transaction: Transaction }) => {
      if (transaction.docChanged || transaction.selectionSet || transaction.scrolledIntoView) schedule();
    };
    const down = () => { selecting = true; };
    const up = () => { if (selecting) { selecting = false; schedule(); } };
    const observer = new ResizeObserver(resize);
    observer.observe(scroll);
    observer.observe(editor.view.dom);
    editor.on('transaction', transaction);
    editor.on('focus', schedule);
    editor.view.dom.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    resize();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      editor.off('transaction', transaction);
      editor.off('focus', schedule);
      editor.view.dom.removeEventListener('pointerdown', down);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      const before = editor.view.dom.getBoundingClientRect().top;
      scroll.style.removeProperty('--document-typewriter-space');
      // Removing the breathing room should not jump away from the passage.
      scroll.scrollTop += editor.view.dom.getBoundingClientRect().top - before;
    };
  }, [editor, scrollRef, enabled]);
}
