import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import type { Node } from '@tiptap/pm/model';
import { closeHistory } from '@tiptap/pm/history';
import { MessageSquarePlus, X } from 'lucide-react';
import { Button } from '../design-system/primitives';
import { canComment, commentAt, commentName, commentsIn } from '../document-comments';
import { decodeComment, type PassageComment } from '../../../shared/document-comments';

type Anchor = { from: number; to: number; left: number; top: number; comment?: PassageComment };
type Draft = Anchor & { doc: Node; text: string };

export function DocumentComments({ editor }: { editor: Editor | null }) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState('');
  const panel = useRef<HTMLDivElement>(null);
  const hover = useRef<string | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const refresh = useRef(() => {});
  const dismissed = useRef('');
  const draftRef = useRef(draft); draftRef.current = draft;
  const signature = () => editor ? `${editor.state.selection.from}:${editor.state.selection.to}:${hover.current || ''}` : '';
  const close = (focus = false) => {
    dismissed.current = signature(); setAnchor(null); setDraft(null); setError('');
    if (focus) editor?.commands.focus();
  };
  const begin = (target: Anchor) => {
    if (!editor?.isEditable) return;
    setDraft({ ...target, doc: editor.state.doc, text: target.comment?.text || '' }); setError('');
  };
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    const sync = () => {
      if (draftRef.current) return;
      const selection = editor.state.selection;
      const comment = hover.current ? commentsIn(editor.state.doc).find(item => item.id === hover.current)
        : editor.isFocused && selection.empty ? commentAt(editor.state.doc, selection.from) : undefined;
      const selected = editor.isEditable && editor.isFocused && canComment(editor.state.doc, selection);
      if ((!comment && !selected) || dismissed.current === signature()) { setAnchor(null); return; }
      const from = comment?.from ?? selection.from;
      const to = comment?.to ?? selection.to;
      const rect = editor.view.coordsAtPos(from);
      const pane = dom.closest('.ws-document')!.getBoundingClientRect();
      const scroll = dom.closest('.ws-document-scroll')!.getBoundingClientRect();
      if (rect.bottom < scroll.top || rect.top > scroll.bottom) { setAnchor(null); return; }
      setAnchor({ from, to, comment,
        left: Math.max(pane.left + 8, Math.min(rect.left, pane.right - 328)),
        top: Math.max(pane.top + 52, Math.min(rect.bottom + 8, window.innerHeight - 320)) });
    };
    refresh.current = sync;
    const scheduleLeave = () => {
      if (leaveTimer.current) clearTimeout(leaveTimer.current);
      leaveTimer.current = setTimeout(() => { hover.current = null; sync(); }, 180);
    };
    const over = (event: MouseEvent) => {
      if (leaveTimer.current) clearTimeout(leaveTimer.current);
      const element = event.target instanceof Element ? event.target.closest('[data-passage-comment]') : null;
      const id = decodeComment(element?.getAttribute('data-passage-comment') || '')?.id;
      if (!id) { scheduleLeave(); return; }
      hover.current = id; sync();
    };
    const leave = (event: MouseEvent) => {
      if (panel.current?.contains(event.relatedTarget as globalThis.Node | null)) return;
      scheduleLeave();
    };
    const transaction = () => { hover.current = null; sync(); };
    const blur = () => {
      // Let focus settle when tabbing from the passage into its controls.
      if (leaveTimer.current) clearTimeout(leaveTimer.current);
      leaveTimer.current = setTimeout(() => { if (!panel.current?.contains(document.activeElement)) sync(); }, 0);
    };
    const outside = (event: PointerEvent) => {
      if (panel.current?.contains(event.target as globalThis.Node)) return;
      if (draftRef.current) return; // Keep an unsaved comment until Save or Cancel.
      hover.current = null; setAnchor(null);
    };
    editor.on('transaction', transaction); editor.on('focus', sync); editor.on('blur', blur);
    dom.addEventListener('mouseover', over); dom.addEventListener('mouseleave', leave);
    const scroll = dom.closest('.ws-document-scroll');
    scroll?.addEventListener('scroll', sync); window.addEventListener('resize', sync);
    window.addEventListener('pointerdown', outside);
    return () => {
      if (leaveTimer.current) clearTimeout(leaveTimer.current);
      editor.off('transaction', transaction); editor.off('focus', sync); editor.off('blur', blur);
      dom.removeEventListener('mouseover', over); dom.removeEventListener('mouseleave', leave);
      scroll?.removeEventListener('scroll', sync); window.removeEventListener('resize', sync);
      window.removeEventListener('pointerdown', outside);
    };
  }, [editor]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!editor || event.defaultPrevented || event.isComposing) return;
      if (event.key === 'Escape' && (draft || anchor)) {
        event.preventDefault(); event.stopPropagation(); close(Boolean(draft)); return;
      }
      if (editor.isFocused && editor.isEditable && (event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'm' && anchor) {
        event.preventDefault(); begin(anchor);
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  });
  if (!editor || (!anchor && !draft)) return null;
  const target = draft || anchor!;
  const update = (text: string | null) => {
    if (!editor.isEditable) return;
    if (draft && !editor.state.doc.eq(draft.doc)) { setError('The document changed. Cancel and select the passage again.'); return; }
    const tr = closeHistory(editor.state.tr);
    const mark = editor.schema.marks[commentName];
    if (target.comment) {
      for (const range of commentsIn(tr.doc).filter(item => item.id === target.comment!.id)) {
        tr.removeMark(range.from, range.to, mark);
        if (text) tr.addMark(range.from, range.to, mark.create({ id: target.comment.id, text }));
      }
    } else if (text && canComment(tr.doc, target)) {
      tr.addMark(target.from, target.to, mark.create({ id: crypto.randomUUID(), text }));
    } else return;
    editor.view.dispatch(tr);
    editor.view.dispatch(closeHistory(editor.state.tr));
    close(true);
  };
  return <div ref={panel} className="ws-document-insert ws-document-comment" style={{ left: target.left, top: target.top }}
    onMouseDown={event => { if (event.target instanceof Element && event.target.closest('button')) event.preventDefault(); }}
    onMouseEnter={() => { if (leaveTimer.current) clearTimeout(leaveTimer.current); }}
    onMouseLeave={() => { if (!draft) { hover.current = null; refresh.current(); } }}>
    {draft ? <form role="dialog" aria-label={draft.comment ? 'Edit comment' : 'Add comment'} onSubmit={event => { event.preventDefault(); if (draft.text.trim()) update(draft.text.trim()); }}>
      <label>Comment<textarea autoFocus maxLength={4000} rows={4} value={draft.text} onChange={event => setDraft({ ...draft, text: event.target.value })}
        onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); if (draft.text.trim()) update(draft.text.trim()); } }} /></label>
      {error && <p role="alert">{error}</p>}
      <div className="ws-comment-actions"><Button type="button" variant="ghost" size="sm" onClick={() => close(true)}>Cancel</Button><Button type="submit" size="sm" disabled={!draft.text.trim()}>Save comment</Button></div>
    </form> : anchor?.comment ? <>
      <div className="ws-comment-heading"><strong>Comment</strong><Button size="sm" icon variant="ghost" aria-label="Dismiss comment" onClick={() => close()}><X size={14} /></Button></div>
      <p className="ws-comment-text" role="status">{anchor.comment.text}</p>
      {editor.isEditable && <div className="ws-comment-actions"><Button size="sm" variant="ghost" onClick={() => update(null)}>Delete comment</Button><Button size="sm" variant="ghost" onClick={() => begin(anchor)}>Edit comment</Button></div>}
    </> : <Button size="sm" variant="ghost" onMouseDown={event => event.preventDefault()} onClick={() => begin(anchor!)}><MessageSquarePlus size={14} />Comment</Button>}
  </div>;
}
