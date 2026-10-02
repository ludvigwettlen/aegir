import React from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@usefragments/ui';
import '../styles';
import type { AppEvent, DesktopApi, Message, Snapshot } from '../../../shared/types';

// Isolated visual fixture: no live account, filesystem, or application database access.
const timestamp = new Date().toISOString();
const long = new URLSearchParams(location.search).has('long');
const title = long ? 'Update the career framework for product managers across every product area and career stage with the team' : 'Update career framework for PMs';
const agents = ['Aegir', 'Mimer', 'Saga', 'Freja'].map((name, i) => ({ id: name, name, role: ['Lead', 'Research', 'Writing', 'Product'][i], color: ['#ede7fc', '#e0f1ed', '#fbeddc', '#f6e6eb'][i], instructions: '', createdAt: timestamp }));
const groups = [{ id: 'general', title: long ? 'Product strategy and professional development' : 'General', kind: 'group' as const, agentIds: agents.map(a => a.id), leadAgentId: 'Aegir', instructions: '', createdAt: timestamp }, ...agents.map(agent => ({ id: agent.id, title: agent.name, kind: 'private' as const, agentIds: [agent.id], leadAgentId: agent.id, instructions: '', createdAt: timestamp }))];
const thread = { id: 'thread', groupId: 'general', title, kind: 'task' as const, taskId: 'task', status: 'active' as const, createdAt: timestamp, updatedAt: timestamp, messageCount: 3, agentIds: ['Aegir'], busyAgentIds: [], snippet: 'The revised framework is ready to review.' };
const task = { id: 'task', title, notes: '', label: null, dueAt: null, status: 'review' as const, agentId: 'Aegir', threadId: 'thread', outputDir: '/mock', sourceUrl: null, sourceKey: null, createdAt: timestamp, updatedAt: timestamp, completedAt: null };
const snapshot = { agents, groups, threads: [thread], tasks: [task], taskLinks: [], routines: [], routineRuns: [], connectors: [], approvals: [], legacyMemoryCount: 0, memoryInstructions: '', codexStatus: 'Connected', launchAtLogin: false, browser: { status: 'off' }, mcpSettings: { slackClientId: '', slackConfigured: false } } as unknown as Snapshot;
const messages: Message[] = [
  { id: 'm1', threadId: thread.id, agentId: null, role: 'user', content: 'Let’s make the progression between PM levels clearer. We need a framework that describes scope and accountability.', status: 'complete', meta: null, createdAt: timestamp },
  { id: 'm2', threadId: thread.id, agentId: 'Aegir', role: 'agent', content: '**The central distinction is the scope of accountability.**\n\nThe framework should describe how a PM’s contribution changes as they take responsibility for a larger part of the product.\n\n- Own a problem and its outcome.\n- Shape a product area’s strategy.\n- Lead a cross-area mandate.\n\nI’ve prepared a [revised proposal](pm-level-boundaries-proposal.md) for us to review.\n\n| Level | Accountability |\n| --- | --- |\n| L2 | Own a problem and its outcome. |\n| L3 | Shape a product area’s strategy. |\n| L4 | Lead a cross-area mandate. |', status: 'complete', meta: null, createdAt: timestamp },
  { id: 'm3', threadId: thread.id, agentId: null, role: 'user', content: 'This sounds good. Let’s review the proposed anchors and refine the wording together.', status: 'complete', meta: null, createdAt: timestamp },
];
const markdown = '# PM level boundaries\n\nA proposal for clearer scope and accountability across the product career framework.\n\n## Diagnosis\n\nThe current framework distinguishes working within a roadmap, setting product-area direction and shaping cross-area direction. Make those scope transitions clear before deciding whether the bar itself needs to change.\n\n## Proposed anchors\n\n| Level | Core accountability | Strategy responsibility |\n| --- | --- | --- |\n| L2 — Mid | Own a meaningful problem and its outcome within an agreed direction. | Independently frame the problem and choose the approach. |\n| L3 — Senior | Own a product area’s direction and outcomes over time. | Decide which problems deserve investment and in what sequence. |\n| L4 — Staff | Lead a consequential cross-area product mandate. | Resolve competing priorities and establish a coherent direction. |\n\n## Review questions\n\n- Is each boundary observable in everyday work?\n- Can a PM explain the scope they own?\n- Are the decision rights clear?';
let saved = { path: 'pm-level-boundaries-proposal.md', content: markdown, revision: '1' };
const listeners = new Set<(event: AppEvent) => void>();
const actions = { copied: [] as string[], revealed: [] as { threadId: string; path: string }[], failCopy: false };
Object.assign(window, { fixtureActions: actions });
const fixture: Partial<DesktopApi> = {
  snapshot: async () => snapshot,
  onEvent: fn => { listeners.add(fn); return () => { listeners.delete(fn); }; },
  threadMessages: async () => ({ messages, before: null }),
  copyChatTranscript: async id => { if (actions.failCopy) throw new Error('Clipboard unavailable'); actions.copied.push(id); },
  showDocumentInFinder: async (threadId, path) => { actions.revealed.push({ threadId, path }); },
  listDocuments: async () => [saved.path],
  readDocument: async () => saved,
  saveDocument: async (_threadId, _path, _revision, content) => { saved = { ...saved, content, revision: String(Number(saved.revision) + 1) }; return saved; },
};
window.aegir = fixture as DesktopApi;
const { App } = await import('../App');
createRoot(document.getElementById('root')!).render(<ThemeProvider defaultMode="light"><App /></ThemeProvider>);
