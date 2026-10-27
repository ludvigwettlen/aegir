export type DraftDelivery = {
  deliveryProvider?: 'aegir' | 'claude';
  externalDraft?: { draftId: string; threadId: string; baseline: string; kind: 'new' | 'reply' | 'reply_all' | 'forward' };
  queuedUntil?: number;
  manuallySentAt?: string;
};
