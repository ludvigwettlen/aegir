import { describe, expect, it } from 'vitest';
import { nextTaskDue, parseDue, parseQuickAdd } from './tasks.js';

const today = new Date(2026, 9, 12, 12);
describe('recurring dates', () => {
  it.each([
    ['daily', '2026-10-01', '2026-10-13'],
    ['weekly', '2026-10-02', '2026-10-16'],
    ['weekdays', '2026-10-16', '2026-10-19'],
    ['monthly', '2026-08-31', '2026-10-31'],
  ] as const)('advances %s past today without losing cadence', (repeat, due, next) => {
    expect(nextTaskDue(due, repeat, today)).toBe(next);
  });
  it('clamps short months but preserves the original day, including leap years', () => {
    expect(nextTaskDue('2027-01-31', 'monthly', new Date(2027, 0, 31))).toBe('2027-02-28');
    expect(nextTaskDue('2027-02-28', 'monthly', new Date(2027, 1, 28), '2027-01-31')).toBe('2027-03-31');
    expect(nextTaskDue('2028-01-31', 'monthly', today)).toBe('2028-02-29');
  });
  it('uses calendar days across DST boundaries', () => {
    expect(nextTaskDue('2026-03-28', 'daily', new Date(2026, 2, 28))).toBe('2026-03-29');
    expect(nextTaskDue('2026-10-25', 'daily', today)).toBe('2026-10-26');
  });
  it('rejects impossible dates and date overflow', () => {
    expect(parseDue('2026-02-30', today)).toBeNull();
    expect(() => nextTaskDue('2026-02-30', 'daily', today)).toThrow('valid due date');
    expect(() => nextTaskDue('9999-12-31', 'daily', today)).toThrow('supported date range');
  });
  it.each([
    ['day', 'daily'], ['weekday', 'weekdays'], ['week', 'weekly'], ['month', 'monthly'],
  ])('parses every %s with a label and an explicit date', (unit, recurrence) => {
    expect(parseQuickAdd(`Review #work every ${unit} fri`, today)).toEqual({ title: 'Review', label: 'work', dueAt: '2026-10-16', recurrence });
  });
  it('defaults repetition to today and retains similar ordinary words', () => {
    expect(parseQuickAdd('Review EVERY DAY', today)).toEqual({ title: 'Review', label: null, dueAt: '2026-10-12', recurrence: 'daily' });
    expect(parseQuickAdd('Review every monthly report', today).title).toBe('Review every monthly report');
  });
});
