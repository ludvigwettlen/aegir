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

  it('finds a task by its source key', () => {
    const store = new Store(path());
    try {
      const task = store.createTask({ title: 'From the inbox', status: 'proposed', sourceKey: 'inbox:slack-1' });
      expect(store.taskBySource('inbox:slack-1')?.id).toBe(task.id);
      expect(store.taskBySource('inbox:slack-2')).toBeUndefined();
    } finally { store.close(); }
  });

  it('deletes a routine with its runs, run events and skill bindings', () => {
    const store = new Store(path());
    try {
      const [routine] = store.routines();
      const run = store.startRun(routine.id, 'manual');
      store.addRunEvent(run.id, 'run', 'Started');
      const db = (store as unknown as { db: Database.Database }).db;
      db.exec('CREATE TABLE IF NOT EXISTS skill_bindings(routineId TEXT PRIMARY KEY,ids TEXT NOT NULL)');
      db.prepare('INSERT INTO skill_bindings VALUES (?,?)').run(routine.id, '[]');
      db.prepare('INSERT INTO skill_bindings VALUES (?,?)').run('other', '[]');
      store.deleteRoutine(routine.id);
      expect(store.routine(routine.id)).toBeUndefined();
      expect(store.routineRuns().filter(item => item.routineId === routine.id)).toEqual([]);
      expect(store.runEvents(run.id)).toEqual([]);
      expect(db.prepare('SELECT routineId FROM skill_bindings').all()).toEqual([{ routineId: 'other' }]);
      expect(() => store.deleteRoutine(routine.id)).toThrow(/not found/);
    } finally { store.close(); }
  });


  it('removes an attachment with its bytes and restores both on undo', () => {
    const store = new Store(path());
    try {
      const moved: [string, string][] = [];
      store.onTaskFileMoved = (file, action) => moved.push([file.name, action]);
      const task = store.createTask({ title: 'Read the board pack' });
      const thread = store.createThread(store.groups()[0].id, task.title, 'task', task.id);
      const file = store.addTaskFile({
        taskId: task.id, threadId: thread.id, messageId: null, root: 'task', path: 'attachments/pack.pdf',
        name: 'pack.pdf', kind: 'pdf', mime: 'application/pdf', bytes: 2048, sha256: 'abc',
        originalPath: '/Downloads/pack.pdf', brainPath: null, brainFiledAt: null,
      });
      store.removeTaskFile(file.id);
      expect(store.taskFiles(task.id)).toEqual([]);
      expect(store.undoTaskAction()).toEqual({ taskId: task.id, action: 'attachment removal' });
      expect(store.taskFiles(task.id)).toEqual([file]);
      expect(moved).toEqual([['pack.pdf', 'remove'], ['pack.pdf', 'restore']]);
      expect(() => store.removeTaskFile(file.id + 'x')).toThrow(/no longer exists/);
    } finally { store.close(); }
  });

  it('keeps a deleted task\'s attachments for undo, and files the brain copy on the row', () => {
    const store = new Store(path());
    try {
      const task = store.createTask({ title: 'Read the board pack' });
      const file = store.addTaskFile({
        taskId: task.id, threadId: null, messageId: null, root: 'task', path: 'attachments/pack.pdf',
        name: 'pack.pdf', kind: 'pdf', mime: 'application/pdf', bytes: 2048, sha256: 'abc',
        originalPath: null, brainPath: null, brainFiledAt: null,
      });
      store.setTaskFileBrainPath(file.id, '/Users/m/brain/sources/q3-close/.raw/pack.pdf');
      expect(store.taskFile(file.id)).toMatchObject({ brainPath: '/Users/m/brain/sources/q3-close/.raw/pack.pdf' });
      expect(store.taskFile(file.id)?.brainFiledAt).toBeTruthy();
      store.deleteTask(task.id, true);
      expect(store.taskFiles(task.id)).toEqual([]);
      store.undoTaskAction();
      expect(store.taskFiles(task.id).map(item => item.id)).toEqual([file.id]);
    } finally { store.close(); }
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
    expect(store.get('tasks', task.id)).toMatchObject({ title: 'Draft', status: 'ready', completedAt: null, priority: null, prioritySource: null, agentPriority: null, priorityReason: null, prioritySetAt: null, priorityCheckedAt: null });
    expect(store.undoTaskAction()?.action).toBe('task creation');
    expect(store.get('tasks', task.id)).toBeUndefined();
    store.close();
  });
});

