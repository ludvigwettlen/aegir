export type OneOnOneMeeting = {
  id: string; account: string; eventId: string; title: string;
  personName: string; personEmail: string; userEmail: string;
  startsAt: string; endsAt: string; sourceUrl: string; description: string;
  revision: string; active: boolean; hidden: boolean;
  threadId?: string;
  attendees?: { name: string; email: string }[];
  kind?: 'one-on-one' | 'meeting';
  autoPrepare?: boolean;
  agendaEdited?: boolean; previousAgenda?: string;
  agenda: string; preparedAt: string | null;
  /** Legacy local notes are retained for compatibility but no longer used for prep. */
  notes?: string;
  status: 'pending' | 'preparing' | 'ready' | 'stale' | 'failed'; error: string;
};
export type OneOnOneState = {
  meetings: OneOnOneMeeting[]; enabled: boolean; account: string;
  syncing: boolean; lastSyncedAt: string | null; error: string;
};
export const emptyOneOnOnes: OneOnOneState = { meetings: [], enabled: false, account: '', syncing: false, lastSyncedAt: null, error: '' };
export const prepStatus: Record<OneOnOneMeeting['status'], string> = {
  pending: 'Not prepared', preparing: 'Preparing…', ready: 'Ready', stale: 'Needs refresh', failed: 'Couldn’t prepare',
};
