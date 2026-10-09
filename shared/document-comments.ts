export type PassageComment = { id: string; text: string };
export const commentEnd = '<!-- /aegir:comment -->';
export const commentStart = '<!-- aegir:comment:';
export const commentPattern = /<!-- aegir:comment:([^\s]+) -->([\s\S]*?)<!-- \/aegir:comment -->/g;

export function encodeComment(comment: PassageComment): string {
  // Encode hyphens too so user text can never terminate an HTML comment.
  return encodeURIComponent(JSON.stringify(comment)).replace(/-/g, '%2D');
}
export function decodeComment(value: string): PassageComment | null {
  try {
    const parsed = JSON.parse(decodeURIComponent(value));
    return typeof parsed.id === 'string' && /^[\w-]{1,80}$/.test(parsed.id)
      && typeof parsed.text === 'string' && parsed.text.trim().length > 0 && parsed.text.length <= 4000
      ? { id: parsed.id, text: parsed.text } : null;
  } catch { return null; }
}
export function unwrapComments(source: string): string {
  return source.replace(commentPattern, (raw, encoded: string, text: string) => decodeComment(encoded) && !text.includes(commentStart) ? text : raw);
}
