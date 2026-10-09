import { Extension } from '@tiptap/react';
import { Plugin, type Command } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const removeHeadingMarker: Command = (state, dispatch) => {
  const { empty, $from } = state.selection;
  if (!empty || $from.parent.type.name !== 'heading' || $from.parentOffset !== 0) return false;
  const level = $from.parent.attrs.level;
  const type = level > 1 ? state.schema.nodes.heading : state.schema.nodes.paragraph;
  if (!type) return false;
  if (dispatch) dispatch(closeHistory(state.tr).setNodeMarkup($from.before(), type,
    level > 1 ? { ...$from.parent.attrs, level: level - 1 } : null));
  return true;
};

export const DocumentHeadingMarkers = Extension.create({
  name: 'documentHeadingMarkers',
  // Handle the visual Markdown prefix before the standard join-backward command.
  priority: 1100,
  addKeyboardShortcuts() {
    return { Backspace: () => this.editor.isEditable && removeHeadingMarker(this.editor.state, this.editor.view.dispatch) };
  },
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
