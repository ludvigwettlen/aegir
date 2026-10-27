import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@usefragments/ui';
import '../styles';
import type { DesktopApi, Snapshot } from '../../../shared/types';
import type { OnboardingState } from '../../../shared/onboarding';
import { defaultProviderSetup, providerSetup } from '../../../shared/provider-setup';
const fresh = new URLSearchParams(location.search).has('fresh');
const memoryPage = new URLSearchParams(location.search).get('memory');
const fixture = {
  failMemory: true, rejectSwitch: false, installed: [] as string[], connected: [] as string[], closed: false,
  state: { showOnLaunch: true, completed: false, step: fresh ? 'setup' : 'codex', choiceRequired: fresh, setup: defaultProviderSetup(), busy: false, codex: { status: 'missing', detail: 'Codex needs setup.' }, memory: { status: 'missing', detail: 'Memory needs setup.' } } as OnboardingState,
  update: () => {},
  loginComplete: () => { fixture.state = { ...fixture.state, codex: { status: 'ready', detail: 'Signed in as colleague@example.com.' } }; fixture.update(); },
};
Object.assign(window, { fixture });
if (memoryPage === 'brain') fixture.state.setup = providerSetup({ preset: 'legolas', brainDir: '/brain', brainId: 'host', sourceId: 'default' });
window.aegir = {
  searchMemories: async () => [{ id: 'one', scope: memoryPage === 'brain' ? 'brain' : 'shared', content: 'A remembered decision', sourceUrl: null, createdAt: '' }],
  checkSetup: async () => {
    if (fixture.state.setup?.preset === 'legolas') {
      fixture.state = { ...fixture.state, codex: { status: 'ready', detail: 'Claude Code is signed in.' },
        memory: fixture.failMemory ? { status: 'missing', detail: 'Memory is not ready yet.', diagnostic: 'The selected gbrain source is not registered to this folder.' } : { status: 'ready', detail: 'gbrain is ready.' } };
      fixture.update();
    }
    return fixture.state;
  },
  selectSetup: async choice => {
    if (fixture.rejectSwitch) throw new Error('Stop active agents before switching setup.');
    fixture.state = { ...fixture.state, setup: providerSetup(choice), step: 'codex', choiceRequired: false, completed: false,
      codex: { status: 'missing', detail: 'Check your AI.' }, memory: { status: 'missing', detail: 'Check memory.' } };
    fixture.update(); return fixture.state;
  },
  chooseBrainFolder: async () => '/Users/test/Work notes/brain',
  installSetupComponent: async kind => {
    fixture.installed.push(kind);
    fixture.state = { ...fixture.state, busy: true, [kind]: { status: 'working', detail: 'Downloading and preparing your installation…' } }; fixture.update();
    await new Promise(resolve => setTimeout(resolve, 250));
    fixture.state = { ...fixture.state, busy: false, [kind]: kind === 'codex' ? { status: 'needs-sign-in', detail: 'Codex is installed. Sign in to continue.' } : fixture.failMemory ? { status: 'error', detail: 'Setup could not finish. Check your internet connection and try again.' } : { status: 'ready', detail: 'Memory is installed and tested.' } }; fixture.update();
    return fixture.state;
  },
  signInCodex: async () => { fixture.state = { ...fixture.state, codex: { status: 'working', detail: 'Finish signing in in your browser, then return to Aegir.' } }; fixture.update(); return fixture.state; },
  cancelCodexSignIn: async () => { fixture.state = { ...fixture.state, codex: { status: 'needs-sign-in', detail: 'Sign-in cancelled.' } }; fixture.update(); return fixture.state; },
  saveSetup: async (step, action) => { fixture.state = { ...fixture.state, step, showOnLaunch: action === 'continue', completed: action === 'finish' }; fixture.update(); return fixture.state; },
  connect: async provider => { fixture.connected.push(provider); },
  disconnect: async () => {},
} as Partial<DesktopApi> as DesktopApi;
const { OnboardingView } = await import('../views/OnboardingView');
const { MemoryView } = await import('../views/MemoryView');
function Fixture() {
  const [, refresh] = useState(0);
  fixture.update = () => refresh(value => value + 1);
  const data = { onboarding: fixture.state, legacyMemoryCount: 2, memoryInstructions: '', connectors: [{ id: 'notion', status: 'disconnected', detail: 'Not connected' }, { id: 'composio', status: 'disconnected', detail: 'Not connected' }], mcpSettings: { slackClientId: '' } } as Snapshot;
  return <ThemeProvider defaultMode="light">{memoryPage ? <MemoryView data={data} run={async action => { await action(); }} /> : <OnboardingView data={data} onClose={() => { fixture.closed = true; }} onSettings={() => { fixture.closed = true; }} />}</ThemeProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
