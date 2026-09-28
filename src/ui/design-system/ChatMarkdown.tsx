import Markdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ReactNode } from 'react';
import { normalizeTaskLink } from '../../../shared/task-links';
import { markdownPath } from '../../../shared/documents';

// Use the shared parser (including GFM tables/lists), keeping navigation in Electron.
export function ChatMarkdown({ content, onOpenLink, onOpenDocument }: { content: string; onOpenLink: (url: string) => void; onOpenDocument?: (path: string) => void }) {
  return <div className="ws-markdown"><Markdown remarkPlugins={[remarkGfm]} urlTransform={(url, key) => key === 'href' && markdownPath(url) ? url : defaultUrlTransform(url)} components={{
    a: ({ href, children }: { href?: string; children?: ReactNode }) => {
      const path = href && markdownPath(href);
      if (path && onOpenDocument) return <a href={href} onClick={event => { event.preventDefault(); onOpenDocument(path); }}>{children}</a>;
      const url = href ? normalizeTaskLink(href) : null;
      return url ? <a href={url} onClick={event => { event.preventDefault(); onOpenLink(url); }}>{children}</a> : <span>{children}</span>;
    },
    table: ({ children }: { children?: ReactNode }) => <div className="ws-markdown-table"><table>{children}</table></div>,
  }}>{content}</Markdown></div>;
}
