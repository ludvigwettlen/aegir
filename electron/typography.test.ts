import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { Store } from './db.js';
import { defaultTypography, readTypography, validateTypography } from '../shared/typography.js';

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }));

it('keeps independent system/editor choices across reopening and rejects unknown fonts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'aegir-fonts-'));
  const path = join(directory, 'aegir.sqlite');
  let store = new Store(path);
  try {
    expect(readTypography(store.getSetting('typography'))).toEqual(defaultTypography);
    const selection = { system: 'dm-sans', editor: 'lora' };
    store.setSetting('typography', JSON.stringify(validateTypography(selection)));
    store.close();
    store = new Store(path);
    expect(readTypography(store.getSetting('typography'))).toEqual(selection);
    expect(() => store.setSetting('typography', JSON.stringify(validateTypography({ system: 'missing', editor: 'lora' })))).toThrow();
    expect(readTypography(store.getSetting('typography'))).toEqual(selection);
    expect(readTypography('{corrupt')).toEqual(defaultTypography);
    expect(readTypography('{"system":"removed-font","editor":"inter"}')).toEqual(defaultTypography);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});
