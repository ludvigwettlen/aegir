import { Extension } from '@tiptap/react';
import { Plugin } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const DocumentHeadingMarkers = Extension.create({
  name: 'documentHeadingMarkers',
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [new Plugin({ props: { decorations(state) {
      if (!editor.isEditable || !editor.isFocused) return DecorationSet.empty;
      const { $from } = state.selection;
      for (let depth = $from.depth; depth > 0; depth--) {
        const node = $from.node(depth);
        if (node.type.name === 'heading') return DecorationSet.create(state.doc, [
          Decoration.node($from.before(depth), $from.after(depth), { 'data-heading-marker': '#'.repeat(node.attrs.level) }),
        ]);
      }
      return DecorationSet.empty;
    } } })];
  },
});
