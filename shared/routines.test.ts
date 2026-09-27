import { describe, expect, it } from 'vitest';
import { isDue, nextRunAfter, validSchedule } from './routines.js';

const at = (d: number, h: number, m = 0) => new Date(2026, 8, d, h, m);
describe('routine schedules', () => {
  it('runs hourly on the hour', () => {
    expect(nextRunAfter({ every: 'hour' }, at(25, 10, 12))).toEqual(at(25, 11));
  });
  it('skips weekends for weekday-only hourly routines', () => {
    expect(nextRunAfter({ every: 'hour', weekdaysOnly: true }, at(25, 23, 30))).toEqual(at(28, 0));
  });
  it('runs daily and weekly at a set time', () => {
    expect(nextRunAfter({ every: 'day', at: '08:30' }, at(25, 9))).toEqual(at(26, 8, 30));
    expect(nextRunAfter({ every: 'week', day: 5, at: '09:00' }, at(25, 9))).toEqual(at(2 + 30, 9));
  });
  it('collapses missed slots into a single due run', () => {
    expect(isDue({ every: 'hour' }, at(25, 8).toISOString(), '', at(25, 12, 5))).toBe(true);
    expect(isDue({ every: 'hour' }, at(25, 12, 1).toISOString(), '', at(25, 12, 5))).toBe(false);
  });
  it('rejects malformed schedules from agents', () => {
    expect(validSchedule({ every: 'day', at: '25:00' })).toBe(false);
    expect(validSchedule({ every: 'week', day: 5, at: '09:00' })).toBe(true);
  });
});
