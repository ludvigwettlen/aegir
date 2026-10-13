import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { EmailDraft, EmailFields } from '../shared/gmail.js';

export type GmailPart = { mimeType?: string; body?: { data?: string }; parts?: GmailPart[]; headers?: { name: string; value: string }[] };
export type GmailMessage = { id: string; threadId: string; internalDate: string; labelIds?: string[]; snippet?: string; payload?: GmailPart };
export type GmailThread = { id: string; messages: GmailMessage[] };
export type GmailRequest = (account: string, path: string, method?: 'GET' | 'POST', body?: unknown) => Promise<any>;
export const gmailRequest: GmailRequest = async (account, path, method = 'GET', body) => {
  const cli = join(homedir(), '.local', 'bin', 'composio');
  if (!existsSync(cli)) throw new Error('Gmail needs the Composio CLI at ~/.local/bin/composio.');
  if (!/^[\w@.+-]{1,200}$/.test(account) || !/^(profile|threads(?:\?|\/)|messages\/send$)/.test(path) || path.includes('..')) throw new Error('Invalid Gmail request');
  const args = ['proxy', `https://gmail.googleapis.com/gmail/v1/users/me/${path}`, '--toolkit', 'gmail', '--account', account, '-X', method];
  if (body !== undefined) args.push('-H', 'Content-Type: application/json', '-d', '-');
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = execFile(cli, args, { timeout: 60_000, maxBuffer: 12 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(new Error('Gmail request failed. Check the Composio connection and Gmail permissions.'));
      else resolve(stdout);
    });
    child.stdin?.on('error', () => {});
    child.stdin?.end(body === undefined ? undefined : JSON.stringify(body));
  });
  let result;
  try { result = JSON.parse(stdout); } catch { throw new Error('Gmail returned an unreadable response.'); }
  if (!result || typeof result !== 'object' || result.error) throw new Error('Gmail rejected the request. Check the connection and Gmail permissions.');
  return result;
};
export const header = (message: GmailMessage, name: string) => message.payload?.headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
export function messageText(part?: GmailPart): string {
  if (!part) return '';
  if (part.mimeType === 'text/plain' && part.body?.data) return Buffer.from(part.body.data, 'base64url').toString('utf8');
  const plain = part.parts?.map(messageText).filter(Boolean).join('\n');
  if (plain) return plain;
  if (part.mimeType === 'text/html' && part.body?.data) return Buffer.from(part.body.data, 'base64url').toString('utf8').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ');
  return '';
}
export function threadSummary(thread: GmailThread) {
  return { id: thread.id, messages: thread.messages.map(m => ({ id: m.id, date: m.internalDate, labels: m.labelIds,
    from: header(m, 'From'), to: header(m, 'To'), cc: header(m, 'Cc'), subject: header(m, 'Subject'), body: messageText(m.payload).slice(0, 18000) || m.snippet || '' })) };
}
export function latestMessage(thread: GmailThread) {
  return thread.messages.filter(m => !m.labelIds?.includes('DRAFT')).sort((a, b) => Number(a.internalDate) - Number(b.internalDate)).at(-1);
}
const hasAddress = (value: string, email: string) => (value.match(/[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-z0-9.-]+/gi) || []).some(address => address.toLowerCase() === email.toLowerCase());
export function replyCandidate(thread: GmailThread, email: string): GmailMessage | null {
  const last = latestMessage(thread);
  if (!last || !last.labelIds?.includes('INBOX') || last.labelIds.some(l => ['SENT', 'SPAM', 'TRASH', 'CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_FORUMS', 'CATEGORY_UPDATES'].includes(l))) return null;
  const from = header(last, 'From');
  if (hasAddress(from, email) || /(?:no[._-]?reply|do[._-]?not[._-]?reply|mailer-daemon|calendar-notification|notifications?)@/i.test(from)) return null;
  if (header(last, 'List-Unsubscribe') || header(last, 'List-Id') || /bulk|list|junk/i.test(header(last, 'Precedence')) || /^(?!no$).+/i.test(header(last, 'Auto-Submitted'))) return null;
  const calendar = (p?: GmailPart): boolean => !!p && (p.mimeType === 'text/calendar' || !!p.parts?.some(calendar));
  if (calendar(last.payload) || /^(invitation|updated invitation|canceled event|accepted|declined):/i.test(header(last, 'Subject'))) return null;
  if (!hasAddress(`${header(last, 'To')},${header(last, 'Cc')}`, email)) return null;
  return last;
}
export function cleanEmailFields(input: unknown): EmailFields {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Email fields are required');
  const value = input as Record<string, unknown>;
  const result = {} as EmailFields;
  for (const key of ['to', 'cc', 'bcc', 'subject', 'body'] as const) {
    if (typeof value[key] !== 'string' || value[key].length > (key === 'body' ? 100000 : 2000) || (key !== 'body' && /[\r\n\0]/.test(value[key]))) throw new Error(`Invalid email ${key}`);
    result[key] = key === 'body' ? value[key] : value[key].trim();
  }
  return result;
}
export function rawEmail(draft: EmailDraft): string {
  const fields = cleanEmailFields(draft);
  for (const [key, value] of Object.entries({ to: fields.to, cc: fields.cc, bcc: fields.bcc })) {
    if (!value && key !== 'to') continue;
    if (!value || !value.split(',').every(address => /^[^\s<>@,]+@[^\s<>@,]+\.[^\s<>@,]+$/.test(address.trim()))) throw new Error('Use comma-separated email addresses without display names.');
  }
  if (!fields.subject || !fields.body.trim()) throw new Error('Add a subject and message before sending.');
  for (const value of [draft.email, draft.inReplyTo, draft.references]) if (value && /[\r\n\0]/.test(value)) throw new Error('Invalid mail header');
  // Encode Unicode subjects in bounded RFC 2047 words; base64 body preserves Unicode and line breaks.
  const words = Array.from(fields.subject).reduce<string[]>((parts, character) => {
    if (!parts.length || Buffer.byteLength(parts.at(-1)! + character) > 42) parts.push(character); else parts[parts.length - 1] += character;
    return parts;
  }, []).map(part => `=?UTF-8?B?${Buffer.from(part).toString('base64')}?=`).join('\r\n ');
  const headers = [`From: ${draft.email}`, `To: ${fields.to}`, ...(fields.cc ? [`Cc: ${fields.cc}`] : []), ...(fields.bcc ? [`Bcc: ${fields.bcc}`] : []), `Subject: ${words}`,
    ...(draft.inReplyTo ? [`In-Reply-To: ${draft.inReplyTo}`, `References: ${draft.references || draft.inReplyTo}`] : []), 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64'];
  return Buffer.from(`${headers.join('\r\n')}\r\n\r\n${Buffer.from(fields.body).toString('base64').match(/.{1,76}/g)?.join('\r\n') || ''}`).toString('base64url');
}
