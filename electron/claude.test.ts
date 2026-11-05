import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { query, Query } from '@anthropic-ai/claude-agent-sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ClaudeProvider, claudeToolPolicy, exposedToolName } from './claude.js';
import type { RunInput } from './codex.js';
import { ToolResult } from './tool-result.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function input(): RunInput {
  const cwd = mkdtempSync(join(tmpdir(), 'aegir-claude-')); roots.push(cwd);
  return { kind: 'task', cwd, sandbox: 'workspace-write', prompt: 'Do the task', instructions: 'Instructions',
    tools: [{ name: 'memory__recall', description: 'Recall', inputSchema: { type: 'object' }, readOnly: true }],
    onDelta: vi.fn() };
}
type Options = NonNullable<Parameters<typeof query>[0]['options']>;
function fixture(script: (options: Options) => AsyncGenerator<any>) {
  let options!: Options;
  const statuses = vi.fn(async () => [{ name: 'Slack', tools: [
    { name: 'slack_search', annotations: { readOnly: true } },
    { name: 'update', annotations: { readOnly: false } },
    { name: 'send_message', annotations: { readOnly: true } },
  ] }]);
  const run = vi.fn((args: Parameters<typeof query>[0]) => {
    options = args.options!;
    return Object.assign(script(options), { mcpServerStatus: statuses }) as unknown as Query;
  });
  const provider = new ClaudeProvider('/configured/claude', run);
  return { provider, run, statuses, get options() { return options; } };
}
async function permission(options: Options, name: string, args = {}) {
  const hook = options.hooks!.PreToolUse![0].hooks[0];
  return await hook({ hook_event_name: 'PreToolUse', tool_name: name, tool_input: args,
    tool_use_id: 'call', session_id: 'session', transcript_path: '', cwd: '/tmp' }, 'call', { signal: options.abortController!.signal }) as any;
}
const completed = { type: 'result', subtype: 'success', is_error: false, result: 'Finished' };

