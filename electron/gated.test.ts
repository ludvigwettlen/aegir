import { describe, expect, it } from 'vitest';
import { CallGate, type GatedCall } from './gated.js';

const send: GatedCall = { tool: 'mcp__slack__send', input: () => ({ channel_id: 'U1', text: 'Hej' }) };

describe('locked runs', () => {
  it('lets the model load tools, then releases each planned call once, in order, with Legolas input', async () => {
    const update: GatedCall = { tool: 'mcp__mail__update', input: () => ({ body: 'Hej' }) };
    const deliver: GatedCall = { tool: 'mcp__mail__send', input: ([updated]) => ({ draft_id: (updated as { id: string }).id }) };
    const gate = new CallGate([update, deliver]);
    expect(await gate.before('ToolSearch')).toEqual({ allow: true });
    expect(await gate.before('mcp__mail__send')).toMatchObject({ allow: false, reason: 'Only mcp__mail__update may run now.' });
    expect(await gate.before('mcp__mail__update')).toEqual({ allow: true, input: { body: 'Hej' } });
    // A second call while one is running is refused, so two can't both be released.
    expect(await gate.before('mcp__mail__update')).toMatchObject({ allow: false });
    gate.after('mcp__mail__update', { body: 'Hej' }, { id: 'draft1' });
    expect(await gate.before('mcp__mail__send')).toEqual({ allow: true, input: { draft_id: 'draft1' } });
    gate.after('mcp__mail__send', { draft_id: 'draft1' }, { success: true });
    expect(gate.outcome()).toEqual({ results: [{ id: 'draft1' }, { success: true }], released: 2, completed: true });
    expect(await gate.before('mcp__mail__send')).toMatchObject({ allow: false });
    expect(await gate.before('Bash')).toMatchObject({ allow: false });
  });

  it('refuses everything else, including Bash and other connector tools', async () => {
    const gate = new CallGate([send]);
    for (const tool of ['Bash', 'Write', 'mcp__slack__delete', 'mcp__other__send']) expect((await gate.before(tool)).allow).toBe(false);
    expect(gate.released).toBe(0);
  });

  it('holds the call at its commit point and releases nothing when the user takes it back', async () => {
    let release!: (value: boolean) => void;
    const gate = new CallGate([{ ...send, commit: () => new Promise<boolean>((done) => { release = done; }) }]);
    const decision = gate.before('mcp__slack__send');
    expect(gate.released).toBe(0);
    release(false);
    expect(await decision).toMatchObject({ allow: false });
    expect(gate.outcome()).toMatchObject({ released: 0, completed: false, error: 'Cancelled before it was sent', toolSaidNo: true });
  });

  it("stops where a call's own answer says it failed, and treats an error after release as unknown", async () => {
    const said = new CallGate([{ ...send, check: (result) => ((result as { error?: string }).error ? 'Slack said no' : null) }]);
    await said.before('mcp__slack__send');
    said.after('mcp__slack__send', { channel_id: 'U1', text: 'Hej' }, { error: 'channel_not_found' });
    expect(said.outcome()).toMatchObject({ completed: false, failedCall: 0, toolSaidNo: true, error: 'Slack said no' });
    const lost = new CallGate([send]);
    await lost.before('mcp__slack__send');
    lost.failed('mcp__slack__send', 'MCP error: timed out');
    expect(lost.outcome()).toMatchObject({ released: 1, completed: false, toolSaidNo: false, error: 'MCP error: timed out' });
  });

  it('notices a call that ran with input other than what it released', async () => {
    const gate = new CallGate([send]);
    await gate.before('mcp__slack__send');
    gate.after('mcp__slack__send', { channel_id: 'C9', text: 'Hej' }, { ok: true });
    expect(gate.outcome()).toMatchObject({ completed: false, toolSaidNo: false, error: 'The call ran with different input than Legolas released' });
  });

  it('parses answers with the reader it was given', async () => {
    const gate = new CallGate([send], (response) => JSON.parse(String(response)));
    await gate.before('mcp__slack__send');
    gate.after('mcp__slack__send', { channel_id: 'U1', text: 'Hej', thread_ts: '' }, '{"ok":true}');
    expect(gate.outcome()).toEqual({ results: [{ ok: true }], released: 1, completed: true });
  });
});
