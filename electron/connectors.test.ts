import { describe, expect, it, vi } from 'vitest';
import { safeStorage } from 'electron';
import { Server } from 'node:http';
import { DesktopOAuthProvider, ConnectorManager } from './connectors.js';
import type { Store } from './db.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

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
      deleteSetting: (key: string) => { settings.delete(key); }
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

it('recovers Notion after explicit disconnect without deleting other connections', async () => {
  const settings = new Map([
    ['secret:notion:tokens', 'unreadable'],
    ['secret:notion:client', 'unreadable'],
    ['secret:notion:verifier', 'unreadable'],
    ['secret:notion:oauthState', 'unreadable'],
    ['secret:slack:tokens', 'keep-slack'],
  ]);
  const store = {
    getSetting: (key: string) => settings.get(key),
    setSetting: (key: string, value: string) => { settings.set(key, value); },
    deleteSetting: (key: string) => { settings.delete(key); },
  } as unknown as Store;
  const decrypt = vi.spyOn(safeStorage, 'decryptString').mockImplementation(() => { throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.'); });
  const connect = vi.spyOn(Client.prototype, 'connect').mockImplementation(async transport => {
    const auth = (transport as unknown as { _authProvider: DesktopOAuthProvider })._authProvider;
    auth.tokens(); auth.clientInformation();
  });
  const list = vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({ tools: [] });
  const manager = new ConnectorManager(store);
  try {
    await expect(manager.connect('notion')).rejects.toThrow('disconnect and reconnect');
    expect(manager.states.notion.status).toBe('error');
    expect(settings.size).toBe(5);
    await manager.disconnect('notion');
    expect([...settings]).toEqual([['secret:slack:tokens', 'keep-slack']]);
    expect(manager.states.notion.status).toBe('disconnected');
    await expect(manager.connect('notion')).resolves.toBeUndefined();
    expect(manager.states.notion.status).toBe('connected');
  } finally {
    manager.close(); decrypt.mockRestore(); connect.mockRestore(); list.mockRestore();
  }
});


it('keeps startup and settings available when saved credentials cannot be decrypted', () => {
  const settings = new Map([
    ['secret:slack:tokens', 'saved-ciphertext'],
    ['secret:slack:slackClient', 'saved-ciphertext'],
    ['secret:composio:consumerKey', 'saved-ciphertext'],
  ]);
  const store = { getSetting: (key: string) => settings.get(key) } as unknown as Store;
  const decrypt = vi.spyOn(safeStorage, 'decryptString').mockImplementation(() => { throw new Error('Cannot decrypt'); });
  const listen = vi.spyOn(Server.prototype, 'listen').mockReturnThis();
  const manager = new ConnectorManager(store);
  try {
    expect(() => manager.start()).not.toThrow();
    expect(manager.states.slack).toMatchObject({ status: 'error', detail: expect.stringContaining('could not be unlocked') });
    expect(manager.states.composio.status).toBe('error');
    expect(manager.states.notion.status).toBe('disconnected');
    expect(manager.slackConfigured()).toBe(false);
    expect(manager.composioConfigured()).toBe(false);
    expect(settings.size).toBe(3);
  } finally {
    manager.close();
    decrypt.mockRestore();
    listen.mockRestore();
  }
});
