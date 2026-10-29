import { z } from 'zod';
import { defaultDelegationDatabase, delegationStatuses, type Delegation, type DelegationInput, type DelegationState, type DelegationStatus, type NotionPerson } from '../shared/delegation.js';
import type { Store } from './db.js';
import type { ConnectorManager } from './connectors.js';
import { taskLabels } from '../shared/task-labels.js';

const uuid = z.string().uuid();
const person = z.object({ id: uuid, name: z.string().trim().min(1).max(200), email: z.string().max(300).optional() });
const inputSchema = z.object({ assignee: person, taggedPeople: z.array(person).max(20), brief: z.string().trim().max(10000) });
const idPattern = /[a-f0-9]{8}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{12}/i;
export function notionId(value: string): string {
  const match = value.match(idPattern)?.[0]?.replaceAll('-', '');
  if (!match) throw new Error('Enter a Notion database URL or ID.');
  return `${match.slice(0, 8)}-${match.slice(8, 12)}-${match.slice(12, 16)}-${match.slice(16, 20)}-${match.slice(20)}`;
}
function unwrap(value: any): any {
  if (value?.isError) throw new Error(JSON.stringify(value.content));
  if (value?.structuredContent) return unwrap(value.structuredContent);
  if (Array.isArray(value?.content)) {
    const text = value.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
    try { return unwrap(JSON.parse(text)); } catch (error) { if (error instanceof SyntaxError) return text; throw error; }
  }
  if (typeof value?.result === 'string') { try { return JSON.parse(value.result); } catch { return value.result; } }
  return value;
}
function textResult(value: unknown): string { const decoded = unwrap(value); return typeof decoded === 'string' ? decoded : typeof decoded?.text === 'string' ? decoded.text : JSON.stringify(decoded); }
export function resultRows(value: unknown): Record<string, any>[] {
  const decoded = unwrap(value);
  const rows = Array.isArray(decoded) ? decoded : decoded?.results ?? decoded?.rows ?? decoded?.pages;
  if (!Array.isArray(rows)) throw new Error('Notion returned an unsupported result. Reconnect Notion and try again.');
  return rows;
}
function personIds(value: unknown): string[] {
  if (typeof value === 'string') { try { return personIds(JSON.parse(value)); } catch { return []; } }
  return Array.isArray(value) ? value.map(x => typeof x === 'string' ? x.replace('user://', '') : x?.id).filter(Boolean) : [];
}
function errorText(error: unknown) { return error instanceof Error ? error.message : String(error); }

