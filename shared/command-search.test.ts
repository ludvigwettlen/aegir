import { describe, expect, it } from 'vitest';
import { rankCommands } from './command-search.js';

const commands = [
  { title: 'Mark done', keywords: ['complete', 'finish', 'check'] },
  { title: 'Snooze…', keywords: ['later', 'postpone', 'defer'] },
  { title: 'Set due date…', keywords: ['deadline', 'schedule'] },
  { title: 'Clear due date', keywords: ['remove date'] },
  { title: 'Ask Claude…', keywords: ['hand off', 'delegate', 'agent'] },
  { title: 'Delete task', keywords: ['remove', 'trash'] },
  { title: 'Go to Today', keywords: ['list', 'jump'] },
  { title: 'Go to Upcoming', keywords: ['list', 'jump'] },
  { title: 'Run Hourly discovery now', subtitle: 'Routine' },
  { title: 'Go to Hourly discovery', subtitle: 'Routine' },
  { title: 'Go to #Lidingö' },
];
const titles = (query: string) => rankCommands(commands, query).map((command) => command.title);

describe('command search', () => {
  it('keeps the given order for an empty query', () => {
    expect(titles('')).toEqual(commands.map((command) => command.title));
    expect(titles('   ')).toEqual(commands.map((command) => command.title));
  });

  it('ranks the start of the name, then the start of a word, then initials, then inside a word', () => {
    expect(titles('go')[0]).toBe('Go to Today');
    expect(titles('due')).toEqual(['Set due date…', 'Clear due date']);
    expect(titles('cdd')[0]).toBe('Clear due date');
    expect(titles('ate')).toEqual(['Set due date…', 'Clear due date']);
  });

  it('finds commands through synonyms and the second line', () => {
    expect(titles('remove')).toEqual(['Clear due date', 'Delete task']);
    expect(titles('later')).toEqual(['Snooze…']);
    expect(titles('routine')).toEqual(['Run Hourly discovery now', 'Go to Hourly discovery']);
  });

  it('accepts letters in order as a last resort', () => {
    expect(titles('snz')).toEqual(['Snooze…']);
    expect(titles('zz')).toEqual([]);
    // s-n-o is scattered across "Run Hourly discovery now", which shouldn't count as a match.
    expect(titles('sno')).toEqual(['Snooze…']);
  });

  it('needs every typed word to match', () => {
    expect(titles('run hou')).toEqual(['Run Hourly discovery now']);
    expect(titles('go hourly')).toEqual(['Go to Hourly discovery']);
    expect(titles('ask banana')).toEqual([]);
  });

  it('ignores case and accents', () => {
    expect(titles('LIDINGO')).toEqual(['Go to #Lidingö']);
    expect(titles('#lid')).toEqual(['Go to #Lidingö']);
  });

  it('keeps the given order between equal matches', () => {
    expect(titles('go to')).toEqual(['Go to Today', 'Go to Upcoming', 'Go to Hourly discovery', 'Go to #Lidingö']);
  });
});
