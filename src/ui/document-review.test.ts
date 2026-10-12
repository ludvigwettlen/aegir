import { describe, expect, it } from 'vitest';
import { MarkdownManager } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import { getSchema } from '@tiptap/react';
import { EditorState } from '@tiptap/pm/state';
import { DocumentComment, DocumentCommentParagraph, commentsIn } from './document-comments';
import { removeAllComments, reviewComments } from './document-review';
import { commentEnd, commentStart, encodeComment } from '../../shared/document-comments';

const extensions = [StarterKit, DocumentComment, DocumentCommentParagraph];
const markdown = new MarkdownManager({ extensions });
const schema = getSchema(extensions);
const wrap = (id: string, note: string, text: string) => `${commentStart}${encodeComment({ id, text: note })} -->${text}${commentEnd}`;
const read = (source: string) => schema.nodeFromJSON(markdown.parse(source));

describe('the comments waiting to go to Claude', () => {
  it('lists each comment once, in reading order, with all the text it covers', () => {
    const doc = read(`Intro ${wrap('late', 'Second', 'later words')} end.\n\n${wrap('early', 'First', 'some **bold** text')} more.\n\n${wrap('late', 'Second', 'and across')} a paragraph.`);
    // "early" is in the second paragraph but the first comment there; "late" spans two paragraphs and starts first.
    expect(reviewComments(doc).map(({ id, text, passage }) => ({ id, text, passage }))).toEqual([
      { id: 'late', text: 'Second', passage: expect.stringMatching(/^later words .*and across$/) },
      { id: 'early', text: 'First', passage: 'some bold text' },
    ]);
  });

  it('takes every comment out and leaves the text as it was', () => {
    const doc = read(`Keep ${wrap('a', 'One', 'this')} and ${wrap('b', 'Two', '**that**')}.`);
    const state = EditorState.create({ schema, doc });
    const tr = state.tr;
    const taken = removeAllComments(tr);
    expect(taken.map((range) => range.id)).toEqual(['a', 'b']);
    expect(commentsIn(tr.doc)).toEqual([]);
    expect(tr.doc.textContent).toBe(doc.textContent);
    expect(markdown.serialize(tr.doc.toJSON())).toBe('Keep this and **that**.');
  });
});
