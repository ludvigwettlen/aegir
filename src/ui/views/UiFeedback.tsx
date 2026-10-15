import * as Dialog from '@radix-ui/react-dialog';
import { MessageSquarePlus, MousePointer2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { FeedbackTarget, UiFeedbackState } from '../../../shared/ui-feedback';
import { Button } from '../design-system/primitives';
import { describeFeedbackTarget, feedbackElement } from '../ui-feedback';
import { api, type Route } from './common';

export function UiFeedback({ route, active, onActiveChange }: {
  route: Route; active: boolean; onActiveChange: (active: boolean) => void;
}) {
  const [picking, setPicking] = useState(false);
  const [hover, setHover] = useState<FeedbackTarget | null>(null);
  const [target, setTarget] = useState<FeedbackTarget | null>(null);
  const [inbox, setInbox] = useState(false);
  const [text, setText] = useState('');
  const [state, setState] = useState<UiFeedbackState | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const launcher = useRef<HTMLDivElement>(null);
  // Draft composer text is not part of navigation context.
  const { draft: _draft, ...location } = route as Route & { draft?: string };
  const page = JSON.stringify(location);
  const dialog = !!target || inbox;
  const attempt = async (action: () => Promise<void>) => {
    if (saving.current) return;
    saving.current = true; setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (cause) { setError(String(cause).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, '')); }
    finally { saving.current = false; setBusy(false); }
  };
  useEffect(() => {
    if (!active) return;
    void attempt(async () => { setState(await api.uiFeedback()); });
  }, [active]);
  useEffect(() => {
    if (!active || dialog) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation();
        if (picking) { setPicking(false); setHover(null); }
        else onActiveChange(false);
        launcher.current?.querySelector('button')?.focus();
      } else if (picking && !(event.target as Element)?.closest('[data-ui-feedback]')) {
        // No task shortcuts or activation can run through the selection layer.
        if (event.key !== 'Tab') event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [active, dialog, picking, onActiveChange]);
  const choose = (value: FeedbackTarget) => { setTarget(value); setText(''); setPicking(false); setHover(null); setError(''); setNotice(''); };
  const hit = (x: number, y: number) => {
    const element = document.elementsFromPoint(x, y).find(element => !element.closest('[data-ui-feedback]') && element !== document.documentElement && element !== document.body);
    return element ? describeFeedbackTarget(feedbackElement(element), page) : null;
  };
  const closeDialog = () => { if (!saving.current) { setTarget(null); setInbox(false); setError(''); setText(''); } };
  const comments = state?.comments.filter(comment => !!comment.resolvedAt === showResolved) ?? [];
  return <>
    <div ref={launcher} className="ui-feedback-launcher" data-ui-feedback onKeyDown={event => event.stopPropagation()}>
      <Button variant="outline" size="sm" aria-pressed={active} onClick={() => {
        onActiveChange(!active); setPicking(!active); setHover(null); setNotice('');
      }}><MessageSquarePlus size={15} /> UI comments</Button>
    </div>
    {active && <>
      {picking && !dialog && <div data-ui-feedback className="ui-feedback-shield" aria-hidden="true"
        onPointerMove={event => setHover(hit(event.clientX, event.clientY))}
        onPointerLeave={() => setHover(null)}
        onPointerDown={event => { event.preventDefault(); event.stopPropagation(); }}
        onClick={event => { event.preventDefault(); const value = hit(event.clientX, event.clientY); if (value) choose(value); }} />}
      {picking && hover && <div data-ui-feedback className="ui-feedback-highlight" style={{ left: hover.bounds.x, top: hover.bounds.y, width: hover.bounds.width, height: hover.bounds.height }} />}
      <section data-ui-feedback className="ui-feedback-toolbar" aria-label="UI comment tools" onKeyDown={event => event.stopPropagation()}>
        <div><strong>UI comments</strong><p>{picking ? 'Click an element to leave a comment. Escape cancels selection.' : 'Browse the app, then select an element to comment.'}</p></div>
        <div className="ui-feedback-actions">
          <Button size="sm" variant={picking ? 'solid' : 'outline'} aria-pressed={picking} onClick={() => { setPicking(!picking); setHover(null); }}><MousePointer2 size={14} />{picking ? 'Stop selecting' : 'Select element'}</Button>
          <Button size="sm" variant="outline" onClick={() => choose(describeFeedbackTarget(document.querySelector<HTMLElement>('.ws-main') || document.body, page))}>Comment on page</Button>
          <Button size="sm" variant="outline" onClick={() => { setInbox(true); setPicking(false); void attempt(async () => setState(await api.uiFeedback())); }}>Comments{state ? ` (${state.comments.filter(comment => !comment.resolvedAt).length})` : ''}</Button>
          <Button size="sm" variant="ghost" aria-label="Exit UI comments" onClick={() => { onActiveChange(false); setPicking(false); setHover(null); launcher.current?.querySelector('button')?.focus(); }}><X size={16} /></Button>
        </div>
        {!dialog && error && <p role="alert" className="ui-feedback-error">{error}</p>}
        {!dialog && notice && <p role="status">{notice}</p>}
      </section>
    </>}
    <Dialog.Root open={dialog} onOpenChange={open => { if (!open) closeDialog(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="ui-feedback-overlay" data-ui-feedback />
        <Dialog.Content data-ui-feedback className="ui-feedback-dialog" onEscapeKeyDown={event => { if (saving.current) event.preventDefault(); }}
          onPointerDownOutside={event => event.preventDefault()} onCloseAutoFocus={event => { event.preventDefault(); launcher.current?.querySelector('button')?.focus(); }}>
          <Dialog.Title>{target ? 'Leave a UI comment' : 'UI comments'}</Dialog.Title>
          <Dialog.Description>{target ? 'Describe what you want to change. The page and element details are saved with your note.' : 'Saved on this computer for review with Codex. Copy the open comments into a chat when you are ready to work on them.'}</Dialog.Description>
          {target ? <form onSubmit={event => { event.preventDefault(); void attempt(async () => {
            setState(await api.addUiFeedback({ text, target })); setTarget(null); setText(''); setNotice('Comment saved. Select another element or open Comments to review.');
          }); }}>
            <div className="ui-feedback-target"><strong>{target.label}</strong><small>{target.page}</small></div>
            <label className="ws-field"><span>Your comment</span><textarea autoFocus rows={5} maxLength={5000} value={text} disabled={busy} onChange={event => setText(event.target.value)} placeholder="What should change here?" /></label>
            <div className="ui-feedback-actions"><Button type="button" variant="ghost" disabled={busy} onClick={closeDialog}>Cancel</Button><Button type="submit" disabled={busy || !text.trim()}>{busy ? 'Saving…' : 'Save comment'}</Button></div>
          </form> : <>
            <div className="ui-feedback-actions">
              <Button variant="outline" size="sm" aria-pressed={!showResolved} onClick={() => setShowResolved(false)}>Open</Button>
              <Button variant="outline" size="sm" aria-pressed={showResolved} onClick={() => setShowResolved(true)}>Resolved</Button>
              <Button size="sm" disabled={busy || !state?.comments.some(comment => !comment.resolvedAt)} onClick={() => void attempt(async () => { await api.copyUiFeedback(); setNotice('Open comments copied. Paste them into your Codex chat.'); })}>Copy for Codex</Button>
            </div>
            {busy && !state && <p role="status">Loading comments…</p>}
            {state && !comments.length && <p className="ui-feedback-empty">{showResolved ? 'No resolved comments yet.' : 'No open comments. Select an element or comment on the whole page.'}</p>}
            <div className="ui-feedback-list">{comments.map(comment => <article key={comment.id}>
              <p>{comment.text}</p><small>{comment.target.label} · {new Date(comment.createdAt).toLocaleString()}</small>
              <details><summary>Element details</summary><code>{comment.target.page}<br />{comment.target.selector}</code></details>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void attempt(async () => setState(await api.resolveUiFeedback(comment.id, !comment.resolvedAt)))}>{comment.resolvedAt ? 'Reopen' : 'Resolve'}</Button>
            </article>)}</div>
            {state && <p className="ui-feedback-path">Saved to <code>{state.path}</code></p>}
            <div className="ui-feedback-actions"><Button variant="ghost" disabled={busy} onClick={closeDialog}>Close</Button><Button variant="outline" disabled={busy} onClick={() => void attempt(async () => setState(await api.uiFeedback()))}>Refresh</Button></div>
          </>}
          {error && <p role="alert" className="ui-feedback-error">{error}</p>}
          {notice && <p role="status">{notice}</p>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </>;
}
