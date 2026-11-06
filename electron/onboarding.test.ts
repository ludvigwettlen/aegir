import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initializeOnboarding, OnboardingService } from './onboarding.js';
import type { CodexProvider } from './codex.js';
import type { installDependency } from './setup-install.js';

const services: OnboardingService[] = [];
afterEach(() => { services.forEach(service => service.close()); services.length = 0; });
function fixture(options: { existing?: boolean; legacyLegolas?: boolean; loggedIn?: boolean; memory?: boolean } = {}) {
  const values = new Map<string, string>();
  const settings = { getSetting: (key: string) => values.get(key), setSetting: (key: string, value: string) => { values.set(key, value); } };
  if (options.legacyLegolas) {
    values.set('providerSetup', JSON.stringify({ preset: 'legolas', brainDir: '/existing/brain' }));
    values.set('onboardingInitialized', 'true');
    values.set('onboardingCompleted', 'true');
    values.set('onboardingDismissed', 'true');
    values.set('setupAutomationPaused', 'false');
  }
  initializeOnboarding(settings, options.existing || false);
  const codex = Object.assign(new EventEmitter(), {
    readAccount: vi.fn(async () => ({ account: options.loggedIn ? { type: 'chatgpt', email: 'tester@example.com' } : null, requiresOpenaiAuth: true })),
    checkModelAccess: vi.fn(async () => {}), close: vi.fn(),
    login: vi.fn(async () => ({ loginId: 'login-1', authUrl: 'https://auth.openai.com/authorize?state=example' })),
    cancelLogin: vi.fn(async () => {}),
  });
  const command = vi.fn(async () => { if (!options.memory) throw new Error('not installed'); return '{"results":[]}'; });
  const install = vi.fn<typeof installDependency>(async kind => `/private/aegir/${kind}/binary`);
  const open = vi.fn(async () => {});
  const service = new OnboardingService(settings, codex as unknown as CodexProvider, { binary: () => '/existing/memory' }, '/private/aegir', vi.fn(), open, install, command);
  services.push(service);
  return { service, settings, values, codex, install, open };
}

