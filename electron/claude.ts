import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { query, type PermissionResult, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Approval } from '../shared/types.js';
import type { RunInput, Tool, ToolHandler } from './codex.js';
import type { EngineProvider } from './engine.js';
import { ToolResult } from './tool-result.js';

const SERVER = 'aegir';
const PREFIX = `mcp__${SERVER}__`;
const WRITE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];

// Claude tool names are capped at 64 characters including the mcp__aegir__ prefix.
// Aegir's per-agent memory tools carry a full agent id, so long names get a stable hashed suffix.
export function exposedToolName(name: string): string {
  const clean = name.replace(/[^a-zA-Z0-9_-]/g, '_');
  if (PREFIX.length + clean.length <= 64) return clean;
  const hash = createHash('sha256').update(name).digest('hex').slice(0, 8);
  return `${clean.slice(0, 64 - PREFIX.length - hash.length - 1)}_${hash}`;
}

export function isInside(dir: string, path: string): boolean {
  const rel = relative(resolve(dir), resolve(dir, path));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

const TOOL_TITLES: Record<string, string> = {
  Bash: 'Run a shell command', Write: 'Create or overwrite a file', Edit: 'Edit a file', MultiEdit: 'Edit a file',
  NotebookEdit: 'Edit a notebook', WebFetch: 'Fetch a web page', WebSearch: 'Search the web', Read: 'Read a file',
};

// A short, human title for the approval card. Claude Code's own sentence wins when it is more than the tool name.
export function approvalTitle(toolName: string, title?: string, displayName?: string): string {
  if (title && title !== toolName) return title;
  if (TOOL_TITLES[toolName]) return TOOL_TITLES[toolName];
  const mcp = toolName.match(/^mcp__(.+?)__(.+)$/);
  if (mcp) return `Use ${mcp[2].replace(/[_-]+/g, ' ')} (${mcp[1].replace(/^claude_ai_/, '')})`;
  return displayName && displayName !== toolName ? displayName : `Use ${toolName}`;
}

const FILE_TOOLS = ['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Glob', 'Grep', 'LS'];
const PATH_KEYS = ['file_path', 'notebook_path', 'path'];
// Long free-text inputs (file contents, edit text) are shortened in the input listing only.
// Paths, commands and URLs are always shown in full on their own lines.
const MAX_VALUE = 600;

function shorten(value: unknown): unknown {
  if (typeof value === 'string')
    return value.length > MAX_VALUE ? `${value.slice(0, MAX_VALUE)}… (${value.length - MAX_VALUE} more characters)` : value;
  if (Array.isArray(value)) return value.map(shorten);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shorten(item)]));
  return value;
}

export type ToolRequestContext = {
  reason?: string; // Claude Code's explanation of why it is asking
  blockedPath?: string;
  description?: string; // Claude Code's sentence about what the action gives access to
  mcpServer?: { name: string; source: string };
  cwd?: string;
};

// Everything an approval grants, in plain lines. Approving runs this one call with exactly this input:
// Legolas never returns permission updates, so nothing carries over to later calls.
export function describeToolRequest(toolName: string, input: Record<string, unknown>, context: ToolRequestContext = {}): string {
  const lines: string[] = [];
  const mcp = toolName.match(/^mcp__(.+?)__(.+)$/);
  lines.push(mcp ? `Tool: ${mcp[2]} on the ${context.mcpServer?.name || mcp[1]} MCP server (${toolName})` : `Tool: ${toolName}`);
  if (typeof input.command === 'string') lines.push(`Command: ${input.command}`);
  if (toolName === 'Bash' && context.cwd) lines.push(`Runs in: ${context.cwd}`);
  for (const key of PATH_KEYS) if (typeof input[key] === 'string') lines.push(`Path: ${input[key]}`);
  if (context.blockedPath) lines.push(`Path outside the allowed folders: ${context.blockedPath}`);
  if (typeof input.url === 'string') lines.push(`URL: ${input.url}`);
  if (toolName === 'Bash') lines.push('Network: open. The command runs as you, with your files and your network');
  else if (toolName === 'WebFetch') lines.push(`Network: fetches ${typeof input.url === 'string' ? input.url : 'a web page'}`);
  else if (toolName === 'WebSearch') lines.push(`Network: searches the web${typeof input.query === 'string' ? ` for "${input.query}"` : ''}`);
  else if (FILE_TOOLS.includes(toolName)) lines.push('Network: none');
  else if (mcp) lines.push(`Network: whatever the ${context.mcpServer?.name || mcp[1]} server does with this request`);
  else lines.push('Network: not limited by Legolas');
  lines.push('Grant: this one call only. Claude asks again next time.');
  if (context.description) lines.push(`Claude Code: ${context.description}`);
  if (context.reason) lines.push(`Why it asks: ${context.reason}`);
  lines.push(`Input:\n${JSON.stringify(shorten(input), null, 2)}`);
  return lines.join('\n');
}

