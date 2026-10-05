import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { frontMatter, readClaudeRoutines, type RunCache } from './claude-schedule.js';

const day = 86_400_000;
function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'aegir-claude-'));
  const dir = join(base, 'account', 'org');
  const old = join(base, 'account', 'other');
  mkdirSync(dir, { recursive: true }); mkdirSync(old, { recursive: true });
  const skills = join(base, 'skills');
  mkdirSync(skills);
  writeFileSync(join(skills, 'brief.md'), '---\nname: cron-daily-brief\ndescription: "Writes the morning brief."\n---\nBody');
  writeFileSync(join(skills, 'sweep.md'), '---\nname: slack-sweep\ndescription: >\n  Sweeps Slack\n  every hour.\n---\n');
  writeFileSync(join(dir, 'scheduled-tasks.json'), JSON.stringify({ scheduledTasks: [
    { id: 'cron-slack-sweep', cronExpression: '0 7-22 * * 1-5', enabled: false, filePath: join(skills, 'sweep.md'), createdAt: 1, lastRunAt: null },
    { id: 'cron-daily-brief', cronExpression: '0 5 * * *', enabled: true, filePath: join(skills, 'brief.md'), createdAt: 1, lastRunAt: '2026-10-05T03:00:00.000Z' },
    { id: 'one-off', enabled: true, filePath: join(skills, 'missing.md') },
    { cronExpression: '0 5 * * *' }, 'junk',
  ] }));
  writeFileSync(join(old, 'scheduled-tasks.json'), JSON.stringify({ scheduledTasks: [] }));
  utimesSync(join(old, 'scheduled-tasks.json'), new Date(Date.now() - day), new Date(Date.now() - day));
  const now = Date.parse('2026-10-05T12:00:00Z');
  const run = (name: string, value: unknown, age = 0) => {
    const path = join(dir, name);
    writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value));
    utimesSync(path, new Date(now - age), new Date(now - age));
  };
  const at = (h: number) => Date.parse(`2026-10-05T0${h}:00:00Z`);
  run('local_a.json', { scheduledTaskId: 'cron-daily-brief', createdAt: at(3), lastActivityAt: at(3) + 60_000, title: 'Brief', postTurnSummary: { status_category: 'completed', status_detail: 'wrote the brief', needs_action: '' } });
  run('local_b.json', { scheduledTaskId: 'cron-daily-brief', createdAt: at(4), lastActivityAt: at(4), title: 'Brief', postTurnSummary: { status_category: 'blocked', status_detail: 'Gmail auth failed', needs_action: 'create a new app password' } });
  run('local_c.json', { scheduledTaskId: 'cron-daily-brief', createdAt: at(5), title: 'Brief', error: 'API Error: Connection dropped' });
  run('local_d.json', { scheduledTaskId: 'cron-daily-brief', createdAt: at(6), title: 'Still running' });
  run('local_old.json', { scheduledTaskId: 'cron-daily-brief', createdAt: at(1), title: 'Too old' }, 15 * day);
  run('local_bad.json', '{ half a file');
  run('local_chat.json', { createdAt: at(2), title: 'Interactive session' });
  return { base, dir, now, run };
}

describe('Claude Code scheduled tasks', () => {
  it('reads the newest registry, descriptions and recent runs', async () => {
    const { base, dir, now } = fixture();
    const result = await readClaudeRoutines(base, now, new Map());
    expect(result.source).toBe(join(dir, 'scheduled-tasks.json'));
    expect(result.tasks.map(task => [task.id, task.enabled, task.schedule])).toEqual([
      ['cron-daily-brief', true, 'Daily at 05:00'], ['one-off', true, 'One-off'], ['cron-slack-sweep', false, 'Hourly 07:00–22:00, weekdays'],
    ]);
    const [brief, oneOff, sweep] = result.tasks;
    expect(brief).toMatchObject({ name: 'cron-daily-brief', description: 'Writes the morning brief.', cron: '0 5 * * *', lastRunAt: '2026-10-05T03:00:00.000Z' });
    expect(sweep.description).toBe('Sweeps Slack every hour.');
    expect(oneOff).toMatchObject({ name: 'one-off', description: '', cron: null, runs: [] });
    expect(brief.runs.map(run => [run.status, run.detail, run.needsAction])).toEqual([
      ['unknown', 'Still running', null],
      ['failed', 'API Error: Connection dropped', null],
      ['needs_action', 'Gmail auth failed', 'create a new app password'],
      ['completed', 'wrote the brief', null],
    ]);
    expect(brief.runs[3]).toMatchObject({ startedAt: '2026-10-05T03:00:00.000Z', endedAt: '2026-10-05T03:01:00.000Z' });
  });

  it('reuses parsed runs until a file changes', async () => {
    const { base, now, run } = fixture();
    const cache: RunCache = new Map();
    await readClaudeRoutines(base, now, cache);
    expect([...cache.keys()].sort()).toEqual(['local_a.json', 'local_b.json', 'local_bad.json', 'local_c.json', 'local_chat.json', 'local_d.json']);
    cache.set('local_a.json', { ...cache.get('local_a.json')!, value: { taskId: 'cron-daily-brief', run: { startedAt: '2026-10-05T00:00:00.000Z', endedAt: null, status: 'completed', detail: 'from cache', needsAction: null } } });
    expect((await readClaudeRoutines(base, now, cache)).tasks[0].runs.at(-1)?.detail).toBe('from cache');
    run('local_a.json', { scheduledTaskId: 'cron-daily-brief', createdAt: Date.parse('2026-10-05T02:00:00Z'), postTurnSummary: { status_category: 'completed', status_detail: 'reread' } }, 1000);
    expect((await readClaudeRoutines(base, now, cache)).tasks[0].runs.at(-1)?.detail).toBe('reread');
  });

  it('shows nothing when the Claude app files are missing or malformed', async () => {
    expect(await readClaudeRoutines(join(tmpdir(), 'no-such-claude-dir'))).toEqual({ tasks: [], source: null });
    const base = mkdtempSync(join(tmpdir(), 'aegir-claude-'));
    mkdirSync(join(base, 'a', 'b'), { recursive: true });
    writeFileSync(join(base, 'a', 'b', 'scheduled-tasks.json'), '{ broken');
    expect(await readClaudeRoutines(base, Date.now(), new Map())).toEqual({ tasks: [], source: null });
    writeFileSync(join(base, 'a', 'b', 'scheduled-tasks.json'), JSON.stringify({ scheduledTasks: 'nope' }));
    expect((await readClaudeRoutines(base, Date.now(), new Map())).tasks).toEqual([]);
  });

  it('parses front matter fields', () => {
    expect(frontMatter('---\nname: x\ndescription: \'Quoted\'\n---\n')).toEqual({ name: 'x', description: 'Quoted' });
    expect(frontMatter('no header')).toEqual({});
  });
});
