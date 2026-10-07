import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Approval } from '../shared/types.js';
import { disabledHostSkills } from './skill-provider.js';
import { chooseLightweightModel, type AvailableModel, type ModelTier } from '../shared/model-policy.js';
import { toolResponse } from './tool-result.js';

type RpcMessage = { id?: number | string; method?: string; params?: any; result?: any; error?: { message: string } };
export type Tool = { name: string; description: string; inputSchema: Record<string, unknown>; readOnly: boolean };
export type ToolHandler = (provider: string, tool: string, args: Record<string, unknown>, readOnly: boolean, threadId: string) => Promise<unknown>;
// sandbox: chat and routines stay read-only; handed-off tasks may write inside their own output folder (cwd).
// kind: what the run is for; engines that enforce their own permissions use it (Codex ignores it).
// onToolResult sees every tool result in a chat or task run (Claude Code only), so Legolas can learn what a connector
// itself returned, such as a Superhuman draft's recipients.
export type RunInput = { kind?: 'chat' | 'task' | 'routine' | 'route' | 'triage'; threadId?: string; cwd: string; instructions: string; prompt: string; tools: Tool[]; modelTier?: ModelTier; sandbox?: 'read-only' | 'workspace-write'; onDelta: (delta: string) => void; onThreadStarted?: (threadId: string) => void; onItem?: (item: Record<string, unknown>) => void; onToolResult?: (name: string, input: unknown, response: unknown) => void };
export interface ModelProvider {
  run(input: RunInput): Promise<{ threadId: string; text: string; status: string }>;
  stop(threadId: string): Promise<void>;
  // Claude Code only: a locked run that may make exactly these connector calls, with Legolas's input (see gated.ts).
  sendGated?(calls: import('./gated.js').GatedCall[], signal?: AbortSignal, read?: (response: unknown) => unknown): Promise<import('./gated.js').GatedOutcome>;
}


// ---- Isolation from the user's own Codex setup ---------------------------
// Runs get only Legolas's dynamic tools. The user's MCP servers (whose tools may be set to auto-approve),
// ChatGPT apps/connectors, plugins and hooks would bypass Legolas's connector policy, so all are off.
// An empty mcp_servers override merges rather than replaces, so each configured server is disabled by name.
export type McpServerStatus = { name: string; runtimeStatus?: string | null; pluginId?: string | null; tools?: Record<string, unknown> };
export function isolationConfig(configRead: any): Record<string, unknown> {
  const servers = Object.keys(configRead?.config?.mcp_servers || {});
  return {
    ...Object.fromEntries(servers.map(name => [`mcp_servers.${name}.enabled`, false])),
    'features.apps': false,
    'features.plugins': false,
    'features.hooks': false,
  };
}
// Servers in a thread's inventory that could still serve tools. Disabled entries are listed but inert.
export function hostMcpServers(servers: McpServerStatus[]): string[] {
  return servers.filter(server => server.runtimeStatus !== 'disabled' || Object.keys(server.tools || {}).length > 0).map(server => server.name);
}

