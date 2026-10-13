import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@usefragments/ui';
import '../styles';
import type { DesktopApi } from '../../../shared/types';
import type { EmailDraft } from '../../../shared/gmail';
const initial: EmailDraft = { type: 'email-draft', account: 'work', email: 'me@example.com', to: 'peer@example.com', cc: '', bcc: '', subject: 'A draft with a longer subject to check narrow email layouts', body: 'Hi Sam,\n\nThanks for sending this over. I can review the proposal tomorrow.\n\nBest,\nAlex', revision: 1, state: 'draft' };
const fixture = { compact: () => {}, fail: false, draft: initial, publish: (_draft: EmailDraft) => {}, resolve: (_value: boolean) => {} };
Object.assign(window, { fixture });
window.aegir = {
  updateEmailDraft: async (_id, revision, fields) => {
    if (fixture.fail) throw new Error('Could not save draft. Try again.');
    if (revision !== fixture.draft.revision) throw new Error('Draft changed');
    fixture.draft = { ...fixture.draft, ...fields, revision: revision + 1 }; fixture.publish(fixture.draft); return fixture.draft;
  },
  sendEmailDraft: async () => {
    fixture.draft = { ...fixture.draft, state: 'awaiting-approval' }; fixture.publish(fixture.draft);
    const approved = await new Promise<boolean>(resolve => { fixture.resolve = resolve; });
    fixture.draft = { ...fixture.draft, state: approved ? 'sent' : 'draft', error: approved ? undefined : 'Send declined. Your draft is kept.' }; fixture.publish(fixture.draft);
  },
} satisfies Partial<DesktopApi> as unknown as DesktopApi;
const { EmailDraftCard } = await import('../views/EmailDraftCard');
function Fixture() {
  const [draft, setDraft] = useState(initial); fixture.publish = setDraft;
  const [compact, setCompact] = useState(false); fixture.compact = () => setCompact(true);
  return <ThemeProvider defaultMode="light"><main style={{ padding: 24, width: '100%', maxWidth: compact ? 430 : 780, boxSizing: 'border-box' }}>
    <EmailDraftCard id="email-test" draft={draft} />
    {draft.state === 'awaiting-approval' && <aside aria-label="Send approval"><p>Approve the exact email?</p><button onClick={() => fixture.resolve(true)}>Approve</button><button onClick={() => fixture.resolve(false)}>Deny</button></aside>}
  </main></ThemeProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
