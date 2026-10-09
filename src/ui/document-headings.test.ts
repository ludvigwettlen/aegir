import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { MarkdownManager } from '@tiptap/markdown';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { history, undo } from '@tiptap/pm/history';
import { removeHeadingMarker } from './document-headings';

const extensions = [StarterKit];
const schema = getSchema(extensions);
const markdown = new MarkdownManager({ extensions });
function headingState(level: number, text = '**Heading** text') {
  const doc = schema.nodeFromJSON(markdown.parse(`Previous paragraph\n\n${'#'.repeat(level)} ${text}\n\nFollowing paragraph`));
  return EditorState.create({ schema, doc, selection: TextSelection.create(doc, doc.firstChild!.nodeSize + 1), plugins: [history()] });
}

describe('heading marker deletion', () => {
  it.each([1, 2, 3, 4, 5, 6])('removes one marker from level %i without joining the previous paragraph', level => {
    let state = headingState(level);
    const before = state.doc;
    expect(removeHeadingMarker(state, tr => { state = state.apply(tr); })).toBe(true);
    expect(state.doc.childCount).toBe(3);
    expect(state.doc.firstChild!.eq(before.firstChild!)).toBe(true);
    expect(state.doc.lastChild!.eq(before.lastChild!)).toBe(true);
    expect(state.doc.child(1).content.eq(before.child(1).content)).toBe(true);
    expect(state.doc.child(1).type.name).toBe(level === 1 ? 'paragraph' : 'heading');
    if (level > 1) expect(state.doc.child(1).attrs.level).toBe(level - 1);
    expect(state.selection.$from.parentOffset).toBe(0);
    expect(markdown.serialize(state.doc.toJSON())).toContain(`${'#'.repeat(level - 1)}${level > 1 ? ' ' : ''}**Heading** text`);
    expect(undo(state, tr => { state = state.apply(tr); })).toBe(true);
    expect(state.doc.eq(before)).toBe(true);
  });
  it('turns a heading into prose after repeated Backspace presses', () => {
    let state = headingState(3);
    for (let count = 0; count < 3; count++) expect(removeHeadingMarker(state, tr => { state = state.apply(tr); })).toBe(true);
    expect(state.doc.child(1).type.name).toBe('paragraph');
    expect(state.doc.childCount).toBe(3);
    expect(removeHeadingMarker(state)).toBe(false);
  });
  it('leaves ordinary text deletion and selected ranges to the editor', () => {
    const state = headingState(2);
    const from = state.selection.from;
    const middle = state.apply(state.tr.setSelection(TextSelection.create(state.doc, from + 2)));
    expect(removeHeadingMarker(middle)).toBe(false);
    const selected = state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, from + 2)));
    expect(removeHeadingMarker(selected)).toBe(false);
  });
  it('handles headings at the start of a document and inside a quote', () => {
    for (const source of ['## First', '> ## Quoted']) {
      const doc = schema.nodeFromJSON(markdown.parse(source));
      let position = 1;
      doc.descendants((node, pos) => { if (node.type.name === 'heading') position = pos + 1; });
      let state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, position) });
      expect(removeHeadingMarker(state, tr => { state = state.apply(tr); })).toBe(true);
      expect(state.selection.$from.parent.attrs.level).toBe(1);
      expect(state.doc.textContent).toBe(doc.textContent);
    }
  });
});
