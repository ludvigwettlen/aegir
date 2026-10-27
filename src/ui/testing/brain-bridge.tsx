import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@usefragments/ui';
import type { DesktopApi } from '../../../shared/types';
import { defaultBrainBridgeConfig, type BrainBridgeState } from '../../../shared/brain-bridge';
import '../styles';
const initial: BrainBridgeState = { ...defaultBrainBridgeConfig(), externalSetup: true, paused: false, lastRunAt: null, error: '', report: null };
const fixture = { state: initial, fail: false, allowSave: true, configurations: [] as unknown[], filed: [] as unknown[], publish: (_value: BrainBridgeState) => {}, aegir: () => {}, compact: () => {} };
Object.assign(window, { fixture });
window.aegir = {
  chooseBridgeFolder: async purpose => `/selected/${purpose}/${'a-long-folder-name-'.repeat(5)}`,
  configureBrainBridge: async value => {
    if (fixture.fail) throw new Error('This workflow folder is unavailable. Choose it again.');
    fixture.configurations.push(value); fixture.state = { ...fixture.state, ...value }; fixture.publish(fixture.state); return fixture.state;
  },
  runBrainBridge: async () => { fixture.state = { ...fixture.state, lastRunAt: '2026-10-21T14:00:00Z', report: { created: 1, skipped: 2, rejected: 1, deferred: 1, exported: true }, error: 'invalid.json: Invalid due date. See rejected folder.' }; fixture.publish(fixture.state); return fixture.state; },
  fileToBrain: async (id, path, kind) => {
    if (fixture.fail) throw new Error('Could not copy this file.');
    fixture.filed.push({ id, path, kind }); return '/selected/filing/brain-copy.md';
  },
} satisfies Partial<DesktopApi> as unknown as DesktopApi;
const { BrainBridgeSettings } = await import('../views/BrainBridgeSettings');
const { BrainFileButton } = await import('../views/BrainFileButton');
function Fixture() {
  const [state, setState] = useState(initial); fixture.publish = setState;
  const [compact, setCompact] = useState(false); fixture.compact = () => setCompact(true);
  fixture.aegir = () => { fixture.state = { ...fixture.state, externalSetup: false }; setState(fixture.state); };
  return <ThemeProvider defaultMode="light"><main style={{ padding: 20, width: compact ? 400 : 760, maxWidth: '100%', boxSizing: 'border-box' }}>
    <BrainBridgeSettings state={state} />
    <BrainFileButton workspaceId="task" path="draft.md" kind="document" beforeFile={async () => fixture.allowSave} />
  </main></ThemeProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