describe('single-agent setup for Claude Code', () => {
  it('renames the lead to Claude and removes unused teammates and their direct chats', () => {
    const store = new Store(path());
    const before = store.list('agents');
    expect(before.length).toBeGreaterThan(1);
    const lead = before.find((agent) => agent.role === 'Lead')!;
    const helper = before.find((agent) => agent.role !== 'Lead')!;
    const chatty = before.find((agent) => agent.role !== 'Lead' && agent.id !== helper.id)!;
    const shared = store.groups().find((group) => group.kind === 'group')!;
    const thread = store.createThread(shared.id, 'History');
    store.addMessage(thread.id, chatty.id, 'agent', 'I said something once');
    store.focusSingleAgent('Claude');
    const after = store.list('agents');
    expect(after.find((agent) => agent.id === lead.id)?.name).toBe('Claude');
    expect(after.find((agent) => agent.id === lead.id)?.instructions).toContain('You are Claude,');
    for (const name of ['Mimer', 'Saga', 'Freja', 'Aegir']) expect(after.find((agent) => agent.id === lead.id)?.instructions).not.toContain(name);
    expect(after.some((agent) => agent.id === helper.id)).toBe(false);
    expect(after.some((agent) => agent.id === chatty.id)).toBe(true);
    expect(store.groups().filter((group) => group.kind === 'group').every((group) => group.agentIds.length === 1 && group.agentIds[0] === lead.id)).toBe(true);
    expect(store.groups().some((group) => group.kind === 'private' && group.leadAgentId === helper.id)).toBe(false);
    expect(store.groups().find((group) => group.kind === 'private' && group.leadAgentId === lead.id)?.title).toBe('Claude');
    expect(store.routines().every((routine) => routine.agentId === lead.id)).toBe(true);
    store.close();
  });
});

describe('reply ordering', () => {
  it('moves a finished reply below messages logged while it ran', () => {
    const store = new Store(path());
    const group = store.groups().find((item) => item.kind === 'group')!;
    const thread = store.createThread(group.id, 'Harborlight');
    store.addMessage(thread.id, null, 'user', 'Check Harborlight');
    const reply = store.addMessage(thread.id, group.leadAgentId, 'agent', '', 'streaming');
    store.addMessage(thread.id, null, 'system', 'Approved: Search the web');
    store.updateMessage(reply.id, 'Reach out to Elin', 'complete');
    store.moveMessageToEnd(reply.id);
    const order = store.messagePage(thread.id).messages.map((message) => message.content);
    expect(order).toEqual(['Check Harborlight', 'Approved: Search the web', 'Reach out to Elin']);
    store.close();
  });
});

