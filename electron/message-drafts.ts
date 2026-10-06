import type { DraftState, EmailDestination, MessageDraft, SlackDestination } from '../shared/types.js';
import type { GatedCall } from './gated.js';

// Draft cards: an email or Slack message the agent wrote for the user to send, shown as an editable card under the
// agent's reply. The user edits it there and presses Send, or copies it and sends it themselves. What the card shows as
// the destination is confirmed by Slack or Superhuman, never taken from the agent, and what Send sends is exactly the
// card's text, through a locked run (gated.ts) that starts only after the user's click and a five-second undo window.

// The user's connectors as Claude Code names them: a local Slack bridge (claude.ai's own Slack shares the prefix and
// adds the profile tool) and claude.ai's Superhuman Mail.
export const SLACK = 'mcp__claude_ai_Slack__';
export const SUPERHUMAN = 'mcp__claude_ai_Superhuman_Mail__';
export const UNDO_MS = 5000;

const slackId = /^[CDGU][A-Z0-9]{6,15}$/;
const slackTs = /^\d{9,11}\.\d{1,9}$/;
const address = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/;
const emailTypes = ['new', 'reply', 'reply_all', 'forward'] as const;
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
// Addresses as a connector returns them: plain strings or { email, name }.
const listed = (value: unknown): string[] => (Array.isArray(value) ? value : [])
  .map(item => (typeof item === 'string' ? item : string(object(item).email)).trim().toLowerCase())
  .filter(Boolean);

// Slack and Superhuman answer with JSON text, MCP content blocks or plain text. Returns the JSON when there is some,
// else { text }.
export function readToolResponse(response: unknown): unknown {
  if (Array.isArray(response)) {
    const text = response.map(block => (block && typeof block === 'object' && 'text' in block ? String((block as { text: unknown }).text) : '')).join('');
    return readToolResponse(text);
  }
  if (response && typeof response === 'object' && Array.isArray((response as { content?: unknown }).content))
    return readToolResponse((response as { content: unknown[] }).content);
  if (typeof response === 'string') {
    try { return readToolResponse(JSON.parse(response)); } catch { return { text: response }; }
  }
  return response;
}

export function cleanDraftText(value: unknown): string {
  if (typeof value !== 'string') throw new Error('The draft text must be text');
  if (value.length > MAX_TEXT) throw new Error('The draft is too long');
  return value.replace(/\r\n/g, '\n');
}

// What the connectors themselves returned in this conversation: Slack names by id, Superhuman drafts by draft id.
export type Known = { slack: Map<string, string>; email: Map<string, EmailDestination> };
export const nothingKnown = (): Known => ({ slack: new Map(), email: new Map() });

// Validates a messages__draft call and builds the card. A destination the connectors already confirmed in this
// conversation is used as is; anything else is checked next (see needsCheck).
export function draftFromTool(args: Record<string, unknown>, known: Known = nothingKnown()): MessageDraft {
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
    const name = known.slack.get(channelId);
    const destination: SlackDestination = { channelId, ...(threadTs ? { threadTs } : {}), ...(name ? { name } : {}) };
    return { ...base, channel: 'slack', slack: destination };
  }
  if (args.channel === 'email') {
    const email = object(args.email);
    const to = addresses(email.to, 'to');
    if (!to.length) throw new Error('email.to needs at least one address');
    const destination: EmailDestination = { to, cc: addresses(email.cc, 'cc'), bcc: addresses(email.bcc, 'bcc'), subject: string(email.subject).slice(0, 300) };
    const draftId = string(email.draft_id); const threadId = string(email.thread_id); const account = string(email.account).toLowerCase();
    const type = emailTypes.find(item => item === email.type);
    if (draftId) destination.draftId = draftId.slice(0, 120);
    if (threadId) destination.threadId = threadId.slice(0, 120);
    if (type) destination.type = type;
    if (account) {
      if (!address.test(account)) throw new Error('email.account must be the Superhuman account address');
      destination.account = account;
    }
    // Superhuman's own copy of this draft wins over what the agent said it contains.
    const captured = destination.draftId ? known.email.get(destination.draftId) : undefined;
    return { ...base, channel: 'email', email: captured ? { ...destination, ...captured, confirmed: true } : destination };
  }
  throw new Error("channel must be 'slack' or 'email'");
}

// ---- Learning from the agent's own tool results ---------------------------------------

