import { expect, it, vi } from 'vitest';
import { readCalendarPage, parseCalendarPage } from './one-on-one-calendar.js';

const { end, execFile } = vi.hoisted(() => ({ end: vi.fn(), execFile: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile }));
vi.mock('node:fs', () => ({ existsSync: () => true }));

it('closes CLI stdin so a background calendar read cannot wait for a request body', async () => {
  execFile.mockImplementation((_file, _args, _options, callback) => {
    end.mockImplementation(() => callback(null, '{"items":[]}'));
    return { stdin: { end } };
  });
  await expect(readCalendarPage('work', '2026-10-13T00:00:00Z', '2026-10-20T00:00:00Z')).resolves.toEqual({ items: [] });
  expect(end).toHaveBeenCalledOnce();
  const args = execFile.mock.calls[0][1] as string[];
  expect(args[0]).toBe('proxy');
  expect(new URL(args[1]).hostname).toBe('www.googleapis.com');
  expect(args.slice(2)).toEqual(['--toolkit', 'googlecalendar', '--account', 'work']);
});

it('turns empty or truncated CLI output into an actionable refresh error', () => {
  expect(() => parseCalendarPage('')).toThrow('Try refreshing again');
  expect(() => parseCalendarPage('{')).toThrow('Existing meetings were kept');
});
