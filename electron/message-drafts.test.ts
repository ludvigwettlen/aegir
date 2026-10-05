import { describe, expect, it } from 'vitest';
import { draftFromTool, draftHistory, draftTranscript } from './message-drafts.js';

const slack = { channel: 'slack', label: 'DM to Johan Lund', text: '  Hej Johan!\r\nSnabb heads-up.  ', slack: { channel_id: 'U06TESTUSR1', thread_ts: '1759687412.123456' } };
const email = { channel: 'email', label: 'Reply to Petra', text: 'Hej Petra!', email: { to: ['Petra@Nordvik.example'], cc: ['johan@example.com'], subject: 'Mötet vi pratade om', draft_id: 'draft00b7d9728c5a1a45', thread_id: 'draft00c3124c75effa45', account: 'malcolm@example.com' } };

describe('draft cards', () => {
  it('builds a Slack card from the tool call, text tidied and kept as the original', () => {
    expect(draftFromTool(slack)).toEqual({
      type: 'message-draft', channel: 'slack', label: 'DM to Johan Lund', original: 'Hej Johan!\nSnabb heads-up.', text: 'Hej Johan!\nSnabb heads-up.', state: 'pending',
      slack: { channelId: 'U06TESTUSR1', threadTs: '1759687412.123456' },
    });
  });
  it('builds an email card with lower-case addresses and the Superhuman draft to open', () => {
    expect(draftFromTool(email).email).toEqual({
      to: ['petra@nordvik.example'], cc: ['johan@example.com'], bcc: [], subject: 'Mötet vi pratade om',
      draftId: 'draft00b7d9728c5a1a45', threadId: 'draft00c3124c75effa45', account: 'malcolm@example.com',
    });
  });
  it.each([
    [{ ...slack, slack: { channel_id: '#mgmt' } }, 'channel_id'],
    [{ ...slack, slack: { channel_id: 'C0123ABCD', thread_ts: 'yesterday' } }, 'thread_ts'],
    [{ ...slack, text: '   ' }, 'needs its text'],
    [{ ...slack, text: 'x'.repeat(30_001) }, 'too long'],
    [{ ...slack, label: '' }, 'label'],
    [{ ...email, email: { to: [] } }, 'at least one'],
    [{ ...email, email: { to: ['petra at nordvik'] } }, "isn't an email address"],
    [{ ...email, email: { to: 'petra@nordvik.example' } }, 'list of email addresses'],
    [{ ...email, email: { ...email.email, account: 'malcolm' } }, 'account'],
    [{ ...slack, channel: 'teams' }, "'slack' or 'email'"],
  ])('refuses a malformed call (%#)', (args, message) => {
    expect(() => draftFromTool(args)).toThrow(message);
  });
  it('tells Claude where each card stands, with the edited text', () => {
    const card = draftFromTool(slack);
    const waiting = draftHistory('card-1', { ...card, text: 'Hej Johan! Kort.' });
    expect(waiting).toContain('DM to Johan Lund (Slack U06TESTUSR1, in thread 1759687412.123456)');
    expect(waiting).toContain('is waiting for the user to send it');
    expect(waiting).toContain('The user edited it.');
    expect(waiting.endsWith('Current text:\nHej Johan! Kort.')).toBe(true);
    const sent = draftHistory('card-1', { ...card, state: 'sent', sentAt: '2026-10-06T07:12:00.000Z' });
    expect(sent).toContain('was sent by the user at 2026-10-06T07:12:00.000Z');
    expect(sent).toContain('Text as sent:');
    expect(draftHistory('card-1', { ...card, state: 'discarded' })).toContain('was discarded by the user, not sent');
    expect(draftHistory('card-1', { ...card, state: 'replaced', replacedBy: 'card-2' })).toContain('replaced by a newer draft, not sent (draft card card-2)');
  });
  it('copies a card into the chat transcript with its state', () => {
    const card = draftFromTool(email);
    expect(draftTranscript(card)).toBe('Email draft · Reply to Petra (email to petra@nordvik.example, cc johan@example.com, subject "Mötet vi pratade om") · waiting to be sent\nHej Petra!');
    expect(draftTranscript({ ...card, state: 'sent', sentAt: 'now', text: 'Hej!' })).toContain('sent by you (now) · edited');
  });
});