// The answer to a permission prompt. Never includes updatedPermissions, so an approval grants only this call.
export function permissionResult(approved: boolean, input: Record<string, unknown>): PermissionResult {
  return approved
    ? { behavior: 'allow', updatedInput: input }
    : { behavior: 'deny', message: 'The user declined this action in Legolas.' };
}

// Aegir tool results use Codex's content items; the MCP transport wants MCP content blocks.
export function mcpContent(value: unknown) {
  if (value instanceof ToolResult) {
    return {
      content: value.contentItems.map((item) => {
        if (item.type === 'inputText') return { type: 'text' as const, text: item.text };
        const match = item.imageUrl.match(/^data:(image\/[a-z]+);base64,(.*)$/s);
        return match
          ? { type: 'image' as const, mimeType: match[1], data: match[2] }
          : { type: 'text' as const, text: '[image omitted]' };
      }),
      isError: !value.success,
    };
  }
  return { content: [{ type: 'text' as const, text: JSON.stringify(value ?? null) }] };
}

function childEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: 'aegir/0.1.0' };
  // Apps opened from Finder get a bare PATH; agent shell commands need the user's tools.
  const extra = [join(homedir(), '.local', 'bin'), join(homedir(), '.bun', 'bin'), '/opt/homebrew/bin', '/usr/local/bin'];
  env.PATH = [...extra, ...(process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin').split(':')]
    .filter((dir, index, all) => dir && all.indexOf(dir) === index)
    .join(':');
  // Started from inside another Claude Code session (development), these would leak into the child.
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  // Review in browser polls human-review for up to nine minutes at a time. Claude Code's default command limit is
  // two minutes, after which a command moves to the background and dies with the turn; 10 minutes is its maximum.
  env.BASH_DEFAULT_TIMEOUT_MS ||= '600000';
  return env;
}

type Run = { abort: AbortController; sessionId?: string };
type Pending = { runId: string; resolve: (approved: boolean) => void; cancel: () => void };

// Runs each Aegir turn as a headless Claude Code session through the Agent SDK.
// Aegir's tools are served in-process as an MCP server; permission prompts become Aegir approvals.
export class ClaudeProvider extends EventEmitter implements EngineProvider {
  status = 'Not started';
  private toolHandler: ToolHandler | null = null;
  private runs = new Map<string, Run>();
  private sessions = new Map<string, string>();
  private pending = new Map<string, Pending>();

  // workDirs: folders agents read and edit without asking (the user's brain, which git versions).
  // approvals: 'auto' follows the user's Claude Code auto mode (Claude approves safe actions and asks
  // through an approval card only when unsure); 'ask' sends every gated action to an approval card.
  // Malcolm chose 'auto' as the default on 2026-10-05.
  constructor(private binary: string, private options: { workDirs?: string[]; approvals?: () => 'auto' | 'ask' } = {}) { super(); }

  allowRules(toolNames: string[]) {
    const home = homedir();
    const rules = toolNames.map((name) => `${PREFIX}${name}`);
    for (const dir of this.options.workDirs || []) {
      const path = dir.startsWith(`${home}/`) ? `~${dir.slice(home.length)}` : `/${dir}`;
      rules.push(`Read(${path}/**)`, `Edit(${path}/**)`, `Write(${path}/**)`);
    }
    rules.push('Bash(gbrain:*)', `Bash(${join(home, '.bun', 'bin', 'gbrain')}:*)`);
    return rules;
  }

  setToolHandler(handler: ToolHandler) { this.toolHandler = handler; }

  async start() {
    this.status = await new Promise<string>((done) => {
      execFile(this.binary, ['--version'], { timeout: 15_000, env: childEnv() }, (error, stdout) => {
        done(error ? `Failed to start: ${error.message}` : `Connected · ${stdout.trim()}`);
      });
    });
    this.emit('status');
  }

  private server(tools: Map<string, Tool>, runId: string) {
    const server = new Server({ name: SERVER, version: '0.1.0' }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [...tools].map(([name, tool]) => ({
        name,
        description: tool.description,
        inputSchema: tool.inputSchema as { type: 'object'; [key: string]: unknown },
        annotations: { readOnlyHint: tool.readOnly },
        _meta: { 'anthropic/alwaysLoad': true },
      })),
    }));
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const tool = tools.get(request.params.name);
      if (!tool || !this.toolHandler) return { content: [{ type: 'text', text: 'Unknown tool' }], isError: true };
      const [provider, ...parts] = tool.name.split('__');
      try {
        const value = await this.toolHandler(provider, parts.join('__'), request.params.arguments || {}, tool.readOnly, runId);
        return mcpContent(value);
      } catch (error) {
        return { content: [{ type: 'text', text: String(error) }], isError: true };
      }
    });
    return server;
  }

  private askUser(runId: string, toolName: string, input: Record<string, unknown>, cwd: string, options: {
    signal: AbortSignal; title?: string; displayName?: string; decisionReason?: string; blockedPath?: string;
    description?: string; mcpServer?: { name: string; source: string };
  }): Promise<boolean> {
    if (options.signal.aborted) return Promise.resolve(false);
    const id = randomUUID();
    const approval: Approval = {
      id,
      method: `claude:${toolName}`,
      title: approvalTitle(toolName, options.title, options.displayName),
      detail: describeToolRequest(toolName, input, {
        reason: options.decisionReason, blockedPath: options.blockedPath, description: options.description, mcpServer: options.mcpServer, cwd,
      }),
      agentId: null,
      threadId: runId,
      createdAt: new Date().toISOString(),
    };
    return new Promise((done) => {
      const cancel = () => {
        if (!this.pending.delete(id)) return;
        done(false);
        this.emit('approval-resolved', id);
      };
      this.pending.set(id, {
        runId,
        cancel,
        resolve: (approved) => {
          options.signal.removeEventListener('abort', cancel);
          done(approved);
        },
      });
      options.signal.addEventListener('abort', cancel, { once: true });
      this.emit('approval', approval);
    });
  }

  resolveApproval(id: string, approved: boolean) {
    const item = this.pending.get(id);
    if (!item) return;
    this.pending.delete(id);
    item.resolve(approved);
    this.emit('approval-resolved', id);
  }

  async run(input: RunInput) {
    const runId = randomUUID();
    const tools = new Map(input.tools.map((tool) => [exposedToolName(tool.name), tool]));
    const run: Run = { abort: new AbortController() };
    this.runs.set(runId, run);
    // Tool calls look up their run by this id, so register it before the session starts.
    input.onThreadStarted?.(runId);
    // A run without tools is a quick classification call (task routing): keep it small and isolated.
    const quick = input.tools.length === 0;
    const server = quick ? null : this.server(tools, runId);
    let streamed = '';
    let sawStream = false;
    let finalText = '';
    let status = 'failed';
    // The last of the engine's error output, shown when a run ends without a result.
    let stderrTail = '';
    try {
      const session = query({
        prompt: input.prompt,
        options: {
          cwd: input.cwd,
          pathToClaudeCodeExecutable: this.binary,
          env: childEnv(),
          systemPrompt: quick ? input.instructions : { type: 'preset', preset: 'claude_code', append: input.instructions },
          permissionMode: this.options.approvals?.() === 'ask' ? 'default' : 'auto',
          ...(quick
            ? { settingSources: [], tools: [], mcpServers: {}, strictMcpConfig: true, model: 'haiku' }
            : {
                mcpServers: { [SERVER]: { type: 'sdk' as const, name: SERVER, instance: server as never } },
                allowedTools: this.allowRules([...tools.keys()]),
                // Unattended routines stay read-only; chats and tasks behave like the user's own Claude Code.
                disallowedTools: input.kind === 'routine' ? WRITE_TOOLS : [],
                additionalDirectories: this.options.workDirs || [],
                model: input.modelTier === 'lightweight' ? 'sonnet' : undefined,
              }),
          resume: input.threadId ? this.sessions.get(input.threadId) : undefined,
          includePartialMessages: true,
          abortController: run.abort,
          stderr: (data) => { this.emit('log', data); stderrTail = (stderrTail + data).slice(-1500); },
          canUseTool: async (toolName, toolInput, options): Promise<PermissionResult> => {
            if (options.mcpServer?.source === 'sdk') return { behavior: 'allow', updatedInput: toolInput };
            const path = toolInput.file_path ?? toolInput.notebook_path;
            const writable = [...(input.sandbox === 'workspace-write' ? [input.cwd] : []), ...(input.kind === 'routine' ? [] : this.options.workDirs || [])];
            if (WRITE_TOOLS.includes(toolName) && typeof path === 'string' && writable.some((dir) => isInside(dir, path)))
              return { behavior: 'allow', updatedInput: toolInput };
            return permissionResult(await this.askUser(runId, toolName, toolInput, input.cwd, options), toolInput);
          },
        },
      });
      for await (const message of session as AsyncIterable<SDKMessage>) {
        if ('session_id' in message && typeof message.session_id === 'string' && !run.sessionId) {
          run.sessionId = message.session_id;
          this.sessions.set(runId, message.session_id);
        }
        if (message.type === 'stream_event' && message.parent_tool_use_id === null) {
          const event = message.event as { type: string; delta?: { type: string; text?: string } };
          if (event.type === 'message_start' && streamed && !streamed.endsWith('\n\n')) {
            streamed += '\n\n';
            input.onDelta('\n\n');
          }
          if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) {
            sawStream = true;
            streamed += event.delta.text;
            input.onDelta(event.delta.text);
          }
        } else if (message.type === 'assistant' && message.parent_tool_use_id === null) {
          for (const block of message.message.content as Array<{ type: string; text?: string; name?: string; input?: unknown }>) {
            // Aegir's own tools are logged by its tool handler in routines, so they get the type routine logs skip.
            if (block.type === 'tool_use' && block.name)
              input.onItem?.({ type: block.name.startsWith(PREFIX) ? 'mcpToolCall' : 'toolUse', name: block.name, input: block.input });
            if (block.type === 'text' && block.text && !sawStream) streamed += `${streamed ? '\n\n' : ''}${block.text}`;
          }
        } else if (message.type === 'result') {
          if (message.subtype === 'success' && !message.is_error) {
            status = 'completed';
            finalText = message.result;
          } else {
            const errors = (message as { errors?: string[] }).errors;
            finalText = errors?.length ? errors.join('\n') : `Claude Code stopped: ${message.subtype}`;
          }
        }
      }
    } catch (error) {
      if (!run.abort.signal.aborted) throw error;
      status = 'interrupted';
    } finally {
      this.runs.delete(runId);
      void server?.close().catch(() => {});
    }
    if (run.abort.signal.aborted) status = 'interrupted';
    const failure = status === 'failed' && stderrTail.trim() ? `Claude Code stopped with this error:\n${stderrTail.trim().slice(-800)}` : '';
    return { threadId: runId, text: finalText || streamed || failure, status };
  }

  // Stopping a run also withdraws any approval it is still waiting on.
  async stop(threadId: string) {
    for (const item of [...this.pending.values()]) if (item.runId === threadId) item.cancel();
    this.runs.get(threadId)?.abort.abort();
  }

  close() {
    for (const item of [...this.pending.values()]) item.cancel();
    for (const run of this.runs.values()) run.abort.abort();
    this.runs.clear();
  }
}
