import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { searchTaskDocuments } from './document-search.js';
import { searchWords } from '../shared/task-search.js';

describe('searching the documents in task folders', () => {
  it('says which words each task folder holds, quotes the document holding the most, and reads a file again once it changes', () => {
    const root = mkdtempSync(join(tmpdir(), 'aegir-document-search-'));
    try {
      const memo = join(root, 'memo');
      mkdirSync(join(memo, 'drafts'), { recursive: true });
      writeFileSync(join(memo, 'outline.md'), '# Outline\nOpen with the Fjelltek renewal.');
      writeFileSync(join(memo, 'drafts', 'memo.md'), '## Draft\nFjelltek signed, and **Åsne** sends the DPA on Friday.');
      writeFileSync(join(memo, 'numbers.csv'), 'dpa,friday');
      const tasks = [{ id: 'memo', outputDir: memo }, { id: 'none', outputDir: null }, { id: 'gone', outputDir: join(root, 'missing') }];
      const search = (query: string) => searchTaskDocuments(tasks, searchWords(query));

      const [found, ...rest] = search('asne renewal #board fjelltek');
      expect(rest).toEqual([]);
      // Words from two documents count together; #board is a label and never looked up.
      expect(found).toMatchObject({ taskId: 'memo', words: [0, 1, 3], where: 'document', document: join('drafts', 'memo.md') });
      expect(found.snippet).toContain('Åsne sends the DPA');
      expect(found.snippet).not.toContain('**');
      // Only Markdown is read.
      expect(search('csv')).toEqual([]);

      writeFileSync(join(memo, 'outline.md'), '# Outline\nOpen with the Fjordline deal.');
      const later = new Date(Date.now() + 5000);
      utimesSync(join(memo, 'outline.md'), later, later);
      expect(search('fjordline')).toMatchObject([{ taskId: 'memo', document: 'outline.md' }]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
