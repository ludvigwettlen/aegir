import type { OnboardingState, SetupDependency, SetupStep } from '../shared/onboarding.js';
import type { Store } from './db.js';
import type { CodexProvider } from './codex.js';
import type { MemoryService } from './memory.js';
import { installDependency, setupCommand } from './setup-install.js';
import { defaultProviderSetup, providerSetup, readProviderSetup, type SetupChoice, type ProviderSetup } from '../shared/provider-setup.js';

type Settings = Pick<Store, 'getSetting' | 'setSetting'>;
type Codex = Pick<CodexProvider, 'readAccount' | 'login' | 'cancelLogin' | 'checkModelAccess' | 'close' | 'on'>;
const steps: SetupStep[] = ['setup', 'codex', 'memory', 'connections'];
export function initializeOnboarding(store: Settings, existingWorkspace: boolean) {
  // Only migrate installations predating provider selection. A fresh user who
  // defers the choice must not be silently opted into Aegir on the next launch.
  if (!store.getSetting('providerSetupInitialized')) {
    if (existingWorkspace && !store.getSetting('providerSetup')) store.setSetting('providerSetup', JSON.stringify(defaultProviderSetup()));
    store.setSetting('providerSetupInitialized', 'true');
  }
  if (store.getSetting('onboardingInitialized')) return;
  store.setSetting('onboardingInitialized', 'true');
  store.setSetting('onboardingDismissed', existingWorkspace ? 'true' : 'false');
  if (!existingWorkspace) store.setSetting('setupAutomationPaused', 'true');
}

