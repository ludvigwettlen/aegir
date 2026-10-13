import { useEffect, useState } from 'react';
import type { EmailDraft, EmailFields } from '../../../shared/gmail';
import { Button } from '../design-system/primitives';
import { api } from './common';
const fieldsOf = ({ to, cc, bcc, subject, body }: EmailFields): EmailFields => ({ to, cc, bcc, subject, body });
export function EmailDraftCard({ id, draft }: { id: string; draft: EmailDraft }) {
  const [fields, setFields] = useState<EmailFields>(() => {
    if (draft.state !== 'draft') return fieldsOf(draft);
    try {
      const value = JSON.parse(localStorage.getItem(`email-draft:${id}:${draft.revision}`) || 'null');
      return value && ['to', 'cc', 'bcc', 'subject', 'body'].every(key => typeof value[key] === 'string') ? fieldsOf(value) : fieldsOf(draft);
    } catch { return fieldsOf(draft); }
  });
  const [saved, setSaved] = useState(draft);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const dirty = JSON.stringify(fields) !== JSON.stringify(fieldsOf(saved));
  useEffect(() => {
    if (draft.revision !== saved.revision && dirty && !pending) { setError('This draft changed elsewhere. Copy your edits before reopening the latest version.'); return; }
    setSaved(draft);
    if (!dirty) setFields(fieldsOf(draft));
  }, [draft]);
  const edit = (key: keyof EmailFields, value: string) => {
    const next = { ...fields, [key]: value }; setFields(next);
    try { localStorage.setItem(`email-draft:${id}:${saved.revision}`, JSON.stringify(next)); } catch { setError('Local recovery is unavailable. Use Save draft to keep your edits.'); }
  };
  const action = async (send: boolean) => {
    setPending(true); setError('');
    try {
      const next = dirty ? await api.updateEmailDraft(id, saved.revision, fields) : saved;
      localStorage.removeItem(`email-draft:${id}:${saved.revision}`); setSaved(next);
      if (send) await api.sendEmailDraft(id, next.revision, fields);
    } catch (cause) { setError(String(cause)); }
    finally { setPending(false); }
  };
  const conflict = draft.revision !== saved.revision && dirty && !pending;
  const locked = pending || saved.state !== 'draft' || conflict;
  return <section className="email-draft-card" aria-label="Email draft">
    <header><strong>{saved.state === 'sent' ? 'Email sent' : 'Email draft'}</strong><span>From {saved.email}</span></header>
    {saved.replyThreadId && <p>Reply to the original Gmail thread. Changing the subject starts a new conversation.</p>}
    <fieldset disabled={locked}>
      {(['to', 'cc', 'bcc', 'subject'] as const).map(key => <label key={key}>{({ to: 'To', cc: 'Cc', bcc: 'Bcc', subject: 'Subject' })[key]}
        <input value={fields[key]} onChange={event => edit(key, event.target.value)} placeholder={key === 'to' ? 'name@example.com' : undefined} /></label>)}
      <label>Message<textarea aria-label="Message" rows={9} value={fields.body} onChange={event => edit('body', event.target.value)} /></label>
    </fieldset>
    <p role="status">{saved.state === 'draft' ? (dirty ? 'Unsaved edits · local recovery enabled' : 'Saved in Aegir · clicking Send approves this email') : ({ 'awaiting-approval': 'This older approval is pending. Reopen Aegir to return it to a draft.', sending: 'Sending…', sent: 'Gmail confirmed sending.', uncertain: 'Delivery is unconfirmed. Check Gmail Sent before composing another email.' })[saved.state]}</p>
    {(error || saved.error) && <p role="alert">{error || saved.error}</p>}
    {conflict && <Button variant="outline" size="sm" onClick={() => {
      localStorage.removeItem(`email-draft:${id}:${saved.revision}`); setFields(fieldsOf(draft)); setSaved(draft); setError('');
    }}>Discard local edits and reload</Button>}
    {saved.state === 'draft' && <p>Clicking Send approves and sends this exact email. No additional confirmation.</p>}
    {saved.state === 'draft' && <footer><Button variant="outline" size="sm" disabled={locked || !dirty} onClick={() => void action(false)}>Save draft</Button>
      <Button size="sm" disabled={locked || !fields.to.trim() || !fields.subject.trim() || !fields.body.trim()} onClick={() => void action(true)}>{pending ? 'Working…' : 'Send'}</Button></footer>}
  </section>;
}
