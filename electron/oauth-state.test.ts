import { describe, expect, it } from 'vitest';
import { createOAuthState, matchesOAuthState } from './oauth-state.js';

describe('OAuth callback state', () => {
  it('generates distinct callback states for separate authorization attempts', () => {
    const first = createOAuthState();
    const second = createOAuthState();
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).not.toBe(first);
    expect(matchesOAuthState(first, first)).toBe(true);
  });

  it('rejects missing and mismatched callback states', () => {
    const expected = createOAuthState();
    expect(matchesOAuthState(expected, null)).toBe(false);
    expect(matchesOAuthState(null, expected)).toBe(false);
    expect(matchesOAuthState(expected, createOAuthState())).toBe(false);
  });
});
