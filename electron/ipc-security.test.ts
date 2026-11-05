import { expect, it } from 'vitest';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { assertTrustedSender, validateIpcArgs } from './ipc-security.js';

const rendererUrl = 'file:///Applications/Aegir.app/Contents/Resources/app.asar/dist/index.html';
function fixture(url = rendererUrl) {
  const frame = { url };
  const contents = { mainFrame: frame };
  const window = { isDestroyed: () => false, webContents: contents } as unknown as BrowserWindow;
  const event = { sender: contents, senderFrame: frame } as unknown as IpcMainInvokeEvent;
  return { window, event };
}
it('accepts only the expected window main frame at the exact app URL', () => {
  const { window, event } = fixture();
  expect(() => assertTrustedSender(event, window, rendererUrl)).not.toThrow();
  for (const url of ['https://attacker.example', `${rendererUrl}?untrusted=1`, rendererUrl.replace('index.html', 'other.html')]) {
    const f = fixture(url);
    expect(() => assertTrustedSender(f.event, f.window, rendererUrl)).toThrow('Untrusted');
  }
  expect(() => assertTrustedSender({ ...event, sender: {} } as IpcMainInvokeEvent, window, rendererUrl)).toThrow('Untrusted');
  expect(() => assertTrustedSender({ ...event, senderFrame: { url: rendererUrl } } as IpcMainInvokeEvent, window, rendererUrl)).toThrow('Untrusted');
  expect(() => assertTrustedSender({ ...event, senderFrame: null } as IpcMainInvokeEvent, window, rendererUrl)).toThrow('Untrusted');
  expect(() => assertTrustedSender(event, null, rendererUrl)).toThrow('Untrusted');
});
it('checks the exact development URL and permits only fragment navigation', () => {
  const f = fixture('http://localhost:5173/#tasks');
  expect(() => assertTrustedSender(f.event, f.window, 'http://localhost:5173/')).not.toThrow();
  expect(() => assertTrustedSender(f.event, f.window, 'http://localhost:5174/')).toThrow('Untrusted');
});
it('rejects malformed approvals, draft fields, paths, unsupported fields and unexpected arguments', () => {
  expect(validateIpcArgs('resolve-approval', ['approval', false])).toEqual(['approval', false]);
  expect(validateIpcArgs('send-message', ['thread', 'hello'])).toEqual(['thread', 'hello']);
  for (const [channel, args] of [
    ['resolve-approval', ['approval', 'false']],
    ['snapshot', ['extra']],
    ['update-install', ['/tmp/untrusted.app']],
    ['update-token', [{ token: 'invalid' }]],
    ['update-token', ['x'.repeat(501)]],
    ['document-read', ['thread', { path: 'secret.md' }]],
    ['gmail-draft-send', ['id', 1, { to: 'person', body: 'hello' }]],
    ['update-task', ['id', { outputDir: '/tmp/escape' }]],
    ['create-task', [{ title: 'Task', status: 'running' }]],
    ['configure-reminders', [1, 'Reminders']],
    ['connect', ['unknown']],
  ] as [string, unknown[]][]) expect(() => validateIpcArgs(channel, args)).toThrow('Invalid arguments');
  for (const channel of ['unregistered', 'toString', '__proto__']) expect(() => validateIpcArgs(channel, [])).toThrow('no argument schema');
});
