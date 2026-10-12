import { describe, expect, it } from 'vitest';
import { VIBRANCY_FLAG, windowLook } from './window-look';

describe('windowLook', () => {
  it('gives the macOS window the clear under-window material, always on, a transparent background and the flag for the page', () => {
    expect(windowLook('darwin')).toEqual({ vibrancy: 'under-window', visualEffectState: 'active', backgroundColor: '#00000000', args: [VIBRANCY_FLAG] });
  });

  it('keeps the solid frame colour everywhere else', () => {
    for (const platform of ['linux', 'win32'] as const) expect(windowLook(platform)).toEqual({ backgroundColor: '#e8e8ed', args: [] });
  });

  it('uses the flag the preload looks for', async () => {
    const { readFileSync } = await import('node:fs');
    expect(readFileSync('electron/preload.ts', 'utf8')).toContain(`process.argv.includes('${VIBRANCY_FLAG}')`);
  });
});
