import { expect, it } from 'vitest';
import { browserAllowed, connectorDecision, connectorReadOnly, nativeMcpReadOnly, nativeToolDecision } from './tool-authorization.js';

it('requires a reviewed tool identity and honors explicit write/destructive metadata', () => {
  expect(connectorReadOnly('notion', 'notion-fetch')).toBe(true);
  expect(connectorReadOnly('notion', 'notion-fetch', { readOnlyHint: false })).toBe(false);
  expect(connectorReadOnly('notion', 'notion-fetch', { readOnlyHint: true, destructiveHint: true })).toBe(false);
  for (const name of ['get-and-delete', 'search-and-send', 'download-export', 'notion-get-unknown']) {
    expect(connectorReadOnly('notion', name, { readOnlyHint: true })).toBe(false);
  }
  for (const provider of ['unknown', 'constructor', '__proto__']) expect(connectorReadOnly(provider, 'notion-fetch')).toBe(false);
});
it('uses the same classification for native connections without trusting unknown read annotations', () => {
  expect(nativeMcpReadOnly('claude_ai_Slack', 'slack_search', { readOnly: true })).toBe(true);
  expect(nativeMcpReadOnly('claude_ai_Slack', 'slack_search', { destructive: true })).toBe(false);
  expect(nativeMcpReadOnly('unreviewed', 'search', { readOnly: true })).toBe(false);
  expect(nativeMcpReadOnly('Slack', 'slack_search_and_send', { readOnly: true })).toBe(false);
});
it('denies stale calls and unattended writes, with one attended approval for writes', () => {
  for (const readOnly of [true, false]) expect(connectorDecision(undefined, readOnly)).toBe('deny');
  for (const kind of ['task', 'routine', 'prep'] as const) {
    expect(connectorDecision(kind, true)).toBe('allow');
    expect(connectorDecision(kind, false)).toBe('deny');
  }
  expect(connectorDecision('chat', false)).toBe('ask');
  expect(connectorDecision('chat', true)).toBe('allow');
  expect(browserAllowed('routine')).toBe(false);
  expect(browserAllowed('prep')).toBe(false);
  expect(browserAllowed('task')).toBe(true);
  expect(nativeToolDecision('mcp__Slack__send_message', { kind: 'chat', readOnly: true, writable: false })).toBe('deny');
});
