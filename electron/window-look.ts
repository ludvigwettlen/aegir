import type { BrowserWindowConstructorOptions } from 'electron';
type Look = Pick<BrowserWindowConstructorOptions, 'visualEffectState' | 'backgroundColor'> & { vibrancy?: 'under-window'; args: string[] };
// Keep the solid fallback in sync with --ds-color-window. Font preferences remain in the renderer.
export function windowLook(platform: NodeJS.Platform, reduceTransparency = false): Look {
  const args = platform === 'darwin' ? ['--aegir-vibrancy'] : [];
  if (platform !== 'darwin' || reduceTransparency) return { backgroundColor: '#e8e8ed', args };
  return { vibrancy: 'under-window', visualEffectState: 'active', backgroundColor: '#00000000', args };
}
