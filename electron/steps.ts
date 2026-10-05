import { homedir } from 'node:os';
import type { Step } from '../shared/types.js';

// Turns an engine's tool event into one short line for the folded "steps" list under a reply.
// Claude Code reports { type: 'toolUse' | 'mcpToolCall', name, input }; Codex reports its own
// item types, which get a generic line. Returns null for events that aren't worth showing.

const home = homedir();
const shortPath = (value: unknown) => {
  const path = String(value || '');
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
};
const clip = (value: unknown, max = 90) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};
const words = (value: string) => value.replace(/^claude_ai_/, '').replace(/[_-]+/g, ' ').trim();
const host = (value: unknown) => {
  try { const url = new URL(String(value)); return `${url.hostname}${url.pathname === '/' ? '' : url.pathname}`; }
  catch { return clip(value, 70); }
};

// Aegir's own tools, as the model sees them after the mcp__aegir__ prefix.
const OWN_TOOLS: Record<string, string> = {
  tasks__suggest: 'Suggested a task', tasks__list: 'Looked through your tasks', tasks__read: 'Read a task',
  threads__set_title: 'Named the conversation', routines__propose_change: 'Proposed a routine change',
};

export function describeStep(item: Record<string, unknown>): string | null {
  const type = String(item.type || '');
  const name = String(item.name || '');
  const input = (item.input && typeof item.input === 'object' ? item.input : {}) as Record<string, unknown>;
  if (type === 'toolUse' || type === 'mcpToolCall') {
    if (name.startsWith('mcp__aegir__')) {
      const tool = name.slice('mcp__aegir__'.length);
      if (OWN_TOOLS[tool]) return OWN_TOOLS[tool];
      if (tool.startsWith('memory__remember')) return 'Saved a memory';
      if (tool.startsWith('memory__recall')) return 'Searched its memory';
      if (tool.startsWith('skills__')) return `Skills: ${words(tool.slice('skills__'.length))}`;
      if (tool.startsWith('browser__')) return `Browser: ${words(tool.slice('browser__'.length))}`;
      return words(tool);
    }
    switch (name) {
      case 'WebSearch': return `Searched the web: "${clip(input.query, 70)}"`;
      case 'WebFetch': return `Read ${host(input.url)}`;
      case 'Read': return `Read ${shortPath(input.file_path)}`;
      case 'Grep': return `Searched files for "${clip(input.pattern, 50)}"`;
      case 'Glob': return `Looked for files matching ${clip(input.pattern, 50)}`;
      case 'Bash': return `Ran ${clip(input.command, 80)}`;
      case 'Write': return `Wrote ${shortPath(input.file_path)}`;
      case 'Edit': case 'MultiEdit': return `Edited ${shortPath(input.file_path)}`;
      case 'NotebookEdit': return `Edited ${shortPath(input.notebook_path)}`;
      case 'Task': case 'Agent': return `Asked a subagent: ${clip(input.description || input.prompt, 70)}`;
      case 'Skill': return `Used the ${clip(input.skill || input.command, 40)} skill`;
      case 'TodoWrite': return 'Updated its plan';
      case 'ToolSearch': return null;
    }
    const mcp = name.match(/^mcp__(.+?)__(.+)$/);
    if (mcp) return `${words(mcp[2])} (${words(mcp[1])})`;
    return words(name) || null;
  }
  if (!type || type === 'agentMessage' || type === 'userMessage' || type === 'reasoning') return null;
  // Codex: commandExecution, fileChange, webSearch and the like.
  if (typeof item.command === 'string' || Array.isArray(item.command)) return `Ran ${clip(Array.isArray(item.command) ? item.command.join(' ') : item.command, 80)}`;
  if (typeof item.query === 'string') return `Searched the web: "${clip(item.query, 70)}"`;
  return words(type.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase());
}

export const MAX_STEPS = 200;
export function addStep(steps: Step[], step: Step) {
  if (steps.length < MAX_STEPS) steps.push(step);
  else steps[MAX_STEPS - 1] = { kind: 'tool', label: 'More steps not shown', at: step.at };
}
