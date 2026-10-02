import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { TableKit } from '@tiptap/extension-table';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Image from '@tiptap/extension-image';
import { Copy, X } from 'lucide-react';
import { hasUnsupportedMarkdown, markdownPath, type DocumentReference, type WorkspaceDocument } from '../../../shared/documents';
import { api } from './common';
import { DocumentLinkSource } from '../document-links';
import { DocumentTable } from '../document-tables';

export type DocumentEditorHandle = { save: () => Promise<boolean> };
type Draft = { content: string; revision: string };
const errorText = (error: unknown) => String(error).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, '');

export const DocumentEditor = forwardRef<DocumentEditorHandle, {
  document: WorkspaceDocument; threadId: string; onClose: () => void; headerActions?: ReactNode;
  onSelection: (selection: DocumentReference | null) => void;
  onOpenDocument: (path: string) => void;
}>(function DocumentEditor({ document: initial, threadId, onClose, onSelection, onOpenDocument, headerActions }, ref) {
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
    extensions: [StarterKit.configure({ link: { openOnClick: false }, underline: false }), Markdown, TableKit.configure({ table: false }), DocumentTable, TaskList, TaskItem.configure({ nested: true }), Image,
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
      onSelection(null); setError(''); setDiskChanged(false); setShowReload(false); setStatus('Saved');
    } catch (cause) { setError(errorText(cause)); }
  };
  return <section className="ws-document" data-keyboard-pane="document" tabIndex={-1} aria-label={`Editing ${initial.path}`}>
    <header className="ws-document-head"><strong title={initial.path}>{initial.path}</strong>{headerActions}<button className="ws-btn ghost" aria-label="Copy document" title="Copy all Markdown text" onClick={() => void copy()}><Copy size={14} />Copy</button><span role="status">{copyStatus || (unsupported ? 'Read only' : status)}</span><button className="ws-icon-btn" data-close-document aria-label="Close document" onClick={() => void save().then(ok => { if (ok) onClose(); })}><X size={15} /></button></header>
    {unsupported && <p className="ws-document-alert">This document contains embedded HTML, metadata, or footnotes. It is read only to preserve that content.</p>}
    {(error || diskChanged) && <div className="ws-document-alert" role="alert"><span>{error || 'The file changed on disk. Your edits are kept here.'}</span><button className="ws-btn" onClick={() => void save()}>Retry save</button><button className="ws-btn" onClick={() => setShowReload(true)}>Reload file</button></div>}
    {showReload && <div className="ws-document-alert"><span>Replace your local edits with the version on disk?</span><button className="ws-btn" onClick={() => void reload()}>Discard edits and reload</button><button className="ws-btn" onClick={() => setShowReload(false)}>Keep editing</button></div>}
    <div className="ws-document-scroll"><EditorContent editor={editor} /></div>
  </section>;
});
