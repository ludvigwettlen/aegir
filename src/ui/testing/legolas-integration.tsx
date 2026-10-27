import { defaultTypography } from '../../../shared/typography';
import { encodeComment, commentStart, commentEnd } from '../../../shared/document-comments';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@usefragments/ui';
import '../styles';
import type { AppEvent, DesktopApi, Message, Snapshot, Task } from '../../../shared/types';

// Isolated visual fixture: no live account, filesystem, or application database access.
const timestamp = new Date().toISOString();
const long = new URLSearchParams(location.search).has('long');
const title = long ? 'Update the career framework for product managers across every product area and career stage with the team' : 'Update career framework for PMs';
const agents = ['Aegir', 'Mimer', 'Saga', 'Freja'].map((name, i) => ({ id: name, name, role: ['Lead', 'Research', 'Writing', 'Product'][i], color: ['#ede7fc', '#e0f1ed', '#fbeddc', '#f6e6eb'][i], instructions: '', createdAt: timestamp }));
const groups = [{ id: 'general', title: long ? 'Product strategy and professional development' : 'General', kind: 'group' as const, agentIds: agents.map(a => a.id), leadAgentId: 'Aegir', instructions: '', createdAt: timestamp }, ...agents.map(agent => ({ id: agent.id, title: agent.name, kind: 'private' as const, agentIds: [agent.id], leadAgentId: agent.id, instructions: '', createdAt: timestamp }))];
const thread = { id: 'thread', groupId: 'general', title, kind: 'task' as const, taskId: 'task', status: 'active' as const, createdAt: timestamp, updatedAt: timestamp, messageCount: 3, agentIds: ['Aegir'], busyAgentIds: [], snippet: 'The revised framework is ready to review.' };
const task = { id: 'task', title, notes: new URLSearchParams(location.search).has('notes') ? 'Revamp candidate — become the destination? Source jobs for a candidate.\n\nPLG / self-serve\nBYO-agent on top of an ATS?\nVolume screening / external sourcing' : '', label: null, dueAt: null, status: 'review' as const, agentId: 'Aegir', threadId: 'thread', outputDir: '/mock', sourceUrl: null, sourceKey: null, createdAt: timestamp, updatedAt: timestamp, completedAt: null };
const snapshot = { showTaskPriorities: localStorage.getItem('fixtureShowTaskPriorities') !== 'false', agents, groups, threads: [thread], tasks: [task], taskLists: [], taskLinks: [], routines: [], routineRuns: [], connectors: [{ id: 'slack', status: 'disconnected', detail: '' }, { id: 'notion', status: 'disconnected', detail: '' }], typography: defaultTypography, browserReviewEnabled: false, approvals: [], legacyMemoryCount: 0, memoryInstructions: '', codexStatus: 'Connected', launchAtLogin: false, browser: { status: 'off' }, mcpSettings: { slackClientId: '', slackConfigured: false } } as unknown as Snapshot;
snapshot.taskViews = JSON.parse(localStorage.getItem('fixtureTaskViews') || '[]');
if (new URLSearchParams(location.search).has('brainFiling')) snapshot.brainBridge = { importEnabled: false, importDir: '', exportEnabled: false, exportDir: '', filingEnabled: true, filingDir: '/mock/brain/files', externalSetup: false, paused: false, lastRunAt: null, error: '', report: null };
if (new URLSearchParams(location.search).has('personal')) {
  Object.assign(task, { status: 'ready', threadId: null, agentId: null, outputDir: null });
  snapshot.threads = [];
}
const messages: Message[] = [
  { id: 'm1', threadId: thread.id, agentId: null, role: 'user', content: 'Let’s make the progression between PM levels clearer. We need a framework that describes scope and accountability.', status: 'complete', meta: null, createdAt: timestamp },
  { id: 'm2', threadId: thread.id, agentId: 'Aegir', role: 'agent', content: '**The central distinction is the scope of accountability.**\n\nThe framework should describe how a PM’s contribution changes as they take responsibility for a larger part of the product.\n\n- Own a problem and its outcome.\n- Shape a product area’s strategy.\n- Lead a cross-area mandate.\n\nI’ve prepared a [revised proposal](pm-level-boundaries-proposal.md) for us to review.\n\n| Level | Accountability |\n| --- | --- |\n| L2 | Own a problem and its outcome. |\n| L3 | Shape a product area’s strategy. |\n| L4 | Lead a cross-area mandate. |', status: 'complete', meta: null, createdAt: timestamp },
  { id: 'm3', threadId: thread.id, agentId: null, role: 'user', content: 'This sounds good. Let’s review the proposed anchors and refine the wording together.', status: 'complete', meta: null, createdAt: timestamp },
];
const markdown = '# PM level boundaries\n\nA proposal for clearer scope and accountability across the product career framework.\n\n## Diagnosis\n\nThe current framework distinguishes working within a roadmap, setting product-area direction and shaping cross-area direction. Make those scope transitions clear before deciding whether the bar itself needs to change.\n\n## Proposed anchors\n\n| Level | Core accountability | Strategy responsibility |\n| --- | --- | --- |\n| L2 — Mid | Own a meaningful problem and its outcome within an agreed direction. | Independently frame the problem and choose the approach. |\n| L3 — Senior | Own a product area’s direction and outcomes over time. | Decide which problems deserve investment and in what sequence. |\n| L4 — Staff | Lead a consequential cross-area product mandate. | Resolve competing priorities and establish a coherent direction. |\n\n## Review questions\n\n- Is each boundary observable in everyday work?\n- Can a PM explain the scope they own?\n- Are the decision rights clear?';
let saved = { path: 'pm-level-boundaries-proposal.md', content: markdown, revision: '1' };
const listeners = new Set<(event: AppEvent) => void>();
const files = Array.from({ length: Math.max(0, Number(new URLSearchParams(location.search).get('files') || 2)) }, (_, index) => ({ path: index ? `research/option-${index}.md` : saved.path, content: index ? `# Option ${index}\n\nA separate document for comparison.` : markdown, revision: '1', modifiedAt: new Date(Date.now() - index * 3600000).toISOString() }));
if (files[0]) files[0].content = `${commentStart}${encodeComment({ id: 'first', text: 'Make the scope clearer.' })} -->First passage${commentEnd}

${commentStart}${encodeComment({ id: 'second', text: 'Add an example.' })} -->Second passage${commentEnd}

` + files[0].content;
const publish = () => listeners.forEach(listener => listener({ type: 'snapshot', value: structuredClone(snapshot) }));
const reviewUndo: Task['status'][] = [];
const actions = { filed: [] as { id: string; path: string; kind: string; content?: string }[], task, failPrioritySetting: false, prioritySettingDelay: 0, failReview: false, reviewDelay: 0, reviewCalls: 0, setTaskStatus: (status: Task['status']) => { Object.assign(task, { status }); publish(); }, failSend: false, failUpload: false, sent: [] as { text: string; paths?: string[] }[], reviews: [] as string[], uploads: [] as string[], failRead: false, failSave: false, failList: new URLSearchParams(location.search).has('failList'), files, copied: [] as string[], revealed: [] as { threadId: string; path: string }[], failCopy: false };
Object.assign(window, { fixtureActions: actions });
const creation = { fail: false, delay: 0, calls: [] as { id: string; name: string }[] };
Object.assign(window, { fixtureCreation: creation });
const fixture: Partial<DesktopApi> = {
  saveTaskView: async view => { if ((actions as any).failViewSave) throw new Error('Could not save filtered view'); snapshot.taskViews = [...(snapshot.taskViews ?? []).filter(item => item.id !== view.id), structuredClone(view)]; localStorage.setItem('fixtureTaskViews', JSON.stringify(snapshot.taskViews)); publish(); },
  deleteTaskView: async id => { snapshot.taskViews = (snapshot.taskViews ?? []).filter(view => view.id !== id); localStorage.setItem('fixtureTaskViews', JSON.stringify(snapshot.taskViews)); publish(); },
  captureTask: async text => { if (text.includes('FAIL')) throw new Error('AI capture failed'); return { title: 'Review captured task', notes: 'Context from your note', label: 'work', dueAt: null }; },
  createTask: async input => { const created = { ...task, ...input, labels: input.labels ?? (input.label ? [input.label] : []), label: input.labels?.[0] ?? input.label ?? null, listId: input.listId ?? null, id: crypto.randomUUID(), status: 'ready' as const, threadId: null, agentId: null, outputDir: null }; snapshot.tasks.push(created); publish(); return created; },
  claudeRoutines: async () => ({ source: '/fixture/scheduled-tasks.json', tasks: [{ id: 'daily', name: 'Morning brief', description: 'External routine', enabled: true, schedule: 'Daily at 09:00', cron: '0 9 * * *', lastRunAt: null, runs: [] }] }),
  configureReminders: async (enabled, list) => { snapshot.reminders = { enabled, list, syncing: false, detail: enabled ? 'Ready to capture' : 'Off', lastSyncAt: null }; publish(); },
  syncReminders: async () => { if (snapshot.reminders) snapshot.reminders.detail = 'No new reminders'; publish(); },
  fileToBrain: async (id, path, kind) => { actions.filed.push({ id, path, kind, content: files.find(file => file.path === path)?.content }); return '/mock/brain/files/copied.md'; },
  snapshot: async () => snapshot,
  setShowTaskPriorities: async show => {
    if (actions.prioritySettingDelay) await new Promise(resolve => setTimeout(resolve, actions.prioritySettingDelay));
    if (actions.failPrioritySetting) throw new Error('Could not save priority setting');
    snapshot.showTaskPriorities = show; localStorage.setItem('fixtureShowTaskPriorities', String(show)); publish();
  },
  importAttachment: async (_id, name, bytes) => { if (actions.failUpload) throw new Error('Copy failed'); actions.uploads.push(name); return { path: '/mock/attachments/' + name, name, size: bytes.length }; },
  openAttachment: async () => {},
  sendMessage: async (_id, text, paths) => { if (actions.failSend) throw new Error('Message rejected'); actions.sent.push({ text, paths }); },
  setBrowserReviewEnabled: async enabled => { snapshot.browserReviewEnabled = enabled; listeners.forEach(listener => listener({ type: 'snapshot', value: structuredClone(snapshot) })); },
  reviewInBrowser: async (_id, path) => { actions.reviews.push(path); },
  onEvent: fn => { listeners.add(fn); return () => { listeners.delete(fn); }; },
  threadMessages: async () => ({ messages, before: null }),
  copyChatTranscript: async id => { if (actions.failCopy) throw new Error('Clipboard unavailable'); actions.copied.push(id); },
  showDocumentInFinder: async (threadId, path) => { actions.revealed.push({ threadId, path }); },
  listDocuments: async () => { if (actions.failList) throw new Error('Documents unavailable'); return files.map(({path, modifiedAt}) => ({path, modifiedAt})); },
  createDocument: async (id, name) => {
    creation.calls.push({ id, name });
    if (creation.delay) await new Promise(resolve => setTimeout(resolve, creation.delay));
    if (creation.fail) throw new Error('Could not create document');
    const path = /\.(md|markdown)$/i.test(name.trim()) ? name.trim() : `${name.trim()}.md`;
    if (files.some(file => file.path === path)) throw new Error('A file with this name already exists. Choose another name.');
    const file = { path, content: '', revision: '1', modifiedAt: new Date().toISOString() };
    files.unshift(file); task.outputDir = '/mock'; publish(); return {...file};
  },
  readDocument: async (_thread, path) => { if (actions.failRead) throw new Error('Could not open document'); const file = files.find(file => file.path === path); if (!file) throw new Error('File missing'); return {...file}; },
  saveDocument: async (_threadId, path, revision, content) => { if (actions.failSave) throw new Error('Could not save document'); const file = files.find(file => file.path === path)!; if (file.revision !== revision) throw new Error('File changed on disk'); Object.assign(file, { content, revision: String(Number(file.revision) + 1) }); return {...file}; },
  skillLibrary: async () => ({ skills: [], bindings: [], proposals: [] } as any),
  markTaskReviewed: async () => {
    actions.reviewCalls++;
    if (actions.reviewDelay) await new Promise(resolve => setTimeout(resolve, actions.reviewDelay));
    if (actions.failReview) throw new Error('Could not mark reviewed');
    if (!['review', 'blocked'].includes(task.status)) throw new Error('This task is no longer waiting for your review');
    reviewUndo.push(task.status); Object.assign(task, { status: 'ready' }); publish();
  },
  undoTaskAction: async () => { const status = reviewUndo.pop(); if (!status) return null; Object.assign(task, { status }); publish(); return { taskId: task.id, action: 'task edit' }; },
  updateTask: async (_id, change) => { if ((actions as any).failLabelsSave && change.labels) throw new Error('Could not save task labels'); const target = snapshot.tasks.find(item => item.id === _id)!; Object.assign(target, change); if (change.labels) target.label = change.labels[0] ?? null; listeners.forEach(listener => listener({ type: 'snapshot', value: structuredClone(snapshot) })); },
};
window.aegir = fixture as DesktopApi;
const { App } = await import('../App');
createRoot(document.getElementById('root')!).render(<ThemeProvider defaultMode="light"><App /></ThemeProvider>);
