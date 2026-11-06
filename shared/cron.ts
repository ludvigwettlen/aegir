// Plain-language descriptions of the five-field cron expressions.
// Anything outside the common shapes falls back to the raw expression.
const dayNames = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
const pad = (value: number) => String(value).padStart(2, '0');
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
const and = (items: string[]) => items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
const num = (value: string, max: number) => /^\d+$/.test(value) && Number(value) <= max ? Number(value) : null;
function list(value: string, max: number) {
  const items = value.split(',').map(item => num(item, max));
  return items.every(item => item !== null) ? items as number[] : null;
}

export function describeCron(expression: string): string {
  const raw = expression.trim();
  const fields = raw.split(/\s+/);
  if (fields.length !== 5 || fields[3] !== '*') return raw;
  const [minute, hour, dom, , dow] = fields;
  const weekday = dow === '*' ? 'daily' : dow === '1-5' ? 'weekdays' : num(dow, 7) !== null ? dayNames[num(dow, 7)! % 7] : null;
  if (!weekday) return raw;
  const suffix = weekday === 'daily' ? '' : `, ${weekday}`;
  const minutes = list(minute, 59);
  const hours = list(hour, 23);
  if (dom !== '*') {
    const date = num(dom, 31);
    if (!date || dow !== '*' || minutes?.length !== 1 || hours?.length !== 1) return raw;
    return `Monthly on the ${ordinal(date)} at ${pad(hours[0])}:${pad(minutes[0])}`;
  }
  const step = minute.match(/^\*\/(\d+)$/);
  if (step && hour === '*') return `Every ${step[1]} minutes${suffix}`;
  if (!minutes) return raw;
  const span = hour === '*' ? [0, 23] : hour.match(/^(\d+)-(\d+)$/)?.slice(1).map(Number);
  if (span && span[0] < span[1] && span[1] <= 23) {
    const range = hour === '*' ? '' : minutes.join() === '0' ? ` ${pad(span[0])}:00–${pad(span[1])}:00` : `, ${pad(span[0])}–${pad(span[1])}`;
    return `Hourly${minutes.join() === '0' ? '' : ` at ${and(minutes.map(item => `:${pad(item)}`))}`}${range}${suffix}`;
  }
  if (!hours) return raw;
  const times = and(hours.flatMap(h => minutes.map(m => `${pad(h)}:${pad(m)}`)));
  return `${weekday === 'daily' ? 'Daily' : weekday === 'weekdays' ? 'Weekdays' : weekday} at ${times}`;
}
