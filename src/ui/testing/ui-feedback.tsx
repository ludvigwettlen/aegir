import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@usefragments/ui';
import '../styles';
import type { DesktopApi } from '../../../shared/types';
import { feedbackBrief, type UiFeedbackState } from '../../../shared/ui-feedback';
const fixture = { fail: false, actions: 0, copied: '', state: { path: '/tmp/aegir-fixture/ui-feedback.json', comments: [] } as UiFeedbackState };
Object.assign(window, { fixture });
window.aegir = {
  uiFeedback: async () => fixture.state,
  addUiFeedback: async input => {
    if (fixture.fail) throw new Error('Could not save comment');
    fixture.state = { ...fixture.state, comments: [...fixture.state.comments, { ...input, id: crypto.randomUUID(), createdAt: new Date().toISOString(), resolvedAt: null }] };
    return fixture.state;
  },
  resolveUiFeedback: async (id, resolved) => { fixture.state = { ...fixture.state, comments: fixture.state.comments.map(comment => comment.id === id ? { ...comment, resolvedAt: resolved ? new Date().toISOString() : null } : comment) }; return fixture.state; },
  copyUiFeedback: async () => { fixture.copied = feedbackBrief(fixture.state); },
} as Partial<DesktopApi> as DesktopApi;
const { UiFeedback } = await import('../views/UiFeedback');
function Fixture() {
  const [active, setActive] = useState(false);
  return <ThemeProvider defaultMode="light"><div className="ws-shell">
    <nav className="ws-sidebar"><button onClick={() => fixture.actions++}>Today</button></nav>
    <main className="ws-main" style={{ padding: 60, flexDirection: 'column', alignItems: 'flex-start', gap: 20 }}><h1>Today's tasks</h1><button id="send-action" onPointerDown={() => fixture.actions++} onClick={() => fixture.actions++}>Send message</button><p>Review the latest changes to your workspace.</p><input aria-label="Private field" type="password" defaultValue="secret-value" /></main>
    <UiFeedback active={active} onActiveChange={setActive} route={{ view: 'tasks', list: 'today' }} />
  </div></ThemeProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
