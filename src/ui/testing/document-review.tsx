import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@usefragments/ui';
import '../styles';
import type { DesktopApi } from '../../../shared/types';
import type { WorkspaceDocument } from '../../../shared/documents';
import { reviewBatchMessage, type ReviewBatch } from '../../../shared/document-review';

// Isolated fixture for reviewing a document in the editor: comments on passages, then one send to Claude.
let saved: WorkspaceDocument = { path: 'board-update.md', revision: '0', content: 'A paragraph that must stay.\n\n### What I need from you\n\nOne decision on the revenue case we build the 2027 cost base on.\n\nA second paragraph with **bold text** and [a reference](https://example.com).' };
const fixture = { sent: [] as { batch: ReviewBatch; message: string }[], fail: false, saved: () => saved, setBusy: (_busy: boolean) => {} };
Object.assign(window, { fixture });
window.aegir = {
  readDocument: async () => saved,
  saveDocument: async (_thread: string, _path: string, expected: string, content: string) => {
    if (expected !== saved.revision) throw new Error('The file changed on disk');
    saved = { ...saved, content, revision: String(Number(saved.revision) + 1) }; return saved;
  },
} as unknown as DesktopApi;
const { DocumentEditor } = await import('../views/DocumentEditor');
function Fixture() {
  const [busy, setBusy] = useState(false);
  fixture.setBusy = setBusy;
  return <ThemeProvider defaultMode="light"><style>{'body { min-width: 0; }'}</style><div className="ws-shell" style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
    <DocumentEditor document={saved} threadId="review-test" onClose={() => {}} onSelection={() => {}} onOpenDocument={() => {}}
      review={{ busy, send: async (batch) => {
        if (fixture.fail) throw new Error('No connection');
        fixture.sent.push({ batch, message: reviewBatchMessage(batch, '~/brain/drafts/2026-10-12-board-update.md') });
      } }} />
  </div></ThemeProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
