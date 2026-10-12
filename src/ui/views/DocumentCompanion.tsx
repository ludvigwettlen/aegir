import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import type { Editor } from '@tiptap/react';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { List, MessageSquareText, NotebookPen, Send, X } from 'lucide-react';
import { Button, ToggleGroup } from '../design-system/primitives';
import type { ListedComment } from '../document-review';
import { DocumentScratchpad } from './DocumentScratchpad';

type Heading = { position: number; level: number; text: string };
function headingsIn(doc: ProseMirrorNode) {
  const headings: Heading[] = [];
  doc.descendants((node, position) => {
    if (node.type.name === 'heading') headings.push({ position, level: node.attrs.level, text: node.textContent.trim() || 'Untitled heading' });
  });
  return headings;
}

// comments: the review waiting to go to Claude, listed under Comments with its Send button. Left out where the document
// can't be reviewed (read only, or no conversation to send to).
export type CompanionComments = { list: ListedComment[]; send: () => void; canSend: boolean; label: string; title: string };

export function DocumentCompanion({ editor, scrollRef, storageKey, open, id, onClose, onNavigate, comments }: {
  editor: Editor | null; scrollRef: RefObject<HTMLDivElement | null>; storageKey: string;
  open: boolean; id: string; onClose: () => void; onNavigate: () => void; comments?: CompanionComments;
}) {
  const [mode, setMode] = useState('contents');
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [active, setActive] = useState<number | null>(null);
  const panelId = useId();
  const scrollFrame = useRef(0);
  const jumpFrame = useRef(0);
  useEffect(() => {
    if (!editor) return;
    let doc = editor.state.doc;
    let items = headingsIn(doc);
    setHeadings(items);
    const selection = () => {
      if (doc !== editor.state.doc) {
        doc = editor.state.doc; items = headingsIn(doc); setHeadings(items);
      }
      let current: number | null = null;
      for (const item of items) {
        if (item.position >= editor.state.selection.from) break;
        current = item.position;
      }
      setActive(current);
    };
    const scrolled = () => {
      cancelAnimationFrame(scrollFrame.current);
      scrollFrame.current = requestAnimationFrame(() => {
        const scroll = scrollRef.current;
        if (!scroll || !scroll.clientHeight || editor.isDestroyed) return;
        const typewriter = Boolean(scroll.closest('.ws-document-typewriter'));
        const line = scroll.getBoundingClientRect().top + (typewriter ? scroll.clientHeight / 2 : 48);
        let current: number | null = null;
        for (const item of items) {
          const dom = editor.view.nodeDOM(item.position);
          if (dom instanceof HTMLElement && dom.getBoundingClientRect().top <= line) current = item.position;
          else break;
        }
        setActive(current);
      });
    };
    const scroll = scrollRef.current;
    editor.on('transaction', selection);
    scroll?.addEventListener('scroll', scrolled, { passive: true });
    selection();
    return () => { editor.off('transaction', selection); scroll?.removeEventListener('scroll', scrolled); cancelAnimationFrame(scrollFrame.current); cancelAnimationFrame(jumpFrame.current); };
  }, [editor, scrollRef]);

  const jump = (heading: Heading) => goTo(heading.position + 1);
  const goTo = (position: number) => {
    if (!editor || editor.isDestroyed) return;
    editor.chain().setTextSelection(position).focus(undefined, { scrollIntoView: false }).run();
    onNavigate();
    cancelAnimationFrame(jumpFrame.current);
    jumpFrame.current = requestAnimationFrame(() => {
      const scroll = scrollRef.current;
      if (!scroll || editor.isDestroyed) return;
      const caret = editor.view.coordsAtPos(editor.state.selection.head);
      const typewriter = Boolean(scroll.closest('.ws-document-typewriter'));
      scroll.scrollTop += (caret.top + caret.bottom) / 2 - scroll.getBoundingClientRect().top - (typewriter ? scroll.clientHeight / 2 : 48);
    });
  };

  return <aside id={id} hidden={!open} className="ws-document-companion" aria-label="Document outline and notes" onKeyDown={event => event.stopPropagation()}>
    <header>
      <ToggleGroup size="sm" className="ws-companion-switch" aria-label="Document panel mode" value={mode} onValueChange={setMode} data-mode={mode} data-count={comments ? 3 : 2}>
        <ToggleGroup.Item value="contents" aria-controls={`${panelId}-contents`}><List size={13} aria-hidden="true" />Contents</ToggleGroup.Item>
        <ToggleGroup.Item value="notes" aria-controls={`${panelId}-notes`}><NotebookPen size={13} aria-hidden="true" />Scratchpad</ToggleGroup.Item>
        {comments && <ToggleGroup.Item value="comments" aria-controls={`${panelId}-comments`}><MessageSquareText size={13} aria-hidden="true" />Comments{comments.list.length ? ` ${comments.list.length}` : ''}</ToggleGroup.Item>}
      </ToggleGroup>
      <button className="ws-icon-btn" data-close-companion aria-label="Hide outline and notes" title="Hide panel" onClick={onClose}><X size={13} aria-hidden="true" /></button>
    </header>
    <nav id={`${panelId}-contents`} hidden={mode !== 'contents'} aria-label="Table of contents" className="ws-document-contents">
      {!editor ? <p>Loading headings…</p> : headings.length ? <ol>{headings.map(heading => <li key={heading.position}>
        <button style={{ paddingLeft: 10 + (heading.level - 1) * 10 }} aria-current={active === heading.position ? 'location' : undefined} onClick={() => jump(heading)} title={heading.text}>
          <span className="ws-heading-level" aria-label={`Heading level ${heading.level}`}>H{heading.level}</span><span>{heading.text}</span>
        </button>
      </li>)}</ol> : <p>Add headings to your document to build an outline.</p>}
    </nav>
    {comments && <div id={`${panelId}-comments`} hidden={mode !== 'comments'} className="ws-document-review" aria-label="Comments to send">
      {comments.list.length ? <>
        <ol>{comments.list.map(comment => <li key={comment.id}>
          <button title="Go to this passage" onClick={() => goTo(comment.from + 1)}>
            <span className="ws-review-passage">{comment.passage}</span><span className="ws-review-comment">{comment.text}</span>
          </button>
        </li>)}</ol>
        <footer>
          <Button size="sm" data-send-comments disabled={!comments.canSend} title={comments.title} onClick={comments.send}><Send size={14} aria-hidden="true" />{comments.label}</Button>
          <p>Claude gets them in one message, and they leave the document.</p>
        </footer>
      </> : <p>No comments yet. Select text, then Comment or ⇧⌘M. Send them to Claude together when you are done.</p>}
    </div>}
    <div id={`${panelId}-notes`} hidden={mode !== 'notes'} className="ws-document-scratchpad">
      <DocumentScratchpad key={storageKey} storageKey={storageKey} statusId={`${panelId}-status`} />
    </div>
  </aside>;
}