export class OnboardingService {
  private codexState: SetupDependency = { status: 'unchecked', detail: 'Check whether Codex is ready on this Mac.' };
  private memoryState: SetupDependency = { status: 'unchecked', detail: 'Check whether memory is ready on this Mac.' };
  private busy = false;
  private checking: Promise<OnboardingState> | null = null;
  private installing: Promise<string> | null = null;
  private controller = new AbortController();
  private loginId: string | null = null;
  private accountRefreshQueued = false;
  private lastState?: OnboardingState;
  private loginTimer: ReturnType<typeof setTimeout> | undefined;
  constructor(private store: Settings, private codex: Codex, private memory: Pick<MemoryService, 'binary'>,
    private root: string, private changed: () => void, private openExternal: (url: string) => Promise<unknown>,
    private install = installDependency, private command = setupCommand,
    private providers?: { apply: (setup: ProviderSetup) => void; checkClaude: (signal: AbortSignal) => Promise<string>; checkBrain: (signal: AbortSignal) => Promise<string> }) {
    codex.on('account-change', (result?: { success?: boolean; error?: string; loginId?: string }) => {
      if (this.controller.signal.aborted || this.setup.engine !== 'codex') return;
      if (result?.success === false) {
        if (!this.loginId || (result.loginId && result.loginId !== this.loginId)) return;
        this.clearLogin();
        this.codexState = { status: 'needs-sign-in', detail: 'Sign-in was not completed. Please try again.' }; this.changed();
      } else if (result?.success) {
        this.clearLogin();
        if (this.busy) this.accountRefreshQueued = true;
        else void this.check();
      } else if (!this.busy && !this.loginId) void this.check();
    });
  }
  get hasActiveWork() { return this.busy || !!this.loginId || !!this.installing; }
  state(): OnboardingState {
    if (this.controller.signal.aborted && this.lastState) return this.lastState;
    const saved = this.store.getSetting('onboardingStep') as SetupStep;
    this.lastState = { showOnLaunch: this.store.getSetting('onboardingDismissed') !== 'true', completed: this.store.getSetting('onboardingCompleted') === 'true',
      step: !this.store.getSetting('providerSetup') ? 'setup' : steps.includes(saved) ? saved : 'codex', busy: this.busy,
      setup: this.setup, choiceRequired: !this.store.getSetting('providerSetup'),
      codex: { ...this.codexState }, memory: { ...this.memoryState } };
    return this.lastState;
  }
  private get setup() { return readProviderSetup(this.store.getSetting('providerSetup')); }
  select(choice: SetupChoice) {
    if (this.busy || this.loginId || this.controller.signal.aborted) throw new Error('Finish or cancel the current setup step before changing setup.');
    const next = providerSetup(choice);
    if (!this.providers) throw new Error('Provider switching is unavailable.');
    if (JSON.stringify(next) !== this.store.getSetting('providerSetup')) {
      // apply validates idle state, persists the selection, and replaces the active adapters synchronously.
      this.providers.apply(next);
      this.store.setSetting('onboardingCompleted', 'false');
      this.store.setSetting('setupAutomationPaused', 'true');
      this.codexState = { status: 'unchecked', detail: `Check ${next.engine === 'claude' ? 'Claude Code' : 'Codex'} to continue.` };
      this.memoryState = { status: 'unchecked', detail: 'Check the selected memory setup.' };
    }
    this.store.setSetting('onboardingStep', 'codex');
    this.changed(); return this.state();
  }
  private clearLogin() { clearTimeout(this.loginTimer); this.loginId = null; }
  private async checkCodex() {
    if (this.setup.engine === 'claude') {
      this.codexState = { status: 'checking', detail: 'Checking Claude Code and its account…' }; this.changed();
      try {
        if (!this.providers) throw new Error('Claude provider unavailable.');
        this.codexState = { status: 'ready', detail: await this.providers.checkClaude(this.controller.signal) };
      } catch (error) { this.codexState = { status: 'missing', detail: 'Install and sign in to Claude Code, then check again. Your Codex setup is kept.', diagnostic: message(error) }; }
      return;
    }
    this.codexState = { status: 'checking', detail: 'Checking Codex and your account…' }; this.changed();
    try {
      const result = await this.codex.readAccount();
      if (!result.account && result.requiresOpenaiAuth !== false) {
        this.codexState = { status: 'needs-sign-in', detail: 'Codex is installed. Sign in with your ChatGPT account to continue.' }; return;
      }
      const label = result.account?.email ? `Signed in as ${result.account.email}.` : 'Codex is connected to your configured provider.';
      try { await this.codex.checkModelAccess(); this.codexState = { status: 'ready', detail: `${label} Agent models are available.` }; }
      catch (error) { this.codexState = { status: 'error', detail: `${label} Aegir could not check the models it needs. Make sure you are online and your account has access to a Luna model, then check again.`, diagnostic: message(error) }; }
    } catch (error) {
      this.codexState = { status: 'missing', detail: 'Codex could not start. Install a copy for Aegir, or check again if it is already installed.', diagnostic: message(error) };
    }
  }
  private async checkMemory() {
    this.memoryState = { status: 'checking', detail: 'Checking local memory…' }; this.changed();
    try {
      if (this.setup.memory === 'gbrain') {
        if (!this.providers) throw new Error('Brain provider unavailable.');
        this.memoryState = { status: 'ready', detail: await this.providers.checkBrain(this.controller.signal) };
        return;
      }
      const output = await this.command(this.memory.binary(), ['recall', 'Aegir setup availability', '1', '--json'], {
        signal: this.controller.signal, timeout: 60_000,
        env: { ...process.env, MNEMOSYNE_BANK: 'aegir-shared', MNEMOSYNE_DEFAULT_SCOPE: 'global' },
      });
      if (!Array.isArray(JSON.parse(output).results)) throw new Error('Unexpected memory response.');
      this.memoryState = { status: 'ready', detail: 'Mnemosyne is ready. Your existing memories stay in place.' };
    } catch (error) { this.memoryState = { status: 'missing', detail: 'Memory is not ready yet. Set it up below, or check again.', diagnostic: message(error) }; }
  }
  check(): Promise<OnboardingState> {
    if (!this.store.getSetting('providerSetup')) return Promise.resolve(this.state());
    if (this.checking) return this.checking;
    if (this.busy || this.loginId || this.controller.signal.aborted) return Promise.resolve(this.state());
    this.busy = true;
    this.checking = (async () => {
      try { await Promise.all([this.checkCodex(), this.checkMemory()]); }
      finally { this.busy = false; this.checking = null; this.changed(); }
      return this.state();
    })();
    return this.checking;
  }
  async installComponent(kind: 'codex' | 'memory') {
    if (kind !== 'codex' && kind !== 'memory') throw new Error('Unknown setup component.');
    if (this.setup.engine !== 'codex') throw new Error('Use your existing Claude Code and gbrain installations for Legolas setup.');
    if (this.busy || this.loginId) throw new Error('Please wait for the current setup step.');
    this.busy = true;
    const update = (detail: string) => { this[kind === 'codex' ? 'codexState' : 'memoryState'] = { status: 'working', detail }; this.changed(); };
    try {
      update('Starting setup…');
      this.installing = this.install(kind, { root: this.root, signal: this.controller.signal, progress: update });
      const binary = await this.installing;
      // The installer only returns after verification. Never replace a working path on failure.
      if (this.controller.signal.aborted) return this.state();
      this.store.setSetting(kind === 'codex' ? 'codexBinary' : 'mnemosyneBinary', binary);
      if (kind === 'codex') { this.codex.close(); await this.checkCodex(); }
      else this.memoryState = { status: 'ready', detail: 'Memory is installed and tested. Your memories will stay on this Mac.' };
    } catch (error) {
      this[kind === 'codex' ? 'codexState' : 'memoryState'] = { status: 'error', detail: 'Setup could not finish. Check your internet connection and try again. Your existing setup has been kept.', diagnostic: message(error) };
    } finally { this.installing = null; this.busy = false; this.changed(); }
    return this.state();
  }
  async signIn() {
    if (this.setup.engine !== 'codex') throw new Error('Sign in through your Claude Code installation, then check again.');
    if (this.busy || this.loginId) throw new Error('Please finish or cancel the current setup step.');
    this.busy = true;
    this.codexState = { status: 'working', detail: 'Opening ChatGPT sign-in…' }; this.changed();
    try {
      const result = await this.codex.login();
      this.loginId = result.loginId;
      const url = new URL(result.authUrl);
      if (url.protocol !== 'https:' || !['auth.openai.com', 'auth0.openai.com', 'chatgpt.com', 'auth.chatgpt.com'].includes(url.hostname)) throw new Error('Codex returned an unexpected sign-in address.');
      await this.openExternal(url.toString());
      this.codexState = { status: 'working', detail: 'Finish signing in in your browser, then return to Aegir.' };
      this.loginTimer = setTimeout(() => { void this.cancelSignIn(); }, 10 * 60_000);
    } catch (error) {
      if (this.loginId) await this.codex.cancelLogin(this.loginId).catch(() => {});
      this.clearLogin(); this.codexState = { status: 'error', detail: 'Could not open sign-in. Please try again.', diagnostic: message(error) };
    } finally {
      this.busy = false; this.changed();
      if (this.accountRefreshQueued) { this.accountRefreshQueued = false; this.clearLogin(); void this.check(); }
    }
    return this.state();
  }
  async cancelSignIn() {
    const id = this.loginId; this.clearLogin();
    if (id) await this.codex.cancelLogin(id).catch(() => {});
    this.codexState = { status: 'needs-sign-in', detail: 'Sign-in cancelled. You can try again whenever you are ready.' }; this.changed();
    return this.state();
  }
  save(step: SetupStep, action: 'continue' | 'later' | 'finish') {
    if (!steps.includes(step) || !['continue', 'later', 'finish'].includes(action)) throw new Error('Invalid setup action.');
    if (this.busy || this.loginId) throw new Error('Please wait for setup, or cancel sign-in first.');
    if (action === 'finish' && (!this.store.getSetting('providerSetup') || this.codexState.status !== 'ready' || this.memoryState.status !== 'ready')) throw new Error(`Connect ${this.setup.engine === 'claude' ? 'Claude Code' : 'Codex'} and set up memory before finishing. You can also choose Set up later.`);
    this.store.setSetting('onboardingStep', step);
    if (action !== 'continue') this.store.setSetting('onboardingDismissed', 'true');
    if (action === 'finish') { this.store.setSetting('onboardingCompleted', 'true'); this.store.setSetting('setupAutomationPaused', 'false'); }
    this.changed(); return this.state();
  }
  async close() {
    this.state(); this.controller.abort(); this.clearLogin();
    await this.installing?.catch(() => {});
  }
}
function message(error: unknown) { return error instanceof Error ? error.message : String(error); }
