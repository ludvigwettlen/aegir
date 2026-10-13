import type { Tool } from './codex.js';

export const composioReadTool = 'SLACK_READ_TOOLS';
const executeTool = 'COMPOSIO_MULTI_EXECUTE_TOOL';
// An explicit allowlist, never a name-prefix heuristic: new/unknown actions
// must go through the attended approval path until reviewed.
const slackReads = new Set([
  'SLACK_SEARCH_ALL', 'SLACK_SEARCH_MESSAGES', 'SLACK_SEARCH_FILES',
  'SLACK_FETCH_CONVERSATION_HISTORY', 'SLACK_FETCH_CONVERSATION_REPLIES',
  'SLACK_LIST_ALL_CHANNELS', 'SLACK_LIST_CONVERSATIONS',
  'SLACK_GET_CHANNEL_INFO', 'SLACK_GET_CONVERSATION_INFO',
  'SLACK_LIST_CONVERSATION_MEMBERS', 'SLACK_LIST_USERS', 'SLACK_GET_USER_INFO',
  'SLACK_GET_MESSAGE_PERMALINK', 'SLACK_GET_THREAD_REPLIES',
]);
const discovery = new Set(['COMPOSIO_SEARCH_TOOLS', 'COMPOSIO_GET_TOOL_SCHEMAS']);
type DiscoveredTool = { name: string; description?: string; inputSchema: Record<string, unknown> };

export function composioTools(tools: DiscoveredTool[], account: string): Tool[] {
  const guidance = ` Slack only. Discover Slack tools and check the returned connection status before executing. ${account ? `The user expects Slack account ${JSON.stringify(account)}; verify it against connection discovery and stop if it differs or cannot be confirmed. This is an expected account, not a server-side account pin.` : 'Use the active Slack connection returned by discovery.'} Use ${composioReadTool} for supported reads; For drafting or sending messages, use slack_messages__draft to open the inline editor; the user clicks Send there. Other Slack actions require chat approval. Remote workbench and shell are unavailable; keep results inline.`;
  return tools.flatMap(tool => {
    if (!discovery.has(tool.name) && tool.name !== executeTool) return [];
    const result: Tool = { ...tool, description: `${tool.description || tool.name}\n${guidance}`, readOnly: discovery.has(tool.name) };
    if (tool.name !== executeTool) return [result];
    return [result, { ...result, name: composioReadTool, readOnly: true,
      description: `Read Slack using the same schema as ${executeTool}. Only these actions are allowed: ${[...slackReads].join(', ')}. ${guidance}` }];
  });
}

export function prepareComposioCall(name: string, args: Record<string, unknown>) {
  if (discovery.has(name)) return { name, arguments: args };
  if (name !== executeTool && name !== composioReadTool) throw new Error('Unsupported Composio tool');
  if (!Array.isArray(args.tools) || !args.tools.length || args.tools.length > 50) throw new Error('Provide 1–50 Slack tools');
  // Reject unfamiliar wrapper fields rather than allowing a new upstream feature
  // to silently bypass our policy. Inner Slack arguments follow discovered schemas.
  const allowed = new Set(['tools', 'thought', 'sync_response_to_workbench', 'current_step', 'current_step_metric', 'session_id']);
  if (Object.keys(args).some(key => !allowed.has(key))) throw new Error('Unsupported Composio execution option');
  for (const item of args.tools) {
    if (!item || typeof item !== 'object' || Array.isArray(item) ||
      Object.keys(item).some(key => key !== 'tool_slug' && key !== 'arguments') ||
      typeof item.tool_slug !== 'string' || !/^SLACK_[A-Z0-9_]+$/.test(item.tool_slug) ||
      !item.arguments || typeof item.arguments !== 'object' || Array.isArray(item.arguments))
      throw new Error('Only Slack tool_slug and arguments entries are supported');
    if (['SLACK_SEND_MESSAGE', 'SLACK_CHAT_POST_MESSAGE', 'SLACK_POST_MESSAGE', 'SLACK_SCHEDULE_MESSAGE'].includes(item.tool_slug))
      throw new Error('Use slack_messages__draft to open the inline editor. The user must click Send there; message sending is unavailable through generic execution.');
    if (name === composioReadTool && !slackReads.has(item.tool_slug))
      throw new Error('This Slack action is not approved for read-only execution. Use the approval-gated execution tool in chat.');
  }
  return { name: executeTool, arguments: { ...args, sync_response_to_workbench: false } };
}
