import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Store } from './db.js';

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }));
const path = () => join(mkdtempSync(join(tmpdir(), 'agent-desk-')), 'test.sqlite');

describe('store', () => {
  it('seeds a shared group, one private group per agent and the discovery routine', () => {
    const store = new Store(path());
    const groups = store.groups();
    expect(groups.filter(group => group.kind === 'group').map(group => group.title)).toEqual(['General']);
    expect(groups.filter(group => group.kind === 'private').map(group => group.title)).toEqual(['Atlas', 'Scout', 'Quill']);
    expect(store.routines().map(routine => routine.name)).toEqual(['Hourly discovery']);
    store.close();
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
    const taskThread = store.get<{ threadId: string }>('tasks', 't1')!.threadId;
    expect(store.messagesForThread(taskThread).map(message => message.content)).toEqual(['Memo written']);
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
    expect(store.get<{ status: string }>('threads', thread.id)!.status).toBe('active');
    store.close();
  });
});
