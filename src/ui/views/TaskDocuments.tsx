import { FilePlus2, FileText } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { documentTitle, type WorkspaceDocument, type WorkspaceDocumentEntry } from '../../../shared/documents';
import type { Task } from '../../../shared/types';
import { Button } from '../design-system/primitives';
import { DocumentEditor, type DocumentEditorHandle } from './DocumentEditor';
import { CreateDocumentDialog, DocumentFileLabel, DocumentPicker } from './DocumentFiles';
import { api } from './common';

/** Personal tasks have documents without needing an agent conversation. */
export function TaskDocuments({ task, children }: { task: Task; children: ReactNode }) {
  const [document, setDocument] = useState<WorkspaceDocument | null>(null);
  const [files, setFiles] = useState<WorkspaceDocumentEntry[]>([]);
  const [showFiles, setShowFiles] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  const editor = useRef<DocumentEditorHandle>(null);
  const workspace = useRef<HTMLDivElement>(null);
  const active = useRef(true);
  const openingRef = useRef(false);
  const sequence = useRef(0);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const refreshFiles = async () => {
    const current = ++sequence.current;
    setLoading(true);
    try {
      const items = await api.listDocuments(task.id);
      if (active.current && sequence.current === current) { setFiles(items); setError(''); }
    } catch (cause) {
      if (active.current && sequence.current === current) setError(String(cause).replace(/^Error: /, ''));
    } finally { if (active.current && sequence.current === current) setLoading(false); }
  };
  useEffect(() => {
    const refresh = () => { if (task.outputDir) void refreshFiles(); };
    refresh(); window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [task.outputDir]);
  const focusDocument = () => requestAnimationFrame(() => {
    const pane = workspace.current?.querySelector<HTMLElement>('[data-keyboard-pane="document"]');
    (pane?.querySelector<HTMLElement>('.ws-document-prose[contenteditable="true"]') || pane)?.focus({ preventScroll: true });
  });
  const openDocument = async (path: string) => {
    if (openingRef.current) return;
    openingRef.current = true; setOpening(true); setError('');
    try {
      if (editor.current && !await editor.current.save()) throw new Error('Save the current document before opening another. Your edits are kept in the editor.');
      const file = await api.readDocument(task.id, path);
      if (active.current) { setDocument(file); setShowFiles(false); focusDocument(); }
    } catch (cause) { if (active.current) setError(String(cause).replace(/^Error: /, '')); }
    finally { openingRef.current = false; if (active.current) setOpening(false); }
  };
  const returnFocus = () => workspace.current?.querySelector<HTMLElement>('[data-document-files]')?.focus();
  const startCreate = () => { setShowFiles(false); setShowCreate(true); };
  const actions = <>
    <Button variant="ghost" size="sm" data-document-files disabled={opening} onClick={() => { setShowFiles(true); if (task.outputDir) void refreshFiles(); }}><FileText size={14} aria-hidden="true" />Files</Button>
    <Button variant="ghost" size="sm" disabled={opening} onClick={startCreate}><FilePlus2 size={14} aria-hidden="true" />New document</Button>
  </>;
  return <div ref={workspace} className={`ws-thread-workspace${document ? ' document-open ws-document-first' : ''}`}>
    {!document && <div className="ws-detail-plain">
      {children}
      <div className="ws-row-actions">{actions}</div>
      {!!files.length && <div className="ws-document-preview" aria-label="Task documents">
        {files.slice(0, 3).map(file => <Button key={file.path} variant="ghost" className="ws-document-file-open" disabled={opening} aria-label={`Open ${file.path}`} onClick={() => void openDocument(file.path)}><DocumentFileLabel file={file} compact /></Button>)}
        {files.length > 3 && <Button variant="ghost" size="sm" onClick={() => setShowFiles(true)}>View all · {files.length} documents</Button>}
      </div>}
      {loading && <p className="ws-document-list-status" role="status">Loading documents…</p>}
    </div>}
    {error && !showFiles && <p className="ws-document-list-status" role="alert">{error}</p>}
    {document && <DocumentEditor ref={editor} key={document.path} document={document} threadId={task.id}
      onClose={() => { setDocument(null); void refreshFiles(); requestAnimationFrame(returnFocus); }}
      onSelection={() => {}} onOpenDocument={path => void openDocument(path)}
      workspaceHeader={{ title: <strong title={document.path}>{documentTitle(document.path)}</strong>, actions, backLabel: 'Back to task', busy: opening }} />}
    {showFiles && <DocumentPicker files={files} loading={loading} error={error} opening={opening} threadId={task.id} currentPath={document?.path}
      onRetry={() => void refreshFiles()} onOpen={path => void openDocument(path)} onCreate={startCreate}
      onClose={() => setShowFiles(false)} onReturnFocus={returnFocus} />}
    {showCreate && <CreateDocumentDialog onClose={() => setShowCreate(false)} onReturnFocus={returnFocus} onCreate={async name => {
      if (editor.current && !await editor.current.save()) throw new Error('Save the current document before creating another. Your edits are kept in the editor.');
      const file = await api.createDocument(task.id, name);
      if (!active.current) return;
      setDocument(file); void refreshFiles(); focusDocument();
    }} />}
  </div>;
}
