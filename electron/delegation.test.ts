import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from './db.js';
import { DelegationService, notionId, resultRows } from './delegation.js';
import { tasksFor } from '../shared/tasks.js';
import type { DelegationInput } from '../shared/delegation.js';
vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }));
const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach(fn => fn()));
const id = '51d440ed-1827-43ab-8da5-805e699bfdf2';
const user = { id: 'd0894967-e1ac-4794-9092-322baa213b76', name: 'Malcolm', email: 'malcolm@example.com' };
const input: DelegationInput = { assignee: user, taggedPeople: [], brief: 'Review the launch plan.' };
const envelope = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data) }] });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'aegir-delegation-')); const path = join(dir, 'db'); const store = new Store(path);
  const schema = Object.fromEntries(Object.entries({ Name: 'title', Assignee: 'person', 'Tagged people': 'person', 'Delegated by': 'person', Status: 'select', Brief: 'text', Progress: 'text', Due: 'date', Tags: 'text', 'Aegir ID': 'text' }).map(([name, type]) => [name, { type, ...(name === 'Status' ? { options: ['Assigned', 'Accepted', 'In progress', 'Blocked', 'Ready for review', 'Done', 'Cancelled'].map(name => ({ name })) } : {}) }]));
  const remote: Record<string, any>[] = []; let ambiguous = false; let failQuery = false; let rejectWrite = false;
  const call = vi.fn(async (_provider: string, tool: string, args: any) => {
    if (tool === 'notion-fetch') return envelope({ text: `<data-source url="{{collection://${id}}}"></data-source><data-source-state>${JSON.stringify({ schema })}</data-source-state>` });
    if (tool === 'notion-get-users') return envelope({ results: [{ ...user, type: 'person' }] });
    if (tool === 'notion-query-data-sources') { if (failQuery) throw new Error('Notion unavailable'); return envelope({ results: remote.filter(row => row['Aegir ID'] === args.data.params[0]), has_more: false }); }
    if (rejectWrite) throw new Error('Write denied');
    if (tool === 'notion-create-pages') {
      const row = { url: 'https://www.notion.so/40892fd0e10181f5b48debf3092a539a', ...args.pages[0].properties }; remote.push(row);
      if (ambiguous) throw new Error('Network timeout after create');
      return envelope({ pages: [{ id: '40892fd0-e101-81f5-b48d-ebf3092a539a', url: row.url }] });
    }
    if (tool === 'notion-update-page') { Object.assign(remote[0], args.properties); return envelope({ page_id: args.page_id }); }
    throw new Error(`Unexpected tool ${tool}`);
  });
  const connectors = { listTools: () => ['fetch', 'get-users', 'query-data-sources', 'create-pages', 'update-page'].map(action => ({ name: `notion__notion-${action}`, description: '', inputSchema: {}, readOnly: false })), call };
  const service = new DelegationService(store, connectors, () => {});
  cleanups.push(() => { service.close(); store.close(); rmSync(dir, { recursive: true, force: true }); });
  return { store, service, remote, call, path, setAmbiguous: () => { ambiguous = true; }, failQuery: () => { failQuery = true; }, rejectWrite: () => { rejectWrite = true; } };
}
it('publishes only reviewed shared fields, tags real people, and keeps private work local', async () => {
  const f = fixture(); const task = f.store.createTask({ title: 'Launch', notes: 'PRIVATE SECRET', labels: ['work'], dueAt: '2026-10-30' });
  await f.service.delegate(task.id, { ...input, taggedPeople: [user] });
  expect(f.remote).toHaveLength(1); expect(f.remote[0]).toMatchObject({ Name: 'Launch', Brief: input.brief, Assignee: JSON.stringify([user.id]), 'Tagged people': JSON.stringify([user.id]), Tags: '#work', 'date:Due:start': '2026-10-30' });
  expect(JSON.stringify(f.call.mock.calls)).not.toContain('PRIVATE SECRET');
  expect(f.store.get('tasks', task.id)?.delegation).toMatchObject({ status: 'Assigned', publishing: false, assignee: user });
  expect(tasksFor('team', f.store.list('tasks'))).toHaveLength(1);
  await f.service.delegate(task.id, { ...input, brief: 'Updated brief' }); expect(f.remote).toHaveLength(1); expect(f.remote[0].Brief).toBe('Updated brief');
});
it('recovers a create that committed before timeout without duplicating it, even after restart', async () => {
  const f = fixture(); const task = f.store.createTask({ title: 'Launch' }); f.setAmbiguous();
  await expect(f.service.delegate(task.id, input)).rejects.toThrow('timeout');
  expect(f.remote).toHaveLength(1); expect(f.store.get('tasks', task.id)?.delegation?.publishing).toBe(true);
  const store2 = new Store(f.path); const service2 = new DelegationService(store2, { listTools: () => ['fetch', 'get-users', 'query-data-sources', 'create-pages', 'update-page'].map(action => ({ name: `notion__notion-${action}`, description: '', inputSchema: {}, readOnly: false })), call: f.call }, () => {});
  try { await service2.delegate(task.id, input); expect(f.remote).toHaveLength(1); expect(store2.get('tasks', task.id)?.delegation?.publishing).toBe(false); }
  finally { service2.close(); store2.close(); }
});
it('pulls progress into Needs you without overwriting local status, title, notes or creating repeated tasks', async () => {
  const f = fixture(); const task = f.store.createTask({ title: 'Local title', notes: 'Private', recurrence: 'daily' });
  await f.service.delegate(task.id, input);
  Object.assign(f.remote[0], { Status: 'Done', Progress: 'Here is my result', Name: 'Remote title' });
  await f.service.sync(); const fresh = f.store.get('tasks', task.id)!;
  expect(fresh).toMatchObject({ title: 'Local title', notes: 'Private', status: 'ready', nextOccurrenceId: null, delegation: { status: 'Done', progress: 'Here is my result', error: null } });
  expect(tasksFor('needs', [fresh])).toHaveLength(1); expect(f.store.list('tasks')).toHaveLength(1);
  f.store.updateTask(task.id, { status: 'done' }, true); expect(tasksFor('needs', f.store.list('tasks'))).toHaveLength(0); expect(f.store.list('tasks')).toHaveLength(2);
  f.store.undoTaskAction(); expect(f.store.list('tasks')).toHaveLength(1); expect(f.store.get('tasks', task.id)?.delegation?.status).toBe('Done');
});
it('keeps shared identity through local delete and undo and does not inherit it on recurrence', async () => {
  const f = fixture(); const task = f.store.createTask({ title: 'Launch', recurrence: 'daily' }); await f.service.delegate(task.id, input);
  f.store.deleteTask(task.id, true); expect(f.remote).toHaveLength(1); f.store.undoTaskAction();
  expect(f.store.get('tasks', task.id)?.delegation?.pageUrl).toBeTruthy();
  f.store.updateTask(task.id, { status: 'done' }); const next = f.store.list('tasks').find(t => t.id !== task.id)!; expect(next.delegation).toBeUndefined();
});
it('preserves collaborator progress during republish, and reports sync failures without dropping cached data', async () => {
  const f = fixture(); const task = f.store.createTask({ title: 'Launch' }); await f.service.delegate(task.id, input);
  Object.assign(f.remote[0], { Status: 'In progress', Progress: 'Working' }); await f.service.delegate(task.id, input);
  expect(f.remote[0]).toMatchObject({ Status: 'In progress', Progress: 'Working' });
  f.failQuery(); await expect(f.service.sync()).rejects.toThrow('unavailable');
  expect(f.store.get('tasks', task.id)?.delegation).toMatchObject({ status: 'In progress', progress: 'Working', error: 'Notion unavailable' });
});
it('fails closed on duplicate records, unknown status, missing records and rejected writes', async () => {
  const f = fixture(); const task = f.store.createTask({ title: 'Launch' }); await f.service.delegate(task.id, input);
  f.remote.push({ ...f.remote[0] }); await expect(f.service.delegate(task.id, input)).rejects.toThrow('Multiple'); f.remote.pop();
  f.remote[0].Status = 'Unsupported'; await expect(f.service.sync()).rejects.toThrow('Unknown');
  f.remote.splice(0); await expect(f.service.delegate(task.id, input)).rejects.toThrow('missing'); expect(f.remote).toHaveLength(0);
});
it('rejects invalid input and unavailable tools before publishing', async () => {
  const f = fixture(); const task = f.store.createTask({ title: 'Launch' });
  await expect(f.service.delegate(task.id, { ...input, assignee: { id: 'made-up', name: 'Malcolm' } })).rejects.toThrow();
  const service = new DelegationService(f.store, { listTools: () => [], call: f.call }, () => {});
  await expect(service.delegate(task.id, input)).rejects.toThrow('Reconnect Notion'); expect(f.remote).toHaveLength(0);
  f.store.updateTask(task.id, { status: 'done' }); await expect(f.service.delegate(task.id, input)).rejects.toThrow('open task');
});
it('updates shared status explicitly and leaves local completion under user control', async () => {
  const f = fixture(); const task = f.store.createTask({ title: 'Launch' }); await f.service.delegate(task.id, input);
  await f.service.setStatus(task.id, 'Cancelled'); expect(f.remote[0].Status).toBe('Cancelled'); expect(f.store.get('tasks', task.id)?.status).toBe('ready');
  f.rejectWrite(); await expect(f.service.setStatus(task.id, 'Done')).rejects.toThrow('denied'); expect(f.store.get('tasks', task.id)?.delegation?.status).toBe('Cancelled');
});
it('decodes actual MCP text envelopes and validates identifiers', () => {
  expect(resultRows(envelope({ results: [{ url: 'https://www.notion.so/example', Status: 'Done' }], has_more: false }))).toHaveLength(1);
  expect(notionId('https://app.notion.com/p/cd6b2c18a610486d874ada03dac584ec?pvs=204')).toBe('cd6b2c18-a610-486d-874a-da03dac584ec');
  expect(() => notionId('bad')).toThrow();
});
