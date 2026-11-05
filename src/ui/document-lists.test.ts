import { expect, it } from 'vitest';
import { getSchema } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { indentDocumentList } from './document-lists';

const schema = getSchema([StarterKit, TaskList, TaskItem.configure({ nested: true })]);

it.each(['bulletList', 'orderedList', 'taskList'])('indents and outdents %s items while retaining selection', listType => {
  const itemType = listType === 'taskList' ? 'taskItem' : 'listItem';
  const item = (text: string) => schema.node(itemType, null, schema.node('paragraph', null, schema.text(text)));
  const doc = schema.node('doc', null, schema.node(listType, null, [item('First'), item('Second')]));
  let position = 0;
  doc.descendants((node, pos) => { if (node.isText && node.text === 'Second') position = pos; });
  let state = EditorState.create({ doc, selection: TextSelection.create(doc, position) });
  const dispatch = (tr: Parameters<typeof state.apply>[0]) => { state = state.apply(tr); };
  expect(indentDocumentList()(state, dispatch)).toBe(true);
  expect(state.doc.firstChild?.childCount).toBe(1);
  expect(state.doc.firstChild?.firstChild?.lastChild?.type.name).toBe(listType);
  expect(state.selection.$from.parent.textContent).toBe('Second');
  expect(indentDocumentList(true)(state, dispatch)).toBe(true);
  expect(state.doc.eq(doc)).toBe(true);
});

it('consumes Tab on the first item and leaves prose and headings to other shortcuts', () => {
  const paragraph = schema.node('paragraph', null, schema.text('First'));
  const doc = schema.node('doc', null, schema.node('bulletList', null, schema.node('listItem', null, paragraph)));
  const state = EditorState.create({ doc, selection: TextSelection.create(doc, 3) });
  expect(indentDocumentList()(state, () => { throw new Error('Unexpected edit'); })).toBe(true);
  for (const node of [paragraph, schema.node('heading', { level: 1 }, schema.text('Heading'))]) {
    const prose = schema.node('doc', null, node);
    expect(indentDocumentList()(EditorState.create({ doc: prose, selection: TextSelection.create(prose, 1) }))).toBe(false);
  }
});
