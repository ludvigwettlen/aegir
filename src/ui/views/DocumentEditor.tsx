import { forwardRef, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { TableKit } from '@tiptap/extension-table';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Image from '@tiptap/extension-image';
import { AlignVerticalJustifyCenter, Copy, Maximize2, Minimize2, PanelLeft, Send, X } from 'lucide-react';
import { closeHistory } from '@tiptap/pm/history';
import { hasUnsupportedMarkdown, markdownPath, type DocumentReference, type WorkspaceDocument } from '../../../shared/documents';
import { api } from './common';
import { DocumentLinkSource } from '../document-links';
import { DocumentTable } from '../document-tables';
import { DocumentHeadingMarkers } from '../document-headings';
import { DocumentComment, DocumentCommentParagraph, commentName } from '../document-comments';
import { removeAllComments, reviewComments, type ListedComment } from '../document-review';
import { unwrapComments } from '../../../shared/document-comments';
import type { ReviewBatch } from '../../../shared/document-review';
import { DocumentComments } from './DocumentComments';
import { DocumentCommands } from './DocumentCommands';
import { Button } from '../design-system/primitives';
import { useTypewriter } from '../hooks/useTypewriter';
import { DocumentCompanion } from './DocumentCompanion';

export type DocumentEditorHandle = { save: () => Promise<boolean> };
type Draft = { content: string; revision: string };
const errorText = (error: unknown) => String(error).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, '');

// review: sends the document's comments to Claude in one message. busy while Claude is working on the conversation.
export type DocumentReview = { busy: boolean; send: (batch: ReviewBatch) => Promise<void> };

