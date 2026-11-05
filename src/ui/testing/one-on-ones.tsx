import React from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@usefragments/ui';
import '../styles';
import type { AppEvent, DesktopApi, Snapshot, Message } from '../../../shared/types';
import type { OneOnOneMeeting } from '../../../shared/one-on-ones';
const meeting: OneOnOneMeeting = { id: 'one', account: 'work', eventId: 'event', title: 'Sam Lee', personName: 'Sam Lee', personEmail: 'sam@example.com', userEmail: 'alex@example.com', startsAt: new Date(new Date().setHours(18, 0, 0, 0)).toISOString(), endsAt: new Date(new Date().setHours(18, 30, 0, 0)).toISOString(), sourceUrl: 'https://www.google.com/calendar/event?eid=test', description: '', revision: 'one', active: true, hidden: false, agenda: '', preparedAt: null, status: 'pending', error: '' };
let data = { agents: [], groups: [], threads: [], tasks: [], taskLists: [], taskLinks: [], routines: [], approvals: [], connectors: [], routineRuns: [], oneOnOnes: { account: '', enabled: false, syncing: false, error: '', lastSyncedAt: null, meetings: [] } } as unknown as Snapshot;
const listeners = new Set<(event: AppEvent) => void>();
const publish = () => { data = structuredClone(data); listeners.forEach(fn => fn({ type: 'snapshot', value: data })); };
const messages: Message[] = [];
const emitMessage = (message: Message) => { const index = messages.findIndex(item => item.id === message.id); if (index < 0) messages.push(message); else messages[index] = message; listeners.forEach(fn => fn({ type: 'message', value: message })); };
const meetingConversation = async (id: string) => {
  const row = data.oneOnOnes!.meetings.find(item => item.id === id)!;
  if (!row.threadId) { row.threadId = `meeting-${id}`; data.threads.push({ id: row.threadId, groupId: 'main', title: row.title, kind: 'chat', taskId: null, status: 'active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messageCount: 0, agentIds: [], busyAgentIds: [], snippet: '' }); publish(); }
  return row.threadId;
};
const fixture = { fail: false };
Object.assign(window, { fixture });
window.aegir = {
  snapshot: async () => data, onEvent: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  meetingConversation,
  threadMessages: async id => ({ messages: messages.filter(message => message.threadId === id), before: null }),
  listDocuments: async () => [],
  sendMessage: async (threadId, content) => {
    emitMessage({ id: `user-${messages.length}`, threadId, agentId: null, role: 'user', content, status: 'complete', meta: null, createdAt: new Date().toISOString() });
    emitMessage({ id: `reply-${messages.length}`, threadId, agentId: null, role: 'agent', content: 'Let’s focus on the launch risks.', status: 'complete', meta: null, createdAt: new Date().toISOString() });
  },
  configureOneOnOnes: async (account, enabled) => { data.oneOnOnes!.account = account; data.oneOnOnes!.enabled = enabled; publish(); },
  syncOneOnOnes: async () => { data.oneOnOnes!.meetings = [meeting, { ...meeting, id: 'two', title: 'Project review', kind: 'meeting', attendees: [{ name: 'Sam', email: 'sam@example.com' }, { name: 'Chris', email: 'chris@example.com' }], personName: 'A very long attendee name to verify wrapping in the narrow layout', personEmail: 'another@example.com', status: 'failed', error: 'Notion could not be reached. Retry preparation when the connection is available.' }]; data.oneOnOnes!.lastSyncedAt = new Date().toISOString(); publish(); },
  prepareOneOnOne: async id => { const threadId = await meetingConversation(id); const row = data.oneOnOnes!.meetings.find(item => item.id === id)!; row.status = 'preparing'; publish(); emitMessage({ id: `prep-${id}`, threadId, agentId: null, role: 'agent', content: 'Reviewing meeting context…', status: 'streaming', meta: null, createdAt: new Date().toISOString() }); await new Promise(resolve => setTimeout(resolve, 250)); const fresh = data.oneOnOnes!.meetings.find(item => item.id === id)!; fresh.status = 'ready'; fresh.agenda = '# Previously discussed\nLast week, you discussed the launch and research plan.\n\n## Open follow-ups\n- **Sam:** confirm the research plan. [Meeting notes](https://example.com/notes)\n\n## Suggested agenda\n1. What have we learned since last week?\n2. Which decision needs support?\n\n## Sources and coverage\nBased on the linked notes; current Slack activity was unavailable.'; fresh.preparedAt = new Date().toISOString(); emitMessage({ id: `prep-${id}`, threadId, agentId: null, role: 'agent', content: fresh.agenda, status: 'complete', meta: null, createdAt: new Date().toISOString() }); publish(); },
  updateOneOnOne: async (id, change) => { if (fixture.fail) throw new Error('Save failed. Try again.'); Object.assign(data.oneOnOnes!.meetings.find(item => item.id === id)!, change); publish(); },
  openExternal: async () => {},
} satisfies Partial<DesktopApi> as unknown as DesktopApi;
const { App } = await import('../App');
createRoot(document.getElementById('root')!).render(<ThemeProvider defaultMode="light"><App /></ThemeProvider>);
