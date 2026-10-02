import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { Store } from './db.js';
import { chatTranscript } from './chat-transcript.js';

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }));

it('exports the complete saved conversation, preserving content and excluding other threads', () => {
  const root = mkdtempSync(join(tmpdir(), 'aegir-transcript-'));
  const store = new Store(join(root, 'test.sqlite'));
  try {
    const group = store.groups()[0];
    const agent = store.list('agents')[0];
    const thread = store.createThread(group.id, 'A complete conversation');
    const other = store.createThread(group.id, 'Another conversation');
    store.addMessage(other.id, null, 'user', 'DO NOT INCLUDE');
    for (let index = 0; index < 75; index++)
      store.addMessage(thread.id, index % 2 ? agent.id : null, index % 2 ? 'agent' : 'user', `Message ${index.toString().padStart(2, '0')}`);
    const source = 'Unicode åäö\n\n| Topic | Source |\n| --- | --- |\n| **Evidence** | [Source](https://example.com) |\n\n```ts\nconst answer = 42;\n```';
    store.addMessage(thread.id, agent.id, 'agent', source);
    store.addMessage(thread.id, agent.id, 'agent', 'Partial answer', 'streaming');
    store.addMessage(thread.id, agent.id, 'agent', 'Tool failed', 'failed');
    store.addMessage(thread.id, null, 'system', 'Require evidence', 'complete', { type: 'skill-change', skillId: 'skill', skillName: 'follow-up-extraction', proposalId: 'proposal' });
    store.addMessage(thread.id, null, 'system', 'Pause discovery', 'complete', { type: 'routine-change', routineId: '', state: 'pending', change: { enabled: false, instructions: 'Only my commitments.' } });
    expect(store.messagePage(thread.id).messages).toHaveLength(50);
    const text = chatTranscript(store, thread.id, [{ id: 'proposal', state: 'applied' }]);
    expect(text).toContain('# A complete conversation');
    expect(text.match(/Message \d\d/g)).toEqual(Array.from({ length: 75 }, (_, i) => `Message ${i.toString().padStart(2, '0')}`));
    expect(text).toContain('**You**');
    expect(text).toContain(`**${agent.name}**`);
    expect(text).toContain(source);
    expect(text).not.toContain('DO NOT INCLUDE');
    expect(text).toContain('[Response in progress — copied so far]');
    expect(text).toContain('[Response failed]');
    expect(text).toContain('Skill revision: follow-up-extraction · applied');
    expect(text).toContain('Routine change · pending');
    expect(text).toContain('Status: Paused');
    expect(text).toContain('Only my commitments.');
    expect(() => chatTranscript(store, 'deleted')).toThrow('no longer exists');
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});