export const DocumentEditor = forwardRef<DocumentEditorHandle, {
  document: WorkspaceDocument; threadId: string; onClose: () => void; headerActions?: ReactNode;
  onSelection: (selection: DocumentReference | null) => void;
  onOpenDocument: (path: string) => void;
  review?: DocumentReview;
}>(function DocumentEditor({ document: initial, threadId, onClose, onSelection, onOpenDocument, headerActions, review }, ref) {
  const storageKey = `aegir-document:${threadId}:${initial.path}`;
  const [recovered] = useState<Draft | null>(() => {
    try { const draft = JSON.parse(localStorage.getItem(storageKey) || 'null'); return typeof draft?.content === 'string' && typeof draft?.revision === 'string' ? draft : null; } catch { return null; }
  });
  const base = useRef({ ...initial, revision: recovered?.revision || initial.revision });
  const content = useRef(recovered?.content ?? initial.content);
  const dirty = useRef(Boolean(recovered));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Promise<boolean> | null>(null);
  const [status, setStatus] = useState(recovered ? 'Recovered local edits' : 'Saved');
  const [error, setError] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);
  // A short line in the header's status spot: Copied, Sent 3 comments to Claude.
  const notify = (text: string) => {
    if (copyTimer.current) clearTimeout(copyTimer.current);
    setCopyStatus(text);
    copyTimer.current = setTimeout(() => setCopyStatus(''), 3000);
  };
  const copy = async () => {
    if (copyTimer.current) clearTimeout(copyTimer.current);
    try {
      await navigator.clipboard.writeText(content.current);
      setCopyStatus('Copied');
    } catch {
      setCopyStatus('Could not copy. Try again.');
    }
    copyTimer.current = setTimeout(() => setCopyStatus(''), 3000);
  };
  const [diskChanged, setDiskChanged] = useState(false);
  const [showReload, setShowReload] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [typewriterMode, setTypewriterMode] = useState(false);
  const [showCompanion, setShowCompanion] = useState(true);
  const companionId = useId();
  const companionToggle = useRef<HTMLDivElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const viewport = scroll.current?.parentElement;
    if (!viewport) return;
    const fit = () => { if (viewport.clientWidth < 760) setShowCompanion(false); };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);
  // Preserve content we cannot faithfully represent instead of silently deleting it on save.
  const [unsupported, setUnsupported] = useState(() => hasUnsupportedMarkdown(content.current));
  const save = async (): Promise<boolean> => {
    if (timer.current) clearTimeout(timer.current);
    if (pending.current) { if (!await pending.current) return false; return save(); }
    if (!dirty.current) return true;
    const snapshot = content.current;
    setStatus('Saving…');
    pending.current = api.saveDocument(threadId, initial.path, base.current.revision, snapshot).then(saved => {
      base.current = saved;
      dirty.current = content.current !== snapshot;
      try {
        if (!dirty.current) localStorage.removeItem(storageKey);
        else localStorage.setItem(storageKey, JSON.stringify({ content: content.current, revision: saved.revision }));
      } catch { /* The file save succeeded; recovery will be retried on the next edit. */ }
      if (!dirty.current) setStatus('Saved');
      setError(''); setDiskChanged(false);
      return true;
    }).catch(cause => { setError(errorText(cause)); setStatus('Not saved'); return false; });
    const result = await pending.current;
    pending.current = null;
    if (result && content.current !== snapshot) return save();
    return result;
  };
  const saveRef = useRef(save); saveRef.current = save;
  useImperativeHandle(ref, () => ({ save: () => saveRef.current() }));
  const editor = useEditor({
    extensions: [StarterKit.configure({ link: { openOnClick: false }, underline: false }), Markdown, TableKit.configure({ table: false }), DocumentTable, DocumentHeadingMarkers, DocumentComment, DocumentCommentParagraph, TaskList, TaskItem.configure({ nested: true }), Image,
      DocumentLinkSource.configure({ openLink: href => {
        const path = markdownPath(href);
        if (path) onOpenDocument(path.startsWith('/') ? path : [...initial.path.split('/').slice(0, -1), path].join('/'));
        else void api.openExternal(href).catch(cause => setError(errorText(cause)));
      } }),
    ],
    content: content.current, contentType: 'markdown', editable: !unsupported,
    editorProps: { attributes: { class: 'ws-document-prose', 'aria-label': 'Document', role: 'textbox', 'aria-multiline': 'true' } },
    onUpdate: ({ editor }) => {
      content.current = editor.getMarkdown();
      dirty.current = true;
      try { localStorage.setItem(storageKey, JSON.stringify({ content: content.current, revision: base.current.revision })); }
      catch { setError('Local recovery storage is full. Keep this document open until it is saved.'); }
      setStatus('Unsaved edits');
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void saveRef.current(), 800);
    },
    onSelectionUpdate: ({ editor }) => {
      const { from, to } = editor.state.selection;
      const text = editor.state.doc.textBetween(from, to, '\n').trim();
      onSelection(text ? { path: initial.path, text } : null);
    },
  });
  useTypewriter(editor, scroll, typewriterMode && !unsupported);

  // The comments waiting to go to Claude, and the text as it was when the last batch went (comments left out), to
  // tell Claude whether you also edited the text yourself.
  const [comments, setComments] = useState<ListedComment[]>([]);
  const [sending, setSending] = useState(false);
  const plain = useRef<string | null>(null);
  useEffect(() => {
    if (!editor) return;
    plain.current ??= unwrapComments(editor.getMarkdown());
    const sync = ({ transaction }: { transaction: { docChanged: boolean } }) => { if (transaction.docChanged) setComments(reviewComments(editor.state.doc)); };
    setComments(reviewComments(editor.state.doc));
    editor.on('transaction', sync);
    return () => { editor.off('transaction', sync); };
  }, [editor]);
  const canSend = Boolean(review && editor?.isEditable && comments.length && !review.busy && !sending);
  // The comments leave the file first and the file is saved, so Claude never reads them twice; then one message goes.
  // If either step fails, the comments go back where they were.
  const sendComments = async () => {
    if (!editor || !review || !canSend) return;
    const batch: ReviewBatch = {
      path: initial.path, comments: comments.map(({ passage, text }) => ({ passage, text })),
      edited: plain.current !== null && unwrapComments(editor.getMarkdown()) !== plain.current,
    };
    setSending(true);
    const tr = closeHistory(editor.state.tr);
    const taken = removeAllComments(tr);
    editor.view.dispatch(tr);
    editor.view.dispatch(closeHistory(editor.state.tr));
    const stripped = editor.state.doc;
    const putBack = () => {
      if (!editor.state.doc.eq(stripped)) return false;
      const restore = closeHistory(editor.state.tr);
      const mark = editor.schema.marks[commentName];
      for (const range of taken) restore.addMark(range.from, range.to, mark.create({ id: range.id, text: range.text }));
      editor.view.dispatch(restore);
      return true;
    };
    try {
      if (!await save()) { putBack(); return; }
      await review.send(batch);
      plain.current = unwrapComments(editor.getMarkdown());
      notify(batch.comments.length === 1 ? 'Sent 1 comment to Claude' : `Sent ${batch.comments.length} comments to Claude`);
    } catch (cause) {
      notify(putBack() ? 'Not sent. Your comments are back in the document.' : 'Not sent. The document changed, so the comments could not be put back.');
      console.error(cause);
    } finally { setSending(false); }
  };
  const sendRef = useRef(sendComments); sendRef.current = sendComments;
  // ⇧⌘↵ in the document sends the comments.
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!(event.metaKey && event.shiftKey && event.key === 'Enter') || event.isComposing) return;
      if (!(event.target instanceof Element && event.target.closest('.ws-document'))) return;
      event.preventDefault(); event.stopPropagation();
      void sendRef.current();
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, []);
  const sendTitle = !review ? '' : review.busy ? 'Claude is working. Send when it finishes; your comments are saved in the file.'
    : 'Send every comment to Claude in one message (⇧⌘↵)';
  const sendLabel = comments.length === 1 ? 'Send 1 comment' : `Send ${comments.length} comments`;
  useEffect(() => { editor?.setEditable(!unsupported, false); }, [editor, unsupported]);
  useEffect(() => {
    let active = true;
    let checking = false;
    const check = async () => {
      if (!active || checking || pending.current) return;
      checking = true;
      const checkedBase = base.current;
      try {
        const latest = await api.readDocument(threadId, initial.path);
        if (!active || pending.current || checkedBase !== base.current || latest.revision === base.current.revision) return;
        if (dirty.current) {
          setDiskChanged(true); return;
        }
        base.current = latest; content.current = latest.content;
        setUnsupported(hasUnsupportedMarkdown(latest.content));
        editor?.commands.setContent(latest.content, { contentType: 'markdown', emitUpdate: false });
        if (editor) plain.current = unwrapComments(editor.getMarkdown());
        onSelection(null); setStatus('Updated from disk');
      } catch (cause) { if (active) setError(errorText(cause)); }
      finally { checking = false; }
    };
    const interval = setInterval(() => void check(), 3000);
    window.addEventListener('focus', check);
    return () => { active = false; clearInterval(interval); window.removeEventListener('focus', check); if (timer.current) clearTimeout(timer.current); void saveRef.current(); };
  }, [editor, threadId, initial.path]);
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault(); void saveRef.current();
      }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, []);
  const reload = async () => {
    if (timer.current) clearTimeout(timer.current);
    if (pending.current) await pending.current;
    try {
      const latest = await api.readDocument(threadId, initial.path);
      base.current = latest; content.current = latest.content;
      dirty.current = false; setUnsupported(hasUnsupportedMarkdown(latest.content));
      localStorage.removeItem(storageKey);
      editor?.commands.setContent(latest.content, { contentType: 'markdown', emitUpdate: false });
      if (editor) plain.current = unwrapComments(editor.getMarkdown());
      onSelection(null); setError(''); setDiskChanged(false); setShowReload(false); setStatus('Saved');
    } catch (cause) { setError(errorText(cause)); }
  };
  return <section className={`ws-document${focusMode ? ' ws-document-focus' : ''}${typewriterMode && !unsupported ? ' ws-document-typewriter' : ''}`} data-keyboard-pane="document" tabIndex={-1} aria-label={`Editing ${initial.path}`}>
    <header className="ws-document-head"><strong title={initial.path}>{initial.path}</strong>{headerActions}
      <div ref={companionToggle} className="ws-document-modes" role="group" aria-label="Writing modes">
        <Button variant="ghost" size="sm" data-companion-toggle aria-label="Outline and notes" aria-expanded={showCompanion} aria-controls={companionId} title="Show or hide outline and notes" onClick={() => setShowCompanion(value => !value)}><PanelLeft size={15} aria-hidden="true" /></Button>
        <Button variant="ghost" size="sm" data-document-focus aria-label="Focus mode" aria-pressed={focusMode} title={focusMode ? 'Exit focus mode (Escape)' : 'Focus mode: fill the window'} onClick={() => { setFocusMode(value => !value); editor?.commands.focus(undefined, { scrollIntoView: false }); }}>{focusMode ? <Minimize2 size={15} aria-hidden="true" /> : <Maximize2 size={15} aria-hidden="true" />}</Button>
        <Button variant="ghost" size="sm" aria-label="Typewriter mode" aria-pressed={typewriterMode && !unsupported} disabled={unsupported} title="Typewriter mode: keep the current line centred" onClick={() => { setTypewriterMode(value => !value); editor?.commands.focus(undefined, { scrollIntoView: false }); }}><AlignVerticalJustifyCenter size={15} aria-hidden="true" /></Button>
      </div>
      {review && comments.length > 0 && !unsupported && <Button size="sm" data-send-comments disabled={!canSend} title={sendTitle} onClick={() => void sendComments()}>
        <Send size={14} aria-hidden="true" />{sending ? 'Sending…' : sendLabel}</Button>}
      <button className="ws-btn ghost" aria-label="Copy document" title="Copy all Markdown text" onClick={() => void copy()}><Copy size={14} />Copy</button><span role="status">{copyStatus || (unsupported ? 'Read only' : status)}</span><button className="ws-icon-btn" data-close-document aria-label="Close document" onClick={() => void save().then(ok => { if (ok) onClose(); })}><X size={15} /></button></header>
    {unsupported && <p className="ws-document-alert">This document contains embedded HTML, metadata, or footnotes. It is read only to preserve that content.</p>}
    {(error || diskChanged) && <div className="ws-document-alert" role="alert"><span>{error || 'The file changed on disk. Your edits are kept here.'}</span><button className="ws-btn" onClick={() => void save()}>Retry save</button><button className="ws-btn" onClick={() => setShowReload(true)}>Reload file</button></div>}
    {showReload && <div className="ws-document-alert"><span>Replace your local edits with the version on disk?</span><button className="ws-btn" onClick={() => void reload()}>Discard edits and reload</button><button className="ws-btn" onClick={() => setShowReload(false)}>Keep editing</button></div>}
    <div className="ws-document-viewport" data-companion-open={showCompanion}>
      <DocumentCompanion editor={editor} scrollRef={scroll} storageKey={`${storageKey}:scratchpad`} open={showCompanion} id={companionId}
        comments={review && !unsupported ? { list: comments, send: () => void sendComments(), canSend, label: sending ? 'Sending…' : sendLabel, title: sendTitle } : undefined}
        onClose={() => { setShowCompanion(false); companionToggle.current?.querySelector<HTMLButtonElement>('[data-companion-toggle]')?.focus(); }}
        onNavigate={() => { if ((scroll.current?.parentElement?.clientWidth ?? 0) < 760) setShowCompanion(false); }} />
      <div ref={scroll} className="ws-document-scroll"><EditorContent editor={editor} /></div>
    </div>
    <DocumentCommands editor={editor} />
    <DocumentComments editor={editor} />
  </section>;
});
