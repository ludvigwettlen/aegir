import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@usefragments/ui';
import '../styles';
import type { DesktopApi } from '../../../shared/types';
import type { WorkspaceDocument } from '../../../shared/documents';

let saved: WorkspaceDocument = { path: 'comments.md', revision: '0', content: 'A paragraph that must stay.\n\n### Review notes\n\nSelect this passage to leave a comment. Keep the rest unchanged.\n\nA second paragraph with **bold text** and [a reference](https://example.com).\n\n| Topic | Status |\n| --- | --- |\n| Research | Ready |' };
window.aegir = {
  readDocument: async () => saved,
  saveDocument: async (_thread: string, _path: string, expected: string, content: string) => {
    if (expected !== saved.revision) throw new Error('The file changed on disk');
    saved = { ...saved, content, revision: String(Number(saved.revision) + 1) }; return saved;
  },
} as unknown as DesktopApi;
const { DocumentEditor } = await import('../views/DocumentEditor');
function Fixture() {
  const [generation, setGeneration] = useState(0);
  return <ThemeProvider defaultMode="light"><style>{'body { min-width: 0; }'}</style><div className="ws-shell" style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
    <button onClick={() => setGeneration(value => value + 1)}>Reopen saved document</button>
    <DocumentEditor key={generation} document={saved} threadId="comments-test" onClose={() => {}} onSelection={() => {}} onOpenDocument={() => {}} />
  </div></ThemeProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
