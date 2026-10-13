import { useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@usefragments/ui';
import { readTypography, validateTypography, type Typography } from '../../../shared/typography';
import type { DesktopApi } from '../../../shared/types';
import { applyTypography } from '../typography';
import '../styles';

let update = (_value: Typography) => {};
window.aegir = {
  setTypography: async (value: Typography) => {
    await new Promise(resolve => setTimeout(resolve, 100));
    if ((window as any).failTypography) throw new Error('Could not save font settings');
    const next = validateTypography(value);
    localStorage.setItem('test-typography', JSON.stringify(next)); update(next);
  },
} as unknown as DesktopApi;
const { TypographySettings } = await import('../views/TypographySettings');
const { DocumentScratchpad } = await import('../views/DocumentScratchpad');
function Fixture() {
  const [value, setValue] = useState(() => readTypography(localStorage.getItem('test-typography') || undefined));
  update = setValue;
  useLayoutEffect(() => applyTypography(value), [value]);
  return <ThemeProvider defaultMode="light"><style>{'body{min-width:0}.typography-fixture{max-width:960px;margin:auto;padding:24px}.sample-workspace{display:grid;gap:16px;margin-top:20px}.sample-workspace .ws-document-companion{position:relative;left:0;top:0;height:300px;max-width:100%}'}</style>
    <div className="ws-shell"><main className="page-scroll supporting-page"><div className="typography-fixture">
      <TypographySettings value={value} />
      <div className="sample-workspace">
        <button className="ws-nav-item">Navigation sample</button>
        <div className="ws-task-title">Task sample</div>
        <div className="ws-message-text">Conversation sample</div>
        <div className="ws-document-prose" data-document-sample><h1>Document heading</h1><p>Document body</p><table><tbody><tr><td>Table cell</td></tr></tbody></table></div>
        <aside className="ws-document-companion"><div className="ws-document-scratchpad"><DocumentScratchpad storageKey="test-scratchpad" statusId="test-scratchpad-status" /></div></aside>
      </div>
    </div></main></div>
  </ThemeProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
