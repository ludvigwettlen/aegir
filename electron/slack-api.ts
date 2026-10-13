import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { SlackFields } from '../shared/slack-messages.js';
import { slackFooter, slackMessageText } from '../shared/slack-messages.js';
export type SlackMethod = 'auth.test' | 'users.info' | 'users.list' | 'conversations.info' | 'conversations.list' | 'conversations.replies' | 'conversations.open' | 'chat.postMessage';
export type SlackRequest = (account: string, method: SlackMethod, args?: Record<string, unknown>) => Promise<any>;
export class SlackApiError extends Error {}
const methods = new Set<SlackMethod>(['auth.test', 'users.info', 'users.list', 'conversations.info', 'conversations.list', 'conversations.replies', 'conversations.open', 'chat.postMessage']);
export const slackRequest: SlackRequest = async (account, method, args = {}) => {
  const cli = join(homedir(), '.local', 'bin', 'composio');
  if (!existsSync(cli)) throw new Error('Slack drafting needs the Composio CLI at ~/.local/bin/composio.');
  if (!/^[\w@.+-]{1,200}$/.test(account) || !methods.has(method)) throw new Error('Invalid Slack request');
  const write = method === 'conversations.open' || method === 'chat.postMessage';
  const url = new URL(`https://slack.com/api/${method}`);
  if (!write) for (const [key, value] of Object.entries(args)) url.searchParams.set(key, String(value));
  const cliArgs = ['proxy', url.href, '--toolkit', 'slack', '--account', account, '-X', write ? 'POST' : 'GET'];
  if (write) cliArgs.push('-H', 'Content-Type: application/json', '-d', '-');
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = execFile(cli, cliArgs, { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(new Error('Slack request failed. Check the Composio connection and permissions.'));
      else resolve(stdout);
    });
    child.stdin?.on('error', () => {}); child.stdin?.end(write ? JSON.stringify(args) : undefined);
  });
  let result;
  try { result = JSON.parse(stdout); } catch { throw new Error('Slack returned an unreadable response.'); }
  if (result?.ok === false) throw new SlackApiError(`Slack rejected the request: ${typeof result.error === 'string' ? result.error.slice(0, 160) : 'unknown error'}`);
  if (result?.ok !== true) throw new Error('Slack did not confirm the request.');
  return result;
};
export function cleanSlackFields(value: unknown): SlackFields {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Slack message fields are required');
  const input = value as Record<string, unknown>;
  if (typeof input.destination !== 'string' || !/^[CDGUW][A-Z0-9]{5,30}$/.test(input.destination)) throw new Error('Choose a Slack person or channel.');
  if (typeof input.threadTs !== 'string' || (input.threadTs && !/^\d{10,}\.[0-9]{6}$/.test(input.threadTs))) throw new Error('Invalid Slack thread.');
  if (input.threadTs && /^[UW]/.test(input.destination)) throw new Error('For thread replies, use the existing conversation id.');
  if (typeof input.text !== 'string' || input.text.length > 40000 || input.text.includes('\0')) throw new Error('Slack messages must be at most 40,000 characters.');
  if (typeof input.includeFooter !== 'boolean') throw new Error('Choose whether to include the Slack footer.');
  return { destination: input.destination, threadTs: input.threadTs, text: input.text, includeFooter: input.includeFooter };
}
export function slackMessagePayload(fields: SlackFields) {
  const text = slackMessageText(fields);
  if (text.length > 40000) throw new Error('Shorten the message to fit the footer within Slack’s 40,000-character limit.');
  if (!fields.includeFooter) return { text };
  // Plain-text blocks keep the editor's content literal; the footer is visually secondary.
  const characters = Array.from(fields.text);
  const blocks: Record<string, unknown>[] = [];
  for (let offset = 0; offset < characters.length; offset += 3000)
    blocks.push({ type: 'section', text: { type: 'plain_text', text: characters.slice(offset, offset + 3000).join(''), emoji: false } });
  blocks.push({ type: 'context', elements: [{ type: 'plain_text', text: slackFooter, emoji: false }] });
  return { text, blocks };
}
