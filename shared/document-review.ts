// Review in the editor: the comments left on passages of a Markdown document go to Claude together, as one message,
// the way human-review sends a batch from the browser. The comments leave the file as they are sent; the message is
// the record of them.

export type ReviewComment = { passage: string; text: string };
export type ReviewBatch = { path: string; comments: ReviewComment[]; edited: boolean };

// Enough of a passage to find it in the file; Claude has the whole file.
const QUOTE = 280;
const clip = (text: string) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > QUOTE ? `${flat.slice(0, QUOTE - 1).trimEnd()}…` : flat;
};

// mirror: where the draft is kept in the brain (reviewMirror), so each round is committed for voice-dna-learning-sweep:
// the commit before Claude changes the file holds Malcolm's edits, the one after holds Claude's. Null when the file
// already lives in the brain's drafts; undefined when the conversation can't commit (a chat, or not Claude Code).
export function reviewBatchMessage(batch: ReviewBatch, mirror?: string | null): string {
  const count = batch.comments.length === 1 ? '1 comment' : `${batch.comments.length} comments`;
  const lines = [`Review of \`${batch.path}\`: ${count}.${batch.edited ? ' I also edited the text directly. Those edits are saved in the file; keep them.' : ''}`];
  batch.comments.forEach((comment, index) => {
    lines.push('', `**${index + 1}.** On this passage:`, `> ${clip(comment.passage)}`, '', comment.text.trim());
  });
  const keep = mirror === undefined ? ''
    : mirror ? ` Copy the file to \`${mirror}\` and commit it before you change anything, and again after.`
      : ' Commit the file before you change anything, and again after.';
  lines.push('', `Apply each comment in the file, then reply with one line per comment saying what you changed.${keep}`);
  return lines.join('\n');
}
