/** Remote images are network access: rendering content never grants consent to load them. */
export function remoteImageSource(value: string): string | null {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
export function remoteImageLabel(source: string): string {
  const url = remoteImageSource(source);
  return url ? `Remote image from ${new URL(url).host}` : 'Remote image';
}
