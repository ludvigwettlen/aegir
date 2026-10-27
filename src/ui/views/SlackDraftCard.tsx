import { DraftCard, DraftActions } from './DraftCard';
import { useEffect, useState } from 'react';
import type { SlackDraft, SlackTarget, SlackTargets } from '../../../shared/slack-messages';
import { slackFooter } from '../../../shared/slack-messages';
import { Button } from '../design-system/primitives';
import { api } from './common';
export function SlackDraftCard({ id, draft }: { id: string; draft: SlackDraft }) {
  const [saved, setSaved] = useState(draft);
  const [text, setText] = useState(() => {
    if (draft.state !== 'draft') return draft.text;
    try { return localStorage.getItem(`slack-draft:${id}:${draft.revision}`) ?? draft.text; } catch { return draft.text; }
  });
  const [includeFooter, setIncludeFooter] = useState(() => {
    if (draft.state !== 'draft') return draft.includeFooter;
    try {
      const recovered = localStorage.getItem(`slack-draft:${id}:${draft.revision}:footer`);
      return recovered === null ? draft.includeFooter : recovered === 'true';
    } catch { return draft.includeFooter; }
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [choosing, setChoosing] = useState(false);
  const dirty = text !== saved.text || includeFooter !== saved.includeFooter;
  const conflict = draft.revision !== saved.revision && dirty && !pending;
  useEffect(() => {
    if (draft.revision !== saved.revision && dirty && !pending) { setError('This draft changed elsewhere. Your edits have been kept.'); return; }
    setSaved(draft); if (!dirty) { setText(draft.text); setIncludeFooter(draft.includeFooter); }
  }, [draft]);
  const edit = (value: string) => {
    setText(value);
    try { localStorage.setItem(`slack-draft:${id}:${saved.revision}`, value); } catch { setError('Local recovery is unavailable. Use Save draft to keep your edits.'); }
  };
  const toggleFooter = (value: boolean) => {
    setIncludeFooter(value);
    try { localStorage.setItem(`slack-draft:${id}:${saved.revision}:footer`, String(value)); } catch { setError('Local recovery is unavailable. Use Save draft to keep your edits.'); }
  };
  const clearRecovery = () => {
    localStorage.removeItem(`slack-draft:${id}:${saved.revision}`);
    localStorage.removeItem(`slack-draft:${id}:${saved.revision}:footer`);
  };
  const action = async (send: boolean, destination = saved.destination, threadTs = saved.threadTs, manual = false) => {
    setPending(true); setError('');
    try {
      const fields = { destination, threadTs, text, includeFooter };
      const next = dirty || saved.error || destination !== saved.destination || threadTs !== saved.threadTs
        ? await api.updateSlackDraft(id, saved.revision, fields) : saved;
      clearRecovery(); setSaved(next); setChoosing(false);
      if (manual) setSaved(await api.markSlackDraftSent(id, next.revision));
      else if (send) {
        // A renamed recipient or edited parent message must be seen before a fresh Send click.
        if (next.destinationName !== saved.destinationName || next.threadPreview !== saved.threadPreview) throw new Error('The Slack destination or thread changed. Review the updated details and click Send again.');
        await api.sendSlackDraft(id, next.revision, fields);
      }
    } catch (cause) { setError(String(cause)); }
    finally { setPending(false); }
  };
  const locked = pending || saved.state !== 'draft' || conflict;
  return <DraftCard label="Slack draft" title={saved.state === 'sent' || saved.state === 'sent-manually' ? 'Slack message sent' : 'Slack draft'} context={`${saved.workspace} · from ${saved.sender}`}>
    <div className="slack-destination"><div><span>To</span><strong>{saved.destinationName}</strong></div>
      {saved.state === 'draft' && <Button variant="ghost" size="sm" disabled={locked} onClick={() => setChoosing(!choosing)}>{choosing ? 'Cancel recipient change' : 'Change recipient'}</Button>}</div>
    {choosing && <SlackRecipientPicker draftId={id} disabled={locked} onChoose={target => void action(false, target.id, '')} />}
    {saved.threadTs && <div className="slack-thread-context"><strong>Reply in thread</strong><blockquote>{saved.threadPreview}</blockquote>
      {saved.state === 'draft' && <Button variant="ghost" size="sm" disabled={locked} onClick={() => void action(false, saved.destination, '')}>Send as a new message instead</Button>}</div>}
    <label>Message<textarea aria-label="Slack message" rows={8} value={text} disabled={locked} maxLength={40000} onChange={event => edit(event.target.value)} /></label>
    <label className="slack-footer-choice"><input type="checkbox" checked={includeFooter} disabled={locked} onChange={event => toggleFooter(event.target.checked)} />Include “{slackFooter}” footer</label>
    {includeFooter && <p className="slack-footer-preview" aria-label="Message footer">{slackFooter}</p>}
    <p role="status">{saved.state === 'draft' ? dirty ? 'Unsaved edits · local recovery enabled' : 'Saved in Aegir' : ({ queued: '', 'sent-manually': '', sending: 'Sending…', sent: 'Slack confirmed sending.', uncertain: 'Delivery is unconfirmed. Check Slack before composing another message.' })[saved.state]}</p>
    {(error || saved.error) && <p role="alert">{error || saved.error}</p>}
    {conflict && <Button variant="outline" size="sm" onClick={() => {
      clearRecovery(); setSaved(draft); setText(draft.text); setIncludeFooter(draft.includeFooter); setError('');
    }}>Discard local edits and reload</Button>}
    <DraftActions state={saved.state} queuedUntil={saved.queuedUntil} locked={locked || choosing} saveDisabled={!dirty && !saved.error}
      sendDisabled={!text.trim()} onSave={() => void action(false)} onSend={() => void action(true)}
      onManual={() => void action(false, saved.destination, saved.threadTs, true)}
      onUndo={() => { setError(''); void api.cancelSlackDraft(id, saved.revision).then(setSaved).catch(cause => setError(String(cause))); }} />
  </DraftCard>;
}
function SlackRecipientPicker({ draftId, disabled, onChoose }: { draftId: string; disabled: boolean; onChoose: (target: SlackTarget) => void }) {
  const [kind, setKind] = useState<'people' | 'channels'>('people');
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<SlackTargets | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const search = async (more = false) => {
    setPending(true); setError('');
    try {
      const next = await api.findSlackTargets(kind, query, more ? result?.nextCursor : undefined, draftId);
      setResult({ targets: more ? [...(result?.targets || []), ...next.targets] : next.targets, nextCursor: next.nextCursor });
    } catch (cause) { setError(String(cause)); } finally { setPending(false); }
  };
  return <div className="slack-recipient-picker" aria-label="Choose Slack recipient">
    <label>Destination type<select value={kind} disabled={disabled || pending} onChange={event => { setKind(event.target.value as typeof kind); setResult(null); }}><option value="people">People</option><option value="channels">Channels</option></select></label>
    <label>Search Slack<input aria-label="Search Slack" value={query} disabled={disabled || pending} onChange={event => { setQuery(event.target.value); setResult(null); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void search(); } }} /></label>
    <Button variant="outline" size="sm" disabled={disabled || pending} onClick={() => void search()}>{pending ? 'Searching…' : 'Search'}</Button>
    {result && !result.targets.length && <p role="status">{result.nextCursor ? 'No matches on these pages. Continue searching below.' : 'No matching people or channels.'}</p>}
    <div className="slack-recipient-results">{result?.targets.map(target => <Button key={target.id} variant="ghost" size="sm" disabled={disabled || pending} onClick={() => onChoose(target)}>{target.name}{target.detail ? ` · ${target.detail}` : ''}</Button>)}</div>
    {result?.nextCursor && <Button variant="outline" size="sm" disabled={disabled || pending} onClick={() => void search(true)}>More results</Button>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
