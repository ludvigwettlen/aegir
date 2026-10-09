import { Extension, Mark } from '@tiptap/react';
import type { Node } from '@tiptap/pm/model';
import { commentEnd, commentStart, decodeComment, encodeComment, type PassageComment } from '../../shared/document-comments';

export const commentName = 'passageComment';
const matchComment = (source: string) => source.match(/^<!-- aegir:comment:([^\s]+) -->([\s\S]*?)<!-- \/aegir:comment -->/);
export const DocumentComment = Mark.create({
  name: commentName, priority: 1100, inclusive: false,
  addAttributes() { return { id: { default: null }, text: { default: '' } }; },
  parseHTML() { return [{ tag: 'span[data-passage-comment]', getAttrs: element => decodeComment(element.getAttribute('data-passage-comment') || '') || false }]; },
  renderHTML({ mark }) {
    return ['span', { 'data-passage-comment': encodeComment(mark.attrs as PassageComment), class: 'ws-commented-text', 'aria-description': `Comment: ${mark.attrs.text}` }, 0];
  },
  markdownTokenizer: {
    name: commentName, level: 'inline', start: source => source.indexOf(commentStart),
    tokenize(source, _tokens, helpers) {
      const match = matchComment(source);
      const attrs = match && decodeComment(match[1]);
      if (!match || !attrs) return undefined;
      return { type: commentName, raw: match[0], attrs, tokens: helpers.inlineTokens(match[2]) };
    },
  },
  parseMarkdown(token, helpers) { return helpers.applyMark(commentName, helpers.parseInline(token.tokens || []), token.attrs); },
  renderMarkdown(node, helpers) {
    return `${commentStart}${encodeComment(node.attrs as PassageComment)} -->${helpers.renderChildren(node)}${commentEnd}`;
  },
});

// HTML comments at the start of a paragraph otherwise become a raw HTML block
// in CommonMark. Route only our validated annotation prefix to inline parsing.
export const DocumentCommentParagraph = Extension.create({
  name: 'commentParagraph',
  markdownTokenizer: {
    name: 'commentParagraph', level: 'block',
    start: source => source.startsWith(commentStart) ? 0 : -1,
    tokenize(source, _tokens, helpers) {
      const match = matchComment(source);
      if (!match || !decodeComment(match[1])) return undefined;
      const raw = source.match(/^[^\n]+(?:\n(?!\s*\n)[^\n]+)*/)?.[0];
      if (!raw || !raw.includes(commentEnd)) return undefined;
      return { type: 'commentParagraph', raw, tokens: helpers.inlineTokens(raw) };
    },
  },
  parseMarkdown(token, helpers) { return helpers.createNode('paragraph', undefined, helpers.parseInline(token.tokens || [])); },
});

export function commentsIn(doc: Node) {
  const ranges: Array<PassageComment & { from: number; to: number }> = [];
  doc.descendants((node, pos) => {
    const mark = node.marks.find(item => item.type.name === commentName);
    if (mark) ranges.push({ ...mark.attrs as PassageComment, from: pos, to: pos + node.nodeSize });
  });
  return ranges;
}
export function canComment(doc: Node, selection: { from: number; to: number }) {
  const { from, to } = selection;
  if (from === to || !doc.textBetween(from, to).trim()) return false;
  let allowed = true;
  doc.nodesBetween(from, to, node => {
    if (node.type.spec.code || node.marks.some(mark => mark.type.name === commentName || mark.type.spec.code) || (node.isTextblock && !node.type.allowsMarkType(doc.type.schema.marks[commentName]))) allowed = false;
  });
  return allowed;
}
export function commentAt(doc: Node, position: number) {
  return commentsIn(doc).find(range => range.from <= position && position < range.to);
}
