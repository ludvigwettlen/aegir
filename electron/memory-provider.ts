import type { MemoryService } from './memory.js';

export type MemoryProvider = Pick<MemoryService, 'recall' | 'remember' | 'search' | 'correct' | 'forget' | 'migrateLegacy'>;

export class MemoryRouter implements MemoryProvider {
  private pending = 0;
  constructor(private provider: MemoryProvider, private enabled = () => true) {}
  get hasActiveWork() { return this.pending > 0; }
  replace(provider: MemoryProvider) {
    if (this.hasActiveWork) throw new Error('Wait for the current memory operation before switching setup.');
    this.provider = provider;
  }
  private async withProvider<T>(action: (provider: MemoryProvider) => Promise<T>) {
    if (!this.enabled()) throw new Error('Choose your setup in Settings before using memory.');
    this.pending++;
    try { return await action(this.provider); } finally { this.pending--; }
  }
  recall(...args: Parameters<MemoryProvider['recall']>) { return this.withProvider(p => p.recall(...args)); }
  remember(...args: Parameters<MemoryProvider['remember']>) { return this.withProvider(p => p.remember(...args)); }
  search(...args: Parameters<MemoryProvider['search']>) { return this.withProvider(p => p.search(...args)); }
  correct(...args: Parameters<MemoryProvider['correct']>) { return this.withProvider(p => p.correct(...args)); }
  forget(...args: Parameters<MemoryProvider['forget']>) { return this.withProvider(p => p.forget(...args)); }
  migrateLegacy() { return this.withProvider(p => p.migrateLegacy()); }
}
