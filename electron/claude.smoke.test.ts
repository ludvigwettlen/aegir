import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Approval } from '../shared/types.js';
import { ClaudeProvider } from './claude.js';
import { findClaudeBinary } from './engine.js';

// Live check against the installed Claude Code CLI. Opt in with AEGIR_CLAUDE_SMOKE=1.
const binary = findClaudeBinary();
describe.skipIf(!process.env.AEGIR_CLAUDE_SMOKE || !binary)('Claude Code engine (live)', () => {
  it('serves Aegir tools, routes permission prompts and streams the answer', async () => {
    const provider = new ClaudeProvider(binary!);
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
});
