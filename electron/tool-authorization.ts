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
/** Chats and handed-off tasks have a person who sees and answers approval cards; routines and meeting prep do not. */
export function attendedRun(kind?: RunKind) { return kind === 'chat' || kind === 'task'; }
const sends = /(?:^|__|_)(?:send|post_message|schedule_message)(?:_|$)/i;
/** Claude Code's native tools. `readable` means the caller confined a Read/Grep/Glob target to the run's own folders. */
export function nativeToolDecision(name: string, options: { kind?: RunKind; writable: boolean; readable: boolean; readOnly: boolean }): ToolDecision {
  if (sends.test(name)) return 'deny';
  if (name === 'ToolSearch') return 'allow';
  if (['Read', 'Grep', 'Glob'].includes(name)) return options.readable ? 'allow' : 'deny';
  // Fetching a model-chosen URL can carry data out of the run, so a person approves it; unattended runs get no web access.
  if (name === 'WebFetch') return attendedRun(options.kind) ? 'ask' : 'deny';
  if (name === 'WebSearch') return attendedRun(options.kind) ? 'allow' : 'deny';
  if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(name)) return options.writable ? 'allow' : 'deny';
  if (name.startsWith('mcp__')) return connectorDecision(options.kind, options.readOnly);
  return options.kind === 'chat' || (name === 'Bash' && options.kind === 'task') ? 'ask' : 'deny';
}

export function nativeMcpReadOnly(server: string, tool: string, annotations?: { readOnly?: boolean; destructive?: boolean }): boolean {
  const provider = /^(?:claude_ai_)?slack$/i.test(server) ? 'slack' : /^(?:claude_ai_)?notion$/i.test(server) ? 'notion' : '';
  return connectorReadOnly(provider, tool, { readOnlyHint: annotations?.readOnly, destructiveHint: annotations?.destructive });
}
