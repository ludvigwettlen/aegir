import { Extension } from '@tiptap/react';
import type { Node } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection, type Command } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

// Sections belong to their heading's parent, so quotes and list items stay intact.
export function headingSections(doc: Node) {
  const sections: { from: number; start: number; end: number }[] = [];
  const collect = (parent: Node, position: number) => {
    if (!parent.childCount) return;
    const offset = parent === doc ? 0 : position + 1;
    parent.forEach((heading, index) => {
      if (heading.type.name !== 'heading') return;
      const from = offset + index;
      let end = offset + parent.content.size;
      parent.forEach((next, nextIndex) => {
        if (nextIndex > index && next.type.name === 'heading' && next.attrs.level <= heading.attrs.level) end = Math.min(end, offset + nextIndex);
      });
      if (end > from + heading.nodeSize) sections.push({ from, start: from + heading.nodeSize, end });
    });
  };
  collect(doc, -1);
  doc.descendants(collect);
  return sections;
}

export const foldingKey = new PluginKey<Set<number>>('documentFolding');
export const toggleHeadingFold: Command = (state, dispatch) => {
  const { empty, $from } = state.selection;
  if (!empty || $from.parent.type.name !== 'heading') return false;
  const position = $from.before();
  if (!headingSections(state.doc).some(section => section.from === position)) return false;
  if (dispatch) dispatch(state.tr.setMeta(foldingKey, position));
  return true;
};

export function headingFoldingPlugin() {
  return new Plugin<Set<number>>({
    key: foldingKey,
    state: {
      init: () => new Set(),
      apply(tr, previous) {
        const sections = headingSections(tr.doc);
        const folded = new Set([...previous].map(pos => tr.mapping.mapResult(pos, 1)).filter(result => !result.deleted).map(result => result.pos)
          .filter(pos => sections.some(section => section.from === pos)));
        const toggle = tr.getMeta(foldingKey);
        if (typeof toggle === 'number') {
          if (folded.has(toggle)) folded.delete(toggle); else folded.add(toggle);
        } else if (tr.selectionSet) {
          // Outline navigation, search and arrow keys must never leave a hidden caret.
          for (const section of sections) if (tr.selection.from >= section.start && tr.selection.to <= section.end && folded.has(section.from)) folded.delete(section.from);
        }
        return folded;
      },
    },
    props: {
      decorations(state) {
        const folded = foldingKey.getState(state)!;
        const decorations: Decoration[] = [];
        for (const section of headingSections(state.doc)) {
          const collapsed = folded.has(section.from);
          decorations.push(Decoration.widget(section.from + 1, view => {
            const button = document.createElement('button');
            button.className = 'ws-heading-fold';
            button.type = 'button';
            button.contentEditable = 'false';
            button.textContent = collapsed ? '▸' : '▾';
            const label = `${collapsed ? 'Expand' : 'Collapse'} section: ${state.doc.nodeAt(section.from)?.textContent || 'Untitled heading'}`;
            button.setAttribute('aria-label', label);
            button.setAttribute('aria-expanded', String(!collapsed));
            button.title = `${label} (Tab in heading)`;
            button.onmousedown = event => event.preventDefault();
            button.onclick = () => {
              view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, section.from + 1)).setMeta(foldingKey, section.from));
              view.focus();
            };
            return button;
          }, { key: `fold-${section.from}-${collapsed}-${state.doc.nodeAt(section.from)?.textContent}`, side: -1, stopEvent: () => true }));
          if (collapsed) state.doc.nodesBetween(section.start, section.end, (node, pos) => {
            if (pos >= section.start && pos + node.nodeSize <= section.end) {
              decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'ws-heading-folded', 'aria-hidden': 'true' }));
              return false;
            }
          });
        }
        return DecorationSet.create(state.doc, decorations);
      },
    },
  });
}

export const DocumentHeadingFolding = Extension.create({
  name: 'documentHeadingFolding',
  addKeyboardShortcuts() { return { Tab: () => toggleHeadingFold(this.editor.state, this.editor.view.dispatch) }; },
  addProseMirrorPlugins() { return [headingFoldingPlugin()]; },
});
