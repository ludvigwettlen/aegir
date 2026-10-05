import { describe, expect, it } from 'vitest';
import { approvalTitle, describeToolRequest, exposedToolName, isInside, mcpContent } from './claude.js';
import { brainKeywords, parseGbrainResults } from './gbrain-memory.js';
import { chooseEngine } from './engine.js';
import { ToolResult } from './tool-result.js';

describe('Claude Code engine helpers', () => {
  it('keeps exposed tool names within Claude limits and stable', () => {
    expect(exposedToolName('tasks__suggest')).toBe('tasks__suggest');
    const long = `memory__remember_${'0f3e2a1b_'.repeat(4)}`;
    const exposed = exposedToolName(long);
    expect(`mcp__aegir__${exposed}`.length).toBeLessThanOrEqual(64);
    expect(exposedToolName(long)).toBe(exposed);
    expect(exposedToolName(`${long}x`)).not.toBe(exposed);
  });

  it('only auto-allows writes inside the task folder', () => {
    expect(isInside('/tmp/task', 'notes.md')).toBe(true);
    expect(isInside('/tmp/task', '/tmp/task/sub/a.md')).toBe(true);
    expect(isInside('/tmp/task', '../other/a.md')).toBe(false);
    expect(isInside('/tmp/task', '/Users/me/.zshrc')).toBe(false);
  });

  it('writes readable approval cards', () => {
    expect(approvalTitle('Bash', 'Bash')).toBe('Run a shell command');
    expect(approvalTitle('mcp__claude_ai_Slack__slack_send_message')).toBe('Use slack send message (Slack)');
    expect(approvalTitle('Bash', 'Claude wants to run git push')).toBe('Claude wants to run git push');
    expect(describeToolRequest('Bash', { command: 'git push', description: 'Push the branch' }, 'Not in allow list')).toBe('git push\nPush the branch\nWhy: Not in allow list');
    expect(describeToolRequest('Write', { file_path: '/Users/me/brain/x.md', content: 'secret' })).toBe('/Users/me/brain/x.md');
  });

  it('converts tool results to MCP content', () => {
    expect(mcpContent({ created: true })).toEqual({ content: [{ type: 'text', text: '{"created":true}' }] });
    expect(mcpContent(new ToolResult([{ type: 'inputText', text: 'hi' }, { type: 'inputImage', imageUrl: 'data:image/png;base64,AAAA' }], false))).toEqual({
      content: [{ type: 'text', text: 'hi' }, { type: 'image', mimeType: 'image/png', data: 'AAAA' }],
      isError: true,
    });
  });

  it('picks the engine from the setting, else what is installed', () => {
    expect(chooseEngine('codex', '/bin/claude')).toBe('codex');
    expect(chooseEngine(null, '/bin/claude')).toBe('claude');
    expect(chooseEngine(undefined, null)).toBe('codex');
  });
});

describe('gbrain memory helpers', () => {
  it('parses search output', () => {
    const output = '[1.1248] companies/harbour-group -- # Harbour Group\n\n> Type: Company (stale)\n[0.81] people/nadia -- Nadia runs events';
    expect(parseGbrainResults(output)).toEqual([
      { slug: 'companies/harbour-group', score: 1.1248, snippet: '# Harbour Group > Type: Company' },
      { slug: 'people/nadia', score: 0.81, snippet: 'Nadia runs events' },
    ]);
  });

  it('turns a message into the names and rarer words gbrain matches on', () => {
    expect(brainKeywords('Can you draft a reply to Nadia about bringing Elias to the EXPO event')).toBe('Nadia Elias EXPO bringing event');
    expect(brainKeywords('the and for')).toBe('');
  });
});
