export type WorkspaceDocument = { path: string; content: string; revision: string };
export type DocumentReference = { path: string; text: string };

export function hasUnsupportedMarkdown(content: string): boolean {
  const prose = content.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\s*$/gm, '');
  return /^---\s*\n[\s\S]*?\n---\s*$/m.test(prose) || /<!--|<\/?[A-Za-z][^>]*>|^\[\^[^\]]+\]:/m.test(prose);
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