it('streams output and isolates lightweight classification from native tools and user connections', async () => {
  const f = fixture(async function* () {
    yield { type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Working' } } };
    yield completed;
  });
  const run = { ...input(), tools: [], modelTier: 'lightweight' as const };
  expect(await f.provider.run(run)).toMatchObject({ text: 'Finished', status: 'completed' });
  expect(run.onDelta).toHaveBeenCalledWith('Working');
  expect(f.options.tools).toEqual([]);
  expect(f.options.settingSources).toEqual([]);
  expect(f.options.strictMcpConfig).toBe(true);
  expect(f.options.model).toBe('sonnet');
});

it('enforces read-only routines even when user permissions would allow a tool, and asks once in chat', async () => {
  const decisions: any[] = [];
  const f = fixture(async function* (options) {
    decisions.push(await permission(options, 'mcp__Slack__slack_search'));
    decisions.push(await permission(options, 'mcp__Slack__send_message'));
    decisions.push(await permission(options, 'mcp__Slack__update'));
    decisions.push(await permission(options, 'Bash', { command: 'pwd' }));
    yield completed;
  });
  await f.provider.run({ ...input(), kind: 'routine', sandbox: 'read-only' });
  expect(decisions.map(d => d.hookSpecificOutput.permissionDecision)).toEqual(['allow', 'deny', 'deny', 'deny']);
  decisions.length = 0;
  const approvals: string[] = [];
  f.provider.on('approval', approval => { approvals.push(approval.method); f.provider.resolveApproval(approval.id, true); });
  await f.provider.run({ ...input(), kind: 'chat', sandbox: 'read-only' });
  expect(decisions.map(d => d.hookSpecificOutput.permissionDecision)).toEqual(['allow', 'deny', 'allow', 'allow']);
  expect(approvals).toEqual(['claude:mcp__Slack__update', 'claude:Bash']);
  expect(f.options.settingSources).toEqual(['user']);
});

it('limits native file writes to the task folder, including new paths and symlink escapes', () => {
  const run = input();
  mkdirSync(join(run.cwd, 'drafts'));
  symlinkSync(tmpdir(), join(run.cwd, 'escape'));
  expect(claudeToolPolicy('Write', { file_path: 'drafts/new.md' }, run)).toBe('allow');
  expect(claudeToolPolicy('Edit', { file_path: '../other.md' }, run)).toBe('deny');
  expect(claudeToolPolicy('Write', { file_path: 'escape/new.md' }, run)).toBe('deny');
  expect(claudeToolPolicy('Write', { file_path: 'new.md' }, { ...run, sandbox: 'read-only' })).toBe('deny');
});

it('dispatches app tools with their original names, call context and structured image/error results', async () => {
  const longName = `documents__${'very_long_'.repeat(9)}`;
  const name = exposedToolName(longName);
  expect(`mcp__aegir__${name}`.length).toBeLessThanOrEqual(64);
  const f = fixture(async function* (options) {
    const server = (options.mcpServers!.aegir as any).instance;
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test', version: '1' });
    await Promise.all([client.connect(clientSide), server.connect(serverSide)]);
    try {
      const list = await client.listTools();
      expect(list.tools.map(t => t.name)).toEqual([name]);
      expect(await client.callTool({ name, arguments: { path: 'test.png' } })).toMatchObject({
        isError: true, content: [{ type: 'text', text: 'Failed' }, { type: 'image', data: 'AAAA', mimeType: 'image/png' }],
      });
    } finally { await client.close(); }
    yield completed;
  });
  const handler = vi.fn(async () => new ToolResult([{ type: 'inputText', text: 'Failed' }, { type: 'inputImage', imageUrl: 'data:image/png;base64,AAAA' }], false));
  f.provider.setToolHandler(handler);
  const result = await f.provider.run({ ...input(), tools: [{ name: longName, description: '', inputSchema: { type: 'object' }, readOnly: true }] });
  expect(handler).toHaveBeenCalledWith('documents', longName.split('__')[1], { path: 'test.png' }, true, result.threadId);
});

it('stops an approval wait, resolves its card, and distinguishes interruption from successful cleanup', async () => {
  let decision: any;
  const f = fixture(async function* (options) { decision = await permission(options, 'Bash', { command: 'pwd' }); yield completed; });
  const resolved = vi.fn();
  f.provider.on('approval-resolved', resolved);
  f.provider.on('approval', approval => { void f.provider.stop(approval.threadId); });
  expect(await f.provider.run(input())).toMatchObject({ status: 'interrupted' });
  expect(decision.hookSpecificOutput.permissionDecision).toBe('deny');
  expect(resolved).toHaveBeenCalledOnce();
});

it('reports selected engine failures without fallback and checks account access without a paid model call', async () => {
  const f = fixture(async function* () { throw new Error('Missing CLI'); });
  await expect(f.provider.run(input())).rejects.toThrow('Claude Code: Missing CLI');
  const command = vi.fn(async () => '{"loggedIn":false}');
  const provider = new ClaudeProvider('/configured/claude', f.run, command);
  await expect(provider.start()).rejects.toThrow('Sign in');
  command.mockResolvedValueOnce('{"loggedIn":true}');
  await provider.start();
  expect(provider.status).toBe('Connected · Claude Code');
  expect(f.run).toHaveBeenCalledOnce(); // Only the explicit run above.
});

it('executes only planned delivery calls with application inputs and records tool-confirmed results', async () => {
  const f = fixture(async function* (options) {
    const decision = await permission(options, 'mcp__claude_ai_Slack__slack_send_message');
    expect(decision.hookSpecificOutput.updatedInput).toEqual({ channel_id: 'C123456', text: 'Exact reviewed body' });
    expect((await permission(options, 'Bash')).hookSpecificOutput.permissionDecision).toBe('deny');
    const post = options.hooks!.PostToolUse![0].hooks[0];
    await post({ hook_event_name: 'PostToolUse', tool_name: 'mcp__claude_ai_Slack__slack_send_message', tool_input: decision.hookSpecificOutput.updatedInput,
      tool_response: { ok: true, ts: '123.456' }, tool_use_id: 'call', session_id: 'session', transcript_path: '', cwd: '/tmp' }, 'call', { signal: options.abortController!.signal });
    expect((await permission(options, 'mcp__claude_ai_Slack__slack_send_message')).hookSpecificOutput.permissionDecision).toBe('deny');
    yield completed;
  });
  const outcome = await f.provider.sendGated([{ tool: 'mcp__claude_ai_Slack__slack_send_message', input: () => ({ channel_id: 'C123456', text: 'Exact reviewed body' }) }]);
  expect(outcome).toMatchObject({ completed: true, released: 1, results: [{ ok: true, ts: '123.456' }] });
  expect(f.options.tools).toEqual(['ToolSearch']); expect(f.options.settingSources).toEqual(['user']);
  expect(JSON.stringify(f.run.mock.calls[0][0].prompt)).not.toContain('Exact reviewed body');
});

it('records a connection failure after release without pretending delivery failed safely', async () => {
  const f = fixture(async function* (options) {
    await permission(options, 'mcp__mail__send');
    const failed = options.hooks!.PostToolUseFailure![0].hooks[0];
    await failed({ hook_event_name: 'PostToolUseFailure', tool_name: 'mcp__mail__send', tool_input: {}, error: 'Connection lost',
      tool_use_id: 'call', session_id: 'session', transcript_path: '', cwd: '/tmp' }, 'call', { signal: options.abortController!.signal });
    yield completed;
  });
  expect(await f.provider.sendGated([{ tool: 'mcp__mail__send', input: () => ({ draft_id: 'draft1' }) }])).toMatchObject({ completed: false, released: 1, toolSaidNo: false, error: 'Connection lost' });
});
