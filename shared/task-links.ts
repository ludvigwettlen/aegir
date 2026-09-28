const blockedSchemes = new Set([
  'file:', 'javascript:', 'data:', 'blob:', 'about:', 'chrome:',
  'chrome-extension:', 'devtools:', 'ftp:', 'ssh:', 'smb:',
]);

export function normalizeTaskLink(value: string): string | null {
  const text = value.trim();
  if (!text || text.length > 2048 || /[\s\x00-\x1f]/.test(text)) return null;
  try {
    const url = new URL(text);
    if (blockedSchemes.has(url.protocol) || !text.includes('://') || (!url.pathname && !url.hostname)) return null;
    if ((url.protocol === 'http:' || url.protocol === 'https:') && !url.hostname) return null;
    return url.href;
  } catch {
    return null;
  }
}