describe('guided setup', () => {
  it('pauses background work on upgrade from Legolas until Codex and memory are checked', async () => {
    const { service, settings, values } = fixture({ existing: true, legacyLegolas: true, loggedIn: true, memory: true });
    expect(service.state()).toMatchObject({ showOnLaunch: true, completed: false, step: 'codex' });
    expect(values.get('setupAutomationPaused')).toBe('true');
    expect(values.get('providerSetup')).toContain('/existing/brain');
    await service.check();
    service.save('connections', 'finish');
    initializeOnboarding(settings, true);
    expect(service.state()).toMatchObject({ completed: true, showOnLaunch: false });
    expect(values.get('setupAutomationPaused')).toBe('false');
  });
  it('shows once for a fresh workspace, pauses automation, and preserves existing workspace behavior', () => {
    const fresh = fixture();
    expect(fresh.service.state().showOnLaunch).toBe(true);
    expect(fresh.values.get('setupAutomationPaused')).toBe('true');
    fresh.service.save('memory', 'later');
    initializeOnboarding(fresh.settings, true);
    expect(fresh.service.state()).toMatchObject({ showOnLaunch: false, completed: false, step: 'memory' });
    expect(fresh.values.get('setupAutomationPaused')).toBe('true');
    const existing = fixture({ existing: true });
    expect(existing.service.state().showOnLaunch).toBe(false);
    expect(existing.values.has('setupAutomationPaused')).toBe(false);
  });
  it('does not call an installed but unauthenticated Codex ready, or finish incomplete setup', async () => {
    const { service } = fixture();
    await service.check();
    expect(service.state().codex.status).toBe('needs-sign-in');
    expect(service.state().memory.status).toBe('missing');
    expect(() => service.save('connections', 'finish')).toThrow('Connect Codex');
  });
  it('preserves a configured memory path on failed installation, and can retry', async () => {
    const { service, install, values } = fixture();
    values.set('mnemosyneBinary', '/existing/memory');
    install.mockRejectedValueOnce(new Error('Network unavailable'));
    await service.installComponent('memory');
    expect(service.state().memory).toMatchObject({ status: 'error', diagnostic: 'Network unavailable' });
    expect(values.get('mnemosyneBinary')).toBe('/existing/memory');
    await service.installComponent('memory');
    expect(values.get('mnemosyneBinary')).toBe('/private/aegir/memory/binary');
    expect(service.state().memory.status).toBe('ready');
  });
  it('rejects parallel installation and invalid components', async () => {
    const { service, install } = fixture();
    let finish!: (binary: string) => void;
    install.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const first = service.installComponent('memory');
    await expect(service.installComponent('codex')).rejects.toThrow('wait');
    await expect(service.installComponent('shell' as 'memory')).rejects.toThrow('Unknown');
    expect(() => service.save('memory', 'later')).toThrow('wait');
    finish('/private/verified/memory'); await first;
    expect(install).toHaveBeenCalledTimes(1);
  });
  it('cancels installation on shutdown without saving an unverified path', async () => {
    const { service, install, values } = fixture();
    install.mockImplementationOnce((_kind, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true });
    }));
    const installing = service.installComponent('memory');
    await service.close(); await installing;
    expect(values.has('mnemosyneBinary')).toBe(false);
  });
  it('only enables automation after both dependencies pass their checks', async () => {
    const { service, values } = fixture({ loggedIn: true, memory: true });
    await service.check();
    service.save('connections', 'finish');
    expect(service.state()).toMatchObject({ completed: true, showOnLaunch: false });
    expect(values.get('setupAutomationPaused')).toBe('false');
  });
  it('reports missing agent models even when sign-in succeeds', async () => {
    const { service, codex } = fixture({ loggedIn: true });
    codex.checkModelAccess.mockRejectedValueOnce(new Error('Unavailable'));
    await service.check();
    expect(service.state().codex).toMatchObject({ status: 'error', detail: expect.stringContaining('Luna') });
  });
  it('opens only trusted login URLs and cancels abandoned sign-ins', async () => {
    const { service, codex, open } = fixture();
    await service.signIn();
    expect(open).toHaveBeenCalledWith('https://auth.openai.com/authorize?state=example');
    await service.cancelSignIn();
    expect(codex.cancelLogin).toHaveBeenCalledWith('login-1');
    codex.login.mockResolvedValueOnce({ loginId: 'login-2', authUrl: 'file:///tmp/unsafe' });
    await service.signIn();
    expect(open).toHaveBeenCalledTimes(1);
    expect(service.state().codex.status).toBe('error');
    expect(codex.cancelLogin).toHaveBeenCalledWith('login-2');
  });
  it('rechecks the real account after a successful browser login', async () => {
    const { service, codex } = fixture({ memory: true });
    await service.signIn();
    codex.readAccount.mockResolvedValue({ account: { type: 'chatgpt', email: 'tester@example.com' }, requiresOpenaiAuth: true });
    codex.emit('account-change', { success: true, loginId: 'login-1' });
    await vi.waitFor(() => expect(service.state().codex.status).toBe('ready'));
  });
  it('ignores cancelled login notifications from an older attempt', async () => {
    const { service, codex } = fixture();
    await service.signIn(); await service.cancelSignIn();
    codex.login.mockResolvedValueOnce({ loginId: 'login-2', authUrl: 'https://auth.openai.com/authorize' });
    await service.signIn();
    codex.emit('account-change', { success: false, loginId: 'login-1' });
    expect(service.state().codex.status).toBe('working');
  });
  it('does not discard a new login because account state changed during the initial check', async () => {
    const { service, codex } = fixture();
    codex.readAccount.mockImplementationOnce(async () => { codex.emit('account-change'); return { account: null, requiresOpenaiAuth: true }; });
    await service.check(); await service.signIn();
    expect(service.state().codex.status).toBe('working');
    expect(() => service.save('memory', 'continue')).toThrow('cancel sign-in');
  });
});
