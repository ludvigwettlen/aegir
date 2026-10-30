import React from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@usefragments/ui';
import '../styles';
import type { AppEvent, DesktopApi, Message, Snapshot, Thread, Group } from '../../../shared/types';
import type { SkillDetail } from '../../../shared/skills';

const listeners = new Set<(event: AppEvent) => void>();
const before = [{ path: 'SKILL.md', encoding: 'utf8' as const, content: '# Follow-ups\n\nExtract commitments.' }];
const detail = {
  skill: { id: 'skill', name: 'follow-up-extraction', revision: 'base' },
  proposals: [{ id: 'proposal', skillId: 'skill', baseRevision: 'base', state: 'pending', reason: 'Require source-backed ownership.', files: [{ ...before[0], content: '# Follow-ups\n\nRequire ownership, a concrete action, open status, and no duplicates.\n\n' + 'Source-backed evidence. '.repeat(120) }] }],
} as SkillDetail;
let fail = false;
let delay = false;
const emit = () => listeners.forEach(listener => listener({ type: 'skills-changed' }));
Object.assign(window, { proposalFixture: {
  state: (state: 'pending' | 'applied' | 'discarded') => { detail.proposals[0].state = state; emit(); },
  stale: () => { detail.skill.revision = 'changed'; emit(); },
  fail: (value: boolean) => { fail = value; emit(); },
  delay: (value: boolean) => { delay = value; emit(); },
  missing: () => { detail.proposals = []; emit(); },
} });
const thread = { id: 'thread', title: 'Improve follow-up proposals', kind: 'chat' } as Thread;
const group = { id: 'group', title: 'Team', kind: 'group', agentIds: [] } as unknown as Group;
const message: Message = { id: 'card', threadId: thread.id, agentId: null, role: 'system', content: 'Require source-backed ownership. Only propose concrete, open and distinct personal actions.', status: 'complete', createdAt: new Date().toISOString(), meta: { type: 'skill-change', skillId: 'skill', skillName: 'follow-up-extraction', proposalId: 'proposal' } };
const mockApi: Pick<DesktopApi, 'onEvent' | 'listDocuments' | 'threadMessages' | 'skillDetail' | 'skillRevisionFiles' | 'resolveSkillProposal'> = {
  onEvent: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  listDocuments: async () => [],
  threadMessages: async () => ({ messages: [message], before: null }),
  skillDetail: async () => { if (delay) await new Promise(resolve => setTimeout(resolve, 800)); if (fail) throw new Error('Could not load proposal'); return structuredClone(detail); },
  skillRevisionFiles: async () => before,
  resolveSkillProposal: async (_id, apply) => { if (detail.skill.revision !== 'base' && apply) throw new Error('Skill changed'); detail.proposals[0].state = apply ? 'applied' : 'discarded'; emit(); },
};
window.aegir = mockApi as DesktopApi;
const { ThreadView } = await import('../views/ThreadView');
const compact = new URLSearchParams(location.search).has('compact');
const run = async (fn: () => Promise<unknown>) => { await fn(); };
createRoot(document.getElementById('root')!).render(<ThemeProvider defaultMode="light"><div className="workspace" style={{ display: 'flex', width: compact ? 440 : 760, height: 760, margin: '20px auto' }}><ThreadView data={{ agents: [], routines: [], threads: [] } as unknown as Snapshot} thread={thread} compact={compact} run={run} header={<h2>Improve follow-ups</h2>} /></div></ThemeProvider>);
