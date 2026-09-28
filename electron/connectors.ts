import { createServer, type Server } from 'node:http';
import { EventEmitter } from 'node:events';
import { shell, safeStorage } from 'electron';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthClientMetadata, OAuthClientInformationMixed, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { Connector } from '../shared/types.js';
import type { Store } from './db.js';
import { createOAuthState, matchesOAuthState } from './oauth-state.js';

type ProviderName = 'slack' | 'notion';
type ToolInfo = { name: string; description: string; inputSchema: Record<string, unknown>; readOnly: boolean };
const endpoint: Record<ProviderName, string> = { slack: 'https://mcp.slack.com/mcp', notion: 'https://mcp.notion.com/mcp' };

class KeychainState {
  constructor(private store: Store, private prefix: string) {}
  get<T>(key: string): T | undefined {
    const value = this.store.getSetting(`secret:${this.prefix}:${key}`); if (!value) return;
    if (!safeStorage.isEncryptionAvailable()) throw new Error('macOS Keychain encryption is unavailable');
    return JSON.parse(safeStorage.decryptString(Buffer.from(value, 'base64'))) as T;
  }
  set(key: string, value: unknown) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('macOS Keychain encryption is unavailable');
    this.store.setSetting(`secret:${this.prefix}:${key}`, safeStorage.encryptString(JSON.stringify(value)).toString('base64'));
  }
  clear(key: string) { this.store.deleteSetting(`secret:${this.prefix}:${key}`); }
}

export class DesktopOAuthProvider implements OAuthClientProvider {
  private secrets: KeychainState;
  constructor(private name: ProviderName, store: Store, private onRedirect: (url: URL) => void) { this.secrets = new KeychainState(store, name); }
  get redirectUrl() { return `http://127.0.0.1:8765/callback/${this.name}`; }
  get clientMetadata(): OAuthClientMetadata {
    return { redirect_uris: [this.redirectUrl], client_name: 'Ägir', response_types: ['code'], grant_types: ['authorization_code', 'refresh_token'], token_endpoint_auth_method: this.name === 'slack' ? 'client_secret_basic' : 'none', scope: this.name === 'slack' ? 'search:read.public search:read.private search:read.im search:read.mpim channels:history groups:history im:history mpim:history channels:read groups:read im:read mpim:read chat:write' : undefined };
  }
  state(): string {
    const value = createOAuthState();
    this.secrets.set('oauthState', value);
    return value;
  }
  clientInformation(): OAuthClientInformationMixed | undefined { return this.secrets.get<OAuthClientInformationMixed>('client') || (this.name === 'slack' ? this.secrets.get<OAuthClientInformationMixed>('slackClient') : undefined); }
  saveClientInformation(value: OAuthClientInformationMixed) { this.secrets.set('client', value); }
  tokens(): OAuthTokens | undefined { return this.secrets.get<OAuthTokens>('tokens'); }
  saveTokens(value: OAuthTokens) { this.secrets.set('tokens', value); }
  redirectToAuthorization(url: URL) {
    if (!this.checkState(url.searchParams.get('state'))) throw new Error('OAuth authorization URL is missing its state parameter');
    this.onRedirect(url);
  }
  saveCodeVerifier(value: string) { this.secrets.set('verifier', value); }
  codeVerifier(): string { const value = this.secrets.get<string>('verifier'); if (!value) throw new Error('OAuth verifier missing'); return value; }
  checkState(value: string | null) { return matchesOAuthState(this.secrets.get<string>('oauthState'), value); }
  consumeState(value: string | null) {
    if (!this.checkState(value)) return false;
    this.secrets.clear('oauthState');
    return true;
  }
  configureSlack(clientId: string, clientSecret: string) { this.secrets.set('slackClient', { client_id: clientId, client_secret: clientSecret }); }
  isSlackConfigured() { return Boolean(this.secrets.get('slackClient')); }
  clear() { for (const key of ['client', 'tokens', 'verifier', 'oauthState', 'slackClient']) this.secrets.clear(key); }
  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery') {
    if (scope === 'all' || scope === 'tokens') this.secrets.clear('tokens');
    if (scope === 'all' || scope === 'verifier') this.secrets.clear('verifier');
    if (scope === 'client') this.secrets.clear('client');
  }
}

