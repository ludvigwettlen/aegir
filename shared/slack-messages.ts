import type { DraftDelivery } from './draft-delivery.js';
export const slackFooter = 'Sent using Aegir';
export type SlackFields = { destination: string; threadTs: string; text: string; includeFooter: boolean };
export function slackMessageText(fields: Pick<SlackFields, 'text' | 'includeFooter'>) {
  return fields.text + (fields.includeFooter ? `\n\n${slackFooter}` : '');
}
export type SlackTarget = { id: string; name: string; kind: 'person' | 'channel'; detail?: string };
export type SlackTargets = { targets: SlackTarget[]; nextCursor: string };
export type SlackDraft = DraftDelivery & SlackFields & {
  type: 'slack-draft'; account: string; teamId: string; userId: string; workspace: string; sender: string;
  destinationName: string; threadPreview: string; revision: number;
  state: 'queued' | 'sent-manually' | 'draft' | 'sending' | 'sent' | 'uncertain';
  approvedAt?: string; approvedRevision?: number; sentTs?: string; sentChannel?: string; error?: string;
};
