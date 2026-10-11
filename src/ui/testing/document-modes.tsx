import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@usefragments/ui';
import '../styles';
import type { DesktopApi } from '../../../shared/types';
import type { WorkspaceDocument } from '../../../shared/documents';

let saved: WorkspaceDocument = { path: 'writing.md', revision: '0', content: '# A quiet place to write\n\n' + Array.from({ length: 24 }, (_, i) => `Paragraph ${i + 1}. ${'A line of prose with room to think and write. '.repeat(8)}`).join('\n\n') };
Object.assign(window, { saved: () => saved });
window.aegir = {
  readDocument: async () => saved,
  saveDocument: async (_thread: string, _path: string, expected: string, content: string) => {
    if (expected !== saved.revision) throw new Error('The file changed on disk');
    saved = { ...saved, content, revision: String(Number(saved.revision) + 1) }; return saved;
  },
} as unknown as DesktopApi;
const { DocumentEditor } = await import('../views/DocumentEditor');
const { useWorkspaceKeyboard } = await import('../hooks/useWorkspaceKeyboard');
const task = new URLSearchParams(location.search).has('task');
function Fixture() {
  const [open, setOpen] = useState(true);
  const [pane, setPane] = useState('document');
  useWorkspaceKeyboard(async fn => { await fn(); }, () => {}, () => {});
  return <ThemeProvider defaultMode="light"><style>{'body { min-width: 0; }'}</style><div className="ws-shell">
    <aside className="ws-sidebar"><button>Navigation</button></aside>
    <main className="ws-main"><div className={task ? 'ws-task-detail' : 'ws-group'} style={{ display: 'flex' }}>
      <div className={`ws-thread-workspace ${open ? 'document-open' : ''}`} data-mobile-pane={pane}>
        <header className="ws-editing-head">Writing workspace<div className="ws-document-tabs"><button onClick={() => setPane('chat')}>Conversation</button><button onClick={() => setPane('document')}>Document</button></div></header>
        <div className="ws-thread-panes">
          <section className="ws-thread" style={{ flex: '0 0 36%' }} data-keyboard-pane="detail"><textarea aria-label="Message" defaultValue="Keep my chat draft" /></section>
          {open && <><div className="ws-document-divider" role="separator" /><DocumentEditor document={saved} threadId="modes-test" onClose={() => setOpen(false)} onSelection={() => {}} onOpenDocument={() => {}} /></>}
        </div>
      </div>
    </div></main>
  </div></ThemeProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
