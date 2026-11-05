import { remoteImageSource } from './remote-images.js';
export const documentImageLimit = 10 * 1024 * 1024;
export const documentImageAccept = 'image/png,image/jpeg,image/gif,image/webp,image/avif';

export function imageSourceKind(src: string): 'remote' | 'local' | null {
  if (!src || /[\x00-\x1f]/.test(src)) return null;
  if (/^https?:\/\//i.test(src)) {
    return remoteImageSource(src) ? 'remote' : null;
  }
  if (/^file:\/\/\//i.test(src)) return 'local';
  if (/^[a-z][a-z\d+.-]*:/i.test(src) || src.startsWith('//')) return null;
  return 'local';
}

export function imageMarkdown(src: string, alt = '', title = '') {
  const escapeText = (text: string) => text.replace(/\\/g, '\\\\').replace(/[\[\]]/g, '\\$&').replace(/[\r\n]+/g, ' ');
  const destination = src.replace(/[\s<>\\]/g, char => encodeURIComponent(char)).replace(/\(/g, '%28').replace(/\)/g, '%29');
  const label = title ? ` "${title.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ')}"` : '';
  return `![${escapeText(alt)}](${destination}${label})`;
}
