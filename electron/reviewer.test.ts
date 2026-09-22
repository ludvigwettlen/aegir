import { describe, expect, it } from 'vitest';
import { jsonObject, Reviewer, searchArguments, taskSourceKey } from './reviewer.js';
import type { Store } from './db.js';
import type { ConnectorManager } from './connectors.js';
import type { CodexProvider } from './codex.js';
import type { MemoryService } from './memory.js';

describe('scheduled review helpers', () => {
  it('adapts to tool-specific search field names', () => {
    expect(searchArguments({ properties: { search_query: { type: 'string' } } }, 'decision')).toEqual({ search_query: 'decision' });
    expect(() => searchArguments({ properties: {} }, 'decision')).toThrow('no query field');
  });
  it('deduplicates repeated source-linked tasks despite whitespace and case', () => {
    expect(taskSourceKey('slack', 'https://slack.test/1', 'Send  proposal')).toBe(taskSourceKey('slack', 'https://slack.test/1', 'send proposal'));
    expect(taskSourceKey('slack', 'https://slack.test/1', 'Send proposal')).not.toBe(taskSourceKey('slack', 'https://slack.test/2', 'Send proposal'));
  });
  it('ignores malformed extraction output', () => {
    expect(jsonObject('no json')).toEqual({});
    expect(jsonObject('```json\n{"tasks":[]}\n```')).toEqual({ tasks: [] });
  });
  it('creates one proposed task when hourly search repeats the same source', async () => {
    const tasks = new Map<string, { title: string; status: string }>();
    let scans = 0;
    const store = {
      createScan: () => ({ id: String(++scans) }),
      finishScan: () => {}, getSetting: () => '',
      db: { prepare: () => ({ get: (key: string) => tasks.get(key) }) },
      createTask: (title: string, _notes: string, status: string, _url: string, key: string) => { tasks.set(key, { title, status }); }
    } as unknown as Store;
    const connectors = {
      states: { slack: { status: 'connected', tools: ['slack_search_messages'] }, notion: { status: 'disconnected', tools: [] } },
      toolInfo: () => ({ inputSchema: { properties: { query: { type: 'string' } } } }),
      call: async () => ({ content: [{ type: 'text', text: 'Message: please send the proposal. https://example.com/message/1' }] })
    } as unknown as ConnectorManager;
    const model = { run: async () => ({ text: JSON.stringify({ tasks: [{ title: 'Send proposal', notes: 'Follow up', sourceUrl: 'https://example.com/message/1' }] }) }) } as unknown as CodexProvider;
    const memory = { retryPending: async () => {} } as unknown as MemoryService;
    const reviewer = new Reviewer(store, connectors, model, memory, '/tmp');
    await reviewer.run(); await reviewer.run();
    expect(tasks.size).toBe(1);
    expect([...tasks.values()][0].status).toBe('proposed');
    expect(scans).toBe(6);
  });
});
