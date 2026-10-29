export type NotionPerson = { id: string; name: string; email?: string };
export const delegationStatuses = ['Assigned', 'Accepted', 'In progress', 'Blocked', 'Ready for review', 'Done', 'Cancelled'] as const;
export type DelegationStatus = typeof delegationStatuses[number];
export type DelegationInput = { assignee: NotionPerson; taggedPeople: NotionPerson[]; brief: string };
export type Delegation = DelegationInput & {
  dataSourceId: string;
  pageUrl: string | null;
  status: DelegationStatus;
  progress: string;
  syncedAt: string | null;
  error: string | null;
  // Persist before creating, so an interrupted publish can be recovered by Aegir ID.
  publishing: boolean;
};
export type DelegationState = { database: string; syncing: boolean; lastSyncedAt: string | null; error: string | null };
// This personal prototype's tracker; each installation can choose another in Settings.
export const defaultDelegationDatabase = 'https://www.notion.so/cd6b2c18a610486d874ada03dac584ec';
