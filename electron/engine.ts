import type { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ModelProvider, ToolHandler } from './codex.js';

export type EngineId = 'codex' | 'claude';
export const engineNames: Record<EngineId, string> = { codex: 'Codex', claude: 'Claude Code' };

// What main.ts needs from an engine beyond running turns: status, approvals and tool dispatch.
// Engines emit 'status', 'log', 'approval' (Approval) and 'approval-resolved' (id).
export interface EngineProvider extends ModelProvider, EventEmitter {
  status: string;
  start(): Promise<void>;
  close(): void;
  setToolHandler(handler: ToolHandler): void;
  resolveApproval(id: string, approved: boolean): void;
}

// The Claude Code CLI as installed by its own installer, Homebrew, or npm.
export function findClaudeBinary(configured?: string | null): string | null {
  const candidates = [
    configured,
    process.env.CLAUDE_BINARY,
    join(homedir(), '.local', 'bin', 'claude'),
    join(homedir(), '.claude', 'local', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
  ];
  return candidates.find((path): path is string => !!path && existsSync(path)) || null;
}

// An explicit setting wins. Without one, use Claude Code when it is installed, else Codex.
export function chooseEngine(setting: string | null | undefined, claudeBinary: string | null): EngineId {
  if (setting === 'codex' || setting === 'claude') return setting;
  return claudeBinary ? 'claude' : 'codex';
}
