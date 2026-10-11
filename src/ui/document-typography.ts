import { Extension, textInputRule } from '@tiptap/react';

export const DocumentTypography = Extension.create({
  name: 'documentTypography',
  addInputRules() {
    // Input rules leave loaded/pasted Markdown and code untouched. Backspace
    // immediately after the replacement restores the literal double hyphen.
    return [textInputRule({ find: /--$/, replace: '—' })];
  },
});
