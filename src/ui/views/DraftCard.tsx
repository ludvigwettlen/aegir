import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '../design-system/primitives';

export function DraftCard({ label, title, context, children }: { label: string; title: string; context: string; children: ReactNode }) {
  return <section className={`email-draft-card ${label === 'Slack draft' ? 'slack-draft-card' : ''}`} aria-label={label}>
    <header><strong>{title}</strong><span>{context}</span></header>{children}
  </section>;
}
export function DraftActions({ state, queuedUntil, locked, saveDisabled, sendDisabled, onSave, onSend, onUndo, onManual }: {
  state: string; queuedUntil?: number; locked: boolean; saveDisabled: boolean; sendDisabled: boolean;
  onSave: () => void; onSend: () => void; onUndo: () => void; onManual: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (state !== 'queued') return;
    setNow(Date.now()); const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, [state, queuedUntil]);
  if (state === 'queued') return <>
    <p role="status">Sending in {Math.max(0, Math.ceil(((queuedUntil || now) - now) / 1000))} seconds…</p>
    <footer><Button variant="outline" size="sm" onClick={onUndo}>Undo</Button></footer>
  </>;
  if (state === 'sent-manually') return <p role="status">You marked this as sent yourself. Aegir did not send it.</p>;
  if (state !== 'draft') return null;
  return <>
    <p>Send starts a five-second countdown. Undo cancels before delivery.</p>
    <footer>
      <Button variant="ghost" size="sm" disabled={locked} onClick={onManual}>I sent it myself</Button>
      <Button variant="outline" size="sm" disabled={locked || saveDisabled} onClick={onSave}>Save draft</Button>
      <Button size="sm" disabled={locked || sendDisabled} onClick={onSend}>Send</Button>
    </footer>
  </>;
}
