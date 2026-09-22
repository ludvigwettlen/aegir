import { randomBytes, timingSafeEqual } from 'node:crypto';

export function createOAuthState(): string {
  return randomBytes(32).toString('hex');
}

export function matchesOAuthState(expected: string | null | undefined, received: string | null): boolean {
  if (!expected || !received) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  return left.length === right.length && timingSafeEqual(left, right);
}
