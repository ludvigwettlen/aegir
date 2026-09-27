import type { RoutineSchedule } from './types.js';

const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const isWeekday = (date: Date) => date.getDay() !== 0 && date.getDay() !== 6;
function atTime(date: Date, at = '09:00') {
  const [hours, minutes] = at.split(':').map(Number);
  const next = new Date(date); next.setHours(hours || 0, minutes || 0, 0, 0); return next;
}

// The first scheduled slot strictly after `from`, in local time.
export function nextRunAfter(schedule: RoutineSchedule, from: Date): Date {
  let next: Date;
  if (schedule.every === 'hour') { next = new Date(from); next.setMinutes(0, 0, 0); next.setHours(next.getHours() + 1); }
  else if (schedule.every === 'day') { next = atTime(from, schedule.at); if (next <= from) next.setDate(next.getDate() + 1); }
  else {
    next = atTime(from, schedule.at);
    const target = schedule.day ?? 1;
    next.setDate(next.getDate() + ((target - next.getDay() + 7) % 7));
    if (next <= from) next.setDate(next.getDate() + 7);
  }
  if (schedule.weekdaysOnly && schedule.every !== 'week') {
    while (!isWeekday(next)) {
      if (schedule.every === 'hour') { next.setDate(next.getDate() + 1); next.setHours(0, 0, 0, 0); }
      else next.setDate(next.getDate() + 1);
    }
  }
  return next;
}

// A routine is due once its next slot after the previous run has passed. Missed slots collapse into one run.
export function isDue(schedule: RoutineSchedule, lastRunAt: string | null, createdAt: string, now: Date): boolean {
  return nextRunAfter(schedule, new Date(lastRunAt || createdAt)) <= now;
}

export function describeSchedule(schedule: RoutineSchedule): string {
  const weekdays = schedule.weekdaysOnly ? ', weekdays' : '';
  if (schedule.every === 'hour') return `Every hour${weekdays}`;
  if (schedule.every === 'day') return `Daily at ${schedule.at || '09:00'}${weekdays}`;
  return `${days[schedule.day ?? 1]}s at ${schedule.at || '09:00'}`;
}

export function validSchedule(value: unknown): value is RoutineSchedule {
  const schedule = value as RoutineSchedule;
  if (!schedule || !['hour', 'day', 'week'].includes(schedule.every)) return false;
  if (schedule.at !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.at)) return false;
  if (schedule.day !== undefined && !(Number.isInteger(schedule.day) && schedule.day >= 0 && schedule.day <= 6)) return false;
  return schedule.weekdaysOnly === undefined || typeof schedule.weekdaysOnly === 'boolean';
}
