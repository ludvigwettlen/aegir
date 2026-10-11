import React from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@usefragments/ui';
import '../styles';
import type { DesktopApi, Snapshot } from '../../../shared/types';
import type { Skill } from '../../../shared/skills';
const now = new Date().toISOString();
const skill = { id: '11111111-1111-4111-8111-111111111111', name: 'research', description: 'Compare evidence from several sources.', enabled: true, archived: false, error: null, ownerAgentId: null, enabledAgentIds: null, disabledAgentIds: [] } as unknown as Skill;
const data = {
  agents: [{ id: 'lead', name: 'Aegir', role: 'Lead', color: '#abc', createdAt: now }, { id: 'writer', name: 'Saga', role: 'Writer', color: '#abc', createdAt: now }],
  groups: [{ id: 'team', title: 'Team', kind: 'group', leadAgentId: 'lead', agentIds: ['lead', 'writer'] }],
  threads: [{ id: 'task-thread', groupId: 'team', title: 'Research brief', kind: 'task', taskId: 'task', status: 'closed', agentIds: ['lead'], busyAgentIds: [], snippet: 'Existing conversation', messageCount: 1, createdAt: now, updatedAt: now }],
  tasks: [{ id: 'task', title: 'Research brief', notes: '', status: 'review', threadId: 'task-thread', dueAt: null, label: null, createdAt: now }],
  taskLists: [], taskLinks: [], routines: [], approvals: [], connectors: [], routineRuns: [],
} as unknown as Snapshot;
const params = new URLSearchParams(location.search);
const fixture = { sent: [] as string[], fail: false, failSkills: params.has('failSkills'), skillDelay: params.has('loading') ? 2000 : 0 };
Object.assign(window, { fixture });
window.aegir = {
  snapshot: async () => data,
  onEvent: () => () => {},
  threadMessages: async () => ({ messages: [{ id: 'message', threadId: 'task-thread', role: 'user', content: 'Existing conversation', status: 'complete', createdAt: now }, { id: 'reply', threadId: 'task-thread', role: 'agent', agentId: 'lead', content: 'I will compare the options and prepare a short brief.', status: 'complete', createdAt: now }], before: null }),
  skillLibrary: async () => {
    if (fixture.skillDelay) await new Promise(resolve => setTimeout(resolve, fixture.skillDelay));
    if (fixture.failSkills) throw new Error('Could not load skills');
    return { skills: [skill, { ...skill, id: '22222222-2222-4222-8222-222222222222', name: 'writing', ownerAgentId: 'writer' }], proposals: [], routineBindings: {} };
  },
  sendMessage: async (_id: string, text: string) => { if (fixture.fail) throw new Error('Send failed'); fixture.sent.push(text); },
} as unknown as DesktopApi;
const { App } = await import('../App');
createRoot(document.getElementById('root')!).render(<ThemeProvider defaultMode="light"><App /></ThemeProvider>);
