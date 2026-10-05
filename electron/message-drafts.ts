import type { DraftState, EmailDestination, MessageDraft, SlackDestination } from '../shared/types.js';

// Draft cards: an email or Slack message the agent wrote for the user to send, shown as an editable card under the
// agent's reply. The user edits it there, copies it, and sends it from Slack or Superhuman. Legolas sends nothing.

const slackId = /^[CDGU][A-Z0-9]{6,15}$/;
const slackTs = /^\d{9,11}\.\d{1,9}$/;
const address = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/;
const MAX_TEXT = 30_000;

const object = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {});
const string = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
function addresses(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`email.${field} must be a list of email addresses`);
  const list = value.map(item => string(item).toLowerCase()).filter(Boolean);
  const bad = list.find(item => !address.test(item));
  if (bad) throw new Error(`email.${field} has something that isn't an email address: ${bad}`);
  if (list.length > 50) throw new Error(`email.${field} has too many addresses`);
  return list;
}

export function cleanDraftText(value: unknown): string {
  if (typeof value !== 'string') throw new Error('The draft text must be text');
  if (value.length > MAX_TEXT) throw new Error('The draft is too long');
  return value.replace(/\r\n/g, '\n');
}

// Validates a messages__draft call and builds the card.
export function draftFromTool(args: Record<string, unknown>): MessageDraft {
  const text = cleanDraftText(args.text).trim();
  if (!text) throw new Error('A draft needs its text');
  const label = string(args.label).slice(0, 120);
  if (!label) throw new Error('label must say where the message goes, like "DM to Johan Lund" or "#mgmt"');
  const base = { type: 'message-draft' as const, label, original: text, text, state: 'pending' as const };
  if (args.channel === 'slack') {
    const slack = object(args.slack);
    const channelId = string(slack.channel_id);
    const threadTs = string(slack.thread_ts);
    if (!slackId.test(channelId)) throw new Error('slack.channel_id must be a Slack channel, DM or user id (C…, G…, D… or U…)');
    if (threadTs && !slackTs.test(threadTs)) throw new Error('slack.thread_ts must be a Slack message timestamp like 1759687412.123456');
    const destination: SlackDestination = { channelId, ...(threadTs ? { threadTs } : {}) };
    return { ...base, channel: 'slack', slack: destination };
  }
  if (args.channel === 'email') {
    const email = object(args.email);
    const to = addresses(email.to, 'to');
    if (!to.length) throw new Error('email.to needs at least one address');
    const destination: EmailDestination = { to, cc: addresses(email.cc, 'cc'), bcc: addresses(email.bcc, 'bcc'), subject: string(email.subject).slice(0, 300) };
    const draftId = string(email.draft_id); const threadId = string(email.thread_id); const account = string(email.account).toLowerCase();
    if (draftId) destination.draftId = draftId.slice(0, 120);
    if (threadId) destination.threadId = threadId.slice(0, 120);
    if (account) {
      if (!address.test(account)) throw new Error('email.account must be the Superhuman account address');
      destination.account = account;
    }
    return { ...base, channel: 'email', email: destination };
  }
  throw new Error("channel must be 'slack' or 'email'");
}

// Where it goes, as the card shows it: the agent's description plus the facts.
export function destinationText(draft: MessageDraft): string {
  if (draft.channel === 'slack' && draft.slack)
    return `${draft.label} (Slack ${draft.slack.channelId}${draft.slack.threadTs ? `, in thread ${draft.slack.threadTs}` : ''})`;
  const email = draft.email;
  if (!email) return draft.label;
  const rows = [`to ${email.to.join(', ')}`, email.cc.length ? `cc ${email.cc.join(', ')}` : '', email.bcc.length ? `bcc ${email.bcc.join(', ')}` : '', email.subject ? `subject "${email.subject}"` : ''];
  return `${draft.label} (email ${rows.filter(Boolean).join(', ')})`;
}

const outcome: Record<DraftState, string> = {
  pending: 'is waiting for the user to send it',
  sent: 'was sent by the user',
  discarded: 'was discarded by the user, not sent',
  replaced: 'was replaced by a newer draft, not sent',
};

// One line per card in the history Claude reads, so "make it shorter" starts from the user's edits and Claude
// never asks for something already sent.
export function draftHistory(id: string, draft: MessageDraft): string {
  const kind = draft.channel === 'email' ? 'Email' : 'Slack message';
  const when = draft.state === 'sent' && draft.sentAt ? ` at ${draft.sentAt}` : '';
  const replaced = draft.state === 'replaced' && draft.replacedBy ? ` (draft card ${draft.replacedBy})` : '';
  const edited = draft.text !== draft.original ? ' The user edited it.' : '';
  return `Draft card ${id}: ${kind}, ${destinationText(draft)}. It ${outcome[draft.state]}${when}${replaced}.${edited} ${draft.state === 'sent' ? 'Text as sent' : 'Current text'}:\n${draft.text}`;
}

// Copy chat: the card, its state and its text.
export function draftTranscript(draft: MessageDraft): string {
  const state = { pending: 'waiting to be sent', sent: `sent by you${draft.sentAt ? ` (${draft.sentAt})` : ''}`, discarded: 'discarded', replaced: 'replaced by a newer draft' }[draft.state];
  return `${draft.channel === 'email' ? 'Email draft' : 'Slack draft'} · ${destinationText(draft)} · ${state}${draft.text !== draft.original ? ' · edited' : ''}\n${draft.text}`;
}
