import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { app } from 'electron';
import { join } from 'node:path';
import type { Agent, Goal, Memory, Message, Room, Scan, Task } from '../shared/types.js';

const now = () => new Date().toISOString();
export class Store {
  readonly db: Database.Database;
  constructor(path = join(app.getPath('userData'), 'agent-desk.sqlite')) {
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agents(id TEXT PRIMARY KEY,name TEXT NOT NULL,role TEXT NOT NULL,color TEXT NOT NULL,instructions TEXT NOT NULL,createdAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS rooms(id TEXT PRIMARY KEY,title TEXT NOT NULL,leadAgentId TEXT NOT NULL,createdAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,roomId TEXT NOT NULL,agentId TEXT,role TEXT NOT NULL,content TEXT NOT NULL,status TEXT NOT NULL,createdAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,title TEXT NOT NULL,notes TEXT NOT NULL,status TEXT NOT NULL,agentId TEXT,sourceUrl TEXT,sourceKey TEXT UNIQUE,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS goals(id TEXT PRIMARY KEY,taskId TEXT NOT NULL,agentId TEXT NOT NULL,status TEXT NOT NULL,threadId TEXT,detail TEXT NOT NULL,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS scans(id TEXT PRIMARY KEY,provider TEXT NOT NULL,status TEXT NOT NULL,query TEXT NOT NULL,found INTEGER NOT NULL,created INTEGER NOT NULL,error TEXT,startedAt TEXT NOT NULL,endedAt TEXT);
      CREATE TABLE IF NOT EXISTS memories(id TEXT PRIMARY KEY,scope TEXT NOT NULL,content TEXT NOT NULL,sourceUrl TEXT,createdAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_threads(roomId TEXT NOT NULL,agentId TEXT NOT NULL,threadId TEXT NOT NULL,PRIMARY KEY(roomId,agentId));
    `);
    if (!this.list<Agent>('agents').length) {
      this.createAgent({ name: 'Atlas', role: 'Lead', color: '#8f79dd', instructions: 'You are a thoughtful generalist. Coordinate work clearly and keep handoffs visible.' });
      this.createAgent({ name: 'Scout', role: 'Research', color: '#54b8aa', instructions: 'You investigate questions, find sources, and report evidence with links.' });
      this.createAgent({ name: 'Quill', role: 'Writing', color: '#e8a76c', instructions: 'You turn complex input into concise, useful writing and action items.' });
    }
    if (!this.list<Room>('rooms').length) this.createRoom('General', this.list<Agent>('agents')[0].id);
    if (!this.getSetting('memoryInstructions')) this.setSetting('memoryInstructions', 'Remember durable preferences, decisions, people, and project facts that will help future work. Avoid secrets, guesses, and transient chatter. Keep each memory short and cite its source when available.');
    this.db.prepare("UPDATE goals SET status='blocked',detail=detail || '\nRun interrupted when Agent Desk quit.',updatedAt=? WHERE status IN ('running','awaiting_approval')").run(now());
    this.db.prepare("UPDATE tasks SET status='blocked',updatedAt=? WHERE status='running'").run(now());
  }
  list<T>(table: 'agents' | 'rooms' | 'messages' | 'tasks' | 'goals' | 'scans' | 'memories'): T[] {
    const order = table === 'scans' ? 'startedAt DESC' : table === 'messages' || table === 'agents' ? 'createdAt ASC' : 'createdAt DESC';
    return this.db.prepare(`SELECT * FROM ${table} ORDER BY ${order}`).all() as T[];
  }
  get<T>(table: 'agents' | 'rooms' | 'tasks' | 'goals' | 'messages', id: string): T | undefined { return this.db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id) as T | undefined; }
  createAgent(input: Pick<Agent, 'name' | 'role' | 'color' | 'instructions'>): Agent {
    const row: Agent = { id: randomUUID(), ...input, createdAt: now() };
    this.db.prepare('INSERT INTO agents VALUES (@id,@name,@role,@color,@instructions,@createdAt)').run(row);
    return row;
  }
  updateAgent(row: Agent) { this.db.prepare('UPDATE agents SET name=@name,role=@role,color=@color,instructions=@instructions WHERE id=@id').run(row); }
  createRoom(title: string, leadAgentId: string): Room { const row = { id: randomUUID(), title, leadAgentId, createdAt: now() }; this.db.prepare('INSERT INTO rooms VALUES (@id,@title,@leadAgentId,@createdAt)').run(row); return row; }
  addMessage(roomId: string, agentId: string | null, role: Message['role'], content: string, status: Message['status'] = 'complete'): Message {
    const row = { id: randomUUID(), roomId, agentId, role, content, status, createdAt: now() };
    this.db.prepare('INSERT INTO messages VALUES (@id,@roomId,@agentId,@role,@content,@status,@createdAt)').run(row);
    return row;
  }
  updateMessage(id: string, content: string, status: Message['status']) { this.db.prepare('UPDATE messages SET content=?,status=? WHERE id=?').run(content,status,id); }
  messagesForRoom(roomId: string): Message[] { return this.db.prepare('SELECT * FROM messages WHERE roomId=? ORDER BY createdAt ASC').all(roomId) as Message[]; }
  createTask(title: string, notes = '', status: Task['status'] = 'ready', sourceUrl: string | null = null, sourceKey: string | null = null): Task {
    const row: Task = { id: randomUUID(), title, notes, status, agentId: null, sourceUrl, sourceKey, createdAt: now(), updatedAt: now() };
    this.db.prepare('INSERT OR IGNORE INTO tasks VALUES (@id,@title,@notes,@status,@agentId,@sourceUrl,@sourceKey,@createdAt,@updatedAt)').run(row);
    return row;
  }
  updateTask(id: string, change: Partial<Pick<Task, 'title' | 'notes' | 'status' | 'agentId'>>) {
    const row = this.get<Task>('tasks', id); if (!row) throw new Error('Task not found');
    this.db.prepare('UPDATE tasks SET title=@title,notes=@notes,status=@status,agentId=@agentId,updatedAt=@updatedAt WHERE id=@id').run({ ...row, ...change, updatedAt: now() });
  }
  createGoal(taskId: string, agentId: string): Goal { const row: Goal = { id: randomUUID(), taskId, agentId, status: 'running', threadId: null, detail: '', createdAt: now(), updatedAt: now() }; this.db.prepare('INSERT INTO goals VALUES (@id,@taskId,@agentId,@status,@threadId,@detail,@createdAt,@updatedAt)').run(row); this.updateTask(taskId,{status:'running',agentId}); return row; }
  updateGoal(id: string, status: Goal['status'], detail: string, threadId?: string | null) { this.db.prepare('UPDATE goals SET status=?,detail=?,threadId=COALESCE(?,threadId),updatedAt=? WHERE id=?').run(status,detail,threadId ?? null,now(),id); }
  createScan(provider: Scan['provider'], query: string): Scan { const row: Scan = { id: randomUUID(), provider, status: 'running', query, found: 0, created: 0, error: null, startedAt: now(), endedAt: null }; this.db.prepare('INSERT INTO scans VALUES (@id,@provider,@status,@query,@found,@created,@error,@startedAt,@endedAt)').run(row); return row; }
  finishScan(id: string, status: Scan['status'], found: number, created: number, error: string | null) { this.db.prepare('UPDATE scans SET status=?,found=?,created=?,error=?,endedAt=? WHERE id=?').run(status,found,created,error,now(),id); }
  remember(scope: string, content: string, sourceUrl: string | null): Memory { const row = { id: randomUUID(), scope, content, sourceUrl, createdAt: now() }; this.db.prepare('INSERT INTO memories VALUES (@id,@scope,@content,@sourceUrl,@createdAt)').run(row); return row; }
  forgetMemory(id: string) { this.db.prepare('DELETE FROM memories WHERE id=?').run(id); }
  getSetting(key: string): string | undefined { return (this.db.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined)?.value; }
  setSetting(key: string, value: string) { this.db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,value); }
  getThread(roomId: string, agentId: string): string | undefined { return (this.db.prepare('SELECT threadId FROM agent_threads WHERE roomId=? AND agentId=?').get(roomId,agentId) as {threadId:string}|undefined)?.threadId; }
  setThread(roomId: string, agentId: string, threadId: string) { this.db.prepare('INSERT INTO agent_threads VALUES(?,?,?) ON CONFLICT(roomId,agentId) DO UPDATE SET threadId=excluded.threadId').run(roomId,agentId,threadId); }
  close() { this.db.close(); }
}
