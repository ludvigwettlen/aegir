import type { Task } from './types.js';
export function normalizeLabels(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 20 || value.some(label => typeof label !== 'string')) throw new Error('Use up to 20 labels.');
  const labels = [...new Set(value.map(label => label.trim().replace(/^#/, '').toLowerCase()).filter(Boolean))];
  if (labels.some(label => label.length > 40 || /[\r\n,]/.test(label))) throw new Error('Labels must be at most 40 characters without commas or newlines.');
  return labels;
}
export function taskLabels(task: Pick<Task, 'label' | 'labels'>): string[] {
  return task.labels ?? (task.label ? [task.label] : []);
}
export function parseLabels(text: string): string[] { return normalizeLabels(text.split(',').map(label => label.trim()).filter(Boolean)); }
