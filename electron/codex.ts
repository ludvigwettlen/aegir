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
export type RunInput = { threadId?: string; cwd: string; instructions: string; prompt: string; tools: Tool[]; modelTier?: ModelTier; sandbox?: 'read-only' | 'workspace-write'; onDelta: (delta: string) => void; onThreadStarted?: (threadId: string) => void; onItem?: (item: Record<string, unknown>) => void };
export interface ModelProvider {
  run(input: RunInput): Promise<{ threadId: string; text: string; status: string }>;
  stop(threadId: string): Promise<void>;
}

export class CodexProvider extends EventEmitter implements ModelProvider {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  private turns = new Map<string, { resolve: (value: any) => void; onDelta: (text: string) => void; onItem?: (item: Record<string, unknown>) => void; text: string; turnId: string }>();
  private approvals = new Map<string, { rpcId: number | string; method: string; threadId: string; params: any }>();
  private toolCalls = new Map<string, { rpcId: number | string; threadId: string }>();
  private toolReadOnly = new Map<string, boolean>();
  private lightweightModel: Promise<{ model: string; effort: string }> | null = null;
  private toolHandler: ToolHandler | null = null;
  status = 'Not started';
  setToolHandler(handler: ToolHandler) { this.toolHandler = handler; }
  private executable() {
    const bundled = '/Applications/ChatGPT.app/Contents/Resources/codex';
    return process.env.CODEX_BINARY || (existsSync(bundled) ? bundled : 'codex');
  }
  async start() {
    if (this.child) return;
    this.child = spawn(this.executable(), ['app-server', '--stdio'], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stderr.on('data', (data: Buffer) => this.emit('log', data.toString()));
    this.child.on('exit', () => { this.status = 'Stopped'; this.child = null; this.lightweightModel = null; for (const [, p] of this.pending) p.reject(new Error('Codex app-server stopped')); this.pending.clear(); for (const [, turn] of this.turns) turn.resolve({ text: turn.text, status: 'failed' }); this.turns.clear(); this.emit('status'); });
    createInterface({ input: this.child.stdout }).on('line', line => { try { this.receive(JSON.parse(line) as RpcMessage); } catch { this.emit('log', `Invalid Codex event: ${line}`); } });
    await this.request('initialize', { clientInfo: { name: 'aegir', title: 'Ägir', version: '0.1.0' }, capabilities: { experimentalApi: true } });
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
    if (message.method === 'item/completed' && message.params?.item) this.turns.get(message.params.threadId)?.onItem?.(message.params.item);
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
      const approval: Approval = { id, method, title: method.includes('command') ? 'Run command' : method.includes('file') ? 'Change files' : 'Agent approval', detail: params.command || params.reason || JSON.stringify(params), agentId: null, threadId: params.threadId, createdAt: new Date().toISOString() };
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
    let threadId = input.threadId;
    if (threadId) { try { await this.request('thread/resume', { threadId, baseInstructions: input.instructions, config: { 'skills.config': skillConfig } }); } catch { threadId = undefined; } }
    if (!threadId) {
      const started = await this.request('thread/start', { cwd: input.cwd, approvalPolicy: 'on-request', sandbox: input.sandbox || 'read-only', baseInstructions: input.instructions, config: { 'skills.config': skillConfig }, dynamicTools, ...(route || {}) });
      threadId = started.thread.id;
    }
    const id = threadId!;
    input.onThreadStarted?.(id);
    const done = new Promise<{ text: string; status: string }>(resolve => this.turns.set(id, { resolve, onDelta: input.onDelta, onItem: input.onItem, text: '', turnId: '' }));
    try {
      const started = await this.request('turn/start', { threadId: id, input: [{ type: 'text', text: input.prompt, text_elements: [] }], ...(route || {}) });
      const turn = this.turns.get(id); if (turn) turn.turnId = started.turn.id;
      const result = await done; return { threadId: id, ...result };
    } catch (error) { this.turns.delete(id); throw error; }
  }
  async stop(threadId: string) { const turn = this.turns.get(threadId); if (turn?.turnId) await this.request('turn/interrupt', { threadId, turnId: turn.turnId }); }
  close() { this.child?.kill(); this.child = null; }
}
