import { describe, expect, it } from 'vitest';
import { describeCron } from './cron.js';

describe('cron descriptions', () => {
  it('describes the shapes the scheduled tasks use', () => {
    expect(describeCron('0 7-22 * * 1-5')).toBe('Hourly 07:00–22:00, weekdays');
    expect(describeCron('0 5 * * *')).toBe('Daily at 05:00');
    expect(describeCron('30 8 * * 1-5')).toBe('Weekdays at 08:30');
    expect(describeCron('0 7 * * 0')).toBe('Sundays at 07:00');
    expect(describeCron('0 7 * * 7')).toBe('Sundays at 07:00');
    expect(describeCron('7 7-23 * * *')).toBe('Hourly at :07, 07–23');
    expect(describeCron('0 4 1 * *')).toBe('Monthly on the 1st at 04:00');
    expect(describeCron('0 8 3 * *')).toBe('Monthly on the 3rd at 08:00');
    expect(describeCron('0 7,14 * * 1-5')).toBe('Weekdays at 07:00 and 14:00');
    expect(describeCron('10,40 7-22 * * *')).toBe('Hourly at :10 and :40, 07–22');
    expect(describeCron('*/15 * * * *')).toBe('Every 15 minutes');
  });
  it('falls back to the raw expression', () => {
    for (const raw of ['0 9 * 1 *', '0 9 * * 1,3', '0 9 1 * 1', '61 9 * * *', 'every day', '0 22-7 * * *']) expect(describeCron(raw)).toBe(raw);
  });
  it('never uses an em dash', () => {
    for (const raw of ['0 7-22 * * 1-5', '7 7-23 * * *']) expect(describeCron(raw)).not.toContain('—');
  });
});
