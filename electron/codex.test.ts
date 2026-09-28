import { describe, expect, it, vi } from 'vitest';
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