// The draft as Superhuman returned it (create_or_update_draft or get_draft), plus what every later update needs from
// the call itself. Null when it isn't a draft.
export function emailDestination(result: unknown, call: Record<string, unknown>, previous?: EmailDestination): EmailDestination | null {
  const outer = object(result);
  const draft = object(outer.draft ?? outer);
  const draftId = string(draft.draft_id) || string(call.draft_id) || previous?.draftId || '';
  const threadId = string(draft.thread_id) || string(call.thread_id) || previous?.threadId || '';
  if (!draftId || !threadId || !('to' in draft || 'cc' in draft || 'subject' in draft)) return null;
  const type = emailTypes.find(item => item === call.type) || previous?.type;
  const account = string(call.acting_email).toLowerCase() || previous?.account;
  return {
    to: listed(draft.to), cc: listed(draft.cc), bcc: listed(draft.bcc), subject: string(draft.subject),
    draftId, threadId, ...(type ? { type } : {}), ...(account ? { account } : {}), confirmed: true,
  };
}

// Called with every tool result in a chat or task run. Results come from the connector, not the model.
export function learnFromToolResult(name: string, input: unknown, response: unknown, known: Known) {
  if (name === `${SUPERHUMAN}create_or_update_draft` || name === `${SUPERHUMAN}get_draft`) {
    const destination = emailDestination(readToolResponse(response), object(input), undefined);
    if (destination?.draftId) known.email.set(destination.draftId, { ...known.email.get(destination.draftId), ...destination });
    return;
  }
  if (!name.startsWith(SLACK)) return;
  const result = object(readToolResponse(response));
  for (const user of Array.isArray(result.users) ? result.users : []) {
    const item = object(user);
    const id = string(item.id); const shown = string(item.real_name) || string(item.display_name) || string(item.name);
    if (slackId.test(id) && shown && !item.deleted) known.slack.set(id, shown);
  }
  for (const entry of Array.isArray(result.channels) ? result.channels : []) {
    const item = object(entry);
    const id = string(item.id); const shown = string(item.name);
    // A DM's name is the other person's user id, which says nothing on a card.
    if (slackId.test(id) && shown && !item.is_im && !slackId.test(shown)) known.slack.set(id, shown);
  }
}

// ---- Confirming where a card goes ----------------------------------------------------------

export function slackKind(channelId: string): 'dm' | 'channel' | 'group' {
  return channelId.startsWith('C') ? 'channel' : channelId.startsWith('G') ? 'group' : 'dm';
}

// slack_read_user_profile answers "Name (handle)\nCompany\nTitle…" as text, or a profile object.
export function profileName(result: unknown): string | null {
  const value = object(readToolResponse(result));
  const named = string(value.real_name) || string(value.display_name) || string(object(value.profile).real_name);
  if (named) return named;
  const text = string(value.result) || string(value.text);
  const first = text.split('\n').map(line => line.trim()).find(Boolean) || '';
  if (!first || /^error\b|not[_ ]found/i.test(first)) return null;
  return first.replace(/\s*\([^)]*\)$/, '').trim() || first;
}

function channelEntry(result: unknown, id: string): Record<string, unknown> | undefined {
  const channels = object(readToolResponse(result)).channels;
  return (Array.isArray(channels) ? channels : []).map(object).find(item => item.id === id);
}

// A Slack card whose name isn't confirmed yet, or an email card whose Superhuman draft Legolas hasn't seen.
export function needsCheck(draft: MessageDraft): boolean {
  if (draft.channel === 'slack') return !!draft.slack && draft.slack.name === undefined;
  return !!draft.email?.draftId && !!draft.email.threadId && !draft.email.confirmed;
}

export type Check = { calls: GatedCall[]; read: (results: unknown[]) => Partial<MessageDraft> };

// Read-only lookups in a locked run: Slack's own name for the destination, or the draft as Superhuman holds it.
export function checkPlan(draft: MessageDraft): Check | null {
  if (draft.channel === 'slack' && draft.slack) {
    const slack = draft.slack;
    const profile = (userId: (results: unknown[]) => string): GatedCall => ({
      tool: `${SLACK}slack_read_user_profile`, input: results => ({ user_id: userId(results), response_format: 'concise' }),
    });
    const named = (name: string | null, why: string): Partial<MessageDraft> => ({ slack: { ...slack, name }, error: name ? undefined : why });
    if (slack.channelId.startsWith('U'))
      return { calls: [profile(() => slack.channelId)], read: ([result]) => named(result === undefined ? null : profileName(result), "Slack didn't say who this is") };
    const list: GatedCall = {
      tool: `${SLACK}slack_search_channels`,
      input: () => ({ query: '', channel_types: slack.channelId.startsWith('D') ? 'im' : 'public_channel,private_channel,mpim', limit: 999 }),
      check: result => (channelEntry(result, slack.channelId) ? null : 'not found'),
    };
    if (slack.channelId.startsWith('D'))
      return {
        // The DM's other person, then their name.
        calls: [list, profile(([result]) => string(channelEntry(result, slack.channelId)?.name) || string(channelEntry(result, slack.channelId)?.user))],
        read: results => named(results.length > 1 ? profileName(results[1]) : null, 'Slack has no DM with this id that you can see'),
      };
    return { calls: [list], read: ([result]) => named(result === undefined ? null : string(channelEntry(result, slack.channelId)?.name) || null, 'Slack has no channel with this id that you can see') };
  }
  if (draft.channel === 'email' && draft.email?.draftId) {
    const email = draft.email;
    return {
      calls: [{ tool: `${SUPERHUMAN}get_draft`, input: () => ({ draft_id: email.draftId, ...(email.account ? { acting_email: email.account } : {}) }) }],
      read: ([result]) => {
        const found = result === undefined ? null : emailDestination(result, {}, email);
        return found ? { email: { ...email, ...found } } : { error: "Superhuman didn't return this draft, so Legolas can't confirm who it goes to" };
      },
    };
  }
  return null;
}

