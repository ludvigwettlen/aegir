import { Extension } from '@tiptap/react';
import { liftListItem, sinkListItem } from '@tiptap/pm/schema-list';
import type { Command } from '@tiptap/pm/state';

export const indentDocumentList = (outdent = false): Command => (state, dispatch) => {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const type = $from.node(depth).type;
    if (type.name !== 'listItem' && type.name !== 'taskItem') continue;
    (outdent ? liftListItem(type) : sinkListItem(type))(state, dispatch);
    // Keep focus in the list even when the first item cannot be indented.
    return true;
  }
  return false;
};

export const DocumentListIndentation = Extension.create({
  name: 'documentListIndentation',
  addKeyboardShortcuts() {
    return {
      Tab: () => indentDocumentList()(this.editor.state, this.editor.view.dispatch),
      'Shift-Tab': () => indentDocumentList(true)(this.editor.state, this.editor.view.dispatch),
    };
  },
});
