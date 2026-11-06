import { statSync } from 'node:fs';
import type { ContentMatch, Task } from '../shared/types.js';
import { fold, snippetFor } from '../shared/task-search.js';
import { listDocuments, readDocument, workspaceFile } from './documents.js';

// Find a task looks in the Markdown documents in each task's folder too: the drafts, memos and prep notes the assistant wrote,
// the same files the task panel lists. Each file's text is kept, folded, until it changes on disk, so typing does not
// read every document again. Read-only.
const MAX_BYTES = 2 * 1024 * 1024;
const cache = new Map<string, { mtimeMs: number; size: number; text: string; folded: string }>();

function textOf(root: string, reference: string) {
  const path = workspaceFile(root, reference);
  const stat = statSync(path);
  if (!stat.isFile() || stat.size > MAX_BYTES) return null;
  const seen = cache.get(path);
  if (seen && seen.mtimeMs === stat.mtimeMs && seen.size === stat.size) return seen;
  const text = readDocument(root, reference).content;
  const entry = { mtimeMs: stat.mtimeMs, size: stat.size, text, folded: fold(text) };
  if (cache.size >= 64) cache.delete(cache.keys().next().value!);
  cache.set(path, entry);
  return entry;
}

// Which of the searched words (see searchWords) each task's documents hold, quoting the document that holds the most.
// A word with a # is a label and never looked up here.
export function searchTaskDocuments(tasks: Pick<Task, 'id' | 'outputDir'>[], words: readonly string[]): ContentMatch[] {
  const wanted = words.map((word, index) => [word, index] as const).filter(([word]) => !word.startsWith('#') && word.length > 1);
  if (!wanted.length) return [];
  const matches: ContentMatch[] = [];
  for (const task of tasks) {
    if (!task.outputDir) continue;
    let documents: string[];
    try { documents = listDocuments(task.outputDir).map(entry => entry.path); } catch { continue; }
    const held = new Set<number>();
    let best: { path: string; text: string; words: string[] } | null = null;
    for (const document of documents) {
      let entry;
      try { entry = textOf(task.outputDir, document); } catch { continue; }
      if (!entry) continue;
      const found = wanted.filter(([word]) => entry.folded.includes(word));
      found.forEach(([, index]) => held.add(index));
      if (found.length && (!best || found.length > best.words.length)) best = { path: document, text: entry.text, words: found.map(([word]) => word) };
    }
    if (!best) continue;
    matches.push({
      taskId: task.id, words: [...held].sort((a, b) => a - b), where: 'document', document: best.path, role: null, agentId: null, draft: false, messageId: null,
      snippet: snippetFor(best.text, ...best.words) || best.text.slice(0, 80),
    });
  }
  return matches;
}