// ---- Approval scope ------------------------------------------------------
// An approval card must show everything the answer grants, not only the agent's stated reason.
type FileChange = { path: string; kind?: { type?: string } };
function sandboxPath(path: any): string {
  if (path?.type === 'path') return String(path.path);
  if (path?.type === 'glob_pattern') return String(path.pattern);
  if (path?.type === 'special') {
    const value = path.value || {};
    const sub = value.subpath ? `/${value.subpath}` : '';
    if (value.kind === 'root') return 'the whole disk (/)';
    if (value.kind === 'project_roots') return `the project folder${sub}`;
    if (value.kind === 'tmpdir') return 'the temporary folder ($TMPDIR)';
    if (value.kind === 'slash_tmp') return '/tmp';
    if (value.kind === 'minimal') return 'minimal system files';
    return `${value.path ?? JSON.stringify(value)}${sub}`;
  }
  return JSON.stringify(path);
}
export function describePermissionProfile(profile: any, networkDefault: string): string[] {
  const lines: string[] = [];
  const fs = profile?.fileSystem;
  for (const path of fs?.read || []) lines.push(`Files: read ${path}`);
  for (const path of fs?.write || []) lines.push(`Files: read and write ${path}`);
  for (const entry of fs?.entries || []) lines.push(`Files: ${entry.access === 'write' ? 'read and write' : entry.access} ${sandboxPath(entry.path)}`);
  const network = profile?.network?.enabled;
  lines.push(network === true ? 'Network: on' : network === false ? 'Network: off' : `Network: ${networkDefault}`);
  return lines;
}
export function describeCodexApproval(method: string, params: any, changes: FileChange[] = []): { title: string; detail: string } {
  const lines: string[] = [];
  let title = 'Agent approval';
  if (method === 'item/commandExecution/requestApproval') {
    title = params.kind === 'writeStdin' ? 'Send input to a running command' : 'Run command';
    lines.push(`Tool: ${params.kind === 'writeStdin' ? 'input to a running command' : 'shell command'}`);
    if (params.command) lines.push(`Command: ${params.command}`);
    if (params.cwd) lines.push(`Runs in: ${params.cwd}`);
    const host = params.networkApprovalContext;
    if (params.additionalPermissions) lines.push(...describePermissionProfile(params.additionalPermissions, host ? `${host.protocol}://${host.host}` : 'unchanged (off in the sandbox)'));
    else if (host) lines.push(`Network: ${host.protocol}://${host.host}`);
    else lines.push('Network: may be open. An approved command can run outside the sandbox, with your files and network');
    lines.push('Grant: this command only');
  } else if (method === 'item/fileChange/requestApproval') {
    title = 'Change files';
    lines.push('Tool: file change');
    for (const change of changes) lines.push(`Files: ${change.kind?.type || 'change'} ${change.path}`);
    if (!changes.length) lines.push('Files: not reported by Codex');
    if (params.grantRoot) lines.push(`Asked for write access under: ${params.grantRoot} (not granted; only this change is)`);
    lines.push('Network: none');
    lines.push('Grant: this change only');
  } else if (method === 'item/permissions/requestApproval') {
    title = 'Extra permissions';
    lines.push('Tool: sandbox permissions');
    if (params.cwd) lines.push(`Folder: ${params.cwd}`);
    lines.push(...describePermissionProfile(params.permissions, 'unchanged'));
    lines.push('Grant: everything above, for the rest of this turn');
  } else {
    lines.push(`Tool: ${method}`, 'Network: not stated by Codex', 'Grant: what the request below asks for', `Request:\n${JSON.stringify(params, null, 2)}`);
  }
  if (params.reason) lines.push(`Why: ${params.reason}`);
  return { title, detail: lines.join('\n') };
}

