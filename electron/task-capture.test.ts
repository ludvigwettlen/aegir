import { expect, it } from 'vitest';
import { readCapture } from './task-capture.js';
it('preserves explicit dates, recurrence and labels and rejects invalid model dates', () => {
  const reply = JSON.stringify({ title: 'Review the inbox', notes: 'Keep this context', label: 'invented', dueAt: '2026-11-10' });
  expect(readCapture('Review inbox every week tomorrow #work', reply, [], new Date('2026-10-26T12:00:00'))).toMatchObject({ dueAt: '2026-10-27', recurrence: 'weekly', label: 'work', notes: 'Keep this context' });
  expect(readCapture('Review inbox', reply, []).label).toBeNull();
  expect(() => readCapture('Task', JSON.stringify({ title: 'Task', notes: '', label: null, dueAt: '2026-02-30' }), [])).toThrow('invalid date');
  expect(() => readCapture('Task', '{"title":""}', [])).toThrow('invalid task');
});