export class DelegationService {
  private busy = false;
  private closed = false;
  private timer?: NodeJS.Timeout;
  private stateValue: Omit<DelegationState, 'database'> = { syncing: false, lastSyncedAt: null, error: null };
  constructor(private store: Store, private connectors: Pick<ConnectorManager, 'listTools' | 'call'>, private changed: () => void) {}
  state(): DelegationState { return { ...this.stateValue, database: this.store.getSetting('delegationDatabase') ?? defaultDelegationDatabase }; }
  start() { this.timer = setInterval(() => { void this.sync().catch(() => {}); }, 120_000); this.timer.unref(); }
  close() { this.closed = true; clearInterval(this.timer); }
  private save(id: string, value: Delegation) { if (!this.closed) this.store.saveDelegation(id, value); }
  private async call(action: string, args: Record<string, unknown>) {
    if (this.closed) throw new Error('Aegir is closing.');
    const normalized = `notion-${action}`;
    const tool = this.connectors.listTools().find(t => t.name.startsWith('notion__') && t.name.slice(8).replaceAll('_', '-') === normalized);
    if (!tool) throw new Error(`Reconnect Notion in Settings. This feature needs the ${normalized} tool.`);
    return this.connectors.call('notion', tool.name.slice(8), args);
  }
  private async exclusive<T>(action: () => Promise<T>): Promise<T> {
    if (this.busy) throw new Error('A Notion delegation operation is already running. Try again shortly.');
    this.busy = true; this.stateValue.syncing = true; this.stateValue.error = null; this.changed();
    try { return await action(); }
    catch (error) { this.stateValue.error = errorText(error); throw error; }
    finally { this.busy = false; this.stateValue.syncing = false; if (!this.closed) this.changed(); }
  }
  private async resolve(database: string) {
    const content = textResult(await this.call('fetch', { id: database }));
    const sources = [...content.matchAll(/<data-source\s+url="(?:\{\{)?collection:\/\/([a-f0-9-]+)(?:\}\})?"/g)].map(m => m[1]);
    const id = database.startsWith('collection://') ? notionId(database) : sources.length === 1 ? notionId(sources[0]) : null;
    if (!id) throw new Error('Choose a single-source Aegir delegation database.');
    const schema = textResult(await this.call('fetch', { id: `collection://${id}` }));
    const state = schema.match(/<data-source-state>\s*([\s\S]*?)\s*<\/data-source-state>/)?.[1];
    if (!state) throw new Error('Notion did not return the database schema.');
    const properties = JSON.parse(state).schema;
    for (const [name, type] of Object.entries({ Name: 'title', Assignee: 'person', 'Tagged people': 'person', 'Delegated by': 'person', Status: 'select', Brief: 'text', Progress: 'text', Due: 'date', Tags: 'text', 'Aegir ID': 'text' }))
      if (properties[name]?.type !== type) throw new Error(`The delegation database needs a ${name} property of type ${type}.`);
    const options = properties.Status.options?.map((x: any) => x.name) ?? [];
    if (delegationStatuses.some(status => !options.includes(status))) throw new Error('The delegation database is missing required status options.');
    return id;
  }
  async configure(database: string) {
    if (typeof database !== 'string' || database.length > 1000) throw new Error('Enter a Notion database URL or ID.');
    notionId(database);
    await this.exclusive(async () => { await this.resolve(database); if (!this.closed) this.store.setSetting('delegationDatabase', database); });
  }
  async people(query: string): Promise<NotionPerson[]> {
    if (typeof query !== 'string' || query.trim().length < 2 || query.length > 200) return [];
    const rows = resultRows(await this.call('get-users', { query: query.trim(), page_size: 50 }));
    return rows.filter(r => r.type === 'person' && typeof r.id === 'string' && typeof r.name === 'string')
      .map(r => ({ id: r.id, name: r.name, ...(typeof r.email === 'string' ? { email: r.email } : {}) }));
  }
  private async query(id: string, taskId: string) {
    return resultRows(await this.call('query-data-sources', { data: { data_source_urls: [`collection://${id}`], query: `SELECT url, "Aegir ID", "Name", "Status", "Progress", "Assignee", "Tagged people", "Brief" FROM "collection://${id}" WHERE "Aegir ID" = ? LIMIT 2`, params: [taskId] } }));
  }
  async delegate(taskId: string, raw: DelegationInput) {
    const input = inputSchema.parse(raw);
    await this.exclusive(async () => {
      const task = this.store.get('tasks', taskId);
      if (!task || ['running', 'done', 'dismissed', 'proposed'].includes(task.status)) throw new Error('Choose an accepted, open task that is not running.');
      const old = task.delegation;
      const id = old?.dataSourceId ?? await this.resolve(this.state().database);
      // Validate the schema on reconnect/retry too. Query before every create so retries recover ambiguous writes.
      if (old) await this.resolve(`collection://${id}`);
      const rows = await this.query(id, taskId);
      if (rows.length > 1) throw new Error('Multiple Notion records use this Aegir ID. Resolve them in Notion before publishing.');
      if (old?.pageUrl && !rows.length) throw new Error('The shared record is missing or inaccessible. Check it in Notion; Aegir will not create a replacement.');
      const remote = rows[0];
      if (remote && !delegationStatuses.includes(remote.Status)) throw new Error('Unknown shared status. Check Notion.');
      const self = resultRows(await this.call('get-users', { user_id: 'self' }))[0];
      if (!self?.id) throw new Error('Could not identify your Notion account.');
      let link: Delegation = { ...input, dataSourceId: id, pageUrl: remote?.url ?? old?.pageUrl ?? null,
        status: remote && delegationStatuses.includes(remote.Status) ? remote.Status : old?.status ?? 'Assigned', progress: remote?.Progress ?? old?.progress ?? '', syncedAt: old?.syncedAt ?? null, error: null, publishing: true };
      this.save(taskId, link); this.changed();
      try {
        const properties = { Name: task.title, Assignee: JSON.stringify([input.assignee.id]), 'Tagged people': JSON.stringify([...new Set(input.taggedPeople.map(p => p.id))]),
          'Delegated by': JSON.stringify([self.id]), Brief: input.brief, 'date:Due:start': task.dueAt, 'date:Due:is_datetime': 0,
          Tags: taskLabels(task).map(label => `#${label}`).join(' '), 'Aegir ID': taskId };
        if (link.pageUrl) {
          await this.call('update-page', { page_id: notionId(link.pageUrl), command: 'update_properties', properties });
        } else {
          const created = await this.call('create-pages', { parent: { data_source_id: id }, pages: [{ properties: { ...properties, Status: 'Assigned' } }] });
          const pages = resultRows(created);
          const page = pages[0];
          const url = page?.url ?? (page?.id ? `https://www.notion.so/${notionId(page.id).replaceAll('-', '')}` : null);
          if (!url) throw new Error('Notion may have created the record, but did not return its link. Refresh before retrying.');
          link.pageUrl = url;
        }
        link = { ...link, publishing: false, syncedAt: new Date().toISOString() }; this.save(taskId, link);
      } catch (error) { this.save(taskId, { ...link, error: errorText(error) }); throw error; }
    });
  }
  async sync() {
    if (this.busy || this.closed) return;
    const tasks = this.store.list('tasks').filter(t => t.delegation);
    if (!tasks.length) return;
    await this.exclusive(async () => {
      const failures: string[] = [];
      for (const task of tasks) {
        if (this.closed) break;
        const link = task.delegation!;
        try {
          const rows = await this.query(link.dataSourceId, task.id);
          if (rows.length !== 1) throw new Error(rows.length ? 'Duplicate shared records. Check Notion.' : 'Shared record not found. Check Notion access or retry publishing.');
          const row = rows[0];
          if (!delegationStatuses.includes(row.Status)) throw new Error('Unknown shared status. Check Notion.');
          const owners = personIds(row.Assignee);
          const assignee = owners.includes(link.assignee.id) ? link.assignee : { id: owners[0] ?? '', name: owners.length ? 'Reassigned in Notion' : 'Unassigned' };
          this.save(task.id, { ...link, assignee, pageUrl: row.url, status: row.Status, progress: row.Progress ?? '', brief: row.Brief ?? '',
            taggedPeople: personIds(row['Tagged people']).map(id => link.taggedPeople.find(p => p.id === id) ?? { id, name: 'Notion collaborator' }),
            publishing: false, syncedAt: new Date().toISOString(), error: null });
        } catch (error) { const detail = errorText(error); failures.push(detail); this.save(task.id, { ...link, error: detail }); }
      }
      if (failures.length) throw new Error(failures[0]);
      this.stateValue.lastSyncedAt = new Date().toISOString();
    });
  }
  async setStatus(taskId: string, status: DelegationStatus) {
    z.enum(delegationStatuses).parse(status);
    await this.exclusive(async () => {
      const link = this.store.get('tasks', taskId)?.delegation;
      if (!link?.pageUrl || link.publishing) throw new Error('Publish or refresh the assignment first.');
      try {
        await this.call('update-page', { page_id: notionId(link.pageUrl), command: 'update_properties', properties: { Status: status } });
        this.save(taskId, { ...link, status, error: null, syncedAt: new Date().toISOString() });
      } catch (error) { this.save(taskId, { ...link, error: errorText(error) }); throw error; }
    });
  }
}
