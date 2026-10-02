import { Node, getMarkRange } from '@tiptap/react';
import { DOMSerializer } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

const key = new PluginKey('documentLinks');
const sourceName = 'documentLinkSource';

// Keep source text in the document after first entering a link. Switching its
// node view between source and rendered content then leaves undo history intact.
export const DocumentLinkSource = Node.create<{ openLink: (href: string) => void }>({
  name: sourceName,
  group: 'inline', inline: true, content: 'text*', marks: '', code: true,
  addOptions() { return { openLink: () => {} }; },
  parseHTML() { return [{ tag: 'span[data-document-link]' }]; },
  renderHTML() { return ['span', { 'data-document-link': '' }, 0]; },
  renderMarkdown(node) { return (node.content ?? []).map(child => child.text ?? '').join(''); },
  addNodeView() {
    return ({ node, editor, decorations }) => {
      const dom = document.createElement('span');
      dom.setAttribute('data-document-link', '');
      const contentDOM = document.createElement('span');
      contentDOM.className = 'ws-document-link-source';
      const rendered = document.createElement('span');
      rendered.contentEditable = 'false';
      dom.append(contentDOM, rendered);
      const display = (current: typeof node, currentDecorations: typeof decorations) => {
        const active = currentDecorations.some(item => item.spec.active);
        contentDOM.hidden = !active;
        rendered.hidden = active;
        if (active) contentDOM.setAttribute('data-link-source', '');
        else contentDOM.removeAttribute('data-link-source');
        rendered.replaceChildren();
        const parsed = editor.markdown?.parse(current.textContent);
        const paragraph = parsed?.content?.length === 1 && parsed.content[0].type === 'paragraph' ? parsed.content[0] : null;
        if (paragraph) {
          const fragment = editor.schema.nodeFromJSON(paragraph).content;
          rendered.append(DOMSerializer.fromSchema(editor.schema).serializeFragment(fragment));
        } else rendered.textContent = current.textContent;
      };
      display(node, decorations);
      return {
        dom, contentDOM,
        update(updated, updatedDecorations) {
          if (updated.type.name !== sourceName) return false;
          display(updated, updatedDecorations); return true;
        },
        ignoreMutation(mutation) {
          return mutation.type !== 'selection' && !contentDOM.contains(mutation.target);
        },
      };
    };
  },
  addProseMirrorPlugins() {
    const editor = this.editor;
    const openLink = this.options.openLink;
    const anchor = (event: Event) => event.target instanceof Element ? event.target.closest('a[href]') : null;
    return [new Plugin({
      key,
      props: {
        decorations(state) {
          const decorations: Decoration[] = [];
          state.doc.descendants((node, pos) => {
            if (node.type.name !== sourceName) return;
            if (state.selection.from >= pos + 1 && state.selection.to <= pos + node.nodeSize - 1) {
              decorations.push(Decoration.node(pos, pos + node.nodeSize, {}, { active: true }));
            }
            return false;
          });
          return DecorationSet.create(state.doc, decorations);
        },
        handleKeyDown(view, event) {
          if (!editor.isEditable || !view.state.selection.empty || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return false;
          const { $from } = view.state.selection;
          const right = event.key === 'ArrowRight';
          if (!right && event.key !== 'ArrowLeft') return false;
          let position: number | undefined;
          if ($from.parent.type.name === sourceName) {
            if (right && $from.parentOffset === $from.parent.content.size) position = $from.after();
            if (!right && $from.parentOffset === 0) position = $from.before();
          } else {
            const node = right ? $from.nodeAfter : $from.nodeBefore;
            if (node?.type.name === sourceName) position = $from.pos + (right ? 1 : -1);
          }
          if (position === undefined) return false;
          view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, position)));
          return true;
        },
        handleDOMEvents: {
          mousedown: (_view, event) => {
            if (event.button !== 0 || !anchor(event)) return false;
            event.preventDefault(); return true;
          },
          click: (_view, event) => {
            const link = anchor(event);
            if (event.button !== 0 || !link) return false;
            event.preventDefault(); openLink(link.getAttribute('href')!); return true;
          },
        },
      },
      appendTransaction(transactions, _oldState, state) {
        if (!editor.isEditable || !editor.isFocused || !editor.markdown || transactions.some(tr => tr.getMeta(key))) return null;
        const { selection } = state;
        if (!selection.empty || selection.$from.parent.type.name === sourceName) return null;
        const range = getMarkRange(selection.$from, state.schema.marks.link);
        if (!range) return null;
        const source = editor.markdown.serialize({ type: 'doc', content: [{ type: 'paragraph', content: state.doc.slice(range.from, range.to).content.toJSON() }] });
        const offset = Math.min(selection.from - range.from + 1, source.length);
        const tr = state.tr.replaceWith(range.from, range.to, state.schema.nodes[sourceName].create(null, state.schema.text(source)));
        return tr.setSelection(TextSelection.create(tr.doc, range.from + 1 + offset)).setMeta(key, true).setMeta('addToHistory', false);
      },
    })];
  },
});