export class CodexProvider extends EventEmitter implements ModelProvider {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  private turns = new Map<string, { resolve: (value: any) => void; onDelta: (text: string) => void; onItem?: (item: Record<string, unknown>) => void; text: string; turnId: string }>();
  private approvals = new Map<string, { rpcId: number | string; method: string; threadId: string; params: any }>();
  private toolCalls = new Map<string, { rpcId: number | string; threadId: string }>();
  private toolReadOnly = new Map<string, boolean>();
  private fileChanges = new Map<string, FileChange[]>(); // file-change item id → its changes, for approval cards
  private lightweightModel: Promise<{ model: string; effort: string }> | null = null;
  private toolHandler: ToolHandler | null = null;
  status = 'Not started';
  setToolHandler(handler: ToolHandler) { this.toolHandler = handler; }
  private executable() {
    const bundled = [
      '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',
      '/Applications/ChatGPT.app/Contents/Resources/codex',
    ];
    return process.env.CODEX_BINARY || bundled.find(path => existsSync(path)) || 'codex';
  }
  async start() {
    if (this.child) return;
    const executable = this.executable();
    const launchError = (error: Error) => new Error(`Could not start Codex (${executable}): ${error.message}. Check the Codex installation or CODEX_BINARY setting.`);
    try {
      this.child = spawn(executable, ['app-server', '--stdio'], { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      this.status = 'Failed to start'; this.emit('status');
      throw launchError(error as Error);
    }
    const child = this.child;
    this.child.stderr.on('data', (data: Buffer) => this.emit('log', data.toString()));
    const stopped = (error: Error, status: string) => {
      if (this.child !== child) return;
      this.status = status; this.child = null; this.lightweightModel = null;
      for (const [, p] of this.pending) p.reject(error);
      this.pending.clear();
      for (const [, turn] of this.turns) turn.resolve({ text: turn.text, status: 'failed' });
      this.turns.clear(); this.emit('status');
    };
    child.on('error', error => stopped(launchError(error), 'Failed to start'));
    child.on('exit', () => stopped(new Error('Codex app-server stopped'), 'Stopped'));
    createInterface({ input: this.child.stdout }).on('line', line => { try { this.receive(JSON.parse(line) as RpcMessage); } catch { this.emit('log', `Invalid Codex event: ${line}`); } });
    await this.request('initialize', { clientInfo: { name: 'aegir', title: 'Aegir', version: '0.1.0' }, capabilities: { experimentalApi: true } });
    this.notify('initialized', {});
    this.status = 'Connected'; this.emit('status');
  }
  private send(value: unknown) { if (!this.child) throw new Error('Codex is not running'); this.child.stdin.write(`${JSON.stringify(value)}\n`); }
  private request(method: string, params: unknown): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.send({ id, method, params }); });
  }
  private notify(method: string, params: unknown) { this.send({ method, params }); }
  private receive(message: RpcMessage) {
    if (message.id !== undefined && !message.method) {
      const p = this.pending.get(Number(message.id)); if (p) { this.pending.delete(Number(message.id)); message.error ? p.reject(new Error(message.error.message)) : p.resolve(message.result); }
      return;
    }
    if (message.id !== undefined && message.method) { void this.handleServerRequest(message); return; }
    if (message.method === 'item/agentMessage/delta') {
      const turn = this.turns.get(message.params.threadId); if (turn) { turn.text += message.params.delta; turn.onDelta(message.params.delta); }
    }
    if (message.method === 'item/started' && message.params?.item?.type === 'fileChange') this.fileChanges.set(message.params.item.id, message.params.item.changes || []);
    if (message.method === 'item/completed' && message.params?.item) { this.fileChanges.delete(message.params.item.id); this.turns.get(message.params.threadId)?.onItem?.(message.params.item); }
    if (message.method === 'turn/completed') {
      const turn = this.turns.get(message.params.threadId);
      if (turn) { this.turns.delete(message.params.threadId); const items = message.params.turn?.items || []; const finalText = items.filter((x: any) => x.type === 'agentMessage').map((x: any) => x.text).join('\n'); turn.resolve({ text: finalText || turn.text, status: message.params.turn?.status || 'completed' }); }
    }
    if (message.method === 'error') this.emit('log', JSON.stringify(message.params));
  }
  private async handleServerRequest(message: RpcMessage) {
    const method = message.method!; const params = message.params || {};
    if (method === 'item/tool/call') {
      const [provider, ...parts] = String(params.tool).split('__'); const tool = parts.join('__');
      const id = randomUUID(); this.toolCalls.set(id, { rpcId: message.id!, threadId: params.threadId });
      try {
        const value = await this.toolHandler?.(provider, tool, params.arguments || {}, this.toolReadOnly.get(String(params.tool)) === true, String(params.threadId || ''));
        if (this.child) this.send({ id: message.id, result: toolResponse(value) });
      } catch (error) { if (this.child) this.send({ id: message.id, result: { success: false, contentItems: [{ type: 'inputText', text: String(error) }] } }); }
      this.toolCalls.delete(id); return;
    }
    if (method === 'item/tool/requestUserInput') { this.send({ id: message.id, result: { answers: {} } }); return; }
    if (method.includes('requestApproval')) {
      const id = randomUUID();
      this.approvals.set(id, { rpcId: message.id!, method, threadId: params.threadId, params });
      const { title, detail } = describeCodexApproval(method, params, this.fileChanges.get(params.itemId));
      const approval: Approval = { id, method, title, detail, agentId: null, threadId: params.threadId, createdAt: new Date().toISOString() };
      this.emit('approval', approval); return;
    }
    this.send({ id: message.id, error: { code: -32601, message: `Unsupported request: ${method}` } });
  }
  resolveApproval(id: string, approved: boolean) {
    const item = this.approvals.get(id); if (!item) return;
    this.approvals.delete(id);
    let result: unknown = { decision: approved ? 'accept' : 'decline' };
    if (item.method === 'item/permissions/requestApproval') result = { permissions: approved ? Object.fromEntries(Object.entries(item.params.permissions || {}).filter(([, value]) => value !== null)) : {}, scope: 'turn' };
    this.send({ id: item.rpcId, result });
    this.emit('approval-resolved', id);
  }
  private async resolveLightweightModel(): Promise<{ model: string; effort: string }> {
    if (!this.lightweightModel) this.lightweightModel = (async () => {
      const models: AvailableModel[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 5; page++) {
        const result = await this.request('model/list', { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) }) as { data?: AvailableModel[]; nextCursor?: string | null };
        models.push(...(result.data || []));
        cursor = result.nextCursor || null;
        if (!cursor) break;
      }
      const selected = chooseLightweightModel(models);
      if (!selected) throw new Error('No supported lightweight Luna model is available for this Codex account. Check model availability before running specialists or discovery.');
      return selected;
    })().catch(error => { this.lightweightModel = null; throw error; });
    return this.lightweightModel;
  }
  async run(input: RunInput) {
    await this.start();
    const route = input.modelTier === 'lightweight' ? await this.resolveLightweightModel() : null;
    for (const tool of input.tools) this.toolReadOnly.set(tool.name, tool.readOnly);
    const dynamicTools = input.tools.map(tool => ({ type: 'function', name: tool.name, description: /^(slack|notion)__/.test(tool.name) ? `${tool.description}${tool.readOnly ? ' (read only)' : ' (requires approval to write)'}` : tool.description, inputSchema: tool.inputSchema }));
    const skillConfig = disabledHostSkills(await this.request('skills/list', { cwds: [input.cwd], forceReload: true }));
    const config = { 'skills.config': skillConfig, ...isolationConfig(await this.request('config/read', { cwd: input.cwd })) };
    let threadId = input.threadId;
    if (threadId) { try { await this.request('thread/resume', { threadId, baseInstructions: input.instructions, config }); } catch { threadId = undefined; } }
    if (!threadId) {
      const started = await this.request('thread/start', { cwd: input.cwd, approvalPolicy: 'on-request', sandbox: input.sandbox || 'read-only', baseInstructions: input.instructions, config, dynamicTools, ...(route || {}) });
      threadId = started.thread.id;
    }
    const id = threadId!;
    // Verify the thread's effective MCP inventory before the agent can act.
    const leaked = hostMcpServers(await this.mcpInventory(id));
    if (leaked.length) throw new Error(`Legolas stopped this run because Codex loaded tools from outside Legolas: ${leaked.join(', ')}`);
    input.onThreadStarted?.(id);
    const done = new Promise<{ text: string; status: string }>(resolve => this.turns.set(id, { resolve, onDelta: input.onDelta, onItem: input.onItem, text: '', turnId: '' }));
    try {
      const started = await this.request('turn/start', { threadId: id, input: [{ type: 'text', text: input.prompt, text_elements: [] }], ...(route || {}) });
      const turn = this.turns.get(id); if (turn) turn.turnId = started.turn.id;
      const result = await done; return { threadId: id, ...result };
    } catch (error) { this.turns.delete(id); throw error; }
  }
  private async mcpInventory(threadId: string) {
    const servers: McpServerStatus[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
      const result = await this.request('mcpServerStatus/list', { threadId, detail: 'toolsAndAuthOnly', ...(cursor ? { cursor } : {}) }) as { data?: McpServerStatus[]; nextCursor?: string | null };
      servers.push(...(result.data || []));
      cursor = result.nextCursor || null;
      if (!cursor) break;
    }
    return servers;
  }
  async stop(threadId: string) { const turn = this.turns.get(threadId); if (turn?.turnId) await this.request('turn/interrupt', { threadId, turnId: turn.turnId }); }
  close() { this.child?.kill(); this.child = null; }
}
