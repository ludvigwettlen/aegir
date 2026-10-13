import { expect, it } from 'vitest';
import { defaultTypography, readTypography, validateTypography } from './typography';

it('preserves existing font choices when adding default text sizes', () => {
  expect(readTypography('{"system":"dm-sans","editor":"lora"}')).toEqual({ ...defaultTypography, system: 'dm-sans', editor: 'lora' });
});

it('rejects invalid size settings at the persistence boundary', () => {
  for (const key of ['systemScale', 'editorSize', 'scratchpadSize']) {
    for (const value of [null, '14', -1, 0, 1000, 14.5, NaN, Infinity]) {
      expect(() => validateTypography({ ...defaultTypography, [key]: value })).toThrow('text size');
    }
  }
});