export class ConnectorManager extends EventEmitter {
  private server: Server | null = null;
  private clients = new Map<ProviderName, { client: Client; transport: StreamableHTTPClientTransport }>();
  private pending = new Map<ProviderName, StreamableHTTPClientTransport>();
  private oauth: Record<ProviderName, DesktopOAuthProvider>;
  readonly states: Record<ProviderName, Connector> = {
    slack: { id: 'slack', status: 'disconnected', detail: 'Connect your Slack workspace', tools: [], checkedAt: null },
    notion: { id: 'notion', status: 'disconnected', detail: 'Connect your Notion workspace', tools: [], checkedAt: null }
  };
  private tools = new Map<ProviderName, ToolInfo[]>();
  constructor(private store: Store) {
    super();
    this.oauth = {
      slack: new DesktopOAuthProvider('slack', store, url => void shell.openExternal(url.toString())),
      notion: new DesktopOAuthProvider('notion', store, url => void shell.openExternal(url.toString()))
    };
  }
  start() {
    this.server = createServer((req, res) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1:8765');
      const provider = url.pathname.endsWith('/slack') ? 'slack' : url.pathname.endsWith('/notion') ? 'notion' : null;
      if (!provider) { res.writeHead(404); res.end('Not found'); return; }
      if (!this.oauth[provider].consumeState(url.searchParams.get('state'))) {
        res.writeHead(400); res.end('Invalid authorization callback'); return;
      }
      const code = url.searchParams.get('code');
      if (!code) { this.failPendingAuthorization(provider, 'Authorization was cancelled. Reconnect to try again.'); res.writeHead(400); res.end('Authorization was cancelled'); return; }
      res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html><body style="font-family:system-ui;padding:3rem"><h2>Authorization received</h2><p>Return to Ägir to check the connection.</p></body></html>');
      void this.finishAuth(provider, code);
    });
    this.server.on('error', error => { for (const provider of ['slack', 'notion'] as const) this.setState(provider, 'error', `OAuth callback unavailable: ${String(error)}`); });
    this.server.listen(8765, '127.0.0.1');
    for (const provider of ['slack', 'notion'] as const) if (this.oauth[provider].tokens()) void this.connect(provider);
  }
  private setState(provider: ProviderName, status: Connector['status'], detail: string, tools: string[] = []) {
    this.states[provider] = { id: provider, status, detail, tools, checkedAt: new Date().toISOString() }; this.emit('change');
  }
  private failPendingAuthorization(provider: ProviderName, detail: string) {
    const transport = this.pending.get(provider);
    this.pending.delete(provider);
    if (transport) void transport.close().catch(() => {});
    this.setState(provider, 'error', detail);
  }
  async connect(provider: ProviderName, clientId?: string, clientSecret?: string) {
    if (provider === 'slack' && clientId && clientSecret) this.oauth.slack.configureSlack(clientId.trim(), clientSecret.trim());
    if (provider === 'slack' && !this.oauth.slack.isSlackConfigured()) throw new Error('Enter the Client ID and Client Secret of an internal Slack app first');
    this.setState(provider, 'connecting', 'Authorizing…');
    try {
      await this.clients.get(provider)?.client.close(); this.clients.delete(provider);
      const transport = new StreamableHTTPClientTransport(new URL(endpoint[provider]), { authProvider: this.oauth[provider] });
      const client = new Client({ name: 'aegir', version: '0.1.0' });
      this.pending.set(provider, transport);
      await client.connect(transport);
      this.pending.delete(provider);
      const discovered: Awaited<ReturnType<Client['listTools']>>['tools'] = [];
      let cursor: string | undefined;
      do {
        const listing = await client.listTools(cursor ? { cursor } : undefined);
        discovered.push(...listing.tools); cursor = listing.nextCursor;
      } while (cursor);
      const tools: ToolInfo[] = discovered.map(tool => {
        const base = tool.name.replace(/^(notion[-_]|slack[-_])/, '');
        return { name: tool.name, description: tool.description || '', inputSchema: tool.inputSchema as Record<string, unknown>, readOnly: tool.annotations?.readOnlyHint === true || /^(get|list|search|retrieve|read|fetch|query|find|inspect|lookup|preview|download)/i.test(base) };
      });
      this.tools.set(provider, tools); this.clients.set(provider, { client, transport });
      if (provider === 'notion') {
        const access = tools.find(tool => tool.name === 'notion-get-tool-access');
        if (access) { try { await client.callTool({ name: access.name, arguments: {} }); } catch { /* tool list is still usable */ } }
      }
      this.setState(provider, 'connected', `${tools.length} tools available`, tools.map(x => x.name));
    } catch (error) {
      if (this.pending.has(provider) && String(error).includes('Unauthorized')) { this.setState(provider, 'connecting', 'Complete authorization in your browser'); return; }
      this.pending.delete(provider); this.setState(provider, 'error', String(error)); throw error;
    }
  }
  private async finishAuth(provider: ProviderName, code: string) {
    try { const transport = this.pending.get(provider); if (!transport) throw new Error('No pending connection'); await transport.finishAuth(code); this.pending.delete(provider); await this.connect(provider); }
    catch (error) { this.failPendingAuthorization(provider, `Authorization failed: ${String(error)}`); }
  }
  async disconnect(provider: ProviderName) { await this.clients.get(provider)?.client.close(); this.clients.delete(provider); this.tools.delete(provider); this.oauth[provider].clear(); this.setState(provider, 'disconnected', 'Disconnected'); }
  listTools(): { name: string; description: string; inputSchema: Record<string, unknown>; readOnly: boolean }[] {
    return [...this.tools].flatMap(([provider, list]) => list.map(tool => ({ ...tool, name: `${provider}__${tool.name}` })));
  }
  async call(provider: ProviderName, tool: string, args: Record<string, unknown>) {
    const client = this.clients.get(provider)?.client; if (!client) throw new Error(`${provider} is not connected`);
    try { const result = await client.callTool({ name: tool, arguments: args }); if (result.isError) throw new Error(JSON.stringify(result.content)); return result; }
    catch (error) { if (/401|unauthoriz|invalid.token/i.test(String(error))) this.setState(provider, 'error', 'Authorization expired. Reconnect to continue.'); throw error; }
  }
  toolInfo(provider: ProviderName, tool: string) { return this.tools.get(provider)?.find(x => x.name === tool); }
  slackConfigured() { return this.oauth.slack.isSlackConfigured(); }
  close() { this.server?.close(); for (const item of this.clients.values()) void item.client.close(); }
}
