import { Markdown } from '@usefragments/ui';
import type { ReactNode } from 'react';
import { normalizeTaskLink } from '../../../shared/task-links';

// Use the shared parser (including GFM tables/lists), keeping navigation in Electron.
export function ChatMarkdown({ content, onOpenLink }: { content: string; onOpenLink: (url: string) => void }) {
  return <Markdown className="ws-markdown" content={content} components={{
    a: ({ href, children }: { href?: string; children?: ReactNode }) => {
      const url = href ? normalizeTaskLink(href) : null;
      return url ? <a href={url} onClick={event => { event.preventDefault(); onOpenLink(url); }}>{children}</a> : <span>{children}</span>;
    },
    table: ({ children }: { children?: ReactNode }) => <div className="ws-markdown-table"><table>{children}</table></div>,
  }} />;
}
