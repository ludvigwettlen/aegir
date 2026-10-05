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

export function describeToolRequest(toolName: string, input: Record<string, unknown>, reason?: string, blockedPath?: string): string {
  const lines: string[] = [];
  if (toolName === 'Bash' && typeof input.command === 'string') {
    lines.push(input.command);
    if (typeof input.description === 'string') lines.push(input.description);
  } else if (typeof input.file_path === 'string') lines.push(input.file_path);
  else if (typeof input.notebook_path === 'string') lines.push(input.notebook_path);
  else lines.push(JSON.stringify(input, null, 2));
  if (blockedPath) lines.push(`Path: ${blockedPath}`);
  if (reason) lines.push(`Why: ${reason}`);
  const text = lines.join('\n');
  return text.length > 2000 ? `${text.slice(0, 2000)}…` : text;
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

  // readDirs: folders agents may read without asking (the user's brain). Edits there still need approval.
  constructor(private binary: string, private readDirs: string[] = []) { super(); }

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

  private askUser(runId: string, toolName: string, input: Record<string, unknown>, options: {
    signal: AbortSignal; title?: string; displayName?: string; decisionReason?: string; blockedPath?: string;
  }): Promise<boolean> {
    if (options.signal.aborted) return Promise.resolve(false);
    const id = randomUUID();
    const approval: Approval = {
      id,
      method: `claude:${toolName}`,
      title: approvalTitle(toolName, options.title, options.displayName),
      detail: describeToolRequest(toolName, input, options.decisionReason, options.blockedPath),
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
    try {
      const session = query({
        prompt: input.prompt,
        options: {
          cwd: input.cwd,
          pathToClaudeCodeExecutable: this.binary,
          env: childEnv(),
          systemPrompt: quick ? input.instructions : { type: 'preset', preset: 'claude_code', append: input.instructions },
          permissionMode: 'default',
          ...(quick
            ? { settingSources: [], tools: [], mcpServers: {}, strictMcpConfig: true, model: 'haiku' }
            : {
                mcpServers: { [SERVER]: { type: 'sdk' as const, name: SERVER, instance: server as never } },
                allowedTools: [...tools.keys()].map((name) => `${PREFIX}${name}`),
                disallowedTools: input.sandbox === 'workspace-write' ? [] : WRITE_TOOLS,
                additionalDirectories: this.readDirs,
                model: input.modelTier === 'lightweight' ? 'sonnet' : undefined,
              }),
          resume: input.threadId ? this.sessions.get(input.threadId) : undefined,
          includePartialMessages: true,
          abortController: run.abort,
          stderr: (data) => this.emit('log', data),
          canUseTool: async (toolName, toolInput, options): Promise<PermissionResult> => {
            if (options.mcpServer?.source === 'sdk') return { behavior: 'allow', updatedInput: toolInput };
            const path = toolInput.file_path ?? toolInput.notebook_path;
            if (input.sandbox === 'workspace-write' && WRITE_TOOLS.includes(toolName) && typeof path === 'string' && isInside(input.cwd, path))
              return { behavior: 'allow', updatedInput: toolInput };
            const approved = await this.askUser(runId, toolName, toolInput, options);
            return approved
              ? { behavior: 'allow', updatedInput: toolInput }
              : { behavior: 'deny', message: 'The user declined this action in Legolas.' };
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
            if (block.type === 'tool_use' && block.name && !block.name.startsWith(PREFIX))
              input.onItem?.({ type: 'toolUse', name: block.name, input: block.input });
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
    return { threadId: runId, text: finalText || streamed, status };
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
