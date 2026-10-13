import * as Dialog from '@radix-ui/react-dialog';
import { Check, FileText, FolderSearch, Search, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { documentTitle, type WorkspaceDocumentEntry } from '../../../shared/documents';
import { Button } from '../design-system/primitives';
import { api } from './common';

export function DocumentFileLabel({ file }: { file: WorkspaceDocumentEntry }) {
  const date = new Date(file.modifiedAt);
  const valid = Number.isFinite(date.getTime());
  return <><FileText size={15} aria-hidden="true" /><span className="ws-document-file-name"><strong>{documentTitle(file.path)}</strong>
    <small>{file.path}</small></span>{valid && <time dateTime={file.modifiedAt} title={`Modified ${date.toLocaleString()}`}>{date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time>}</>;
}

export function DocumentPicker({ files, loading, error, opening, threadId, currentPath, onRetry, onOpen, onClose, onReturnFocus }: {
  files: WorkspaceDocumentEntry[]; loading: boolean; error: string; opening: boolean; threadId: string; currentPath?: string;
  onRetry: () => void; onOpen: (path: string) => void; onClose: () => void; onReturnFocus: () => void;
}) {
  const [query, setQuery] = useState('');
  const [revealError, setRevealError] = useState('');
  const [revealing, setRevealing] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const options = useRef<HTMLDivElement>(null);
  const filtered = files.filter(file => `${documentTitle(file.path)} ${file.path}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <Dialog.Root open onOpenChange={open => { if (!open && !opening) onClose(); }}><Dialog.Portal>
    <Dialog.Overlay className="ws-list-dialog-overlay" />
    <Dialog.Content className="ws-list-dialog ws-document-picker" onOpenAutoFocus={event => { event.preventDefault(); search.current?.focus(); }}
      onCloseAutoFocus={event => { event.preventDefault(); requestAnimationFrame(onReturnFocus); }}
      onEscapeKeyDown={event => { if (opening) event.preventDefault(); }}
      onPointerDownOutside={event => { if (opening) event.preventDefault(); }}
      onKeyDown={event => {
        if (!['ArrowDown', 'ArrowUp'].includes(event.key) || event.nativeEvent.isComposing || event.metaKey || event.altKey) return;
        const buttons = [...(options.current?.querySelectorAll<HTMLButtonElement>('[data-file-choice]:not(:disabled)') || [])];
        if (!buttons.length) return;
        event.preventDefault();
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus();
      }}>
      <div className="ws-move-title"><Dialog.Title>Documents</Dialog.Title><Button variant="ghost" size="sm" icon aria-label="Close document picker" disabled={opening} onClick={onClose}><X size={16} /></Button></div>
      <Dialog.Description>Markdown files in this conversation, most recently updated first.</Dialog.Description>
      <div className="ws-move-search"><Search size={16} aria-hidden="true" /><input ref={search} aria-label="Search documents" placeholder="Search documents…" value={query} onChange={event => setQuery(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter' && filtered[0] && !opening) { event.preventDefault(); onOpen(filtered[0].path); } }} /></div>
      {loading && <p role="status">Loading documents…</p>}
      {error && <div role="alert" className="ws-field-error">{error}<Button variant="ghost" size="sm" disabled={loading || opening} onClick={onRetry}>Refresh documents</Button></div>}
      <div ref={options} className="ws-document-picker-options" aria-label="Workspace files" aria-busy={loading || opening}>
        {filtered.map(file => <div key={file.path} className="ws-document-file-row">
          <Button variant="ghost" className="ws-document-file-open" data-file-choice aria-label={`Open ${file.path}`} aria-current={currentPath === file.path ? 'page' : undefined} disabled={opening} onClick={() => onOpen(file.path)}>
            <DocumentFileLabel file={file} />{currentPath === file.path && <Check size={15} aria-label="Current document" />}
          </Button>
          <Button variant="ghost" size="sm" icon aria-label={`Show ${file.path} in Finder`} title="Show in Finder" disabled={revealing || opening} onClick={async () => {
            setRevealError(''); setRevealing(true);
            try { await api.showDocumentInFinder(threadId, file.path); }
            catch (cause) { setRevealError(String(cause).replace(/^Error: /, '')); }
            finally { setRevealing(false); }
          }}><FolderSearch size={15} aria-hidden="true" /></Button>
        </div>)}
      </div>
      {!loading && !error && !filtered.length && <p role="status">{files.length ? 'No matching documents.' : 'No Markdown files in this workspace yet.'}</p>}
      {revealError && <p role="alert" className="ws-field-error">{revealError}</p>}
      {opening && <p role="status">Opening document…</p>}
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}
