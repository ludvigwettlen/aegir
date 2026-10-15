import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@usefragments/ui';
import '../styles';
import type { DesktopApi, Snapshot } from '../../../shared/types';
import type { OnboardingState } from '../../../shared/onboarding';
const fixture = {
  failMemory: true, installed: [] as string[], connected: [] as string[], closed: false,
  state: { showOnLaunch: true, completed: false, step: 'codex', busy: false, codex: { status: 'missing', detail: 'Codex needs setup.' }, memory: { status: 'missing', detail: 'Memory needs setup.' } } as OnboardingState,
  update: () => {},
  loginComplete: () => { fixture.state = { ...fixture.state, codex: { status: 'ready', detail: 'Signed in as colleague@example.com.' } }; fixture.update(); },
};
Object.assign(window, { fixture });
window.aegir = {
  checkSetup: async () => fixture.state,
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
function Fixture() {
  const [, refresh] = useState(0);
  fixture.update = () => refresh(value => value + 1);
  const data = { onboarding: fixture.state, connectors: [{ id: 'notion', status: 'disconnected', detail: 'Not connected' }, { id: 'composio', status: 'disconnected', detail: 'Not connected' }], mcpSettings: { slackClientId: '' } } as Snapshot;
  return <ThemeProvider defaultMode="light"><OnboardingView data={data} onClose={() => { fixture.closed = true; }} onSettings={() => { fixture.closed = true; }} /></ThemeProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
