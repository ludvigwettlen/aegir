import type { Node } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import { commentName, commentsIn } from './document-comments';

export type ListedComment = { id: string; text: string; from: number; to: number; passage: string };

// Every comment in the document once, in reading order, with the text it covers. A comment over bold text or across
// paragraphs is several marked ranges sharing one id.
export function reviewComments(doc: Node): ListedComment[] {
  const byId = new Map<string, { id: string; text: string; from: number; to: number }>();
  for (const range of commentsIn(doc)) {
    const seen = byId.get(range.id);
    if (seen) { seen.from = Math.min(seen.from, range.from); seen.to = Math.max(seen.to, range.to); }
    else byId.set(range.id, { id: range.id, text: range.text, from: range.from, to: range.to });
  }
  return [...byId.values()].sort((a, b) => a.from - b.from)
    .map((comment) => ({ ...comment, passage: doc.textBetween(comment.from, comment.to, ' ').trim() }));
}

// Takes every comment out of the document, leaving its text as it was. Returns what was taken, to put back if the
// send fails.
export function removeAllComments(tr: Transaction) {
  const ranges = commentsIn(tr.doc);
  const mark = tr.doc.type.schema.marks[commentName];
  for (const range of ranges) tr.removeMark(range.from, range.to, mark);
  return ranges;
}
