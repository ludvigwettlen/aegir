import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import type { Task } from '../shared/types.js';
import { ClaudeProvider } from './claude.js';
import { findClaudeBinary } from './engine.js';
import { readRubric, readTriage, triageInstructions, triagePrompt } from './task-triage.js';

// A real prioritizing run on the live export, through the installed Claude Code, before shipping a rubric or prompt
// change: LEGOLAS_TRIAGE_LIVE=1. It reads the brain and changes nothing; the bands go to LEGOLAS_TRIAGE_OUT.
it.skipIf(process.env.LEGOLAS_TRIAGE_LIVE !== '1')('bands the live task list', async () => {
  const brain = join(homedir(), 'brain');
  const empty = { priority: null, prioritySource: null, agentPriority: null, priorityReason: null, prioritySetAt: null, priorityCheckedAt: null };
  const tasks = (JSON.parse(readFileSync(join(brain, 'queues', 'legolas-tasks.json'), 'utf8')) as Task[])
    .map((task) => ({ ...task, ...empty }))
    .filter((task) => ['proposed', 'ready', 'running', 'review', 'blocked'].includes(task.status));
  const decide = new Set(tasks.map((task) => task.id));
  const { prompt, ids } = triagePrompt(tasks, decide, [], new Date());
  const provider = new ClaudeProvider(findClaudeBinary()!, { workDirs: [brain] });
  const started = Date.now();
  const result = await provider.run({ kind: 'triage', cwd: mkdtempSync(join(tmpdir(), 'triage-live-')), instructions: triageInstructions(readRubric(join(brain, 'queues', 'priority-rubric.md'))), prompt, tools: [], onDelta: () => {} });
  const calls = readTriage(result.text, ids, decide);
  const rows = calls.map((call) => ({ ...call, title: tasks.find((task) => task.id === call.taskId)!.title })).sort((a, b) => a.priority - b.priority);
  writeFileSync(process.env.LEGOLAS_TRIAGE_OUT || join(tmpdir(), 'legolas-triage-live.json'), JSON.stringify({ seconds: Math.round((Date.now() - started) / 1000), status: result.status, rows }, null, 1));
  expect(result.status).toBe('completed');
  expect(calls.length).toBe(tasks.length);
}, 420_000);
