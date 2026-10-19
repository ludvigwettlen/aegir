import { expect, it } from 'vitest';
import { windowLook } from './window-look';
it('uses native glass only on macOS, with a solid reduced-transparency fallback', () => {
  expect(windowLook('darwin')).toMatchObject({ vibrancy: 'under-window', backgroundColor: '#00000000', args: ['--aegir-vibrancy'] });
  expect(windowLook('darwin', true)).toEqual({ backgroundColor: '#e8e8ed', args: ['--aegir-vibrancy'] });
  expect(windowLook('linux')).toEqual({ backgroundColor: '#e8e8ed', args: [] });
});
