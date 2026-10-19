import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { Store } from './db';
import { searchWords } from '../shared/task-search';
import type { MessageMeta } from '../shared/types';
vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }));

it('indexes existing conversations and Aegir drafts, then follows edits, deletion and undo', () => {
  const root = mkdtempSync(join(tmpdir(), 'aegir-search-'));
  const file = join(root, 'db.sqlite');
  let store = new Store(file);
  try {
    const task = store.createTask({ title: 'A task' });
    const thread = store.createThread(store.groups()[0].id, 'Task', 'task', task.id);
    store.updateTask(task.id, { threadId: thread.id });
    const a = store.addMessage(thread.id, null, 'user', 'Åsne reviews the budget');
    store.addMessage(thread.id, null, 'agent', 'The renewal is agreed');
    const draft = store.addMessage(thread.id, null, 'system', 'Email draft', 'complete', {
      type: 'email-draft', body: 'Please review the contract', subject: 'Annual renewal', to: 'a@example.com', cc: '', bcc: '',
    } as MessageMeta);
    const other = store.createThread(store.groups()[0].id, 'Private chat');
    store.addMessage(other.id, null, 'user', 'Unrelated unicorn');
    // Simulate upgrading a populated database with no search index.
    store.db.exec('DROP TRIGGER message_search_insert; DROP TRIGGER message_search_update; DROP TRIGGER message_search_delete; DROP TABLE message_search');
    store.setSetting('messageSearchVersion', '');
    store.close(); store = new Store(file);
    const search = (query: string) => store.searchTaskMessages(searchWords(query));
    expect(search('asne renewal')).toMatchObject([{ taskId: task.id, words: [0, 1] }]);
    expect(search('contract')).toMatchObject([{ messageId: draft.id, draft: true, snippet: expect.stringContaining('contract') }]);
    expect(search('unicorn')).toEqual([]);
    store.updateMessage(a.id, 'Changed to forecast', 'complete');
    expect(search('budget')).toEqual([]);
    expect(search('forecast')).toHaveLength(1);
    store.setMessageMeta(draft.id, { type: 'slack-draft', text: 'New proposal' } as MessageMeta);
    expect(search('contract')).toEqual([]);
    expect(search('proposal')).toMatchObject([{ draft: true }]);
    store.updateTask(task.id, { status: 'done' });
    expect(search('proposal')).toHaveLength(1);
    store.deleteTask(task.id, true);
    expect(search('proposal')).toEqual([]);
    store.undoTaskAction();
    expect(search('proposal')).toHaveLength(1);
    store.updateTask(task.id, { status: 'dismissed' });
    expect(search('proposal')).toEqual([]);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});
