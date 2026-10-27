import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ModelProvider, ToolHandler } from './codex.js';

export interface EngineProvider extends ModelProvider, EventEmitter {
  status: string;
  start(): Promise<void>;
  close(): void;
  setToolHandler(handler: ToolHandler): void;
  resolveApproval(id: string, approved: boolean): void;
}

export function findClaudeBinary(configured?: string): string {
  if (configured) return configured;
  return [process.env.CLAUDE_BINARY, join(homedir(), '.local/bin/claude'), join(homedir(), '.claude/local/claude'),
    '/opt/homebrew/bin/claude', '/usr/local/bin/claude'].find((path): path is string => !!path && existsSync(path)) || 'claude';
}

/** Keeps the runtime and approval handlers attached when the user changes setup. */
export class EngineRouter extends EventEmitter implements EngineProvider {
  private handler?: ToolHandler;
  private pending = 0;
  private listenersForEngine: Array<[string, (...args: any[]) => void]> = [];
  constructor(private engine: EngineProvider, private enabled = () => true) { super(); this.attach(); }
  get status() { return this.engine.status; }
  get hasActiveWork() { return this.pending > 0; }
  set status(value: string) { this.engine.status = value; }
  private attach() {
    for (const name of ['status', 'log', 'approval', 'approval-resolved', 'account-change']) {
      const listener = (...args: any[]) => this.emit(name, ...args);
      this.listenersForEngine.push([name, listener]);
      this.engine.on(name, listener);
    }
    if (this.handler) this.engine.setToolHandler(this.handler);
  }
  replace(engine: EngineProvider) {
    if (this.hasActiveWork) throw new Error('Wait for the current AI request before switching setup.');
    this.engine.close();
    for (const [name, listener] of this.listenersForEngine) this.engine.off(name, listener);
    this.listenersForEngine = [];
    this.engine = engine; this.attach(); this.emit('status');
  }
  setToolHandler(handler: ToolHandler) { this.handler = handler; this.engine.setToolHandler(handler); }
  private async withEngine<T>(action: (engine: EngineProvider) => Promise<T>) {
    if (!this.enabled()) throw new Error('Choose your setup in Settings before starting an agent.');
    this.pending++;
    try { return await action(this.engine); } finally { this.pending--; }
  }
  start() { return this.withEngine(engine => engine.start()); }
  close() { this.engine.close(); }
  run(input: Parameters<ModelProvider['run']>[0]) { return this.withEngine(engine => engine.run(input)); }
  sendGated(calls: import('./gated.js').GatedCall[], read?: (response: unknown) => unknown) {
    return this.withEngine(engine => {
      if (!engine.sendGated) throw new Error('Claude connection delivery is unavailable for the selected engine.');
      return engine.sendGated(calls, read);
    });
  }
  stop(id: string) { return this.engine.stop(id); }
  resolveApproval(id: string, approved: boolean) { this.engine.resolveApproval(id, approved); }
}
