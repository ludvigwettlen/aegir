import { useEffect, useRef, useState } from 'react';
import { Check, ChevronRight, Copy, ExternalLink, Mail, MessageSquare } from 'lucide-react';
import type { Message, MessageDraft } from '../../../shared/types';
import { api, time, type Run } from './common';

// Edits save after this long without typing, and on blur.
const SAVE_AFTER_MS = 600;
const stateLabel: Record<MessageDraft['state'], string> = { pending: 'Draft', sent: 'Sent', discarded: 'Discarded', replaced: 'Replaced' };
const joined = (items?: string[]) => (items || []).filter(Boolean).join(', ');

// An email or Slack message the agent wrote for the user to send. Legolas sends nothing: the user edits the text
// here, copies it, sends it from Slack or Superhuman, and "I sent it" records that they did, with the text as it was.
export function DraftCard({ message, draft, agentName, run }: { message: Message; draft: MessageDraft; agentName?: string; run: Run }) {
  const editable = draft.state === 'pending';
  const [text, setText] = useState(draft.text);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
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
  // edit. Once the card leaves pending, the stored text is shown as is.
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
  const markSent = () => {
    const value = current();
    if (value.trim()) act(async () => { await api.markDraftSent(message.id, value); saved.current = value; });
  };

  const Icon = draft.channel === 'slack' ? MessageSquare : Mail;
  const shown = editable ? text : draft.text;
  const email = draft.email;
  const superhuman = email?.account && email.threadId ? `https://mail.superhuman.com/${email.account}/thread/${email.threadId}` : null;
  const name = draft.channel === 'slack' ? `Slack draft: ${draft.label}` : `Email draft: ${email?.subject || draft.label}`;
  // The agent's words for where it goes, then the raw facts to check them against.
  const destination = (check: boolean) => (
    <div className="ws-draft-to">
      {draft.label && <p className="ws-draft-label">{agentName ? `${agentName}'s draft for:` : 'Drafted for:'} <strong>{draft.label}</strong></p>}
      {draft.slack && <p className="ws-draft-facts"><code>{draft.slack.channelId}</code>{draft.slack.threadTs ? ' · in a thread' : ''}</p>}
      {email && (
        <dl className="ws-draft-rows">
          <div><dt>To</dt><dd>{joined(email.to) || <span className="ws-draft-none">No recipients</span>}</dd></div>
          {joined(email.cc) && <div><dt>Cc</dt><dd>{joined(email.cc)}</dd></div>}
          {joined(email.bcc) && <div><dt>Bcc</dt><dd>{joined(email.bcc)}</dd></div>}
          <div><dt>Subject</dt><dd>{email.subject || <span className="ws-draft-none">No subject</span>}</dd></div>
          {email.account && <div><dt>From</dt><dd>{email.account}</dd></div>}
        </dl>
      )}
      {check && <p className="ws-draft-check">Check where it goes before you send it.</p>}
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
            copy();
          }}
        />
      ) : (
        <div className="ws-draft-readonly">{draft.text}</div>
      )}
      {editable ? (
        <div className="ws-draft-actions">
          <button type="button" className="ws-btn primary" title="Copy the text (⌘↵)" disabled={!text.trim()} onClick={copy}>
            {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button type="button" className="ws-btn" title="Mark it sent once you have sent it yourself" disabled={busy || !text.trim()} onClick={markSent}>I sent it</button>
          <button type="button" className="ws-btn" disabled={busy} onClick={() => act(() => api.discardDraft(message.id))}>Discard</button>
          {superhuman && (
            <button type="button" className="ws-btn ghost ws-draft-open" onClick={() => void run(() => api.openExternal(superhuman))}>
              <ExternalLink size={13} aria-hidden="true" />Open in Superhuman
            </button>
          )}
          <span className="ws-draft-announce" role="status">{copied ? 'Copied the draft text.' : ''}</span>
        </div>
      ) : (
        <p className="ws-draft-status" role="status">{draft.sentAt ? `You sent it ${time(draft.sentAt)}` : 'You sent it'}</p>
      )}
    </article>
  );
}
