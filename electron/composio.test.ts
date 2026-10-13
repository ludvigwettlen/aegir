import { describe, expect, it } from 'vitest';
import { composioReadTool, composioTools, prepareComposioCall } from './composio.js';
import { connectorToolsFor } from './agent-tools.js';

const batch = (...slugs: string[]) => ({ tools: slugs.map(tool_slug => ({ tool_slug, arguments: {} })), sync_response_to_workbench: true });

describe('Composio permissions', () => {
  it('exposes discovery and constrained reads in unattended runs, never generic execution or remote code', () => {
    const tools = composioTools(['COMPOSIO_SEARCH_TOOLS', 'COMPOSIO_GET_TOOL_SCHEMAS', 'COMPOSIO_MULTI_EXECUTE_TOOL', 'COMPOSIO_REMOTE_BASH_TOOL', 'COMPOSIO_REMOTE_WORKBENCH', 'COMPOSIO_MANAGE_CONNECTIONS'].map(name => ({ name, inputSchema: {} })), 'slack_style-winrow');
    expect(tools).toHaveLength(4);
    for (const kind of ['task', 'routine'] as const) {
      expect(connectorToolsFor(kind, tools).map(t => t.name)).toEqual(['COMPOSIO_SEARCH_TOOLS', 'COMPOSIO_GET_TOOL_SCHEMAS', composioReadTool]);
    }
    expect(tools.find(t => t.name === 'COMPOSIO_MULTI_EXECUTE_TOOL')?.readOnly).toBe(false);
  });
  it('forwards supported reads and forces inline results', () => {
    expect(prepareComposioCall(composioReadTool, batch('SLACK_SEARCH_MESSAGES'))).toEqual({ name: 'COMPOSIO_MULTI_EXECUTE_TOOL', arguments: { ...batch('SLACK_SEARCH_MESSAGES'), sync_response_to_workbench: false } });
  });
  it('rejects mixed read/write batches, unknown actions, and other apps', () => {
    for (const slug of ['SLACK_SEND_MESSAGE', 'SLACK_SEARCH_AND_DELETE', 'GMAIL_FETCH_EMAILS']) {
      expect(() => prepareComposioCall(composioReadTool, batch('SLACK_SEARCH_MESSAGES', slug))).toThrow();
    }
    expect(() => prepareComposioCall('COMPOSIO_MULTI_EXECUTE_TOOL', batch('GMAIL_SEND_EMAIL'))).toThrow();
    expect(() => prepareComposioCall('COMPOSIO_REMOTE_BASH_TOOL', { command: 'anything' })).toThrow();
  });
  it('routes message sends to the editor and keeps other writes approval-gated', () => {
    expect(() => prepareComposioCall('COMPOSIO_MULTI_EXECUTE_TOOL', batch('SLACK_SEND_MESSAGE'))).toThrow('inline editor');
    expect(prepareComposioCall('COMPOSIO_MULTI_EXECUTE_TOOL', batch('SLACK_ADD_REACTION')).name).toBe('COMPOSIO_MULTI_EXECUTE_TOOL');
  });
  it('fails closed on malformed or extended execution wrappers', () => {
    for (const args of [{ tools: [] }, { tools: [null] }, { tools: [{ tool_slug: 'SLACK_SEARCH_MESSAGES', arguments: {}, account: 'other' }] }, { ...batch('SLACK_SEARCH_MESSAGES'), custom_auth: {} }]) {
      expect(() => prepareComposioCall(composioReadTool, args)).toThrow();
    }
  });
});
