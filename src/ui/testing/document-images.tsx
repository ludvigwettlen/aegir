import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@usefragments/ui';
import '../styles';
import type { DesktopApi } from '../../../shared/types';

async function call(op: string, args: unknown[] = []) {
  const response = await fetch('/image-api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op, args }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}
window.aegir = {
  readDocument: () => call('read'),
  saveDocument: (_thread: string, _path: string, revision: string, content: string) => call('save', [revision, content]),
  readDocumentImage: (_thread: string, _path: string, src: string) => call('image', [src]),
  importDocumentImage: async (_thread: string, _path: string, name: string, bytes: Uint8Array) => {
    if ((window as any).delayImport) await new Promise(resolve => { (window as any).resumeImport = resolve; });
    return call('import', [name, Array.from(bytes)]);
  },
} as unknown as DesktopApi;
const { DocumentEditor } = await import('../views/DocumentEditor');
const initial = await call('read');
createRoot(document.getElementById('root')!).render(<ThemeProvider defaultMode="light"><style>{'body{min-width:0}.ws-document{height:100vh}'}</style><DocumentEditor document={initial} threadId="image-test" onClose={() => {}} onSelection={() => {}} onOpenDocument={() => {}} /></ThemeProvider>);
