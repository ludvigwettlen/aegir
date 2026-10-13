export type EmailFields = { to: string; cc: string; bcc: string; subject: string; body: string };
export type EmailDraft = EmailFields & {
  type: 'email-draft'; account: string; email: string; revision: number;
  replyThreadId?: string; inReplyTo?: string; references?: string;
  state: 'draft' | 'awaiting-approval' | 'sending' | 'sent' | 'uncertain';
  approvedAt?: string; approvedRevision?: number;
  sentId?: string; error?: string;
};
export type GmailState = {
  account: string; email: string; enabled: boolean; syncing: boolean;
  lastSyncedAt: string | null; error: string; summary: string;
};
