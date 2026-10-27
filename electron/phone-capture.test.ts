import { expect, it, vi } from 'vitest';
import { PhoneCapture } from './phone-capture.js';
import type { Store } from './db.js';
const calls = vi.hoisted(() => ({ sync: vi.fn(async () => ({ imported: 2, keptForAlert: 1, failed: 0 })) }));
vi.mock('./reminders.js', () => ({ RemindersHelper: class {}, parseLedger: () => ({}), syncReminders: calls.sync }));
it('requires opt-in, respects paused setup, guards unavailable helpers and stops on shutdown', async () => {
  const settings = new Map<string, string>();
  const store = { isOpen: true, getSetting: (key: string) => settings.get(key), setSetting: (key: string, value: string) => settings.set(key, value) } as unknown as Store;
  const capture = new PhoneCapture(store, '/fake/helper', () => {});
  await capture.sync(); expect(calls.sync).not.toHaveBeenCalled();
  capture.configure(true, 'Phone'); settings.set('setupAutomationPaused', 'true');
  await capture.sync(); expect(calls.sync).not.toHaveBeenCalled();
  settings.set('setupAutomationPaused', 'false'); await capture.sync();
  expect(calls.sync).toHaveBeenCalledTimes(1); expect(capture.state().detail).toContain('2 imported');
  capture.stop(); await capture.sync(); expect(calls.sync).toHaveBeenCalledTimes(1);
  expect(() => new PhoneCapture(store, null, () => {}).configure(true, 'Phone')).toThrow('macOS');
  expect(() => capture.configure(false, '')).toThrow('Name');
});
