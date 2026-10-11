import { useState } from 'react';
import { EditorContent, Extension, useEditor, type Command, type Editor, type JSONContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Bold, Italic, List, IndentIncrease, IndentDecrease } from 'lucide-react';
import { Button } from '../design-system/primitives';

const storagePrefix = 'aegir:scratchpad:v1\n';
const emptyDoc = (): JSONContent => ({ type: 'doc', content: [{ type: 'paragraph' }] });
function readNotes(storageKey: string): JSONContent {
  const source = localStorage.getItem(storageKey) || '';
  if (source.startsWith(storagePrefix)) {
    const doc = JSON.parse(source.slice(storagePrefix.length));
    if (doc?.type !== 'doc' || !Array.isArray(doc.content)) throw new Error('Invalid notes');
    return doc;
  }
  // Existing scratchpads were literal text, including any Markdown punctuation.
  return { type: 'doc', content: source.split(/\r?\n/).map(text => ({ type: 'paragraph',
    ...(text ? { content: [{ type: 'text', text }] } : {}),
  })) };
}

const paragraphIndent = (direction: number): Command => ({ tr, dispatch }) => {
  let changed = false;
  tr.doc.nodesBetween(tr.selection.from, tr.selection.to, (node, pos) => {
    if (node.type.name === 'bulletList' || node.type.name === 'orderedList') return false;
    if (node.type.name !== 'paragraph') return;
    const indent = Math.max(0, Math.min(6, (node.attrs.indent || 0) + direction));
    if (indent === node.attrs.indent) return;
    changed = true;
    if (dispatch) tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent });
  });
  return changed;
};
function indentNotes(editor: Editor, direction: number, check = false) {
  const commands = check ? editor.can() : editor.commands;
  if (editor.isActive('listItem')) return direction > 0 ? commands.sinkListItem('listItem') : commands.liftListItem('listItem');
  return commands.command(paragraphIndent(direction));
}
const ScratchpadIndent = Extension.create({
  name: 'scratchpadIndent', priority: 1100,
  addGlobalAttributes() {
    return [{ types: ['paragraph'], attributes: { indent: {
      default: 0,
      parseHTML: element => Math.max(0, Math.min(6, Number(element.getAttribute('data-indent')) || 0)),
      renderHTML: attributes => attributes.indent ? { 'data-indent': attributes.indent, style: `margin-inline-start: ${attributes.indent}em` } : {},
    } } }];
  },
  addKeyboardShortcuts() {
    return {
      'Mod-]': () => indentNotes(this.editor, 1),
      'Mod-[': () => indentNotes(this.editor, -1),
      Tab: () => this.editor.isActive('listItem') && indentNotes(this.editor, 1),
      'Shift-Tab': () => this.editor.isActive('listItem') && indentNotes(this.editor, -1),
    };
  },
});

export function DocumentScratchpad({ storageKey, statusId }: { storageKey: string; statusId: string }) {
  const [initial] = useState(() => {
    try { return { content: readNotes(storageKey), loaded: true }; }
    catch { return { content: emptyDoc(), loaded: false }; }
  });
  const [loaded, setLoaded] = useState(initial.loaded);
  const [error, setError] = useState(initial.loaded ? '' : 'Could not load your notes.');
  const save = (editor: Editor) => {
    try { localStorage.setItem(storageKey, storagePrefix + JSON.stringify(editor.getJSON())); setError(''); }
    catch { setError('Notes could not be saved. Keep this document open and retry.'); }
  };
  const editor = useEditor({
    extensions: [StarterKit.configure({ heading: false, blockquote: false, code: false, codeBlock: false,
      horizontalRule: false, link: false, underline: false, strike: false, trailingNode: false }), ScratchpadIndent],
    content: initial.content, editable: initial.loaded, shouldRerenderOnTransaction: true,
    editorProps: { attributes: { class: 'ws-scratchpad-prose', role: 'textbox', 'aria-label': 'Document scratchpad',
      'aria-multiline': 'true', 'aria-describedby': statusId, 'data-placeholder': 'Ideas, loose thoughts, a rough outline…', spellcheck: 'true' } },
    onUpdate: ({ editor }) => save(editor),
  });
  const retry = () => {
    if (!editor) return;
    if (loaded) { save(editor); return; }
    try {
      editor.commands.setContent(readNotes(storageKey), { emitUpdate: false, errorOnInvalidContent: true });
      editor.setEditable(true, false); setLoaded(true); setError('');
    } catch { /* Preserve stored notes and keep the load error visible. */ }
  };
  const format = (action: () => void) => { if (editor?.isEditable) { editor.commands.focus(); action(); } };
  return <>
    <div className="ws-scratchpad-toolbar" role="group" aria-label="Scratchpad formatting">
      <Button variant="ghost" size="sm" aria-label="Bold" title="Bold (⌘/Ctrl+B)" aria-pressed={editor?.isActive('bold') || false} disabled={!loaded || !editor}
        onMouseDown={event => event.preventDefault()} onClick={() => format(() => editor!.commands.toggleBold())}><Bold size={14} aria-hidden="true" /></Button>
      <Button variant="ghost" size="sm" aria-label="Italic" title="Italic (⌘/Ctrl+I)" aria-pressed={editor?.isActive('italic') || false} disabled={!loaded || !editor}
        onMouseDown={event => event.preventDefault()} onClick={() => format(() => editor!.commands.toggleItalic())}><Italic size={14} aria-hidden="true" /></Button>
      <Button variant="ghost" size="sm" aria-label="Bullet list" title="Bullet list" aria-pressed={editor?.isActive('bulletList') || false} disabled={!loaded || !editor}
        onMouseDown={event => event.preventDefault()} onClick={() => format(() => editor!.commands.toggleBulletList())}><List size={14} aria-hidden="true" /></Button>
      <Button variant="ghost" size="sm" aria-label="Decrease indent" title="Decrease indent (⌘/Ctrl+[; Shift+Tab in lists)" disabled={!loaded || !editor || !indentNotes(editor, -1, true)}
        onMouseDown={event => event.preventDefault()} onClick={() => format(() => indentNotes(editor!, -1))}><IndentDecrease size={14} aria-hidden="true" /></Button>
      <Button variant="ghost" size="sm" aria-label="Increase indent" title="Increase indent (⌘/Ctrl+]; Tab in lists)" disabled={!loaded || !editor || !indentNotes(editor, 1, true)}
        onMouseDown={event => event.preventDefault()} onClick={() => format(() => indentNotes(editor!, 1))}><IndentIncrease size={14} aria-hidden="true" /></Button>
    </div>
    <EditorContent editor={editor} className="ws-scratchpad-editor" data-empty={editor?.isEmpty ?? true} />
    <div className="ws-scratchpad-status" id={statusId} role={error ? 'alert' : 'status'}>{error || 'Saved locally for this document'}{error && <Button variant="ghost" size="sm" onClick={retry}>Retry</Button>}</div>
  </>;
}
