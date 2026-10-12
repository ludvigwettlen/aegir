import type { BrowserWindowConstructorOptions } from 'electron';

// Glass step 2 (12 Oct 2026): on macOS the window is Apple's sidebar material, so the desktop shows through the
// window frame and the sidebar pane, blurred, as in Finder. The page sees the flag in its preload and paints its
// frame transparent (html.ws-vibrant). Other platforms, and the browser test fixtures, keep the solid frame colour.
export const VIBRANCY_FLAG = '--legolas-vibrancy';
const FRAME = '#e8e8ed'; // --ds-color-window

type Look = Pick<BrowserWindowConstructorOptions, 'vibrancy' | 'visualEffectState' | 'backgroundColor'> & { args: string[] };

export function windowLook(platform: NodeJS.Platform): Look {
  if (platform !== 'darwin') return { backgroundColor: FRAME, args: [] };
  // followWindow: like Finder, the material turns flat grey while another app is in front.
  // A transparent background lets the material show from the first frame, so nothing flashes at launch.
  return { vibrancy: 'sidebar', visualEffectState: 'followWindow', backgroundColor: '#00000000', args: [VIBRANCY_FLAG] };
}