// Send needs a destination the connector confirmed. Email also needs the Superhuman draft and its kind.
export function canSend(draft: MessageDraft): boolean {
  if (draft.channel === 'slack') return !!draft.slack?.name;
  return !!(draft.email?.draftId && draft.email.threadId && draft.email.type && draft.email.confirmed);
}

// ---- Sending -----------------------------------------------------------------------------------

// Plain text to Superhuman's body HTML, one <div> per line as Superhuman writes it, with the text escaped.
export function emailHtml(text: string): string {
  const escape = (line: string) => line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return text.split('\n').map(line => `<div>${line ? escape(line) : '<br>'}</div>`).join('');
}

const sameList = (a: string[], b: string[]) => [...a].sort().join('\n') === [...b].sort().join('\n');
export function sameDestination(card: EmailDestination, live: EmailDestination): boolean {
  return sameList(card.to, live.to) && sameList(card.cc, live.cc) && sameList(card.bcc, live.bcc) && card.subject === live.subject;
}

// How a released send ended. 'failed' only when the tool itself said no, so nothing went out; anything else after
// the send call was released is 'unknown', so a retry can never send twice.
export type SendVerdict = { state: 'sent'; link?: string; sentAt: string } | { state: 'failed' | 'unknown'; error: string };

export function slackVerdict(result: unknown, channelId: string, now = new Date()): SendVerdict {
  const value = object(readToolResponse(result));
  const error = string(value.error);
  if (error) return { state: 'failed', error: `Slack said: ${error}` };
  if (value.ok === true || string(value.ts) || string(value.message_ts) || string(value.permalink)) {
    const link = string(value.permalink) || string(value.permalink_hint) || `https://app.slack.com/client/${string(value.channel) || channelId}`;
    return { state: 'sent', link, sentAt: now.toISOString() };
  }
  const text = string(value.text);
  if (/^(error|failed|could not|couldn't)/i.test(text)) return { state: 'failed', error: `Slack said: ${text.slice(0, 200)}` };
  const link = text.match(/https:\/\/\S*slack\.com\S*/)?.[0];
  if (link || /\b(sent|posted)\b/i.test(text)) return { state: 'sent', ...(link ? { link } : {}), sentAt: now.toISOString() };
  return { state: 'unknown', error: 'Slack answered without confirming the message' };
}

export function superhumanVerdict(result: unknown, now = new Date()): SendVerdict {
  const value = object(readToolResponse(result));
  if (value.success === true) return { state: 'sent', ...(string(value.open_url) ? { link: string(value.open_url) } : {}), sentAt: string(value.sent_at) || now.toISOString() };
  const error = string(value.error) || string(object(value.error).message);
  if (value.success === false || error) return { state: 'failed', error: `Superhuman said: ${error || 'not sent'}` };
  return { state: 'unknown', error: 'Superhuman answered without confirming the send' };
}

// The calls that send a card. `commit` runs right before the irreversible call and returns false when the user took
// the send back in the undo window. For email, `live` reads the draft Superhuman answered with before the send.
export type SendPlan = { calls: GatedCall[]; sendIndex: number; verdict: (result: unknown) => SendVerdict; live?: (results: unknown[]) => EmailDestination | null };

export function sendPlan(draft: MessageDraft, commit: () => Promise<boolean>): SendPlan {
  if (draft.channel === 'slack' && draft.slack) {
    const { channelId, threadTs } = draft.slack;
    // The bridge reads `text`, claude.ai's own Slack reads `message`; each ignores the other.
    return {
      calls: [{ tool: `${SLACK}slack_send_message`, input: () => ({ channel_id: channelId, text: draft.text, message: draft.text, thread_ts: threadTs || '' }), commit }],
      sendIndex: 0,
      verdict: result => slackVerdict(result, channelId),
    };
  }
  if (draft.channel === 'email' && draft.email?.draftId && draft.email.threadId && draft.email.type) {
    const email = draft.email;
    const account = email.account ? { acting_email: email.account } : {};
    return {
      calls: [
        // The card's text goes into the draft, body only: sending recipients again breaks names with å, ä and ö.
        // Superhuman answers with the live draft, which must still go where the card says.
        {
          tool: `${SUPERHUMAN}create_or_update_draft`,
          input: () => ({ type: email.type, draft_id: email.draftId, thread_id: email.threadId, body: emailHtml(draft.text), ...account }),
          check: result => {
            const live = emailDestination(result, {}, email);
            if (!live) return "Superhuman didn't return the draft";
            return sameDestination(email, live) ? null : 'The draft in Superhuman goes to different people now';
          },
        },
        { tool: `${SUPERHUMAN}send_draft`, input: () => ({ draft_id: email.draftId, ...account }), commit },
      ],
      sendIndex: 1,
      verdict: result => superhumanVerdict(result),
      live: results => (results[0] === undefined ? null : emailDestination(results[0], {}, email)),
    };
  }
  throw new Error("This draft can't be sent from Legolas");
}

// ---- What the card says, in the history and in Copy chat ---------------------------------------

export function destinationText(draft: MessageDraft): string {
  if (draft.channel === 'slack' && draft.slack) {
    const { channelId, threadTs, name } = draft.slack;
    const confirmed = name ? `, confirmed by Slack as ${slackKind(channelId) === 'dm' ? name : `#${name}`}` : '';
    return `${draft.label} (Slack ${channelId}${threadTs ? `, in thread ${threadTs}` : ''}${confirmed})`;
  }
  const email = draft.email;
  if (!email) return draft.label;
  const rows = [`to ${email.to.join(', ')}`, email.cc.length ? `cc ${email.cc.join(', ')}` : '', email.bcc.length ? `bcc ${email.bcc.join(', ')}` : '', email.subject ? `subject "${email.subject}"` : ''];
  return `${draft.label} (email ${rows.filter(Boolean).join(', ')}${email.confirmed ? ', as Superhuman holds it' : ''})`;
}

const outcome: Record<DraftState, string> = {
  checking: 'is waiting while Legolas confirms where it goes',
  pending: 'is waiting for the user to send it',
  queued: 'is about to be sent: the user pressed Send',
  sending: 'is being sent',
  sent: 'was sent by the user',
  failed: "wasn't sent: the send failed",
  unknown: 'may or may not have been sent: Legolas lost track of the send',
  discarded: 'was discarded by the user, not sent',
  replaced: 'was replaced by a newer draft, not sent',
};

// One line per card in the history Claude reads, so "make it shorter" starts from the user's edits and Claude never
// asks for something already sent.
export function draftHistory(id: string, draft: MessageDraft): string {
  const kind = draft.channel === 'email' ? 'Email' : 'Slack message';
  const how = draft.state === 'sent' && draft.sentBy === 'legolas' ? 'was sent by Legolas when the user pressed Send' : outcome[draft.state];
  const when = draft.state === 'sent' && draft.sentAt ? ` at ${draft.sentAt}` : '';
  const why = (draft.state === 'failed' || draft.state === 'unknown') && draft.error ? ` (${draft.error})` : '';
  const replaced = draft.state === 'replaced' && draft.replacedBy ? ` (draft card ${draft.replacedBy})` : '';
  const edited = draft.text !== draft.original ? ' The user edited it.' : '';
  return `Draft card ${id}: ${kind}, ${destinationText(draft)}. It ${how}${when}${why}${replaced}.${edited} ${draft.state === 'sent' ? 'Text as sent' : 'Current text'}:\n${draft.text}`;
}

// Copy chat: the card, its state and its text.
export function draftTranscript(draft: MessageDraft): string {
  const when = draft.sentAt ? ` (${draft.sentAt})` : '';
  const state = {
    checking: 'checking where it goes', pending: 'waiting to be sent', queued: 'about to be sent', sending: 'sending',
    sent: draft.sentBy === 'legolas' ? `sent from Legolas${when}` : `sent by you${when}`,
    failed: `not sent${draft.error ? `: ${draft.error}` : ''}`, unknown: 'may not have been sent, check before resending',
    discarded: 'discarded', replaced: 'replaced by a newer draft',
  }[draft.state];
  return `${draft.channel === 'email' ? 'Email draft' : 'Slack draft'} · ${destinationText(draft)} · ${state}${draft.text !== draft.original ? ' · edited' : ''}\n${draft.text}`;
}
