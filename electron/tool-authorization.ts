/** Shared policy for tool discovery, run exposure and dispatch. Unknown capabilities fail closed. */
export type ToolDecision = 'allow' | 'ask' | 'deny';
export type RunKind = 'chat' | 'task' | 'routine' | 'prep';
type Annotations = { readOnlyHint?: boolean; destructiveHint?: boolean };
const reads: Record<string, Set<string>> = {
  slack: new Set(['slack_search', 'slack_search_all', 'slack_search_messages', 'slack_search_channels', 'slack_search_users', 'slack_read_channel', 'slack_read_thread', 'slack_read_user_profile']),
  notion: new Set(['notion-search', 'notion-fetch', 'notion-get-users', 'notion-get-self', 'notion-get-teams', 'notion-query-data-sources', 'notion-get-tool-access']),
};
export function connectorReadOnly(provider: string, name: string, annotations?: Annotations): boolean {
  if (annotations?.readOnlyHint === false || annotations?.destructiveHint === true) return false;
  return Object.hasOwn(reads, provider) && reads[provider].has(name);
}
export function connectorDecision(kind: RunKind | undefined, readOnly: boolean): ToolDecision {
  if (!kind) return 'deny';
  return readOnly ? 'allow' : kind === 'chat' ? 'ask' : 'deny';
}
export function browserAllowed(kind: string) { return kind === 'chat' || kind === 'task'; }
