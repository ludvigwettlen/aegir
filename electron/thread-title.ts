import type { Tool } from './codex.js';

export const threadTitleTool: Tool = {
  name: 'threads__set_title',
  description: 'Give this new conversation a concise, descriptive title based on the user’s topic or goal. Applies only to the current chat and can be used once.',
  inputSchema: { type: 'object', properties: { title: { type: 'string', minLength: 1, maxLength: 80 } }, required: ['title'], additionalProperties: false },
  readOnly: false,
};

export const threadTitleInstructions = 'This is a new conversation. Before answering, call threads__set_title with a short, descriptive title (usually 3–7 words, at most 80 characters) that captures the user’s topic or goal rather than copying their opening sentence. Use the user’s language and sentence case, without quotation marks or a “Title:” prefix. This is conversation metadata: do not announce the title in your reply. Then continue with the user’s request normally.';

export function cleanThreadTitle(value: unknown): string {
  if (typeof value !== 'string') throw new Error('A title must be text');
  const title = value.replace(/\s+/g, ' ').trim();
  if (!title || title.length > 80 || /[\x00-\x1f\x7f]/.test(title))
    throw new Error('A title must be 1–80 characters of plain text');
  return title;
}
