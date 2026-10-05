import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// Captures the options Legolas passes to the Agent SDK and replays a scripted session.
const sdk = vi.hoisted(() => ({ options: [] as any[], init: null as any, toolCalls: [] as string[] }));
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: ({ options }: { options: any }) => {
    sdk.options.push(options);
    return (async function* () {
      yield { type: 'system', subtype: 'init', session_id: 's1', ...sdk.init };
      // If the run was not stopped, the agent would now call a tool.
      sdk.toolCalls.push('called');
      yield { type: 'result', subtype: 'success', is_error: false, result: 'Done', session_id: 's1' };
    })();
  },
}));

const { ClaudeProvider, hostTools, BUILTIN_TOOLS } = await import('./claude.js');

const legolasInit = { tools: [...BUILTIN_TOOLS, 'mcp__aegir__tasks__suggest'], mcp_servers: [{ name: 'aegir', status: 'connected', source: 'sdk' }], plugins: [] };
const tool = { name: 'tasks__suggest', description: 'Suggest', inputSchema: { type: 'object' }, readOnly: false };

function provider() {
  const claude = new ClaudeProvider('/bin/claude', { workDirs: [join(homedir(), 'brain')] });
  claude.setToolHandler(async () => ({}));
  return claude;
}

describe('Claude Code run isolation', () => {
  it.each(['chat', 'task', 'routine'] as const)('does not inherit host settings, MCP servers, plugins or skills in a %s run', async (kind) => {
    sdk.options.length = 0;
    sdk.init = legolasInit;
    const result = await provider().run({ kind, cwd: '/tmp/task', instructions: 'Be brief', prompt: 'Hi', tools: [tool], onDelta: () => {} });
    expect(result.status).toBe('completed');
    const options = sdk.options[0];
    expect(options.settingSources).toEqual([]);
    expect(options.strictMcpConfig).toBe(true);
    expect(Object.keys(options.mcpServers)).toEqual(['aegir']);
    expect(options.plugins).toEqual([]);
    expect(options.skills).toEqual([]);
    expect(options.tools).toEqual(BUILTIN_TOOLS);
    expect(options.env.ENABLE_CLAUDEAI_MCP_SERVERS).toBe('false');
    // The deliberate pre-approvals stay: Legolas tools, the brain folder and the gbrain CLI.
    expect(options.allowedTools).toEqual(expect.arrayContaining(['mcp__aegir__tasks__suggest', 'Edit(~/brain/**)', 'Bash(gbrain:*)']));
    expect(options.allowedTools.filter((rule: string) => rule.startsWith('mcp__') && !rule.startsWith('mcp__aegir__'))).toEqual([]);
  });

  it('keeps quick routing calls tool-free', async () => {
    sdk.options.length = 0;
    sdk.init = { tools: [], mcp_servers: [], plugins: [] };
    await provider().run({ kind: 'route', cwd: '/tmp', instructions: 'Route', prompt: 'Which group?', tools: [], onDelta: () => {} });
    expect(sdk.options[0]).toMatchObject({ settingSources: [], tools: [], mcpServers: {}, strictMcpConfig: true });
  });

  it('stops a run whose inventory contains a host write tool before the agent acts', async () => {
    sdk.toolCalls.length = 0;
    sdk.init = {
      tools: [...legolasInit.tools, 'mcp__hostwrite__send_message'],
      mcp_servers: [...legolasInit.mcp_servers, { name: 'hostwrite', status: 'connected', source: 'project' }],
      plugins: [],
    };
    const claude = provider();
    const logs: string[] = [];
    claude.on('log', (line: string) => logs.push(line));
    const result = await claude.run({ kind: 'routine', cwd: '/tmp', instructions: 'Run', prompt: 'Go', tools: [tool], onDelta: () => {} });
    expect(result.status).toBe('failed');
    expect(result.text).toContain('mcp__hostwrite__send_message');
    expect(sdk.toolCalls).toEqual([]);
    expect(logs.join('\n')).toContain('hostwrite');
  });

  it('finds every host-provided item in a tool inventory', () => {
    expect(hostTools(legolasInit)).toEqual([]);
    expect(hostTools({
      tools: ['Bash', 'mcp__aegir__tasks__list', 'mcp__claude_ai_Slack__slack_send_message', 'mcp__notionApi__API-patch-page'],
      mcp_servers: [{ name: 'aegir', source: 'sdk' }, { name: 'claude.ai Slack', source: 'claudeai' }, { name: 'aegir', source: 'user' }],
      plugins: [{ name: 'sec-default' }, { name: 'plugin-authoring', path: 'builtin' }],
    })).toEqual([
      'MCP server claude.ai Slack', 'MCP server aegir',
      'mcp__claude_ai_Slack__slack_send_message', 'mcp__notionApi__API-patch-page',
      'plugin sec-default',
    ]);
  });
});
