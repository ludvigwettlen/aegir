export function normalizeTaskLink(value: string): string | null {
  const text = value.trim();
  if (!text || text.length > 2048 || /[\s\x00-\x1f]/.test(text)) return null;
  try {
    const url = new URL(text);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    if ((url.protocol === 'http:' || url.protocol === 'https:') && !url.hostname) return null;
    return url.href;
  } catch {
    return null;
  }
}

/** User-attached local files are handled separately from links supplied in chat. */
export function normalizeTaskAttachment(value: string, homeDirectory?: string): string | null {
  let text = value.trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) text = text.slice(1, -1);
  if (!text || text.length > 8192 || /[\x00-\x1f]/.test(text)) return null;
  if (text.startsWith('~/') && homeDirectory) text = `${homeDirectory}/${text.slice(2)}`;
  try {
    let path: string;
    if (/^file:/i.test(text)) {
      const url = new URL(text);
      if ((url.hostname && url.hostname !== 'localhost') || url.search || url.hash) return null;
      path = decodeURIComponent(url.pathname);
    } else if (text.startsWith('/') && !text.startsWith('//')) path = text;
    else return normalizeTaskLink(text);
    if (!path.startsWith('/') || path.startsWith('//') || /[\x00-\x1f]/.test(path)) return null;
    return new URL(`file://${path.split('/').map(segment => encodeURIComponent(segment)).join('/')}`).href;
  } catch { return null; }
}

export function taskLinkLabel(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol === 'file:') return decodeURIComponent(url.pathname).split('/').filter(Boolean).pop() || '/';
    return url.hostname || url.protocol.replace(':', '');
  } catch { return value; }
}
