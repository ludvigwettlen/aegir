import { describe, expect, it, vi } from 'vitest';
import { DesktopOAuthProvider } from './connectors.js';
import type { Store } from './db.js';

vi.mock('electron', () => ({
  shell: { openExternal: vi.fn() },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString()
  }
}));

describe('OAuth callback state', () => {
  it('preserves state after a mismatch and consumes it after one valid callback', () => {
    const settings = new Map<string, string>();
    const store = {
      getSetting: (key: string) => settings.get(key),
      setSetting: (key: string, value: string) => { settings.set(key, value); },
      db: { prepare: () => ({ run: (key: string) => { settings.delete(key); } }) }
    } as unknown as Store;
    const provider = new DesktopOAuthProvider('notion', store, () => {});
    const state = provider.state();
    expect(provider.consumeState('wrong')).toBe(false);
    expect(provider.checkState(state)).toBe(true);
    expect(provider.consumeState(state)).toBe(true);
    expect(provider.consumeState(state)).toBe(false);
    expect(settings.has('secret:notion:oauthState')).toBe(false);
  });
});
