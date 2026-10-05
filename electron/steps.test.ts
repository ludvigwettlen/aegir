import { homedir } from 'node:os';
import { describe, expect, it } from 'vitest';
import type { Step } from '../shared/types.js';
import { addStep, describeStep, MAX_STEPS } from './steps.js';

describe('step lines under a reply', () => {
  it('describes Claude Code tool use in plain words', () => {
    expect(describeStep({ type: 'toolUse', name: 'WebSearch', input: { query: 'Harborlight team' } })).toBe('Searched the web: "Harborlight team"');
    expect(describeStep({ type: 'toolUse', name: 'WebFetch', input: { url: 'https://www.example.com/team' } })).toBe('Read www.example.com/team');
    expect(describeStep({ type: 'toolUse', name: 'Read', input: { file_path: `${homedir()}/brain/companies/harborlight.md` } })).toBe('Read ~/brain/companies/harborlight.md');
    expect(describeStep({ type: 'toolUse', name: 'Bash', input: { command: 'gbrain search "Harborlight" --limit 2' } })).toBe('Ran gbrain search "Harborlight" --limit 2');
    expect(describeStep({ type: 'toolUse', name: 'mcp__claude_ai_HubSpot__search_crm_objects', input: {} })).toBe('search crm objects (HubSpot)');
    expect(describeStep({ type: 'mcpToolCall', name: 'mcp__aegir__tasks__suggest', input: {} })).toBe('Suggested a task');
    expect(describeStep({ type: 'mcpToolCall', name: 'mcp__aegir__memory__remember_7938327d_d4fe_4fad_85c5_94_bbfa2de1', input: {} })).toBe('Saved a memory');
    expect(describeStep({ type: 'toolUse', name: 'ToolSearch', input: {} })).toBeNull();
  });

  it('gives Codex items a generic line and skips chat items', () => {
    expect(describeStep({ type: 'commandExecution', command: ['ls', '-la'] })).toBe('Ran ls -la');
    expect(describeStep({ type: 'agentMessage', text: 'hi' })).toBeNull();
    expect(describeStep({ type: 'fileChange' })).toBe('file change');
  });

  it('caps a very long run of steps', () => {
    const steps: Step[] = [];
    for (let i = 0; i < MAX_STEPS + 5; i++) addStep(steps, { kind: 'tool', label: `step ${i}`, at: '' });
    expect(steps).toHaveLength(MAX_STEPS);
    expect(steps[MAX_STEPS - 1].label).toBe('More steps not shown');
  });
});
