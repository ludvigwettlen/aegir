import type { Store } from './db.js';
import type { ModelProvider, Tool } from './codex.js';
import type { GatedCall, GatedOutcome } from './gated.js';
import type { EmailDraft, EmailFields } from '../shared/gmail.js';
import type { SlackDraft, SlackFields, SlackTargets } from '../shared/slack-messages.js';
import { slackMessageText } from '../shared/slack-messages.js';
import { cleanEmailFields, rawEmail } from './gmail-api.js';
import { cleanSlackFields, slackMessagePayload } from './slack-api.js';
import { DraftSendQueue } from './draft-send-queue.js';
import { readProviderSetup } from '../shared/provider-setup.js';

const SLACK = 'mcp__claude_ai_Slack__';
const MAIL = 'mcp__claude_ai_Superhuman_Mail__';
type Draft = EmailDraft | SlackDraft;
const object = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
export function readConnectionResponse(value: unknown): any {
  if (typeof value === 'string') { try { return readConnectionResponse(JSON.parse(value)); } catch { return { text: value }; } }
  if (Array.isArray(value)) return readConnectionResponse(value.map(item => object(item).text || '').join(''));
  const record = object(value);
  if (record.isError) throw new Error('The Claude connection reported a tool error.');
  return Array.isArray(record.content) ? readConnectionResponse(record.content) : record;
}
export const emailHtml = (text: string) => text.split('\n').map(line => `<div>${line ? line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') : '<br>'}</div>`).join('');
const addresses = (value: unknown) => (Array.isArray(value) ? value : []).map(item => typeof item === 'string' ? item : object(item).email).map(item => String(item || '').trim().toLowerCase()).sort();
function externalEmail(value: unknown) {
  const record = object(value), draft = object(record.draft || record);
  if (typeof draft.draft_id !== 'string' || typeof draft.thread_id !== 'string' || !Array.isArray(draft.to) || !Array.isArray(draft.cc) || !Array.isArray(draft.bcc) || typeof draft.subject !== 'string' || typeof draft.body !== 'string') throw new Error('Superhuman did not return complete draft fields.');
  return { draftId: draft.draft_id, threadId: draft.thread_id, to: addresses(draft.to), cc: addresses(draft.cc), bcc: addresses(draft.bcc), subject: draft.subject, body: draft.body };
}
export const claudeDraftInstructions = `For Slack and email drafts use messages__draft to display the shared editable card. The user clicks Send, has five seconds to Undo, or marks it sent manually. Never send through native connector tools, shell or browser. Slack uses the Claude Slack connection. Use native read tools to find IDs; supply destination and threadTs for replies. For email use your Superhuman Mail connection to create/read the external draft first (creating an external draft may need approval), then supply its draft_id, thread_id, kind and acting_email to messages__draft along with the desired plain-text body. The app verifies the external draft and shows its recipients/subject, and checks for external changes before delivery. messages__update_draft edits local cards only. Missing connections are errors, never a reason to switch delivery providers.`;
export const claudeDraftTools: Tool[] = [
  { name: 'messages__draft', description: 'Open a verified Slack or Superhuman email card. Never sends.', readOnly: false, inputSchema: { type: 'object', properties: {
    channel: { type: 'string', enum: ['slack', 'email'] }, destination: { type: 'string' }, threadTs: { type: 'string' }, text: { type: 'string' },
    draft_id: { type: 'string' }, thread_id: { type: 'string' }, kind: { type: 'string', enum: ['new', 'reply', 'reply_all', 'forward'] }, acting_email: { type: 'string' },
  }, required: ['channel', 'text'], additionalProperties: false } },
  { name: 'messages__update_draft', description: 'Update a local draft using its id and revision. Never sends.', readOnly: false, inputSchema: { type: 'object', properties: {
    id: { type: 'string' }, revision: { type: 'integer' }, text: { type: 'string' }, to: { type: 'string' }, cc: { type: 'string' }, bcc: { type: 'string' }, subject: { type: 'string' },
  }, required: ['id', 'revision', 'text'], additionalProperties: false } },
];
export class ClaudeDrafts {
  private stopped = false;
  private busy = new Set<string>();
  private queue = new DraftSendQueue<Draft>(id => this.draft(id), (id, draft) => this.save(id, draft));
  constructor(private store: Store, private engine: ModelProvider, private refresh: () => void) {
    for (const row of store.db.prepare("SELECT id,meta FROM messages WHERE meta LIKE '%deliveryProvider%'").all() as { id: string; meta: string }[]) {
      const draft = JSON.parse(row.meta) as Draft;
      if (draft.deliveryProvider !== 'claude') continue;
      if (draft.state === 'queued') this.save(row.id, { ...draft, state: 'draft', queuedUntil: undefined, error: 'Queued send cancelled when Aegir restarted.' });
      if (draft.state === 'sending') this.save(row.id, { ...draft, state: 'uncertain', error: 'Sending was interrupted. Check the connected service before sending again.' });
    }
  }
  get hasActiveWork() { return this.queue.size > 0 || this.busy.size > 0; }
  owns(id: string) { return (this.store.message(id)?.meta as Draft | undefined)?.deliveryProvider === 'claude'; }
  private active() {
    if (this.stopped || !this.store.isOpen) throw new Error('Claude draft delivery is stopped.');
    if (readProviderSetup(this.store.getSetting('providerSetup')).connections !== 'claude') throw new Error('Switch to your Claude setup to use this draft’s original connection.');
  }
  private draft(id: string): Draft {
    if (this.stopped || !this.store.isOpen) throw new Error('Claude drafts are stopped.');
    const value = this.store.message(id)?.meta;
    if ((value?.type !== 'slack-draft' && value?.type !== 'email-draft') || value.deliveryProvider !== 'claude') throw new Error('Claude draft not found.');
    return value;
  }
  private save(id: string, draft: Draft) { this.store.setMessageMeta(id, draft); this.refresh(); }
  private async execute(calls: GatedCall[]): Promise<GatedOutcome> {
    this.active();
    if (!this.engine.sendGated) throw new Error('The selected engine cannot use Claude connections.');
    return this.engine.sendGated(calls, readConnectionResponse);
  }
  private async read(calls: GatedCall[]) {
    const result = await this.execute(calls);
    if (!result.completed) throw new Error(result.error || 'Claude connection could not complete the lookup.');
    this.active(); return result.results;
  }
  private async slackTarget(fields: SlackFields) {
    let name: string;
    if (/^[UW]/.test(fields.destination)) {
      const [result] = await this.read([{ tool: `${SLACK}slack_read_user_profile`, input: () => ({ user_id: fields.destination, response_format: 'concise' }) }]);
      const value = object(result), profile = object(value.profile);
      name = value.real_name || value.display_name || profile.real_name || profile.display_name;
      if (typeof name !== 'string' || !name.trim()) throw new Error('Slack did not confirm the recipient name.');
      name = `@${name}`;
    } else {
      const [result] = await this.read([{ tool: `${SLACK}slack_search_channels`, input: () => ({ query: fields.destination, channel_types: 'public_channel,private_channel,mpim,im', limit: 5 }) }]);
      const channel = object(result).channels?.find((item: any) => item.id === fields.destination);
      if (!channel || channel.is_archived || typeof channel.name !== 'string') throw new Error('Slack did not confirm this channel.');
      if (channel.is_im || fields.destination.startsWith('D')) {
        const userId = typeof channel.user === 'string' ? channel.user : channel.name;
        if (!/^[UW][A-Z0-9]{5,30}$/.test(userId)) throw new Error('Slack did not confirm the direct-message recipient.');
        name = (await this.slackTarget({ ...fields, destination: userId, threadTs: '' })).destinationName;
      } else name = `#${channel.name}`;
    }
    let threadPreview = '';
    if (fields.threadTs) {
      const [result] = await this.read([{ tool: `${SLACK}slack_read_thread`, input: () => ({ channel_id: fields.destination, thread_ts: fields.threadTs }) }]);
      const parent = object(result).messages?.find((item: any) => item.ts === fields.threadTs);
      if (!parent || typeof parent.text !== 'string') throw new Error('Slack did not confirm the original thread.');
      threadPreview = parent.text.slice(0, 1000);
    }
    return { destinationName: name, threadPreview };
  }
  async findTargets(kind: 'people' | 'channels', query: string, cursor = ''): Promise<SlackTargets> {
    if (!['people', 'channels'].includes(kind) || typeof query !== 'string' || query.length > 200 || cursor) throw new Error('Invalid Claude Slack search. Refine your search instead of paging.');
    const [result] = await this.read([{ tool: `${SLACK}${kind === 'people' ? 'slack_search_users' : 'slack_search_channels'}`, input: () => ({ query, limit: 50 }) }]);
    const items = object(result)[kind === 'people' ? 'users' : 'channels'];
    if (!Array.isArray(items)) throw new Error('Slack returned an incomplete search result.');
    return { targets: items.filter(item => !item.deleted && !item.is_archived && typeof item.id === 'string').map(item => ({ id: item.id, kind: kind === 'people' ? 'person' : 'channel', name: `${kind === 'people' ? '@' : '#'}${item.real_name || item.display_name || item.name}`, detail: item.email || '' })), nextCursor: '' };
  }
  async call(tool: string, args: Record<string, unknown>, threadId: string) {
    this.active();
    if (tool === 'update_draft') {
      const id = String(args.id || ''), draft = this.draft(id);
      if (this.store.message(id)?.threadId !== threadId) throw new Error('Draft belongs to another conversation.');
      return this.update(id, Number(args.revision), draft.type === 'slack-draft' ? { ...draft, text: args.text } as SlackFields : { ...cleanEmailFields(draft), ...Object.fromEntries(['to', 'cc', 'bcc', 'subject'].filter(key => args[key] !== undefined).map(key => [key, args[key]])), body: args.text } as EmailFields);
    }
    if (tool !== 'draft') throw new Error('Only local drafting tools are available to agents.');
    let draft: Draft;
    if (args.channel === 'slack') {
      const fields = cleanSlackFields({ destination: args.destination, threadTs: args.threadTs || '', text: args.text, includeFooter: true });
      const target = await this.slackTarget(fields);
      draft = { ...fields, ...target, type: 'slack-draft', deliveryProvider: 'claude', account: 'claude-slack', teamId: '', userId: '', workspace: 'Claude Slack connection', sender: 'Your connected Slack account', revision: 1, state: 'draft' };
    } else if (args.channel === 'email') {
      if (typeof args.acting_email !== 'string' || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(args.acting_email) || typeof args.draft_id !== 'string' || typeof args.thread_id !== 'string' || !['new', 'reply', 'reply_all', 'forward'].includes(String(args.kind))) throw new Error('Provide the verified Superhuman draft, thread, type and account.');
      const [result] = await this.read([{ tool: `${MAIL}get_draft`, input: () => ({ draft_id: args.draft_id, acting_email: args.acting_email }) }]);
      const external = externalEmail(result);
      if (external.draftId !== args.draft_id || external.threadId !== args.thread_id) throw new Error('Superhuman returned a different draft.');
      const fields = cleanEmailFields({ to: external.to.join(', '), cc: external.cc.join(', '), bcc: external.bcc.join(', '), subject: external.subject, body: args.text });
      draft = { ...fields, type: 'email-draft', deliveryProvider: 'claude', externalDraft: { draftId: external.draftId, threadId: external.threadId, kind: args.kind as 'new', baseline: JSON.stringify(external) }, account: args.acting_email, email: args.acting_email, revision: 1, state: 'draft' };
    } else throw new Error('Choose Slack or email.');
    this.active(); const message = this.store.addMessage(threadId, null, 'system', 'Draft — review and edit before sending.', 'complete', draft);
    this.refresh(); return { draftId: message.id, revision: 1, sent: false };
  }
  async update(id: string, revision: number, input: EmailFields | SlackFields) {
    this.active(); const draft = this.draft(id);
    if (draft.state !== 'draft' || draft.revision !== revision || this.busy.has(id)) throw new Error('This draft changed or is locked.');
    this.busy.add(id);
    try {
      const next: Draft = draft.type === 'email-draft' ? { ...draft, ...cleanEmailFields(input), revision: revision + 1, error: undefined }
        : { ...draft, ...cleanSlackFields(input), ...await this.slackTarget(cleanSlackFields(input)), revision: revision + 1, error: undefined };
      this.active(); this.save(id, next); return next;
    } finally { this.busy.delete(id); }
  }
  queueSend(id: string, revision: number, input: EmailFields | SlackFields) {
    this.active(); const draft = this.draft(id);
    const clean = draft.type === 'email-draft' ? cleanEmailFields : cleanSlackFields;
    if (JSON.stringify(clean(input)) !== JSON.stringify(clean(draft))) throw new Error('The displayed draft changed. Save it first.');
    if (draft.type === 'email-draft') rawEmail(draft); else { if (!draft.text.trim()) throw new Error('Write a message.'); slackMessagePayload(draft); }
    if (this.busy.has(id)) throw new Error('Draft is busy.');
    return this.queue.queue(id, revision, () => this.send(id, revision));
  }
  cancelSend(id: string, revision: number) { return this.queue.cancel(id, revision); }
  markSentManually(id: string, revision: number) { if (this.busy.has(id)) throw new Error('Draft is busy.'); return this.queue.markSentManually(id, revision); }
  private async send(id: string, revision: number) {
    this.active(); const draft = structuredClone(this.draft(id));
    if (draft.state !== 'draft' || draft.revision !== revision || this.busy.has(id)) throw new Error('Draft changed.');
    this.busy.add(id); let attempted = false;
    this.save(id, { ...draft, state: 'sending', queuedUntil: undefined, approvedAt: new Date().toISOString(), approvedRevision: revision });
    try {
      let calls: GatedCall[];
      if (draft.type === 'slack-draft') {
        const target = await this.slackTarget(draft);
        if (target.destinationName !== draft.destinationName || target.threadPreview !== draft.threadPreview) throw new Error('Slack destination or thread changed. Save and review the draft again.');
        calls = [{ tool: `${SLACK}slack_send_message`, input: () => ({ channel_id: draft.destination, text: slackMessageText(draft), message: slackMessageText(draft), thread_ts: draft.threadTs }), commit: () => { this.active(); attempted = true; return true; } }];
      } else {
        const external = draft.externalDraft;
        if (!external) throw new Error('Missing Superhuman draft.');
        const account = { acting_email: draft.email };
        const expected = { draftId: external.draftId, threadId: external.threadId, to: draft.to.split(',').map(x => x.trim().toLowerCase()).sort(), cc: draft.cc ? draft.cc.split(',').map(x => x.trim().toLowerCase()).sort() : [], bcc: draft.bcc ? draft.bcc.split(',').map(x => x.trim().toLowerCase()).sort() : [], subject: draft.subject, body: emailHtml(draft.body) };
        calls = [
          { tool: `${MAIL}get_draft`, input: () => ({ draft_id: external.draftId, ...account }), check: value => JSON.stringify(externalEmail(value)) === external.baseline ? null : 'The external draft changed. Create a fresh card to review it.' },
          { tool: `${MAIL}create_or_update_draft`, input: () => ({ draft_id: external.draftId, thread_id: external.threadId, type: external.kind, ...account, to: expected.to, cc: expected.cc, bcc: expected.bcc, subject: draft.subject, body: expected.body }), check: value => JSON.stringify(externalEmail(value)) === JSON.stringify(expected) ? null : 'Superhuman returned different fields. Review its draft before sending.' },
          { tool: `${MAIL}get_draft`, input: () => ({ draft_id: external.draftId, ...account }), check: value => JSON.stringify(externalEmail(value)) === JSON.stringify(expected) ? null : 'The external draft changed before sending.' },
          { tool: `${MAIL}send_draft`, input: () => ({ draft_id: external.draftId, ...account }), commit: () => { this.active(); attempted = true; return true; } },
        ];
      }
      const outcome = await this.execute(calls);
      if (!outcome.completed) throw new Error(outcome.error || 'Claude did not confirm delivery.');
      const result = object(outcome.results.at(-1));
      const confirmed = draft.type === 'email-draft' ? result.success === true : result.ok === true && typeof (result.ts || result.message_ts) === 'string';
      if (!confirmed) throw new Error('The connection did not confirm delivery.');
      this.active(); this.save(id, { ...draft, state: 'sent', queuedUntil: undefined, error: undefined });
    } catch (error) {
      if (!this.stopped && this.store.isOpen) this.save(id, { ...draft, state: attempted ? 'uncertain' : 'draft', queuedUntil: undefined, error: `${String(error)}${attempted ? ' Check the service before sending again; Aegir will not retry.' : ''}` });
    } finally { this.busy.delete(id); }
  }
  stop() { this.queue.stop(); this.stopped = true; }
}
