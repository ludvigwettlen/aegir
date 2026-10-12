import { describe, expect, it } from 'vitest';
import { reviewBatchMessage } from './document-review.js';

describe('sending a document review to Claude', () => {
  const batch = { path: 'drafts/board-update.md', edited: false, comments: [
    { passage: 'One decision on the revenue case', text: 'Say which case Rasmus backs.' },
    { passage: `A long passage ${'with many words '.repeat(30)}`, text: '  Cut it.\nKeep the number.  ' },
  ] };

  it('lists every comment under its passage, numbered, in one message', () => {
    const message = reviewBatchMessage(batch);
    expect(message.split('\n')[0]).toBe('Review of `drafts/board-update.md`: 2 comments.');
    expect(message).toContain('**1.** On this passage:\n> One decision on the revenue case\n\nSay which case Rasmus backs.');
    expect(message).toContain('\n\nCut it.\nKeep the number.\n');
    // A long passage is cut to what it takes to find it.
    const quoted = message.split('\n').find((line) => line.startsWith('> A long passage'))!;
    expect(quoted.length).toBeLessThanOrEqual(282);
    expect(quoted.endsWith('…')).toBe(true);
    expect(message).toMatch(/Apply each comment in the file, then reply with one line per comment saying what you changed\.$/);
    expect(message).not.toContain('—');
  });

  it('says when the file also holds your own edits, and how to keep each round for voice-dna', () => {
    expect(reviewBatchMessage({ ...batch, edited: true, comments: batch.comments.slice(0, 1) }).split('\n')[0])
      .toBe('Review of `drafts/board-update.md`: 1 comment. I also edited the text directly. Those edits are saved in the file; keep them.');
    expect(reviewBatchMessage(batch, '~/brain/drafts/2026-10-12-board-update.md'))
      .toMatch(/Copy the file to `~\/brain\/drafts\/2026-10-12-board-update\.md` and commit it before you change anything, and again after\.$/);
    expect(reviewBatchMessage(batch, null)).toMatch(/ Commit the file before you change anything, and again after\.$/);
    expect(reviewBatchMessage(batch)).not.toContain('commit');
  });
});
