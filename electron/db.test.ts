import Database from 'better-sqlite3';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Store } from './db.js';
import { defaultAgents, legacyAgents } from './default-agents.js';

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }));
const path = () => join(mkdtempSync(join(tmpdir(), 'aegir-')), 'test.sqlite');

describe('store', () => {
  it('persists custom lists and membership, validates names and supports moving with undo', () => {
    const file = path();
    const store = new Store(file);
    const list = store.createTaskList('  Work  ');
    expect(list.name).toBe('Work');
    expect(() => store.createTaskList('work')).toThrow('already exists');
    expect(() => store.createTaskList(' ')).toThrow('needs a name');
    expect(() => store.createTaskList('x'.repeat(81))).toThrow('80');
    const task = store.createTask({ title: 'Existing task' });
    expect(task.listId).toBeNull();
    store.updateTask(task.id, { listId: list.id }, true);
    expect(store.get('tasks', task.id)?.listId).toBe(list.id);
    store.undoTaskAction();
    expect(store.get('tasks', task.id)?.listId).toBeNull();
    expect(() => store.updateTask(task.id, { listId: 'missing' })).toThrow('not found');
    expect(() => store.createTask({ title: 'Invalid', listId: 'missing' })).toThrow('not found');
    const filed = store.createTask({ title: 'Filed', listId: list.id });
    store.renameTaskList(list.id, 'Projects');
    store.close();
    const reopened = new Store(file);
    try {
      expect(reopened.taskLists()).toEqual([{ ...list, name: 'Projects' }]);
      expect(reopened.get('tasks', filed.id)?.listId).toBe(list.id);
      expect(reopened.get('tasks', task.id)?.listId).toBeNull();
    } finally { reopened.close(); }
  });

  it('returns tasks to Inbox on list deletion and never restores dangling membership on undo', () => {
    const store = new Store(path());
    try {
      const list = store.createTaskList('Work');
      const task = store.createTask({ title: 'Keep my context', notes: 'Notes', listId: list.id });
      const thread = store.createThread(store.groups()[0].id, task.title, 'task', task.id);
      store.updateTask(task.id, { threadId: thread.id, status: 'done' });
      const link = store.addTaskLink(task.id, 'https://example.com/context');
      const deleted = store.createTask({ title: 'Previously deleted', listId: list.id });
      store.deleteTask(deleted.id, true);
      store.deleteTaskList(list.id);
      expect(store.get('tasks', task.id)).toMatchObject({ notes: 'Notes', status: 'done', threadId: thread.id, listId: null });
      expect(store.get('threads', thread.id)).toBeDefined();
      expect(store.taskLinks(task.id)).toEqual([link]);
      store.undoTaskAction();
      expect(store.get('tasks', deleted.id)?.listId).toBeNull();
      const second = store.createTaskList('Second');
      store.updateTask(deleted.id, { listId: second.id }, true);
      store.deleteTaskList(second.id);
      store.undoTaskAction();
      expect(store.get('tasks', deleted.id)?.listId).toBeNull();
      expect(store.taskLists()).toEqual([]);
    } finally { store.close(); }
  });

  it('migrates existing tasks into Inbox without losing their data', () => {
    const file = path();
    const old = new Database(file);
    old.exec("CREATE TABLE tasks(id TEXT PRIMARY KEY,title TEXT NOT NULL,notes TEXT NOT NULL,status TEXT NOT NULL,agentId TEXT,sourceUrl TEXT,sourceKey TEXT UNIQUE,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL)");
    old.prepare('INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?,?)').run('old', 'Existing', 'Keep', 'ready', null, null, null, '2026-01-01', '2026-01-01');
    old.close();
    const store = new Store(file);
    try {
      expect(store.get('tasks', 'old')).toMatchObject({ title: 'Existing', notes: 'Keep', listId: null });
      expect(store.taskLists()).toEqual([]);
    } finally { store.close(); }
  });

  it('persists suggested chat titles without overwriting newer titles, closed chats, or tasks', () => {
    const file = path();
    const store = new Store(file);
    const groupId = store.groups()[0].id;
    const thread = store.createThread(groupId, 'Opening message');
    expect(store.setSuggestedThreadTitle(thread.id, thread.title, 'A useful title')).toBe(true);
    expect(store.setSuggestedThreadTitle(thread.id, thread.title, 'Stale suggestion')).toBe(false);
    store.setThreadStatus(thread.id, 'closed');
    expect(store.setSuggestedThreadTitle(thread.id, 'A useful title', 'Closed suggestion')).toBe(false);
    const task = store.createThread(groupId, 'Task title', 'task');
    expect(store.setSuggestedThreadTitle(task.id, task.title, 'Chat title')).toBe(false);
    store.close();
    const reopened = new Store(file);
    try {
      expect(reopened.get('threads', thread.id)?.title).toBe('A useful title');
      expect(reopened.get('threads', task.id)?.title).toBe('Task title');
    } finally { reopened.close(); }
  });

  it('preserves long pasted task notes through save and reopen', () => {
    const file = path();
    const notes = ('A pasted paragraph with Unicode åäö and a newline.\n').repeat(4000) + 'END OF PASTE';
    const store = new Store(file);
    const task = store.createTask({ title: 'Long notes' });
    store.updateTask(task.id, { notes }, true);
    expect(store.get('tasks', task.id)?.notes).toBe(notes);
    store.close();
    const reopened = new Store(file);
    try {
      expect(reopened.get('tasks', task.id)?.notes).toBe(notes);
    } finally {
      reopened.close();
    }
  });

  it('seeds a shared group, one private group per agent and the discovery routine', () => {
    const store = new Store(path());
    const groups = store.groups();
    expect(groups.filter(group => group.kind === 'group').map(group => group.title)).toEqual(['General']);
    expect(groups.filter(group => group.kind === 'private').map(group => group.title)).toEqual(['Aegir', 'Mimer', 'Saga', 'Freja']);
    expect(store.routines().map(routine => routine.name)).toEqual(['Hourly discovery']);
    expect(store.get('agents', store.routines()[0].agentId)?.name).toBe('Mimer');
    expect(groups.find(group => group.kind === 'group')?.agentIds).toHaveLength(4);
    store.close();
  });

  it.each([false, true])('renames the existing lead in place (custom instructions: %s)', (custom) => {
    const file = path();
    const initial = new Store(file);
    const lead = initial.list('agents')[0];
    const others = initial.list('agents').slice(1);
    const group = initial.groups().find(item => item.kind === 'private' && item.leadAgentId === lead.id)!;
    const thread = initial.createThread(group.id, 'Existing history');
    initial.addMessage(thread.id, lead.id, 'agent', 'Historical Ägir message');
    const instructions = custom ? 'My custom lead instructions' : defaultAgents[0].instructions.replace('You are Aegir,', 'You are Ägir,');
    initial.updateAgent({ ...lead, name: 'Ägir', instructions });
    initial.db.prepare("DELETE FROM settings WHERE key='aegirNameMigrated'").run();
    initial.close();

    const upgraded = new Store(file);
    expect(upgraded.get('agents', lead.id)).toMatchObject({ name: 'Aegir', instructions: custom ? instructions : defaultAgents[0].instructions });
    expect(upgraded.list('agents').slice(1)).toEqual(others);
    expect(upgraded.group(group.id)?.title).toBe('Aegir');
    expect(upgraded.messagesForThread(thread.id)[0]).toMatchObject({ agentId: lead.id, content: 'Historical Ägir message' });
    upgraded.updateAgent({ ...upgraded.get('agents', lead.id)!, name: 'My lead' });
    upgraded.close();
    const reopened = new Store(file);
    expect(reopened.get('agents', lead.id)?.name).toBe('My lead');
    reopened.close();
  });

  it('upgrades the old team in place, preserves custom instructions and history, and runs only once', () => {
    const file = path();
    const initial = new Store(file);
    const agents = initial.list('agents');
    const researcher = agents[1];
    const privateGroup = initial.groups().find(group => group.kind === 'private' && group.leadAgentId === researcher.id)!;
    const thread = initial.createThread(privateGroup.id, 'Research history');
    initial.addMessage(thread.id, researcher.id, 'agent', 'Evidence collected');
    const customGroup = initial.createGroup('Product', [agents[0].id], agents[0].id);
    initial.close();
    const old = new Database(file);
    old.prepare("DELETE FROM settings WHERE key='nordicTeamSeeded'").run();
    old.prepare('DELETE FROM agents WHERE id=?').run(agents[3].id);
    old.prepare("DELETE FROM groups WHERE kind='private' AND leadAgentId=?").run(agents[3].id);
    old.prepare("UPDATE groups SET agentIds=? WHERE title='General'").run(JSON.stringify(agents.slice(0, 3).map(agent => agent.id)));
    for (const [index, legacy] of legacyAgents.entries()) {
      old.prepare('UPDATE agents SET name=?,instructions=? WHERE id=?').run(legacy.name, index === 1 ? 'My custom research instructions' : legacy.instructions, agents[index].id);
      old.prepare("UPDATE groups SET title=? WHERE kind='private' AND leadAgentId=?").run(legacy.name, agents[index].id);
    }
    old.close();

    const upgraded = new Store(file);
    expect(upgraded.list('agents').map(agent => agent.name)).toEqual(['Aegir', 'Mimer', 'Saga', 'Freja']);
    expect(upgraded.get('agents', researcher.id)?.instructions).toBe('My custom research instructions');
    expect(upgraded.get('agents', agents[0].id)?.instructions).toBe(defaultAgents[0].instructions);
    expect(upgraded.group(privateGroup.id)?.title).toBe('Mimer');
    expect(upgraded.messagesForThread(thread.id)[0]).toMatchObject({ agentId: researcher.id, content: 'Evidence collected' });
    expect(upgraded.routines()[0].agentId).toBe(researcher.id);
    expect(upgraded.group(customGroup.id)?.agentIds).toEqual([agents[0].id]);
    const freja = upgraded.list('agents')[3];
    expect(upgraded.groups().find(group => group.title === 'General')?.agentIds).toContain(freja.id);
    upgraded.updateAgent({ ...freja, name: 'My advisor' });
    upgraded.close();

    const reopened = new Store(file);
    expect(reopened.list('agents')).toHaveLength(4);
    expect(reopened.get('agents', freja.id)?.name).toBe('My advisor');
    reopened.close();
  });

  it('moves room history and goal output into threads without dropping the old tables', () => {
    const file = path();
    const old = new Database(file);
    old.exec(`
      CREATE TABLE agents(id TEXT PRIMARY KEY,name TEXT NOT NULL,role TEXT NOT NULL,color TEXT NOT NULL,instructions TEXT NOT NULL,createdAt TEXT NOT NULL);
      CREATE TABLE rooms(id TEXT PRIMARY KEY,title TEXT NOT NULL,leadAgentId TEXT NOT NULL,createdAt TEXT NOT NULL);
      CREATE TABLE messages(id TEXT PRIMARY KEY,roomId TEXT NOT NULL,agentId TEXT,role TEXT NOT NULL,content TEXT NOT NULL,status TEXT NOT NULL,createdAt TEXT NOT NULL);
      CREATE TABLE tasks(id TEXT PRIMARY KEY,title TEXT NOT NULL,notes TEXT NOT NULL,status TEXT NOT NULL,agentId TEXT,sourceUrl TEXT,sourceKey TEXT UNIQUE,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL);
      CREATE TABLE goals(id TEXT PRIMARY KEY,taskId TEXT NOT NULL,agentId TEXT NOT NULL,status TEXT NOT NULL,threadId TEXT,detail TEXT NOT NULL,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL);
      INSERT INTO agents VALUES ('a1','Atlas','Lead','#000','', '2026-01-01');
      INSERT INTO rooms VALUES ('r1','Product','a1','2026-01-02');
      INSERT INTO messages VALUES ('m1','r1',NULL,'user','hello','complete','2026-01-03');
      INSERT INTO tasks VALUES ('t1','Write memo','','done','a1',NULL,NULL,'2026-01-04','2026-01-04');
      INSERT INTO goals VALUES ('g1','t1','a1','done',NULL,'Memo written','2026-01-05','2026-01-05');
    `);
    old.close();
    const store = new Store(file);
    const product = store.group('r1')!;
    expect(product).toMatchObject({ title: 'Product', kind: 'group', leadAgentId: 'a1' });
    const threads = store.threads().filter(thread => thread.groupId === 'r1');
    expect(threads.map(thread => [thread.title, thread.kind]).sort()).toEqual([['Earlier conversation', 'chat'], ['Write memo', 'task']]);
    const taskThread = store.get('tasks', 't1')!.threadId;
    expect(store.get('tasks', 't1')!.completedAt).toBe('2026-01-04');
    expect(store.messagesForThread(taskThread!).map(message => message.content)).toEqual(['Memo written']);
    expect(store.groups().some(group => group.kind === 'group' && group.title === 'General')).toBe(false);
    store.close();
    const reopened = new Store(file);
    expect(reopened.threads().filter(thread => thread.groupId === 'r1')).toHaveLength(2);
    reopened.close();
  });

  it('keeps messages attached to their thread and reactivates the thread', () => {
    const store = new Store(path());
    const group = store.groups()[0];
    const thread = store.createThread(group.id, 'Pricing');
    store.setThreadStatus(thread.id, 'closed');
    store.addMessage(thread.id, null, 'user', 'What did we decide?');
    expect(store.messagesForThread(thread.id).map(message => message.content)).toEqual(['What did we decide?']);
    expect(store.get('threads', thread.id)!.status).toBe('active');
    store.close();
  });

  it('updates every editable task field and keeps its task thread title in sync', () => {
    const store = new Store(path());
    const group = store.groups()[0];
    const task = store.createTask({ title: 'First title', notes: 'Old', label: 'old', dueAt: '2026-10-01' });
    const thread = store.createThread(group.id, task.title, 'task', task.id);
    store.updateTask(task.id, { threadId: thread.id });
    store.updateTask(task.id, { title: '  Better title  ', notes: 'New', label: null, dueAt: null });
    expect(store.get('tasks', task.id)).toMatchObject({ title: 'Better title', notes: 'New', label: null, dueAt: null });
    expect(store.get('threads', thread.id)?.title).toBe('Better title');
    expect(() => store.updateTask(task.id, { title: '  ' })).toThrow('A task needs a title');
    store.close();
  });

  it('deletes a task and its task-thread conversation but keeps output files external', () => {
    const store = new Store(path());
    const group = store.groups()[0];
    const outputDir = mkdtempSync(join(tmpdir(), 'aegir-output-'));
    const deliverable = join(outputDir, 'report.md');
    writeFileSync(deliverable, 'Keep this deliverable');
    const task = store.createTask({ title: 'Remove me' });
    store.updateTask(task.id, { outputDir });
    const thread = store.createThread(group.id, task.title, 'task', task.id);
    store.addMessage(thread.id, null, 'user', 'Task context');
    store.updateTask(task.id, { threadId: thread.id });
    store.deleteTask(task.id);
    expect(store.get('tasks', task.id)).toBeUndefined();
    expect(store.get('threads', thread.id)).toBeUndefined();
    expect(store.messagesForThread(thread.id)).toEqual([]);
    expect(readFileSync(deliverable, 'utf8')).toBe('Keep this deliverable');
    rmSync(outputDir, { recursive: true, force: true });
    store.close();
  });

  it('does not delete a running task', () => {
    const store = new Store(path());
    const task = store.createTask({ title: 'In progress' });
    store.updateTask(task.id, { status: 'running' });
    expect(() => store.deleteTask(task.id)).toThrow('Stop this task before deleting it');
    expect(store.get('tasks', task.id)).toBeDefined();
    store.close();
  });

  it('undoes a task deletion with its exact thread, messages, and attached links', () => {
    const store = new Store(path());
    const group = store.groups()[0];
    const task = store.createTask({ title: 'Prepare report' }, true);
    const thread = store.createThread(group.id, task.title, 'task', task.id);
    const first = store.addMessage(thread.id, null, 'user', 'Keep this context');
    store.updateTask(task.id, { threadId: thread.id });
    const link = store.addTaskLink(task.id, 'obsidian://open?vault=Work&file=Report');
    store.deleteTask(task.id, true);
    expect(store.get('tasks', task.id)).toBeUndefined();
    expect(store.messagesForThread(thread.id)).toEqual([]);
    expect(store.taskLinks(task.id)).toEqual([]);

    expect(store.undoTaskAction()).toEqual({ taskId: task.id, action: 'task deletion' });
    expect(store.get('tasks', task.id)?.threadId).toBe(thread.id);
    expect(store.get('threads', thread.id)?.id).toBe(thread.id);
    expect(store.messagePage(thread.id).messages.map(message => message.id)).toEqual([first.id]);
    expect(store.taskLinks(task.id)).toEqual([link]);
    store.close();
  });

  it('stores local file attachments canonically and supports undo and deduplication', () => {
    const store = new Store(path());
    const task = store.createTask({ title: 'Review local file' }, true);
    const link = store.addTaskLink(task.id, '/tmp/My report.md');
    expect(link.url).toBe('file:///tmp/My%20report.md');
    expect(store.addTaskLink(task.id, 'file:///tmp/My%20report.md')).toEqual(link);
    store.removeTaskLink(link.id);
    store.undoTaskAction();
    expect(store.taskLinks(task.id)).toEqual([link]);
    store.undoTaskAction();
    expect(store.taskLinks(task.id)).toEqual([]);
    store.close();
  });

  it('replaces attachments atomically and restores the previous attachment with undo', () => {
    const store = new Store(path());
    const task = store.createTask({ title: 'One attachment' });
    const original = store.addTaskLink(task.id, '/tmp/first.md');
    const latest = store.addTaskLink(task.id, '/tmp/second.md\n/tmp/latest.md');
    expect(store.taskLinks(task.id)).toEqual([latest]);
    expect(latest.url).toBe('file:///tmp/latest.md');
    expect(() => store.addTaskLink(task.id, 'not a link')).toThrow();
    expect(store.taskLinks(task.id)).toEqual([latest]);
    store.undoTaskAction();
    expect(store.taskLinks(task.id)).toEqual([original]);
    store.undoTaskAction();
    expect(store.taskLinks(task.id)).toEqual([]);
    store.close();
  });

  it('migrates existing multi-attachment tasks to their newest attachment', () => {
    const file = path();
    const first = new Store(file);
    const task = first.createTask({ title: 'Older attachments' });
    first.close();
    const db = new Database(file);
    db.exec('DROP INDEX task_links_single_task');
    const insert = db.prepare('INSERT INTO task_links(id,taskId,url,createdAt) VALUES (?,?,?,?)');
    insert.run('old', task.id, 'https://example.com/old', '2026-09-01');
    insert.run('latest', task.id, 'https://example.com/latest', '2026-09-02');
    insert.run('tie', task.id, 'https://example.com/tie', '2026-09-02');
    db.close();
    const upgraded = new Store(file);
    expect(upgraded.taskLinks(task.id).map(link => link.id)).toEqual(['tie']);
    upgraded.close();
  });

  it('undoes completion, edits, links, and creation in reverse order', () => {
    const store = new Store(path());
    const task = store.createTask({ title: 'Draft' }, true);
    store.updateTask(task.id, { title: 'Send draft', status: 'done' }, true);
    expect(store.get('tasks', task.id)?.completedAt).toBeTruthy();
    const link = store.addTaskLink(task.id, 'https://example.com/draft');
    store.removeTaskLink(link.id);
    expect(store.undoTaskAction()?.action).toBe('link removal');
    expect(store.taskLinks(task.id)).toEqual([link]);
    expect(store.undoTaskAction()?.action).toBe('link attachment');
    expect(store.taskLinks(task.id)).toEqual([]);
    expect(store.undoTaskAction()?.action).toBe('task edit');
    expect(store.get('tasks', task.id)).toMatchObject({ title: 'Draft', status: 'ready', completedAt: null });
    expect(store.undoTaskAction()?.action).toBe('task creation');
    expect(store.get('tasks', task.id)).toBeUndefined();
    store.close();
  });
});
