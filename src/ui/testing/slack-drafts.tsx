import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@usefragments/ui';
import '../styles';
import type { DesktopApi } from '../../../shared/types';
import type { SlackDraft } from '../../../shared/slack-messages';
const initial: SlackDraft = { type: 'slack-draft', account: 'work', teamId: 'T123456', userId: 'U123456', workspace: 'Example workspace', sender: 'Alex', destination: 'C123456', destinationName: '#product-team-with-a-long-name', threadTs: '1730000000.000001', threadPreview: 'Could you share the revised plan with the team?', text: 'Hello, team. Here is the updated plan.', revision: 1, state: 'draft', includeFooter: true };
const fixture = { compact: () => {}, conflict: () => {}, fail: false, draft: initial, sendCalls: [] as unknown[], publish: (_draft: SlackDraft) => {} };
Object.assign(window, { fixture });
let queuedTimer: ReturnType<typeof setTimeout> | undefined;
window.aegir = {
  findSlackTargets: async () => { if (fixture.fail) throw new Error('Slack search is unavailable. Retry.'); return { targets: [{ id: 'U234567', name: '@Sam Lee', kind: 'person', detail: 'sam@example.com' }], nextCursor: '' }; },
  updateSlackDraft: async (_id, revision, fields) => {
    if (fixture.fail) throw new Error('Could not save draft. Try again.');
    if (revision !== fixture.draft.revision) throw new Error('Draft changed');
    fixture.draft = { ...fixture.draft, ...fields, destinationName: fields.destination === 'U234567' ? '@Sam Lee' : initial.destinationName, threadPreview: fields.threadTs ? initial.threadPreview : '', revision: revision + 1 }; fixture.publish(fixture.draft); return fixture.draft;
  },
  cancelSlackDraft: async () => {
    if (fixture.draft.state !== 'queued') throw new Error('Sending has already started.');
    clearTimeout(queuedTimer); fixture.draft = { ...fixture.draft, state: 'draft', queuedUntil: undefined }; fixture.publish(fixture.draft); return fixture.draft;
  },
  markSlackDraftSent: async () => { fixture.draft = { ...fixture.draft, state: 'sent-manually', manuallySentAt: new Date().toISOString() }; fixture.publish(fixture.draft); return fixture.draft; },
  sendSlackDraft: async (id, revision, fields) => {
    fixture.draft = { ...fixture.draft, state: 'queued', queuedUntil: Date.now() + 5000 }; fixture.publish(fixture.draft);
    queuedTimer = setTimeout(() => {
      fixture.sendCalls.push({ id, revision, fields });
      fixture.draft = { ...fixture.draft, state: 'sending' }; fixture.publish(fixture.draft);
      setTimeout(() => { fixture.draft = { ...fixture.draft, state: 'sent' }; fixture.publish(fixture.draft); }, 300);
    }, 5000);
  },
} satisfies Partial<DesktopApi> as unknown as DesktopApi;
const { SlackDraftCard } = await import('../views/SlackDraftCard');
function Fixture() {
  const [draft, setDraft] = useState(initial); fixture.publish = setDraft;
  const [compact, setCompact] = useState(false); fixture.compact = () => setCompact(true);
  fixture.conflict = () => { fixture.draft = { ...fixture.draft, revision: fixture.draft.revision + 1, text: 'Revised by the agent.' }; setDraft(fixture.draft); };
  return <ThemeProvider defaultMode="light"><main style={{ padding: 24, width: '100%', maxWidth: compact ? 430 : 780, boxSizing: 'border-box' }}><SlackDraftCard id="slack-test" draft={draft} /></main></ThemeProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
