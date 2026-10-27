import { DraftSendQueue } from './draft-send-queue.js';
import { randomUUID } from 'node:crypto';
import type { Store } from './db.js';
import type { Tool } from './codex.js';
import type { SlackDraft, SlackFields, SlackTarget, SlackTargets } from '../shared/slack-messages.js';
import { cleanSlackFields, slackMessagePayload, SlackApiError, slackRequest, type SlackRequest } from './slack-api.js';
export const slackMessageInstructions = `For drafting or sending Slack messages, use slack_messages__draft to open an editable card in this conversation. Find the recipient/channel with slack_messages__find_targets or existing Slack read tools; never invent destination ids. For replies, read the thread and pass the conversation id and parent thread timestamp. Use slack_messages__update_draft with the current card id and revision for revisions. These tools only save local drafts. The user's explicit Send click in the card authorizes sending that exact saved message; no second approval is needed. You have no Slack composer send tool. Never send via generic Composio execution, shell, browser or other tools to bypass the card. Do not claim a draft was sent. The editor includes an optional “Sent using Aegir” footer, checked by default and controlled by the user. Do not append it to the message body yourself. Agent edits preserve the user’s footer choice. Messages use plain text; no hidden blocks, attachments, auto-unfurls or mass mentions are added.`;
const fields = { destination: { type: 'string', description: 'Verified Slack channel/DM id (C/G/D…) or user id (U/W…) from a lookup' }, threadTs: { type: 'string', description: 'Parent message timestamp for a reply; empty for a new message' }, text: { type: 'string' } };
export const slackMessageTools: Tool[] = [
  { name: 'slack_messages__find_targets', description: 'Find Slack people or channels by name. Results include verified ids. Continue with nextCursor when returned; an empty page is not proof that the person/channel does not exist.', readOnly: true,
    inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: ['people', 'channels'] }, query: { type: 'string' }, cursor: { type: 'string' } }, required: ['kind', 'query'], additionalProperties: false } },
  { name: 'slack_messages__draft', description: 'Open a local inline Slack editor. The user reviews and edits the destination and text, then explicitly clicks Send. Does not send.', readOnly: false,
    inputSchema: { type: 'object', properties: fields, required: ['destination', 'text'], additionalProperties: false } },
  { name: 'slack_messages__update_draft', description: 'Revise a saved Slack editor in this conversation using its id and current revision. Does not send.', readOnly: false,
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, revision: { type: 'integer' }, ...fields }, required: ['id', 'revision', 'destination', 'threadTs', 'text'], additionalProperties: false } },
];
export class SlackMessages {
  private stopped = false;
  private queue = new DraftSendQueue<SlackDraft>(id => this.draft(id).draft, (id, draft) => this.save(id, draft));
  get hasActiveWork() { return this.queue.size > 0 || this.busy.size > 0; }
  private busy = new Set<string>();
  constructor(private store: Store, private refresh: () => void, private request: SlackRequest = slackRequest) {
    const rows = store.db.prepare("SELECT id,meta FROM messages WHERE meta LIKE '%slack-draft%'").all() as { id: string; meta: string }[];
    for (const row of rows) {
      const draft = JSON.parse(row.meta) as SlackDraft;
      if (draft.type !== 'slack-draft' || draft.deliveryProvider === 'claude') continue;
      if (typeof draft.includeFooter !== 'boolean') {
        draft.includeFooter = draft.state === 'draft';
        this.save(row.id, draft);
      }
      if (draft.state === 'queued') this.save(row.id, { ...draft, state: 'draft', queuedUntil: undefined, error: 'Queued send cancelled when Aegir restarted.' });
      if (draft.type === 'slack-draft' && draft.state === 'sending') this.save(row.id, { ...draft, state: 'uncertain', error: 'Sending was interrupted. Check Slack before composing another message.' });
    }
  }
  private account() { return this.store.getSetting('composioSlackAccount') || ''; }
  private active() { if (this.stopped || !this.store.isOpen) throw new Error('Slack messages are stopped'); }
  tools(attended: boolean) { return this.account() ? slackMessageTools.filter(tool => attended || tool.readOnly) : []; }
  private async identity(account: string) {
    this.active(); if (!account) throw new Error('Set your Slack account in Settings → Slack via Composio.');
    const auth = await this.request(account, 'auth.test'); this.active();
    if (!/^T[A-Z0-9]+$/.test(auth.team_id) || !/^[UW][A-Z0-9]+$/.test(auth.user_id) || typeof auth.team !== 'string' || typeof auth.user !== 'string') throw new Error('Slack returned an incomplete account identity.');
    return { teamId: auth.team_id as string, userId: auth.user_id as string, workspace: auth.team as string, sender: auth.user as string };
  }
  private async resolve(account: string, fields: SlackFields) {
    let destinationName: string;
    if (/^[UW]/.test(fields.destination)) {
      const { user } = await this.request(account, 'users.info', { user: fields.destination });
      if (user?.id !== fields.destination || user.deleted) throw new Error('Slack recipient is unavailable.');
      destinationName = `@${user.profile?.display_name || user.real_name || user.name || user.id}`;
    } else {
      const { channel } = await this.request(account, 'conversations.info', { channel: fields.destination });
      if (channel?.id !== fields.destination || channel.is_archived) throw new Error('Slack conversation is unavailable or archived.');
      if (channel.is_im && channel.user) {
        const { user } = await this.request(account, 'users.info', { user: channel.user });
        if (user?.id !== channel.user || user.deleted) throw new Error('Slack recipient is unavailable.');
        destinationName = `@${user.profile?.display_name || user.real_name || user.name || user.id}`;
      } else destinationName = `${channel.is_mpim ? 'Group DM: ' : '#'}${channel.name || fields.destination}`;
    }
    let threadPreview = '';
    if (fields.threadTs) {
      const result = await this.request(account, 'conversations.replies', { channel: fields.destination, ts: fields.threadTs, limit: 1 });
      const parent = result.messages?.[0];
      if (!parent || parent.ts !== fields.threadTs || (parent.thread_ts && parent.thread_ts !== fields.threadTs)) throw new Error('The original Slack thread could not be verified.');
      threadPreview = typeof parent.text === 'string' ? parent.text.slice(0, 1000) : '(message without text)';
    }
    this.active(); return { destinationName, threadPreview };
  }
  async findTargets(kind: 'people' | 'channels', query: string, cursor = ''): Promise<SlackTargets> {
    if (!['people', 'channels'].includes(kind) || typeof query !== 'string' || query.length > 200 || typeof cursor !== 'string' || cursor.length > 2000) throw new Error('Invalid Slack recipient search');
    const account = this.account(); await this.identity(account); let nextCursor = cursor; const targets: SlackTarget[] = []; const seen = new Set<string>();
    for (let page = 0; page < 5; page++) {
      const result = await this.request(account, kind === 'people' ? 'users.list' : 'conversations.list', { limit: 200, ...(nextCursor ? { cursor: nextCursor } : {}), ...(kind === 'channels' ? { types: 'public_channel,private_channel', exclude_archived: true } : {}) });
      this.active(); const items = kind === 'people' ? result.members : result.channels;
      if (!Array.isArray(items)) throw new Error('Slack returned an incomplete recipient list.');
      for (const item of items) {
        if (item.deleted || item.is_archived || item.is_bot || item.id === 'USLACKBOT') continue;
        const name = kind === 'people' ? item.profile?.display_name || item.real_name || item.name : item.name;
        if (typeof name !== 'string' || typeof item.id !== 'string') continue;
        const detail = kind === 'people' ? item.profile?.email || item.name : item.is_private ? 'Private channel' : 'Channel';
        if (!`${name} ${detail || ''} ${item.real_name || ''}`.toLowerCase().includes(query.toLowerCase().replace(/^[@#]/, ''))) continue;
        targets.push({ id: item.id, name: `${kind === 'people' ? '@' : '#'}${name}`, kind: kind === 'people' ? 'person' : 'channel', detail });
      }
      nextCursor = result.response_metadata?.next_cursor || '';
      if (typeof nextCursor !== 'string') throw new Error('Invalid Slack pagination');
      if (!nextCursor || targets.length) break;
      if (seen.has(nextCursor)) throw new Error('Slack returned a repeated page.'); seen.add(nextCursor);
    }
    return { targets, nextCursor };
  }
  async call(tool: string, args: Record<string, unknown>, threadId?: string) {
    if (tool === 'find_targets') return this.findTargets(args.kind as 'people' | 'channels', args.query as string, args.cursor as string | undefined);
    if (!threadId || !['draft', 'update_draft'].includes(tool)) throw new Error('Slack sends require the user to click Send in the inline editor.');
    if (tool === 'update_draft') {
      const id = String(args.id || '');
      if (this.draft(id).message.threadId !== threadId) throw new Error('You can only edit Slack drafts in this conversation.');
      return this.update(id, Number(args.revision), cleanSlackFields({ ...args, includeFooter: this.draft(id).draft.includeFooter }));
    }
    const account = this.account(), fields = cleanSlackFields({ ...args, threadTs: args.threadTs ?? '', includeFooter: true });
    const identity = await this.identity(account); const destination = await this.resolve(account, fields);
    const draft: SlackDraft = { ...fields, ...identity, ...destination, type: 'slack-draft', account, revision: 1, state: 'draft' };
    this.active(); const message = this.store.addMessage(threadId, null, 'system', 'Slack draft — edit and click Send when ready.', 'complete', draft);
    this.refresh(); return { draftId: message.id, revision: 1, sent: false, location: 'Inline Slack editor in this conversation' };
  }
  private draft(id: string) {
    this.active(); const message = this.store.message(id);
    if ((message?.meta?.type !== 'slack-draft' || message.meta.deliveryProvider === 'claude')) throw new Error('Slack draft not found');
    return { message, draft: message.meta };
  }
  private save(id: string, draft: SlackDraft) { this.store.setMessageMeta(id, draft); this.refresh(); }
  private async verify(draft: SlackDraft) {
    if (this.account() !== draft.account) throw new Error('The Slack account changed. Create a new draft for the current account.');
    const identity = await this.identity(draft.account);
    if (identity.teamId !== draft.teamId || identity.userId !== draft.userId) throw new Error('The Slack workspace or sender changed. Create a new draft.');
  }
  async update(id: string, revision: number, input: SlackFields) {
    const { draft } = this.draft(id); const fields = cleanSlackFields(input);
    if (draft.state !== 'draft' || draft.revision !== revision || this.busy.has(id)) throw new Error('This Slack draft changed or is locked. Reload the latest version.');
    this.busy.add(id);
    try {
      await this.verify(draft);
      const target = await this.resolve(draft.account, fields);
      this.active(); const next = { ...draft, ...fields, ...target, revision: revision + 1, error: undefined };
      this.save(id, next); return next;
    } finally { this.busy.delete(id); }
  }
  queueSend(id: string, revision: number, fields: SlackFields) {
    const { draft } = this.draft(id);
    const approved = cleanSlackFields(fields);
    if (JSON.stringify(approved) !== JSON.stringify(cleanSlackFields(draft))) throw new Error('The displayed draft changed. Save and review it before sending.');
    if (!approved.text.trim()) throw new Error('Write a message before sending.'); slackMessagePayload(approved);
    if (this.busy.has(id)) throw new Error('Draft is busy.');
    return this.queue.queue(id, revision, () => this.send(id, revision, approved));
  }
  cancelSend(id: string, revision: number) { return this.queue.cancel(id, revision); }
  markSentManually(id: string, revision: number) { if (this.busy.has(id)) throw new Error('Draft is busy.'); return this.queue.markSentManually(id, revision); }
  // Renderer IPC only. The explicit Send click authorizes this exact revision and displayed fields.
  async send(id: string, revision: number, approvedFields: SlackFields) {
    const { draft } = this.draft(id);
    if (draft.state !== 'draft' || draft.revision !== revision || this.busy.has(id)) throw new Error('This Slack draft changed or is already sending.');
    const fields = cleanSlackFields(approvedFields);
    if (JSON.stringify(fields) !== JSON.stringify(cleanSlackFields(draft))) throw new Error('The displayed Slack message changed. Save and review it before sending.');
    if (!fields.text.trim()) throw new Error('Write a message before sending.');
    const payload = slackMessagePayload(fields);
    const frozen: SlackDraft = { ...structuredClone(draft), approvedAt: new Date().toISOString(), approvedRevision: revision };
    this.busy.add(id); let attempted = false;
    try {
      this.save(id, { ...frozen, state: 'sending' }); await this.verify(frozen);
      const target = await this.resolve(frozen.account, fields);
      if (target.destinationName !== frozen.destinationName || target.threadPreview !== frozen.threadPreview) throw new Error('The Slack destination or original message changed. Save the draft again to review it.');
      let channel = fields.destination;
      if (/^[UW]/.test(channel)) {
        const result = await this.request(frozen.account, 'conversations.open', { users: channel }); this.active();
        if (typeof result.channel?.id !== 'string' || !/^D[A-Z0-9]+$/.test(result.channel.id)) throw new Error('Slack did not confirm the direct-message destination.');
        channel = result.channel.id;
      }
      this.active(); attempted = true;
      const result = await this.request(frozen.account, 'chat.postMessage', { channel, ...payload, ...(fields.threadTs ? { thread_ts: fields.threadTs } : {}),
        mrkdwn: false, parse: 'none', link_names: false, unfurl_links: false, unfurl_media: false, reply_broadcast: false, client_msg_id: randomUUID() });
      this.active(); if (typeof result.ts !== 'string' || result.channel !== channel) throw new Error('Slack did not confirm sending.');
      this.save(id, { ...frozen, state: 'sent', sentTs: result.ts, sentChannel: channel });
    } catch (error) {
      if (!this.stopped && this.store.isOpen) {
        const uncertain = attempted && !(error instanceof SlackApiError);
        this.save(id, { ...frozen, state: uncertain ? 'uncertain' : 'draft', error: uncertain ? 'Delivery is unconfirmed. Check Slack before composing another message; this draft will not retry automatically.' : String(error) });
      }
      throw error;
    } finally { this.busy.delete(id); }
  }
  stop() { this.queue.stop(); this.stopped = true; }
}
