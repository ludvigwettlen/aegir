// Ranks command palette entries against what the user typed. Kept free of React so it runs with the other shared tests.
export type Searchable = { title: string; keywords?: readonly string[]; subtitle?: string };

// Lowercase and drop accents, so "lidingo" finds "Lidingö".
export const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const wordsOf = (text: string) => fold(text).split(/[^\p{L}\p{N}#]+/u).filter(Boolean);

// Letters of `needle` appear in `haystack` in order and close together: "snz" is in "snooze", but scattered
// letters across a long name don't count. Returns the shortest span that holds them, or Infinity.
function inOrder(needle: string, haystack: string) {
  let best = Infinity;
  for (let start = haystack.indexOf(needle[0]); start >= 0; start = haystack.indexOf(needle[0], start + 1)) {
    let at = start;
    for (const letter of needle.slice(1)) {
      at = haystack.indexOf(letter, at + 1);
      if (at < 0) return best;
    }
    best = Math.min(best, at - start + 1);
  }
  return best;
}

// Best match first: the name starts with it, a word starts with it, the words' first letters,
// inside the name, a synonym, the second line, then letters in order. 0 means no match.
function score(word: string, item: Searchable) {
  const title = fold(item.title);
  const titleWords = wordsOf(item.title);
  if (title === word) return 120;
  if (title.startsWith(word)) return 100;
  if (titleWords.some((part) => part.startsWith(word))) return 80;
  if (word.length > 1 && titleWords.map((part) => part[0]).join('').startsWith(word)) return 70;
  if (title.includes(word)) return 50;
  const keywords = (item.keywords || []).flatMap(wordsOf);
  if (keywords.some((part) => part.startsWith(word))) return 40;
  if (item.subtitle && fold(item.subtitle).includes(word)) return 30;
  if (word.length > 2 && inOrder(word, title.replace(/\s+/g, '')) <= word.length * 2 + 1) return 20;
  return 0;
}

// Every typed word must match. Ties keep the given order, which callers use to put the selected task first.
export function rankCommands<T extends Searchable>(items: readonly T[], query: string): T[] {
  const queryWords = wordsOf(query);
  if (!queryWords.length) return [...items];
  return items
    .map((item, index) => {
      let total = 0;
      for (const word of queryWords) {
        const value = score(word, item);
        if (!value) return null;
        total += value;
      }
      return { item, index, total };
    })
    .filter((entry): entry is { item: T; index: number; total: number } => entry !== null)
    .sort((a, b) => b.total - a.total || a.index - b.index)
    .map((entry) => entry.item);
}
