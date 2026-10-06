import { useEffect, useRef, useState } from 'react';
import { Check, ChevronRight, Copy, ExternalLink, Mail, MessageSquare, Send, Undo2 } from 'lucide-react';
import type { Message, MessageDraft } from '../../../shared/types';
import { api, time, type Run } from './common';

// Edits save after this long without typing, and on blur.
const SAVE_AFTER_MS = 600;
// Matches UNDO_MS in electron/message-drafts.ts: Send waits this long before anything goes out.
const UNDO_MS = 5000;
const stateLabel: Record<MessageDraft['state'], string> = {
  checking: 'Checking', pending: 'Draft', queued: 'Sending soon', sending: 'Sending', sent: 'Sent',
  failed: 'Not sent', unknown: 'Check before resending', discarded: 'Discarded', replaced: 'Replaced',
};
const editableStates: MessageDraft['state'][] = ['checking', 'pending', 'failed', 'unknown'];
const joined = (items?: string[]) => (items || []).filter(Boolean).join(', ');

// An email or Slack message the agent wrote for the user to send. The user edits the text here and presses Send: after
// five seconds to undo, Legolas sends exactly this text to the destination Slack or Superhuman confirmed. Or they copy
// it, send it themselves, and say so. `canSend` is false on engines that can't send (Codex).
export function DraftCard({ message, draft, agentName, canSend, run }: { message: Message; draft: MessageDraft; agentName?: string; canSend: boolean; run: Run }) {
  const editable = editableStates.includes(draft.state);
  const [text, setText] = useState(draft.text);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const field = useRef<HTMLTextAreaElement>(null);
  const latest = useRef(draft.text); // what the field holds right now
  const saved = useRef<string | null>(draft.text); // the last text handed to the app; null after a failed save
  const saveTimer = useRef<number | undefined>(undefined);
  const saving = useRef(0);
  const focused = useRef(false);
  const acting = useRef(false);
  const copiedTimer = useRef<number | undefined>(undefined);
  const alive = useRef(true);

  const save = () => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = undefined;
    const value = latest.current;
    if (value === saved.current) return;
    saved.current = value;
    saving.current++;
    void run(async () => {
      try { await api.updateDraft(message.id, value); }
      catch (cause) { if (saved.current === value) saved.current = null; throw cause; }
      finally { saving.current--; }
    });
  };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      window.clearTimeout(copiedTimer.current);
      // Leaving the conversation during the pause still keeps the edit.
      if (saveTimer.current !== undefined) save();
    };
  }, []);
  // The stored text replaces the field only while it is idle: not focused, nothing waiting or in flight, no unsaved
  // edit. Once the card leaves an editable state, the stored text is shown as is.
  useEffect(() => {
    if (!editable) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = undefined;
      focused.current = false;
      return;
    }
    if (focused.current || saveTimer.current !== undefined || saving.current || latest.current !== saved.current) return;
    latest.current = draft.text;
    saved.current = draft.text;
    setText(draft.text);
  }, [draft.text, editable]);
  // The undo countdown.
  useEffect(() => {
    if (draft.state !== 'queued') return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [draft.state]);

  const edit = (value: string) => {
    latest.current = value;
    setText(value);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(save, SAVE_AFTER_MS);
  };
  // Reads the field itself, so the last keys typed before Cmd+Enter or a click are included.
  const current = () => field.current?.value ?? latest.current;
  const copy = () => {
    const value = current();
    if (!value.trim()) return;
    void run(async () => {
      try { await navigator.clipboard.writeText(value); }
      catch { throw new Error('Could not copy the draft. Try again.'); }
      if (!alive.current) return;
      setCopied(true);
      window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(false), 2000);
    });
  };
  const act = (action: () => Promise<unknown>) => {
    if (acting.current) return;
    acting.current = true;
    setBusy(true);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = undefined;
    void run(async () => {
      try { await action(); }
      finally { acting.current = false; if (alive.current) setBusy(false); }
    });
  };
  const withText = (send: (value: string) => Promise<unknown>) => {
    const value = current();
    if (value.trim()) act(async () => { await send(value); saved.current = value; latest.current = value; });
  };

  const Icon = draft.channel === 'slack' ? MessageSquare : Mail;
  const shown = editable ? text : draft.text;
  const email = draft.email;
  const slack = draft.slack;
  const where = draft.channel === 'email' ? 'Superhuman' : 'Slack';
  const superhuman = email?.account && email.threadId ? `https://mail.superhuman.com/${email.account}/thread/${email.threadId}` : null;
  // Send needs the destination confirmed by the connector itself; while that check runs, Send shows but waits.
  const confirmed = draft.channel === 'slack' ? !!slack?.name : !!(email?.confirmed && email.draftId && email.threadId && email.type);
  const showSend = canSend && (confirmed || draft.state === 'checking');
  const sendReady = showSend && confirmed && (draft.state === 'pending' || draft.state === 'failed' || draft.state === 'unknown');
  const seconds = draft.queuedAt ? Math.max(0, Math.ceil((Date.parse(draft.queuedAt) + UNDO_MS - now) / 1000)) : 0;
  const name = draft.channel === 'slack' ? `Slack draft: ${slack?.name || draft.label}` : `Email draft: ${email?.subject || draft.label}`;

  // The agent's words for where it goes, then what Slack or Superhuman confirm.
  const destination = (live: boolean) => (
    <div className="ws-draft-to">
      {draft.label && <p className="ws-draft-label">{agentName ? `${agentName}'s draft for:` : 'Drafted for:'} <strong>{draft.label}</strong></p>}
      {slack && (
        <p className="ws-draft-facts">
          {slack.name && <span className="ws-draft-confirmed">Slack: {slack.channelId.startsWith('C') || slack.channelId.startsWith('G') ? `#${slack.name}` : `DM to ${slack.name}`} · </span>}
          <code>{slack.channelId}</code>{slack.threadTs ? ' · in a thread' : ''}
        </p>
      )}
      {email && (
        <dl className="ws-draft-rows">
          <div><dt>To</dt><dd>{joined(email.to) || <span className="ws-draft-none">No recipients</span>}</dd></div>
          {joined(email.cc) && <div><dt>Cc</dt><dd>{joined(email.cc)}</dd></div>}
          {joined(email.bcc) && <div><dt>Bcc</dt><dd>{joined(email.bcc)}</dd></div>}
          <div><dt>Subject</dt><dd>{email.subject || <span className="ws-draft-none">No subject</span>}</dd></div>
          {email.account && <div><dt>From</dt><dd>{email.account}</dd></div>}
        </dl>
      )}
      {live && (draft.state === 'checking'
        ? <p className="ws-draft-check" role="status">Checking where it goes with {where}…</p>
        : slack?.name === null
          ? <p className="ws-draft-warning">Couldn't confirm where this goes{draft.error ? `: ${draft.error}` : ''}. Legolas won't send it; copy it instead.</p>
          : email?.draftId && !email.confirmed && draft.error
            ? <p className="ws-draft-warning">{draft.error}. Legolas won't send it; copy it or open it in Superhuman.</p>
            : email && !email.draftId
              ? <p className="ws-draft-check">Not in Superhuman yet, so Legolas can't send it. Copy it, or ask Claude to put it there.</p>
              : confirmed
                ? (email && <p className="ws-draft-check">As Superhuman holds it.</p>)
                : <p className="ws-draft-check">Check where it goes before you send it.</p>)}
    </div>
  );

  if (draft.state === 'discarded' || draft.state === 'replaced')
    return (
      <article className="ws-draft folded" aria-label={name}>
        <details className="ws-draft-fold">
          <summary>
            <ChevronRight size={13} aria-hidden="true" />
            <Icon size={13} aria-hidden="true" />
            <span className="ws-draft-fold-text">
              {draft.state === 'discarded' ? 'Discarded draft' : 'Replaced by a newer draft'}
              {draft.label && <span className="ws-draft-fold-label"> · {draft.label}</span>}
            </span>
          </summary>
          <div className="ws-draft-fold-body">
            {destination(false)}
            <div className="ws-draft-readonly">{draft.text}</div>
          </div>
        </details>
      </article>
    );
  return (
    <article className={`ws-draft ${draft.state}`} aria-label={name}>
      <header className="ws-draft-head">
        <Icon size={14} aria-hidden="true" />
        <span className="ws-draft-kind">{draft.channel === 'slack' ? 'Slack message' : 'Email'}</span>
        {shown !== draft.original && <span className="ws-draft-edited">Edited</span>}
        <span className={`ws-draft-state ${draft.state}`}>{stateLabel[draft.state] || draft.state}</span>
      </header>
      {destination(editable)}
      {editable ? (
        <textarea
          ref={field}
          className="ws-draft-text"
          aria-label="Draft text"
          placeholder="Write the message"
          value={text}
          readOnly={busy}
          onChange={(event) => edit(event.target.value)}
          onFocus={() => { focused.current = true; }}
          onBlur={() => {
            focused.current = false;
            if (saveTimer.current !== undefined || latest.current !== saved.current) save();
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey) || event.nativeEvent.isComposing) return;
            event.preventDefault();
            if (showSend) { if (sendReady && !busy) withText((value) => api.sendDraft(message.id, value)); }
            else copy();
          }}
        />
      ) : (
        <div className="ws-draft-readonly">{draft.text}</div>
      )}
      {draft.state === 'failed' && draft.error && <p className="ws-draft-error" role="alert">{draft.error}</p>}
      {draft.state === 'unknown' && (
        <p className="ws-draft-warning" role="alert">Legolas lost track of this send. Check {where} before sending again.{draft.error ? ` ${draft.error}` : ''}</p>
      )}
      {editable ? (
        <div className="ws-draft-actions">
          {showSend ? <>
            <button type="button" className="ws-btn primary" disabled={!sendReady || busy || !text.trim()}
              title={sendReady ? `Send it now from ${where}, with five seconds to undo (⌘↵)` : `Waiting for ${where} to confirm where it goes`}
              onClick={() => withText((value) => api.sendDraft(message.id, value))}>
              <Send size={13} aria-hidden="true" />{draft.state === 'failed' || draft.state === 'unknown' ? 'Send again' : 'Send'}
            </button>
            <button type="button" className="ws-btn" title="Copy the text" disabled={!text.trim()} onClick={copy}>
              {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button type="button" className="ws-btn" disabled={busy} onClick={() => act(() => api.discardDraft(message.id))}>Discard</button>
            <button type="button" className="ws-btn ghost ws-draft-open" title="Mark it sent once you have sent it yourself" disabled={busy || !text.trim()}
              onClick={() => withText((value) => api.markDraftSent(message.id, value))}>I sent it myself</button>
          </> : <>
            <button type="button" className="ws-btn primary" title="Copy the text (⌘↵)" disabled={!text.trim()} onClick={copy}>
              {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button type="button" className="ws-btn" title="Mark it sent once you have sent it yourself" disabled={busy || !text.trim()}
              onClick={() => withText((value) => api.markDraftSent(message.id, value))}>I sent it</button>
            <button type="button" className="ws-btn" disabled={busy} onClick={() => act(() => api.discardDraft(message.id))}>Discard</button>
          </>}
          {superhuman && (
            <button type="button" className="ws-btn ghost ws-draft-open" onClick={() => void run(() => api.openExternal(superhuman))}>
              <ExternalLink size={13} aria-hidden="true" />Open in Superhuman
            </button>
          )}
          <span className="ws-draft-announce" role="status">{copied ? 'Copied the draft text.' : ''}</span>
        </div>
      ) : draft.state === 'queued' ? (
        <div className="ws-draft-actions">
          <p className="ws-draft-status" role="status">{seconds > 0 ? `Sending in ${seconds} s` : 'Sending…'}</p>
          <button type="button" className="ws-btn" disabled={busy || seconds === 0} onClick={() => act(() => api.undoDraftSend(message.id))}>
            <Undo2 size={13} aria-hidden="true" />Undo
          </button>
        </div>
      ) : draft.state === 'sending' ? (
        <p className="ws-draft-status" role="status">Sending…</p>
      ) : (
        <div className="ws-draft-actions">
          <p className="ws-draft-status" role="status">
            {draft.sentBy === 'legolas' ? `Sent from Legolas${draft.sentAt ? ` ${time(draft.sentAt)}` : ''}` : `You sent it${draft.sentAt ? ` ${time(draft.sentAt)}` : ''}`}
          </p>
          {draft.link && (
            <button type="button" className="ws-btn ghost ws-draft-open" onClick={() => void run(() => api.openExternal(draft.link!))}>
              <ExternalLink size={13} aria-hidden="true" />Open in {where}
            </button>
          )}
          {draft.sentBy !== 'legolas' && (
            <button type="button" className="ws-btn ghost ws-draft-open" disabled={busy} title="Didn't send it after all? Reopen the draft"
              onClick={() => act(() => api.reopenDraft(message.id))}>Reopen</button>
          )}
        </div>
      )}
    </article>
  );
}
