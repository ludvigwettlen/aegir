import { describe, expect, it } from 'vitest';
import { parseSuggestionReview } from './task-discovery.js';

describe('task suggestion review', () => {
  it('rejects Slack conversation triage even when the reviewer also approves it', () => {
    expect(parseSuggestionReview(JSON.stringify({ approve: true, slackReplyOnly: true, reason: 'Malcolm explicitly asked for an answer.' })))
      .toEqual({ approve: false, reason: 'Routine Slack reply reminders belong in Slack, not the task inbox.' });
  });
  it.each([undefined, null, 'false', 0])('fails closed when Slack triage classification is invalid: %s', slackReplyOnly => {
    expect(parseSuggestionReview(JSON.stringify({ approve: true, slackReplyOnly, reason: 'A direct request' })).approve).toBe(false);
  });
  it('preserves approval of substantive obligations and ordinary review rejections', () => {
    expect(parseSuggestionReview('{"approve":true,"slackReplyOnly":false,"reason":"Approve a personally assigned budget decision"}').approve).toBe(true);
    expect(parseSuggestionReview('{"approve":false,"slackReplyOnly":false,"reason":"Already completed"}')).toEqual({ approve: false, reason: 'Already completed' });
  });
});