describe('priority', () => {
  it('adds the priority columns to an existing database without touching its tasks', () => {
    const file = path();
    const old = new Database(file);
    old.exec("CREATE TABLE tasks(id TEXT PRIMARY KEY,title TEXT NOT NULL,notes TEXT NOT NULL,status TEXT NOT NULL,agentId TEXT,sourceUrl TEXT,sourceKey TEXT UNIQUE,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL,label TEXT,dueAt TEXT,threadId TEXT,outputDir TEXT,completedAt TEXT)");
    old.prepare("INSERT INTO tasks VALUES ('t1','Board deck','notes','ready',NULL,NULL,'reminders:1','2026-10-01T00:00:00Z','2026-10-02T00:00:00Z','board','2026-10-09',NULL,NULL,NULL)").run();
    old.close();
    const store = new Store(file);
    try {
      expect(store.get('tasks', 't1')).toMatchObject({ title: 'Board deck', notes: 'notes', label: 'board', dueAt: '2026-10-09', updatedAt: '2026-10-02T00:00:00Z', priority: null, prioritySource: null, agentPriority: null, priorityReason: null, prioritySetAt: null, priorityCheckedAt: null });
      expect(store.priorityEvents()).toEqual([]);
    } finally { store.close(); }
  });

  it('lets Claude band a task, never over a band the user set, and logs only real changes', () => {
    const store = new Store(path());
    try {
      const task = store.createTask({ title: 'Prep Greenfield call', label: 'investor', sourceKey: 'inbox:calendar-abc' });
      expect(store.setPriority(task.id, 2, 'agent', { reason: 'Investor call, not this week', runId: 'run-1' })).toBe(true);
      expect(store.get('tasks', task.id)).toMatchObject({ priority: 2, prioritySource: 'agent', agentPriority: 2, priorityReason: 'Investor call, not this week', updatedAt: task.updatedAt });
      // Same band, new reason: the task follows, the log does not.
      expect(store.setPriority(task.id, 2, 'agent', { reason: 'Still next week' })).toBe(true);
      expect(store.priorityEvents()).toHaveLength(1);
      expect(store.priorityEvents()[0]).toMatchObject({ actor: 'agent', priority: 2, previous: null, previousActor: null, runId: 'run-1', source: 'calendar', title: 'Prep Greenfield call', label: 'investor' });
      // The user overrides: logged with what Claude said and why.
      expect(store.setPriority(task.id, 1, 'user')).toBe(true);
      expect(store.get('tasks', task.id)).toMatchObject({ priority: 1, prioritySource: 'user', agentPriority: 2, priorityReason: 'Still next week' });
      expect(store.setPriority(task.id, 3, 'agent', { reason: 'Try again' })).toBe(false);
      expect(store.get('tasks', task.id)?.priority).toBe(1);
      expect(store.priorityOverrides()).toEqual([expect.objectContaining({ actor: 'user', priority: 1, previous: 2, previousActor: 'agent', agentPriority: 2, reason: 'Still next week' })]);
    } finally { store.close(); }
  });

  it('learns only from his last word per task: a confirmation, a clear or a fixed mis-key is no correction', () => {
    const store = new Store(path());
    try {
      const confirmed = store.createTask({ title: 'Confirmed' });
      const cleared = store.createTask({ title: 'Cleared' });
      const miskeyed = store.createTask({ title: 'Mis-keyed' });
      const moved = store.createTask({ title: 'Moved' });
      for (const task of [confirmed, cleared, miskeyed, moved]) store.setPriority(task.id, 2, 'agent', { reason: 'r' });
      store.setPriority(confirmed.id, 2, 'user');
      store.setPriority(cleared.id, null, 'user');
      store.setPriority(miskeyed.id, 3, 'user');
      store.setPriority(miskeyed.id, 2, 'user');
      store.setPriority(moved.id, 3, 'user');
      store.setPriority(moved.id, 1, 'user');
      expect(store.get('tasks', cleared.id)).toMatchObject({ priority: null, prioritySource: null, agentPriority: 2 });
      expect(store.priorityEvents().filter((event) => event.actor === 'user')).toHaveLength(6);
      expect(store.priorityOverrides()).toEqual([expect.objectContaining({ title: 'Moved', priority: 1, agentPriority: 2 })]);
      // Cleared hands it back: Claude may band it again.
      expect(store.setPriority(cleared.id, 2, 'agent', { reason: 'again' })).toBe(true);
    } finally { store.close(); }
  });

  it('shows only corrections newer than the rubric refresh, but always the newest few', () => {
    const store = new Store(path());
    try {
      for (const title of ['a', 'b', 'c']) {
        const task = store.createTask({ title });
        store.setPriority(task.id, 2, 'agent', { reason: 'r' });
        store.setPriority(task.id, 1, 'user');
      }
      expect(store.priorityOverrides(30, '2999-01-01T00:00:00Z', 2).map((event) => event.title)).toEqual(['c', 'b']);
      expect(store.priorityOverrides(30, '2000-01-01T00:00:00Z', 0)).toHaveLength(3);
    } finally { store.close(); }
  });

  it('records what became of a banded task, keeps sweep closes apart, and forgets the outcome on undo', () => {
    const store = new Store(path());
    try {
      const done = store.createTask({ title: 'Done by him' });
      const closed = store.createTask({ title: 'Closed by a sweep' });
      const gone = store.createTask({ title: 'Deleted' });
      const unbanded = store.createTask({ title: 'Never banded' });
      for (const task of [done, closed, gone]) store.setPriority(task.id, 2, 'agent', { reason: 'r' });
      store.updateTask(done.id, { status: 'done' }, true, 'user');
      store.updateTask(closed.id, { status: 'done' }, false, 'sweep');
      store.updateTask(unbanded.id, { status: 'done' }, true, 'user');
      store.deleteTask(gone.id, true);
      const outcomes = () => store.priorityEvents().filter((event) => event.kind !== 'band').map((event) => `${event.kind}:${event.actor}:${event.title}:P${event.priority}`).sort();
      expect(outcomes()).toEqual(['deleted:user:Deleted:P2', 'done:sweep:Closed by a sweep:P2', 'done:user:Done by him:P2']);
      store.undoTaskAction(); // the deletion
      store.undoTaskAction(); // the unbanded task's done
      store.undoTaskAction(); // done by him
      expect(outcomes()).toEqual(['done:sweep:Closed by a sweep:P2']);
      expect(store.get('tasks', gone.id)?.priority).toBe(2);
    } finally { store.close(); }
  });

  it('hands a P1 the user set back to Claude with the same band, logged as the system', () => {
    const store = new Store(path());
    try {
      const task = store.createTask({ title: 'Old commitment', priority: 1 });
      expect(store.expireUserPriority(task.id, 'Your P1 from last week')).toBe(true);
      expect(store.get('tasks', task.id)).toMatchObject({ priority: 1, prioritySource: 'agent', agentPriority: 1, priorityReason: 'Your P1 from last week' });
      expect(store.priorityEvents()[0]).toMatchObject({ kind: 'band', actor: 'system', priority: 1, previousActor: 'user' });
      expect(store.priorityOverrides()).toEqual([]);
      expect(store.expireUserPriority(task.id, 'again')).toBe(false);
    } finally { store.close(); }
  });

  it('undoes a user priority change, removes its log row, and refuses once Claude has moved on', () => {
    const store = new Store(path());
    try {
      const task = store.createTask({ title: 'Undo me' });
      store.setPriority(task.id, 3, 'agent', { reason: 'Reading' });
      store.setPriority(task.id, 1, 'user', {}, true);
      expect(store.undoTaskAction()).toEqual({ taskId: task.id, action: 'priority change' });
      expect(store.get('tasks', task.id)).toMatchObject({ priority: 3, prioritySource: 'agent', priorityReason: 'Reading' });
      expect(store.priorityOverrides()).toEqual([]);
      store.updateTask(task.id, { dueAt: '2026-10-09' }, true);
      store.setPriority(task.id, null, 'user', {}, true);
      store.setPriority(task.id, 2, 'agent', { reason: 'Rebanded' });
      expect(() => store.undoTaskAction()).toThrow('changed');
      // The stale entry is gone, so the next ⌘Z reaches the date change below it.
      expect(store.undoTaskAction()).toEqual({ taskId: task.id, action: 'task edit' });
      expect(store.get('tasks', task.id)?.dueAt).toBeNull();
    } finally { store.close(); }
  });

  it('keeps a quick-add priority as the user band, and brings priority back when a deleted task is restored', () => {
    const store = new Store(path());
    try {
      const task = store.createTask({ title: 'Board pack !1', priority: 1 }, true);
      expect(task).toMatchObject({ priority: 1, prioritySource: 'user', agentPriority: null });
      expect(store.priorityEvents()).toEqual([expect.objectContaining({ actor: 'user', priority: 1, previous: null, previousActor: null })]);
      store.setPriority(task.id, 1, 'agent', { reason: 'ignored' });
      store.deleteTask(task.id, true);
      store.undoTaskAction();
      expect(store.get('tasks', task.id)).toMatchObject({ priority: 1, prioritySource: 'user' });
      // Undoing the creation takes its log rows with it.
      const quick = store.createTask({ title: 'Typed by mistake', priority: 2 }, true);
      store.undoTaskAction();
      expect(store.priorityEvents().some((event) => event.taskId === quick.id)).toBe(false);
    } finally { store.close(); }
  });
});
