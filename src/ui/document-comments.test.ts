import { describe, expect, it } from 'vitest';
import { MarkdownManager } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';
import { getSchema } from '@tiptap/react';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { DocumentComment, DocumentCommentParagraph, canComment, commentName, commentsIn } from './document-comments';
import { commentEnd, commentStart, encodeComment } from '../../shared/document-comments';
import { DocumentLinkSource } from './document-links';
import { hasUnsupportedMarkdown } from '../../shared/documents';

const extensions = [StarterKit, TableKit, DocumentComment, DocumentCommentParagraph, DocumentLinkSource];
const markdown = new MarkdownManager({ extensions });
const schema = getSchema(extensions);
const note = { id: 'test-note', text: 'Keep this clear.\nUnicode: åäö 👋 <script> & -->' };
const wrap = (text: string) => `${commentStart}${encodeComment(note)} -->${text}${commentEnd}`;
const read = (source: string) => schema.nodeFromJSON(markdown.parse(source));

describe('passage comments', () => {
  it.each([
    `Before ${wrap('some **bold** text')} after.`,
    `${wrap('At the start')} of a paragraph.`,
    `${wrap('Whole paragraph')}`, `# ${wrap('Heading')}`,
    `- ${wrap('List item')}`, `> ${wrap('Quoted text')}`,
    `| Name | Value |\n| --- | --- |\n| ${wrap('Cell')} | Other |`,
    `${wrap('First paragraph')}\n\n${wrap('Second paragraph')}`,
    `Before ${wrap('[a link](https://example.com)')} after.`,
  ])('round-trips annotated Markdown: %s', source => {
    expect(hasUnsupportedMarkdown(source)).toBe(false);
    const doc = read(source);
    expect(commentsIn(doc).length).toBeGreaterThan(0);
    expect(commentsIn(doc).every(item => item.id === note.id && item.text === note.text)).toBe(true);
    expect(doc.textContent).not.toContain('aegir:comment');
    const serialized = markdown.serialize(doc.toJSON());
    expect(read(serialized).toJSON()).toEqual(doc.toJSON());
    expect(hasUnsupportedMarkdown(serialized)).toBe(false);
  });
  it('retains the HTML protection for malformed markers and embedded markup', () => {
    expect(hasUnsupportedMarkdown(`${commentStart}bad -->Text${commentEnd}`)).toBe(true);
    expect(hasUnsupportedMarkdown(`${commentStart}${encodeComment(note)} -->Text`)).toBe(true);
    expect(hasUnsupportedMarkdown(wrap('<script>bad()</script>'))).toBe(true);
    expect(hasUnsupportedMarkdown(wrap(wrap('Nested')))).toBe(true);
  });
  it('maps annotations through edits and removes them when their passage is deleted', () => {
    let state = EditorState.create({ schema, doc: read(`Before ${wrap('passage')} after.`) });
    state = state.apply(state.tr.insertText('New ', 1));
    const range = commentsIn(state.doc)[0];
    expect(state.doc.textBetween(range.from, range.to)).toBe('passage');
    state = state.apply(state.tr.delete(range.from, range.to));
    expect(commentsIn(state.doc)).toEqual([]);
    expect(markdown.serialize(state.doc.toJSON())).not.toContain('aegir:comment');
  });
  it('keeps comments around links while their Markdown source is being edited', () => {
    const link = schema.nodes.documentLinkSource.create(null, schema.text('[a link](https://example.com)'), [schema.marks[commentName].create(note)]);
    const doc = schema.nodes.doc.create(null, schema.nodes.paragraph.create(null, [schema.text('Before ', [schema.marks[commentName].create(note)]), link, schema.text(' after', [schema.marks[commentName].create(note)])]));
    const source = markdown.serialize(doc.toJSON());
    const reopened = read(source);
    expect(commentsIn(reopened)[0].text).toBe(note.text);
    expect(reopened.textContent).toBe('Before a link after');
    expect(commentsIn(reopened).every(item => item.text === note.text)).toBe(true);
    expect(hasUnsupportedMarkdown(source)).toBe(false);
  });
  it('does not offer comments on inline code', () => {
    const doc = read('Before `code` after');
    expect(canComment(doc, { from: 8, to: 12 })).toBe(false);
  });
  it('rejects empty, overlapping, and code-block selections', () => {
    const doc = read(`Text ${wrap('marked')}\n\n\`\`\`\ncode\n\`\`\``);
    expect(canComment(doc, { from: 1, to: 5 })).toBe(true);
    expect(canComment(doc, { from: 1, to: 1 })).toBe(false);
    const marked = commentsIn(doc)[0];
    expect(canComment(doc, marked)).toBe(false);
    const code = doc.content.size - 3;
    expect(canComment(doc, { from: code, to: code + 1 })).toBe(false);
  });
  it('serializes a newly applied mark across multiple blocks', () => {
    const doc = read('First paragraph\n\nSecond **bold** paragraph');
    const state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, 1, doc.content.size - 1) });
    const next = state.apply(state.tr.addMark(1, doc.content.size - 1, schema.marks[commentName].create(note)));
    expect(read(markdown.serialize(next.doc.toJSON())).toJSON()).toEqual(next.doc.toJSON());
  });
});
