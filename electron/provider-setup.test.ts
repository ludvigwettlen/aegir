import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { defaultProviderSetup, providerSetup, readProviderSetup } from '../shared/provider-setup.js';
import { EngineRouter, type EngineProvider } from './engine.js';
import { initializeOnboarding, OnboardingService } from './onboarding.js';
import type { CodexProvider } from './codex.js';
import { MemoryRouter, type MemoryProvider } from './memory-provider.js';

function fixture(existing = false) {
  const values = new Map<string, string>();
  const store = { getSetting: (key: string) => values.get(key), setSetting: (key: string, value: string) => { values.set(key, value); } };
  initializeOnboarding(store, existing);
  const codex = Object.assign(new EventEmitter(), {
    readAccount: vi.fn(async () => ({ account: { type: 'chatgpt' }, requiresOpenaiAuth: true })),
    checkModelAccess: vi.fn(async () => {}), close: vi.fn(), login: vi.fn(), cancelLogin: vi.fn(),
  });
  const providers = {
    apply: vi.fn((setup: unknown) => { store.setSetting('providerSetup', JSON.stringify(setup)); }),
    checkClaude: vi.fn(async () => 'Claude account ready'),
    checkBrain: vi.fn(async () => 'Selected brain ready'),
  };
  const command = vi.fn(async () => '{"results":[]}');
  const install = vi.fn();
  const service = new OnboardingService(store, codex as unknown as CodexProvider, { binary: () => '/memory' }, '/tmp', vi.fn(), vi.fn(), install, command, providers);
  return { values, store, service, codex, providers, command, install };
}
const legolas = { preset: 'legolas' as const, brainDir: '/tmp/brain', brainId: 'host', sourceId: 'notes' };

describe('explicit setup selection', () => {
  it('does not initialize either engine or memory before a fresh user chooses', async () => {
    const f = fixture();
    expect(f.service.state()).toMatchObject({ step: 'setup', choiceRequired: true });
    await f.service.check();
    expect(f.codex.readAccount).not.toHaveBeenCalled();
    expect(f.providers.checkClaude).not.toHaveBeenCalled();
    expect(f.command).not.toHaveBeenCalled();
    expect(f.values.get('setupAutomationPaused')).toBe('true');
    f.service.save('setup', 'later');
    initializeOnboarding(f.store, true);
    expect(f.service.state()).toMatchObject({ step: 'setup', choiceRequired: true, showOnLaunch: false });
    await f.service.close();
  });
  it('preserves existing Codex users even when Claude is installed', async () => {
    const f = fixture(true);
    expect(f.service.state().setup).toEqual(defaultProviderSetup());
    await f.service.check();
    expect(f.codex.readAccount).toHaveBeenCalledOnce();
    expect(f.providers.checkClaude).not.toHaveBeenCalled();
    await f.service.close();
  });
  it('checks only the selected providers, persists choice across reopening, and pauses until both are ready', async () => {
    const f = fixture(true);
    f.service.select(legolas);
    f.providers.checkBrain.mockRejectedValueOnce(new Error('Folder mapping mismatch'));
    await f.service.check();
    expect(f.codex.readAccount).not.toHaveBeenCalled();
    expect(f.command).not.toHaveBeenCalled();
    expect(f.service.state().memory).toMatchObject({ status: 'missing', diagnostic: 'Folder mapping mismatch' });
    expect(() => f.service.save('connections', 'finish')).toThrow('Claude Code');
    expect(f.values.get('setupAutomationPaused')).toBe('true');
    f.service.save('memory', 'later');
    initializeOnboarding(f.store, true);
    expect(readProviderSetup(f.values.get('providerSetup')).preset).toBe('legolas');
    await f.service.check();
    f.service.save('connections', 'finish');
    expect(f.values.get('setupAutomationPaused')).toBe('false');
    await f.service.installComponent('codex').catch(() => {});
    expect(f.install).not.toHaveBeenCalled();
    await f.service.close();
  });
  it('does not switch or reset setup if an active run prevents applying it', async () => {
    const f = fixture(true);
    f.providers.apply.mockImplementationOnce(() => { throw new Error('Stop active agents first'); });
    expect(() => f.service.select(legolas)).toThrow('Stop active agents');
    expect(f.service.state().setup?.preset).toBe('aegir');
    expect(f.values.has('setupAutomationPaused')).toBe(false);
    await f.service.close();
  });
  it('keeps memory stores and account configuration when switching back', async () => {
    const f = fixture(true);
    f.values.set('mnemosyneBinary', '/existing/memory');
    f.values.set('codexBinary', '/existing/codex');
    f.service.select(legolas);
    f.service.select({ ...legolas, preset: 'aegir' });
    expect(f.values.get('mnemosyneBinary')).toBe('/existing/memory');
    expect(f.values.get('codexBinary')).toBe('/existing/codex');
    expect(f.values.get('setupAutomationPaused')).toBe('true');
    await f.service.close();
  });
  it('rejects invalid saved selections instead of falling back to another engine', () => {
    expect(() => readProviderSetup('broken')).toThrow('invalid');
    expect(() => providerSetup({ ...legolas, sourceId: '--all' })).toThrow('IDs');
  });
});

it('replaces the engine while retaining tool dispatch and forwarding only the active engine events', async () => {
  const engine = () => Object.assign(new EventEmitter(), {
    status: 'Ready', start: vi.fn(async () => {}), close: vi.fn(), setToolHandler: vi.fn(),
    resolveApproval: vi.fn(), run: vi.fn(async () => ({ threadId: 'test', text: 'ok', status: 'completed' })), stop: vi.fn(async () => {}),
  }) satisfies EngineProvider;
  const first = engine(), second = engine();
  const router = new EngineRouter(first);
  const status = vi.fn(), handler = vi.fn();
  router.on('status', status); router.setToolHandler(handler);
  router.replace(second);
  expect(first.close).toHaveBeenCalledOnce();
  expect(second.setToolHandler).toHaveBeenCalledWith(handler);
  status.mockClear(); first.emit('status'); expect(status).not.toHaveBeenCalled();
  second.emit('status'); expect(status).toHaveBeenCalledOnce();
  await router.start(); expect(second.start).toHaveBeenCalledOnce();
  let finish!: () => void;
  second.start.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const starting = router.start();
  expect(router.hasActiveWork).toBe(true);
  expect(() => router.replace(first)).toThrow('current AI request');
  finish(); await starting;
  expect(router.hasActiveWork).toBe(false);
});

it('does not replace memory during an in-flight write and releases the guard on failure', async () => {
  let fail!: (error: Error) => void;
  const provider = { remember: vi.fn(() => new Promise((_resolve, reject) => { fail = reject; })) } as unknown as MemoryProvider;
  const router = new MemoryRouter(provider);
  const writing = router.remember('shared', 'fact', null);
  expect(() => router.replace(provider)).toThrow('current memory operation');
  fail(new Error('Write failed'));
  await expect(writing).rejects.toThrow('Write failed');
  expect(router.hasActiveWork).toBe(false);
  expect(() => router.replace(provider)).not.toThrow();
  const unselected = new MemoryRouter(provider, () => false);
  await expect(unselected.remember('shared', 'fact', null)).rejects.toThrow('Choose your setup');
  expect(provider.remember).toHaveBeenCalledOnce();
});
