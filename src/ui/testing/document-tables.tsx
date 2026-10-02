import React from 'react';
import { createRoot } from 'react-dom/client';
import '../design-system/tokens.scss';
import '../document-workspace.scss';
import type { DesktopApi } from '../../../shared/types';
import type { WorkspaceDocument } from '../../../shared/documents';

const initial = '# Project plan\n\n| Workstream | Owner | Status |\n| :--- | --- | ---: |\n| **Research** | Mimer | In progress |\n| Writing | Saga | Ready |\n\nAnother table:\n\n| Name | Value |\n| --- | --- |\n| Keep | Untouched |';
let saved: WorkspaceDocument = { path: 'plan.md', content: initial, revision: '0' };
Object.assign(window, { saved: () => saved, changeDisk: (content: string) => { saved = { ...saved, content, revision: String(Number(saved.revision) + 1) }; }, initial });
window.aegir = {
  readDocument: async () => saved,
  saveDocument: async (_thread: string, _path: string, expected: string, content: string) => {
    if (expected !== saved.revision) throw new Error('The file changed on disk');
    saved = { ...saved, content, revision: String(Number(saved.revision) + 1) };
    return saved;
  },
} as unknown as DesktopApi;
const { DocumentEditor } = await import('../views/DocumentEditor');
createRoot(document.getElementById('host')!).render(<DocumentEditor document={saved} threadId="table-test" onClose={() => {}} onSelection={() => {}} onOpenDocument={() => {}} />);
