import { useCallback, useEffect, useRef, useState } from 'react';
import type { MessageMeta } from '../../../shared/types';
import type { SkillDetail, SkillFile } from '../../../shared/skills';
import { Button } from '../design-system/primitives';
import { PackageDiff } from '../design-system/PackageDiff';
import { api } from './common';

export function SkillChangeCard({ meta, reason }: { meta: Extract<MessageMeta, { type: 'skill-change' }>; reason: string }) {
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [before, setBefore] = useState<SkillFile[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const request = useRef(0);
  const active = useRef(false);
  const reload = useCallback(async () => {
    const version = ++request.current;
    try {
      const value = await api.skillDetail(meta.skillId);
      if (active.current && version === request.current) { setDetail(value); setError(''); }
    } catch (cause) {
      if (active.current && version === request.current) { setDetail(null); setError(String(cause)); }
    }
  }, [meta.skillId]);
  useEffect(() => {
    active.current = true;
    void reload();
    const unsubscribe = api.onEvent(event => { if (event.type === 'skills-changed') void reload(); });
    return () => { active.current = false; request.current++; unsubscribe(); };
  }, [reload]);
  const proposal = detail?.proposals.find(p => p.id === meta.proposalId);
  const stale = !!proposal && proposal.baseRevision !== detail?.skill.revision;
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await action(); }
    catch (cause) { if (active.current) setError(String(cause)); }
    finally { if (active.current) setBusy(false); }
  };
  return <section className="ws-change ws-skill-change" aria-label={`Skill revision: ${meta.skillName}`}>
    <div className="ws-change-title">Skill revision · {meta.skillName}</div>
    <p>{reason}</p>
    {error && <p role="alert">{error} <Button size="sm" variant="ghost" disabled={busy} onClick={() => void reload()}>Retry</Button></p>}
    {!detail && !error && <p role="status">Loading proposal…</p>}
    {detail && !proposal && <p role="alert">This proposal could not be found. Check Settings → Manage skills.</p>}
    {proposal && <>
      <span className="ws-change-state" role="status">{proposal.state === 'pending' ? 'Pending approval' : proposal.state === 'applied' ? 'Applied' : 'Discarded'}</span>
      <div className="ws-row-actions">
        <Button size="sm" variant="outline" disabled={busy} aria-expanded={reviewing} onClick={() => {
          if (reviewing) { setReviewing(false); return; }
          void act(async () => {
            const files = await api.skillRevisionFiles(meta.skillId, proposal.baseRevision);
            if (active.current) { setBefore(files); setReviewing(true); }
          });
        }}>{reviewing ? 'Hide changes' : 'Review changes'}</Button>
        {proposal.state === 'pending' && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act(async () => { await api.resolveSkillProposal(proposal.id, false); await reload(); })}>Discard</Button>}
      </div>
      {reviewing && before && <div className="ws-skill-review">
        <PackageDiff before={before} after={proposal.files} />
        {proposal.state === 'pending' && (stale
          ? <p role="alert">The skill has changed since this proposal. Merge it with the current revision in Settings → Manage skills.</p>
          : <Button size="sm" disabled={busy} onClick={() => void act(async () => { await api.resolveSkillProposal(proposal.id, true); await reload(); })}>Apply revision</Button>)}
      </div>}
    </>}
  </section>;
}
