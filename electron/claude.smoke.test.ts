import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Approval } from '../shared/types.js';
import { ClaudeProvider, hostTools } from './claude.js';
import { findClaudeBinary } from './engine.js';

// Live check against the installed Claude Code CLI. Opt in with AEGIR_CLAUDE_SMOKE=1.
const binary = findClaudeBinary();
describe.skipIf(!process.env.AEGIR_CLAUDE_SMOKE || !binary)('Claude Code engine (live)', () => {
  it('serves Aegir tools, routes permission prompts and streams the answer', async () => {
    const provider = new ClaudeProvider(binary!, { approvals: () => 'ask' });
    await provider.start();
    expect(provider.status).toMatch(/^Connected/);
    const calls: unknown[][] = [];
    provider.setToolHandler(async (...args) => { calls.push(args); return { created: true, id: 'task-1' }; });
    const approvals: Approval[] = [];
    provider.on('approval', (approval: Approval) => { approvals.push(approval); provider.resolveApproval(approval.id, true); });
    const deltas: string[] = [];
    let started = '';
    const longName = `memory__remember_${'a1b2c3d4_'.repeat(4)}`;
    const result = await provider.run({
      cwd: mkdtempSync(join(tmpdir(), 'aegir-smoke-')),
      sandbox: 'read-only',
      instructions: 'You are running an automated smoke test. Follow the steps exactly and keep the reply short.',
      prompt: 'Step 1: call the tasks__suggest tool with title "Smoke test". Step 2: run the shell command `mkdir smoke-$((6*7)) && ls` with the Bash tool. Step 3: reply with the word DONE and the folder name the command printed.',
      tools: [
        { name: 'tasks__suggest', description: 'Suggest a task for the user.', inputSchema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] }, readOnly: false },
        { name: longName, description: 'Save a memory (unused in this test).', inputSchema: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'] }, readOnly: false },
      ],
      onThreadStarted: (id) => { started = id; },
      onDelta: (delta) => deltas.push(delta),
    });
    expect(result.status).toBe('completed');
    expect(result.threadId).toBe(started);
    expect(calls[0]?.slice(0, 3)).toEqual(['tasks', 'suggest', { title: 'Smoke test' }]);
    expect(calls[0]?.[4]).toBe(started);
    expect(approvals.some((approval) => approval.method === 'claude:Bash' && approval.detail.includes('mkdir'))).toBe(true);
    expect(approvals.every((approval) => approval.threadId === started)).toBe(true);
    expect(result.text).toMatch(/DONE/);
    expect(result.text).toMatch(/42/);
    expect(deltas.join('')).toMatch(/DONE/);
  }, 180_000);

  // A synthetic host write tool, configured the way a user's own Claude Code setup would expose it:
  // a project MCP server, enabled and auto-approved in settings. The run must not see it at all.
  it('does not load host MCP servers or their auto-approved write tools', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'aegir-host-'));
    const server = join(cwd, 'server.cjs');
    writeFileSync(server, `
const rl = require('readline').createInterface({ input: process.stdin });
const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n');
rl.on('line', (line) => { const m = JSON.parse(line); if (m.id === undefined) return;
  if (m.method === 'initialize') send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'hostwrite', version: '1' } } });
  else if (m.method === 'tools/list') send({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'send_message', description: 'Send a message', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: false } }] } });
  else send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'sent' }] } });
});`);
    writeFileSync(join(cwd, '.mcp.json'), JSON.stringify({ mcpServers: { hostwrite: { command: process.execPath, args: [server] } } }));
    mkdirSync(join(cwd, '.claude'));
    writeFileSync(join(cwd, '.claude', 'settings.json'), JSON.stringify({ enableAllProjectMcpServers: true, permissions: { allow: ['mcp__hostwrite__send_message'] } }));
    const provider = new ClaudeProvider(binary!, { approvals: () => 'auto' });
    provider.setToolHandler(async () => ({}));
    const inventories: Array<{ tools: string[]; mcpServers: Array<{ name: string }>; plugins: unknown[] }> = [];
    provider.on('inventory', (inventory) => { inventories.push(inventory); void provider.stop(inventory.runId); });
    await provider.run({
      kind: 'routine', cwd, sandbox: 'read-only', instructions: 'Reply OK.', prompt: 'Reply OK.',
      tools: [{ name: 'tasks__list', description: 'List tasks (unused).', inputSchema: { type: 'object', properties: {} }, readOnly: true }],
      onDelta: () => {},
    });
    expect(inventories).toHaveLength(1);
    const [inventory] = inventories;
    expect(inventory.mcpServers.map((server) => server.name)).toEqual(['aegir']);
    expect(inventory.tools.filter((tool) => tool.startsWith('mcp__') && !tool.startsWith('mcp__aegir__'))).toEqual([]);
    expect(inventory.tools).toContain('mcp__aegir__tasks__list');
    expect(hostTools({ tools: inventory.tools, mcp_servers: inventory.mcpServers, plugins: inventory.plugins as { name: string; path?: string }[] })).toEqual([]);
  }, 120_000);

  it('in auto mode, edits the brain folder without asking', async () => {
    const brain = mkdtempSync(join(tmpdir(), 'aegir-brain-'));
    const provider = new ClaudeProvider(binary!, { workDirs: [brain], approvals: () => 'auto' });
    provider.setToolHandler(async () => ({}));
    const approvals: Approval[] = [];
    provider.on('approval', (approval: Approval) => { approvals.push(approval); provider.resolveApproval(approval.id, false); });
    const result = await provider.run({
      kind: 'chat',
      cwd: mkdtempSync(join(tmpdir(), 'aegir-cwd-')),
      sandbox: 'read-only',
      instructions: 'You are running an automated smoke test. Follow the steps exactly and keep the reply short.',
      prompt: `Use the Write tool to create the file ${join(brain, 'note.md')} containing exactly the word ok. Then reply DONE.`,
      tools: [{ name: 'tasks__list', description: 'List tasks (unused).', inputSchema: { type: 'object', properties: {} }, readOnly: true }],
      onDelta: () => {},
    });
    expect(result.status).toBe('completed');
    expect(approvals).toEqual([]);
    expect(readFileSync(join(brain, 'note.md'), 'utf8').trim()).toBe('ok');
  }, 180_000);
});
