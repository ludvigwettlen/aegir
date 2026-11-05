import { expect, it } from 'vitest';
import { getSchema } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { MarkdownManager } from '@tiptap/markdown';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { foldingKey, headingFoldingPlugin, headingSections, toggleHeadingFold } from './document-folding';

const schema = getSchema([StarterKit]);
const markdown = new MarkdownManager({ extensions: [StarterKit] });
function setup(source: string) {
  const doc = schema.nodeFromJSON(markdown.parse(source));
  let state = EditorState.create({ doc, selection: TextSelection.create(doc, 1), plugins: [headingFoldingPlugin()] });
  return { get state() { return state; }, apply: (tr: Parameters<typeof state.apply>[0]) => { state = state.apply(tr); }, toggle: () => toggleHeadingFold(state, tr => { state = state.apply(tr); }) };
}

it('folds nested sections without changing Markdown and stops at peer headings', () => {
  const editor = setup('# Parent\n\nIntro\n\n## Child\n\nBody\n\n# Peer\n\nEnd');
  const original = editor.state.doc;
  const sections = headingSections(original);
  expect(sections).toHaveLength(3);
  expect(sections[0].end).toBe(sections[2].from);
  expect(sections[1].end).toBe(sections[2].from);
  expect(editor.toggle()).toBe(true);
  expect(foldingKey.getState(editor.state)).toEqual(new Set([0]));
  expect(editor.state.doc.eq(original)).toBe(true);
  expect(editor.toggle()).toBe(true);
  expect(foldingKey.getState(editor.state)?.size).toBe(0);
});
it('reveals a folded ancestor on outline navigation while preserving nested folds', () => {
  const editor = setup('# Parent\n\nIntro\n\n## Child\n\nBody');
  const sections = headingSections(editor.state.doc);
  editor.apply(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, sections[1].from + 1)));
  editor.toggle();
  editor.apply(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1)));
  editor.toggle();
  expect(foldingKey.getState(editor.state)?.size).toBe(2);
  editor.apply(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, sections[1].from + 1)));
  expect(foldingKey.getState(editor.state)).toEqual(new Set([sections[1].from]));
});
it('maps folds through edits and drops removed headings', () => {
  const editor = setup('# Title\n\nBody');
  editor.toggle();
  editor.apply(editor.state.tr.insertText('New ', 1));
  expect(foldingKey.getState(editor.state)).toEqual(new Set([0]));
  editor.apply(editor.state.tr.setNodeMarkup(0, schema.nodes.paragraph));
  expect(foldingKey.getState(editor.state)?.size).toBe(0);
});
it('leaves Tab alone for prose, selected text and headings without sections', () => {
  const editor = setup('# Empty');
  expect(editor.toggle()).toBe(false);
  const prose = setup('Paragraph');
  expect(prose.toggle()).toBe(false);
  const selected = setup('# Heading\n\nBody');
  selected.apply(selected.state.tr.setSelection(TextSelection.create(selected.state.doc, 1, 3)));
  expect(selected.toggle()).toBe(false);
});
