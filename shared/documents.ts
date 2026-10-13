import { unwrapComments } from './document-comments';

export type WorkspaceDocument = { path: string; content: string; revision: string };
export type WorkspaceDocumentEntry = { path: string; modifiedAt: string };
export type DocumentReference = { path: string; text: string };

export function documentTitle(path: string): string {
  return (path.split('/').pop() || path).replace(/\.(md|markdown)$/i, '').replace(/[-_]+/g, ' ');
}

// GFM requires a header. This inert marker preserves Aegir's header-off choice
// without adding a blank row or changing cell content in other Markdown readers.
export const tableHeaderOffMarker = '<!-- aegir:table-header=off -->';
export const headerlessTableStart = /^<!-- aegir:table-header=off -->\r?\n(?=[^\n]*\|[^\n]*\r?\n[ \t|:]*-[ \t|:-]*\|[ \t|:-]*(?:\r?\n|$))/;

export function hasUnsupportedMarkdown(content: string): boolean {
  const prose = unwrapComments(content).replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\s*$/gm, '')
    .replace(new RegExp(headerlessTableStart.source, 'gm'), '');
  // Frontmatter starts at the beginning of the source. Horizontal rules later
  // in ordinary prose must not turn an otherwise editable document read only.
  return /^\uFEFF?---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.test(content)
    || /<!--|<\/?[A-Za-z][^>]*>|^\[\^[^\]]+\]:/m.test(prose);
}

/** Local Markdown references only; remote links continue through the external-link policy. */
export function markdownPath(href: string): string | null {
  try {
    if (/^[a-z][a-z\d+.-]*:/i.test(href) && !href.startsWith('file:///')) return null;
    const path = decodeURIComponent(href.startsWith('file:///') ? new URL(href).pathname : href.split('#')[0]);
    return /\.(md|markdown)$/i.test(path) && !/[\x00-\x1f?]/.test(path) ? path : null;
  } catch { return null; }
}

export function withDocumentReference(message: string, reference: DocumentReference | null): string {
  return reference ? `Selected passage from ${reference.path}:\n\n${reference.text.split('\n').map(line => `> ${line}`).join('\n')}\n\n${message}` : message;
}
