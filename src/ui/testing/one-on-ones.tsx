import React from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@usefragments/ui';
import '../styles';
import type { AppEvent, DesktopApi, Snapshot } from '../../../shared/types';
import type { OneOnOneMeeting } from '../../../shared/one-on-ones';
const meeting: OneOnOneMeeting = { id: 'one', account: 'work', eventId: 'event', title: 'Alex / Sam', personName: 'Sam Lee', personEmail: 'sam@example.com', userEmail: 'alex@example.com', startsAt: '2026-10-14T09:00:00Z', endsAt: '2026-10-14T09:30:00Z', sourceUrl: 'https://www.google.com/calendar/event?eid=test', description: '', revision: 'one', active: true, hidden: false, agenda: '', preparedAt: null, status: 'pending', error: '' };
let data = { agents: [], groups: [], threads: [], tasks: [], taskLists: [], taskLinks: [], routines: [], approvals: [], connectors: [], routineRuns: [], oneOnOnes: { account: '', enabled: false, syncing: false, error: '', lastSyncedAt: null, meetings: [] } } as unknown as Snapshot;
const listeners = new Set<(event: AppEvent) => void>();
const publish = () => { data = structuredClone(data); listeners.forEach(fn => fn({ type: 'snapshot', value: data })); };
const fixture = { fail: false };
Object.assign(window, { fixture });
window.aegir = {
  snapshot: async () => data, onEvent: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  configureOneOnOnes: async (account, enabled) => { data.oneOnOnes!.account = account; data.oneOnOnes!.enabled = enabled; publish(); },
  syncOneOnOnes: async () => { data.oneOnOnes!.meetings = [meeting, { ...meeting, id: 'two', personName: 'A very long attendee name to verify wrapping in the narrow layout', personEmail: 'another@example.com', startsAt: '2026-10-15T10:00:00Z', endsAt: '2026-10-15T10:30:00Z', status: 'failed', error: 'Notion could not be reached. Retry preparation when the connection is available.' }]; data.oneOnOnes!.lastSyncedAt = new Date().toISOString(); publish(); },
  prepareOneOnOne: async id => { const row = data.oneOnOnes!.meetings.find(item => item.id === id)!; row.status = 'preparing'; publish(); await new Promise(resolve => setTimeout(resolve, 250)); const fresh = data.oneOnOnes!.meetings.find(item => item.id === id)!; fresh.status = 'ready'; fresh.agenda = '# Previously discussed\nLast week, you discussed the launch and research plan.\n\n## Open follow-ups\n- **Sam:** confirm the research plan. [Meeting notes](https://example.com/notes)\n\n## Suggested agenda\n1. What have we learned since last week?\n2. Which decision needs support?\n\n## Sources and coverage\nBased on the linked notes; current Slack activity was unavailable.'; fresh.preparedAt = new Date().toISOString(); publish(); },
  updateOneOnOne: async (id, change) => { if (fixture.fail) throw new Error('Save failed. Try again.'); Object.assign(data.oneOnOnes!.meetings.find(item => item.id === id)!, change); publish(); },
  openExternal: async () => {},
} satisfies Partial<DesktopApi> as unknown as DesktopApi;
const { App } = await import('../App');
createRoot(document.getElementById('root')!).render(<ThemeProvider defaultMode="light"><App /></ThemeProvider>);
