import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { documentImageAccept, imageSourceKind } from '../../../shared/document-images';
import { insertImageFiles, type ImageRange, type ImportImage } from '../document-images';
import { Button } from '../design-system/primitives';

export function DocumentImageInsert({ editor, range, importImage, onClose }: {
  editor: Editor; range: ImageRange; importImage: ImportImage; onClose: () => void;
}) {
  const [src, setSrc] = useState('');
  const [alt, setAlt] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [doc] = useState(editor.state.doc);
  const file = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const valid = () => {
    if (!editor.isEditable || !editor.state.doc.eq(doc)) { setError('The document changed. Close this dialog and choose an insertion point again.'); return false; }
    return true;
  };
  return <form className="ws-document-insert ws-document-link-form" role="dialog" aria-label="Insert image"
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!busy) onClose(); } }}
    onSubmit={event => {
      event.preventDefault();
      if (busy || !valid()) return;
      const source = src.trim();
      if (!imageSourceKind(source)) { setError('Enter an image URL or a path relative to this Markdown file.'); return; }
      if (editor.chain().focus().insertContentAt(range, { type: 'image', attrs: { src: source, alt: alt.trim() } }).run()) onClose();
      else setError('Place the cursor in a paragraph to insert an image');
    }}>
    <strong>Insert image</strong>
    <Button autoFocus type="button" variant="outline" disabled={busy} onClick={() => file.current?.click()}>Choose image files…</Button>
    <input ref={file} type="file" accept={documentImageAccept} multiple hidden aria-label="Image files" disabled={busy}
      onChange={async event => {
        const files = Array.from(event.target.files || []); event.target.value = '';
        if (!files.length || !valid()) return;
        setBusy(true); setError('');
        try { await insertImageFiles(editor, files, importImage, range); if (alive.current) onClose(); }
        catch (cause) { if (alive.current) setError(String((cause as Error).message || cause)); }
        finally { if (alive.current) setBusy(false); }
      }} />
    <small>PNG, JPEG, GIF, WebP or AVIF, up to 10 MB each. Files are copied beside this document. You can also paste or drop images into the page.</small>
    <label>Image URL or relative path<input value={src} disabled={busy} placeholder="https://… or images/diagram.png" onChange={event => setSrc(event.target.value)} /></label>
    <label>Description (alt text)<input value={alt} disabled={busy} onChange={event => setAlt(event.target.value)} /></label>
    {busy && <p role="status">Adding images…</p>}
    {error && <p role="alert">{error}</p>}
    <div><Button type="button" variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy || !src.trim()}>Insert image</Button></div>
  </form>;
}
