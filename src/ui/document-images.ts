import { remoteImageLabel, remoteImageSource } from '../../shared/remote-images';
import Image, { type ImageOptions } from '@tiptap/extension-image';
import type { Editor } from '@tiptap/react';
import { closeHistory } from '@tiptap/pm/history';
import { Plugin, type Transaction } from '@tiptap/pm/state';
import { documentImageLimit, imageMarkdown, imageSourceKind } from '../../shared/document-images';

export type ImageRange = { from: number; to: number };
export type ImportImage = (file: File) => Promise<string>;

export async function insertImageFiles(editor: Editor, files: File[], importImage: ImportImage, range: ImageRange = editor.state.selection) {
  if (!editor.isEditable || !files.length) return;
  if (files.length > 10) throw new Error('Insert up to 10 images at a time');
  if (files.some(file => !file.size || file.size > documentImageLimit)) throw new Error('Choose images smaller than 10 MB');
  let { from, to } = range;
  let removed = false;
  const map = ({ transaction }: { transaction: Transaction }) => {
    if (!transaction.docChanged) return;
    const start = transaction.mapping.mapResult(from, 1);
    const end = transaction.mapping.mapResult(to, from === to ? 1 : -1);
    removed ||= start.deletedAcross || end.deletedAcross;
    from = start.pos; to = end.pos;
  };
  editor.on('transaction', map);
  try {
    const images = [];
    for (const file of files) images.push({ type: 'image', attrs: { src: await importImage(file), alt: file.name.replace(/\.[^.]+$/, '') } });
    if (editor.isDestroyed) return;
    if (!editor.isEditable || removed) throw new Error('The insertion point changed. Insert the image again.');
    editor.view.dispatch(closeHistory(editor.state.tr));
    const inserted = editor.chain().insertContentAt({ from, to }, images).focus().run();
    editor.view.dispatch(closeHistory(editor.state.tr));
    if (!inserted) throw new Error('Place the cursor in a paragraph to insert an image');
  } finally { editor.off('transaction', map); }
}

type Options = ImageOptions & { loadImage: (src: string) => Promise<string>; importImage: ImportImage; onError: (message: string) => void };
export const DocumentImage = Image.extend<Options>({
  addOptions() { return { ...this.parent!(), loadImage: async () => '', importImage: async () => '', onError: () => {} }; },
  renderMarkdown(node) { return imageMarkdown(node.attrs?.src || '', node.attrs?.alt || '', node.attrs?.title || ''); },
  addProseMirrorPlugins() {
    const upload = (files: File[], range?: ImageRange) => {
      void insertImageFiles(this.editor, files, this.options.importImage, range).catch(error => this.options.onError(String(error.message || error)));
    };
    // File-only clipboard/drop events have no text slice. Handle them before
    // ProseMirror's ordinary text parsing and drop insertion.
    return [...(this.parent?.() || []), new Plugin({ props: { handleDOMEvents: {
      paste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files || []);
        if (!this.editor.isEditable || !files.length) return false;
        event.preventDefault(); upload(files); return true;
      },
      drop: (view, event) => {
        const files = Array.from(event.dataTransfer?.files || []);
        if (!files.length) return false;
        event.preventDefault();
        if (this.editor.isEditable) {
          const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
          upload(files, pos === undefined ? undefined : { from: pos, to: pos });
        }
        return true;
      },
    } } })];
  },
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('div'); dom.className = 'ws-document-image'; dom.contentEditable = 'false';
      const img = document.createElement('img'); img.draggable = false; img.referrerPolicy = 'no-referrer';
      const status = document.createElement('span'); status.setAttribute('role', 'status');
      const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Retry image'; retry.hidden = true;
      retry.addEventListener('mousedown', event => event.preventDefault());
      dom.append(img, status, retry);
      let current = node; let generation = 0; let destroyed = false; let allowedSource: string | null = null;
      const fail = () => { img.hidden = true; status.hidden = false; status.textContent = `Could not load image${current.attrs.alt ? `: ${current.attrs.alt}` : ''}`; retry.textContent = 'Retry image'; retry.hidden = false; dom.dataset.state = 'error'; };
      const load = async () => {
        const request = ++generation;
        img.onload = null; img.onerror = null; img.removeAttribute('src'); img.hidden = true;
        img.alt = current.attrs.alt || ''; img.title = current.attrs.title || '';
        status.hidden = false; status.textContent = 'Loading image…'; retry.hidden = true; dom.dataset.state = 'loading';
        const src = String(current.attrs.src || '');
        try {
          const kind = imageSourceKind(src);
          if (!kind) throw new Error('Unsupported image source');
          const remote = remoteImageSource(src);
          if (kind === 'remote' && allowedSource !== remote) {
            status.textContent = `${remoteImageLabel(src)}${current.attrs.alt ? `: ${current.attrs.alt}` : ''}`;
            retry.textContent = 'Load remote image'; retry.hidden = false; dom.dataset.state = 'blocked';
            return;
          }
          const resolved = kind === 'remote' ? remote! : await this.options.loadImage(src);
          if (destroyed || request !== generation) return;
          img.onload = () => { if (request !== generation) return; img.hidden = false; status.hidden = true; retry.hidden = true; dom.dataset.state = 'loaded'; };
          img.onerror = () => { if (request === generation) fail(); };
          img.src = resolved;
        } catch { if (!destroyed && request === generation) fail(); }
      };
      retry.addEventListener('click', () => { allowedSource = remoteImageSource(String(current.attrs.src || '')); void load(); }); void load();
      return { dom,
        update(next) {
          if (next.type !== current.type) return false;
          const changed = next.attrs.src !== current.attrs.src || next.attrs.alt !== current.attrs.alt || next.attrs.title !== current.attrs.title;
          if (next.attrs.src !== current.attrs.src) allowedSource = null;
          current = next; if (changed) void load(); return true;
        },
        selectNode() { dom.classList.add('ProseMirror-selectednode'); },
        deselectNode() { dom.classList.remove('ProseMirror-selectednode'); },
        stopEvent: event => event.target === retry,
        ignoreMutation: () => true,
        destroy() { destroyed = true; generation++; img.onload = null; img.onerror = null; },
      };
    };
  },
});
