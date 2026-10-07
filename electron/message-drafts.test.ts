import { describe, expect, it } from 'vitest';
import {
  canSend, checkPlan, draftFromTool, draftHistory, draftTranscript, emailHtml, learnFromToolResult, needsCheck, nothingKnown,
  profileName, readToolResponse, sendPlan, slackVerdict, superhumanVerdict, SLACK, SUPERHUMAN,
} from './message-drafts.js';

// Answers as the connectors gave them on 5 Oct (Superhuman) and from the Slack bridge's source.
const created = `{"draft":{"draft_id":"draft00b7d9728c5a1a45","thread_id":"draft00c3124c75effa45","to":[{"email":"petra@nordvik.example","name":""}],"cc":[{"email":"johan@example.com","name":"Johan Lund"}],"subject":"Mötet vi pratade om","body":"<div>Hej Petra!</div>"}}`;
const sentEmail = `{"success":true,"message_id":"draft00b7d9728c5a1a45","thread_id":"1a0773deea46a0fa","sent_at":"2026-10-06T07:12:00Z","undo_token":"x","undo_expires_at":"2026-10-06T07:13:00Z","open_url":"https://mail.superhuman.com/malcolm@example.com/thread/1a0773deea46a0fa"}`;

describe('sending draft cards', () => {
  const run = (calls: { input: (results: unknown[]) => Record<string, unknown> }[], results: unknown[] = []) => calls.map((call, index) => call.input(results.slice(0, index)));

  it('learns Superhuman drafts and Slack names from what the connectors returned, and confirms cards with them', () => {
    const known = nothingKnown();
    learnFromToolResult(`${SUPERHUMAN}create_or_update_draft`, { type: 'reply_all', acting_email: 'malcolm@example.com' }, created, known);
    learnFromToolResult(`${SLACK}slack_search_users`, {}, '{"users":[{"id":"U06TESTUSR1","real_name":"Johan Lund"}]}', known);
    learnFromToolResult(`${SLACK}slack_search_channels`, {}, '{"channels":[{"id":"D04EXAMPL01","name":"U06TESTUSR1","is_im":true},{"id":"C01EXAMPL03","name":"mgmt"}]}', known);
    const mail = draftFromTool({ ...email, email: { ...email.email, to: ['someone@else.com'] } }, known);
    expect(mail.email).toMatchObject({ to: ['petra@nordvik.example'], cc: ['johan@example.com'], type: 'reply_all', account: 'malcolm@example.com', confirmed: true });
    expect(needsCheck(mail)).toBe(false);
    expect(canSend(mail)).toBe(true);
    expect(draftFromTool(slack, known).slack?.name).toBe('Johan Lund');
    expect(draftFromTool({ ...slack, slack: { channel_id: 'C01EXAMPL03' } }, known).slack?.name).toBe('mgmt');
    // A DM's channel name is a user id, so a D… card still gets checked.
    expect(needsCheck(draftFromTool({ ...slack, slack: { channel_id: 'D04EXAMPL01' } }, known))).toBe(true);
    expect(canSend(draftFromTool(slack))).toBe(false);
  });

  it('checks a Slack destination with Slack itself', () => {
    const user = checkPlan(draftFromTool(slack))!;
    expect(user.calls.map((call) => call.tool)).toEqual([`${SLACK}slack_read_user_profile`]);
    expect(run(user.calls)).toEqual([{ user_id: 'U06TESTUSR1', response_format: 'concise' }]);
    expect(user.read([readToolResponse([{ type: 'text', text: '{"result":"johan.lund (Johan Lund)\\nNorthwind\\nCSM\\n"}' }])])).toEqual({ slack: { channelId: 'U06TESTUSR1', threadTs: '1759687412.123456', name: 'Johan Lund' }, error: undefined });
    expect(user.read([])).toMatchObject({ slack: { name: null }, error: "Slack didn't say who this is" });

    const dm = checkPlan(draftFromTool({ ...slack, slack: { channel_id: 'D04EXAMPL01' } }))!;
    const list = readToolResponse('{"channels":[{"id":"D04EXAMPL01","name":"U06TESTUSR1","is_im":true}]}');
    // The check asks for the one conversation by id, never for a list it would have to scan.
    expect(dm.calls[0].input([])).toMatchObject({ query: 'D04EXAMPL01', channel_types: 'im' });
    expect(dm.calls[0].check?.(list)).toBeNull();
    expect(dm.calls[1].input([list])).toEqual({ user_id: 'U06TESTUSR1', response_format: 'concise' });
    expect(dm.read([list, { result: 'johan.lund (Johan Lund)' }]).slack?.name).toBe('Johan Lund');
    expect(dm.calls[0].check?.({ channels: [] })).toBe('not found');

    const channel = checkPlan(draftFromTool({ ...slack, slack: { channel_id: 'C01EXAMPL03' } }))!;
    expect(channel.calls[0].input([])).toMatchObject({ query: 'C01EXAMPL03', limit: 5 });
    expect(channel.read([{ channels: [{ id: 'C01EXAMPL03', name: 'mgmt' }] }]).slack?.name).toBe('mgmt');
    expect(channel.read([{ channels: [] }])).toMatchObject({ slack: { name: null }, error: 'Slack has no channel with this id that you can see' });
  });

  it('checks an email card against the draft in Superhuman', () => {
    const plan = checkPlan(draftFromTool({ ...email, email: { ...email.email, type: 'new' } }))!;
    expect(run(plan.calls)).toEqual([{ draft_id: 'draft00b7d9728c5a1a45', acting_email: 'malcolm@example.com' }]);
    expect(plan.read([readToolResponse(created)]).email).toMatchObject({ to: ['petra@nordvik.example'], confirmed: true, type: 'new' });
    expect(plan.read([{ text: 'not found' }])).toMatchObject({ error: "Superhuman didn't return this draft, so Legolas can't confirm who it goes to" });
  });

  it('sends Slack with the card text under both field names, and only after the commit point', async () => {
    let committed = 0;
    const card = { ...draftFromTool(slack), text: 'Hej Johan! Kort.', slack: { channelId: 'U06TESTUSR1', name: 'Johan Lund' } };
    const plan = sendPlan(card, async () => { committed++; return true; });
    expect(run(plan.calls)).toEqual([{ channel_id: 'U06TESTUSR1', text: 'Hej Johan! Kort.', message: 'Hej Johan! Kort.', thread_ts: '' }]);
    expect(await plan.calls[plan.sendIndex].commit?.()).toBe(true);
    expect(committed).toBe(1);
  });

  it('sends email as a body-only update that must still go where the card says, then the send', () => {
    const known = nothingKnown();
    learnFromToolResult(`${SUPERHUMAN}create_or_update_draft`, { type: 'new', acting_email: 'malcolm@example.com' }, created, known);
    const card = { ...draftFromTool(email, known), text: 'Hej Petra!\n\nTack <3 & hej' };
    const plan = sendPlan(card, async () => true);
    expect(plan.calls.map((call) => call.tool)).toEqual([`${SUPERHUMAN}create_or_update_draft`, `${SUPERHUMAN}send_draft`]);
    expect(plan.calls[0].input([])).toEqual({ type: 'new', draft_id: 'draft00b7d9728c5a1a45', thread_id: 'draft00c3124c75effa45', body: '<div>Hej Petra!</div><div><br></div><div>Tack &lt;3 &amp; hej</div>', acting_email: 'malcolm@example.com' });
    expect(plan.calls[0].commit).toBeUndefined();
    expect(plan.calls[1].commit).toBeDefined();
    expect(plan.calls[0].check?.(readToolResponse(created))).toBeNull();
    const moved = readToolResponse(created.replace('petra@nordvik.example', 'someone@else.com'));
    expect(plan.calls[0].check?.(moved)).toBe('The draft in Superhuman goes to different people now');
    expect(plan.live?.([moved])?.to).toEqual(['someone@else.com']);
    expect(plan.verdict(readToolResponse(sentEmail))).toEqual({ state: 'sent', link: 'https://mail.superhuman.com/malcolm@example.com/thread/1a0773deea46a0fa', sentAt: '2026-10-06T07:12:00Z' });
  });

  it('reads send answers: failed only when the tool said no, unknown when it said nothing clear', () => {
    const now = new Date('2026-10-06T07:12:00Z');
    expect(slackVerdict({ ok: true, channel: 'D04EXAMPL01', ts: '1759.1', permalink_hint: 'https://app.slack.com/client/D04EXAMPL01' }, 'U1', now)).toEqual({ state: 'sent', link: 'https://app.slack.com/client/D04EXAMPL01', sentAt: '2026-10-06T07:12:00.000Z' });
    expect(slackVerdict({ error: 'channel_not_found' }, 'U1')).toEqual({ state: 'failed', error: 'Slack said: channel_not_found' });
    expect(slackVerdict({ text: 'Message sent: https://example.slack.com/archives/D1/p1' }, 'U1', now)).toMatchObject({ state: 'sent', link: 'https://example.slack.com/archives/D1/p1' });
    expect(slackVerdict({ text: 'Hmm.' }, 'U1')).toMatchObject({ state: 'unknown' });
    expect(superhumanVerdict({ success: false, error: 'draft not found' })).toEqual({ state: 'failed', error: 'Superhuman said: draft not found' });
    expect(superhumanVerdict({ text: '' })).toMatchObject({ state: 'unknown' });
  });

  it('turns text into Superhuman body HTML, escaped, one div per line', () => {
    expect(emailHtml('Hej "Petra"\n\n<b>')).toBe('<div>Hej &quot;Petra&quot;</div><div><br></div><div>&lt;b&gt;</div>');
  });

  it('reads Slack profile answers', () => {
    expect(profileName({ result: 'malcolm (malcolm)\nNorthwind\nCEO' })).toBe('malcolm');
    // Slack answers "handle (Real Name)": the card shows the real name.
    expect(profileName({ result: 'people (Nora Palmer)\nNorthwind\nHead of People' })).toBe('Nora Palmer');
    expect(profileName({ result: 'lin' })).toBe('lin');
    expect(profileName({ real_name: 'Johan Lund' })).toBe('Johan Lund');
    expect(profileName({ text: 'Error: user_not_found' })).toBeNull();
  });

  it('tells Claude a card Legolas sent apart from one the user sent', () => {
    const card = { ...draftFromTool(slack), state: 'sent' as const, sentAt: '2026-10-06T07:12:00.000Z' };
    expect(draftHistory('card-1', { ...card, sentBy: 'legolas' })).toContain('was sent by Legolas when the user pressed Send at 2026-10-06T07:12:00.000Z');
    expect(draftHistory('card-1', { ...card, sentBy: 'you' })).toContain('was sent by the user at');
    expect(draftHistory('card-1', { ...card, state: 'unknown', error: 'Timed out' })).toContain('may or may not have been sent: Legolas lost track of the send (Timed out)');
    expect(draftTranscript({ ...card, sentBy: 'legolas', slack: { channelId: 'U06TESTUSR1', name: 'Johan Lund' } })).toContain('confirmed by Slack as Johan Lund) · sent from Legolas');
  });
});

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
