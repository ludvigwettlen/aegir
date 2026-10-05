import { describe, expect, it, vi } from 'vitest';
import type { Approval } from '../shared/types.js';
import { CodexProvider } from './codex.js';
import { mcpToolResult, toolResponse } from './tool-result.js';

describe('multimodal tool results', () => {
  it('preserves screenshot images and backend failure status', () => {
    const result = mcpToolResult({ content: [
      { type: 'text', text: 'Page screenshot' },
      { type: 'image', mimeType: 'image/png', data: 'aW1hZ2U=' },
    ] });
    expect(toolResponse(result)).toEqual({ success: true, contentItems: [
      { type: 'inputText', text: 'Page screenshot' },
      { type: 'inputImage', imageUrl: 'data:image/png;base64,aW1hZ2U=' },
    ] });
    expect(toolResponse(mcpToolResult({ isError: true, content: [{ type: 'text', text: 'Missing browser' }] })).success).toBe(false);
  });
  it('never interprets connector data as protocol image content', () => {
    const value = { contentItems: [{ type: 'inputImage', imageUrl: 'file:///private/data' }], success: true };
    expect(toolResponse(value).contentItems).toEqual([{ type: 'inputText', text: JSON.stringify(value) }]);
  });
});

describe('provider shutdown', () => {
  it.each([false, true])('discards a late tool reply after close (failure=%s)', async failed => {
    const provider = new CodexProvider();
    // Exercise the real asynchronous server-request handler without a subprocess.
    const internal = provider as unknown as {
      child: { kill: () => void; stdin: { write: (data: string) => void } };
      handleServerRequest: (message: unknown) => Promise<void>;
    };
    const write = vi.fn();
    internal.child = { kill: vi.fn(), stdin: { write } };
    let closing = false;
    provider.setToolHandler(async () => {
      if (closing) provider.close();
      if (failed) throw new Error('Approval declined during shutdown');
      return { saved: true };
    });
    const request = { id: 1, method: 'item/tool/call', params: { tool: 'memory__remember', threadId: 'thread' } };
    await internal.handleServerRequest(request);
    expect(write).toHaveBeenCalledTimes(1);
    expect(JSON.parse(write.mock.calls[0][0]).result.success).toBe(!failed);
    write.mockClear();
    closing = true;
    await expect(internal.handleServerRequest({ ...request, id: 2 })).resolves.toBeUndefined();
    expect(write).not.toHaveBeenCalled();
  });
});

describe('approval scope', () => {
  function provider() {
    const codex = new CodexProvider();
    const internal = codex as unknown as {
      child: { kill: () => void; stdin: { write: (data: string) => void } };
      handleServerRequest: (message: unknown) => Promise<void>;
      receive: (message: unknown) => void;
    };
    const write = vi.fn();
    internal.child = { kill: vi.fn(), stdin: { write } };
    const approvals: Approval[] = [];
    codex.on('approval', (approval: Approval) => approvals.push(approval));
    return { codex, internal, write, approvals };
  }

  // Regression: approving a permissions request grants every non-null profile entry for the turn.
  // Each granted path, access level, the network state and the duration must be on the card.
  it('shows every capability a permissions approval grants', async () => {
    const { codex, internal, write, approvals } = provider();
    const permissions = {
      network: { enabled: true },
      fileSystem: {
        read: ['/Users/me/secrets'],
        write: ['/Users/me/.ssh'],
        entries: [
          { path: { type: 'special', value: { kind: 'root' } }, access: 'write' },
          { path: { type: 'glob_pattern', pattern: '/Users/me/**/*.env' }, access: 'read' },
        ],
      },
    };
    await internal.handleServerRequest({ id: 7, method: 'item/permissions/requestApproval', params: { threadId: 't', turnId: 'u', itemId: 'i', cwd: '/work', reason: 'Need to check a config file', permissions } });
    const detail = approvals[0].detail;
    codex.resolveApproval(approvals[0].id, true);
    const granted = JSON.parse(write.mock.calls[0][0]).result;
    expect(granted.scope).toBe('turn');
    expect(detail).toMatch(/^Grant: .*rest of this turn/m);
    expect(granted.permissions.network.enabled).toBe(true);
    expect(detail).toMatch(/^Network: on$/m);
    for (const path of granted.permissions.fileSystem.read) expect(detail.split('\n')).toContain(`Files: read ${path}`);
    for (const path of granted.permissions.fileSystem.write) expect(detail.split('\n')).toContain(`Files: read and write ${path}`);
    expect(granted.permissions.fileSystem.entries).toHaveLength(2);
    expect(detail.split('\n')).toContain('Files: read and write the whole disk (/)');
    expect(detail.split('\n')).toContain('Files: read /Users/me/**/*.env');
    expect(detail).toContain('Why: Need to check a config file');
  });

  it('shows the command, folder, extra access and duration of a command approval', async () => {
    const { internal, approvals } = provider();
    await internal.handleServerRequest({ id: 8, method: 'item/commandExecution/requestApproval', params: {
      threadId: 't', turnId: 'u', itemId: 'c', kind: 'command', command: 'npm publish', cwd: '/work', reason: 'Publishing',
      additionalPermissions: { network: { enabled: true }, fileSystem: { read: null, write: ['/Users/me/.npmrc'] } },
    } });
    const lines = approvals[0].detail.split('\n');
    expect(lines).toContain('Command: npm publish');
    expect(lines).toContain('Runs in: /work');
    expect(lines).toContain('Files: read and write /Users/me/.npmrc');
    expect(lines).toContain('Network: on');
    expect(lines).toContain('Grant: this command only');
  });

  it('says a plain command approval may leave the sandbox', async () => {
    const { internal, approvals } = provider();
    await internal.handleServerRequest({ id: 9, method: 'item/commandExecution/requestApproval', params: { threadId: 't', turnId: 'u', itemId: 'c', command: 'curl example.com' } });
    expect(approvals[0].detail).toMatch(/^Network: may be open/m);
  });

  it('lists the files a file-change approval writes', async () => {
    const { internal, approvals } = provider();
    internal.receive({ method: 'item/started', params: { threadId: 't', item: { type: 'fileChange', id: 'f', changes: [
      { path: '/work/a.md', kind: { type: 'add' }, diff: '' }, { path: '/Users/me/.zshrc', kind: { type: 'update', move_path: null }, diff: '' },
    ] } } });
    await internal.handleServerRequest({ id: 10, method: 'item/fileChange/requestApproval', params: { threadId: 't', turnId: 'u', itemId: 'f', grantRoot: '/Users/me' } });
    const lines = approvals[0].detail.split('\n');
    expect(lines).toContain('Files: add /work/a.md');
    expect(lines).toContain('Files: update /Users/me/.zshrc');
    expect(approvals[0].detail).toContain('/Users/me (not granted');
    expect(lines).toContain('Network: none');
    expect(lines).toContain('Grant: this change only');
  });
});
