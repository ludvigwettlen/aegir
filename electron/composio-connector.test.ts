import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Store } from './db.js';
import { ConnectorManager } from './connectors.js';
const mock = vi.hoisted(() => ({ options: [] as any[], connect: vi.fn(), close: vi.fn(), call: vi.fn(), list: vi.fn() }));
vi.mock('electron', () => ({ shell: { openExternal: vi.fn() }, safeStorage: {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from(`encrypted:${s}`),
  decryptString: (b: Buffer) => b.toString().replace(/^encrypted:/, ''),
} }));
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({ Client: class {
  connect = mock.connect; close = mock.close; callTool = mock.call; listTools = mock.list;
} }));
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({ StreamableHTTPClientTransport: class {
  constructor(url: URL, options: unknown) { mock.options.push({ url: url.toString(), options }); }
  close = mock.close;
} }));
function fixture() {
  const settings = new Map<string, string>();
  const store = { getSetting: (k: string) => settings.get(k), setSetting: (k: string, v: string) => settings.set(k, v), deleteSetting: (k: string) => settings.delete(k) } as unknown as Store;
  return { settings, store, manager: new ConnectorManager(store) };
}
beforeEach(() => {
  vi.resetAllMocks(); mock.options.length = 0;
  mock.connect.mockResolvedValue(undefined); mock.close.mockResolvedValue(undefined);
  mock.list.mockResolvedValue({ tools: [{ name: 'COMPOSIO_SEARCH_TOOLS', inputSchema: {} }, { name: 'COMPOSIO_MULTI_EXECUTE_TOOL', inputSchema: {} }] });
  mock.call.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
});
describe('Composio connector', () => {
  it('uses the consumer header, reuses encrypted credentials, and clears them on disconnect', async () => {
    const { manager, store, settings } = fixture();
    await manager.connect('composio', 'slack_style-winrow', 'test-secret');
    expect(mock.options[0]).toMatchObject({ url: 'https://connect.composio.dev/mcp', options: { requestInit: { headers: { 'x-consumer-api-key': 'test-secret' } } } });
    expect(settings.get('secret:composio:consumerKey')).not.toContain('test-secret');
    expect(JSON.stringify(manager.states)).not.toContain('test-secret');
    const restarted = new ConnectorManager(store);
    await restarted.connect('composio');
    expect(mock.options[1].options.requestInit.headers['x-consumer-api-key']).toBe('test-secret');
    await restarted.disconnect('composio');
    expect(restarted.composioConfigured()).toBe(false);
    expect(restarted.listTools()).toEqual([]);
    await restarted.connect('composio');
    expect(mock.options[2].options.authProvider).toBeDefined();
    await manager.disconnect('composio'); await restarted.disconnect('composio');
  });
  it('blocks bypasses before calling upstream and routes reads to the real execution tool', async () => {
    const { manager } = fixture(); await manager.connect('composio', '', 'key');
    await expect(manager.call('composio', 'SLACK_READ_TOOLS', { tools: [{ tool_slug: 'SLACK_SEND_MESSAGE', arguments: {} }] })).rejects.toThrow();
    await expect(manager.call('composio', 'COMPOSIO_REMOTE_BASH_TOOL', {})).rejects.toThrow();
    expect(mock.call).not.toHaveBeenCalled();
    await manager.call('composio', 'SLACK_READ_TOOLS', { tools: [{ tool_slug: 'SLACK_SEARCH_MESSAGES', arguments: { query: 'hello' } }] });
    expect(mock.call).toHaveBeenCalledWith({ name: 'COMPOSIO_MULTI_EXECUTE_TOOL', arguments: { tools: [{ tool_slug: 'SLACK_SEARCH_MESSAGES', arguments: { query: 'hello' } }], sync_response_to_workbench: false } });
    await manager.disconnect('composio');
  });
  it('reports a failed key without leaking upstream error credentials', async () => {
    const { manager } = fixture(); mock.connect.mockRejectedValue(new Error('Unauthorized secret-key'));
    await expect(manager.connect('composio', '', 'secret-key')).rejects.toThrow('consumer API key');
    expect(manager.states.composio.status).toBe('error');
    expect(JSON.stringify(manager.states)).not.toContain('secret-key');
    expect(manager.listTools()).toEqual([]);
    expect(mock.close).toHaveBeenCalled();
  });
  it('does not republish tools after disconnect during discovery', async () => {
    const { manager } = fixture();
    let finish!: (value: unknown) => void;
    mock.list.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const connecting = manager.connect('composio', '', 'key');
    await vi.waitFor(() => expect(mock.list).toHaveBeenCalled());
    await manager.disconnect('composio');
    finish({ tools: [{ name: 'COMPOSIO_MULTI_EXECUTE_TOOL', inputSchema: {} }] });
    await connecting;
    expect(manager.states.composio.status).toBe('disconnected');
    expect(manager.listTools()).toEqual([]);
  });
});
