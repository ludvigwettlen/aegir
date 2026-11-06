import { EventEmitter } from 'node:events';
import type { ModelProvider, ToolHandler } from './codex.js';

export interface EngineProvider extends ModelProvider, EventEmitter {
  status: string;
  start(): Promise<void>;
  close(): void;
  setToolHandler(handler: ToolHandler): void;
  resolveApproval(id: string, approved: boolean): void;
}

export class EngineRouter extends EventEmitter implements EngineProvider {
  private pending = 0;
  constructor(private readonly engine: EngineProvider) { super(); this.attach(); }
  get status() { return this.engine.status; }
  get hasActiveWork() { return this.pending > 0; }
  set status(value: string) { this.engine.status = value; }
  private attach() {
    for (const name of ['status', 'log', 'approval', 'approval-resolved', 'account-change']) {
      const listener = (...args: any[]) => this.emit(name, ...args);
      this.engine.on(name, listener);
    }
  }
  setToolHandler(handler: ToolHandler) { this.engine.setToolHandler(handler); }
  private async withEngine<T>(action: (engine: EngineProvider) => Promise<T>) {
    this.pending++;
    try { return await action(this.engine); } finally { this.pending--; }
  }
  start() { return this.withEngine(engine => engine.start()); }
  close() { this.engine.close(); }
  run(input: Parameters<ModelProvider['run']>[0]) { return this.withEngine(engine => engine.run(input)); }
  stop(id: string) { return this.engine.stop(id); }
  resolveApproval(id: string, approved: boolean) { this.engine.resolveApproval(id, approved); }
}
