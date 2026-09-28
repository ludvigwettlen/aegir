import { basename, dirname, isAbsolute } from 'node:path';
// App-server's skills/list reports SKILL.md paths. Thread-local overrides accept
// package directories; never change the user's global skills/config/write state.
export function disabledHostSkills(response: unknown): { path: string; enabled: false }[] {
  const data = (response as { data?: { skills?: { path?: string }[]; errors?: unknown[] }[] } | null)?.data;
  if (!Array.isArray(data)) throw new Error('Codex did not return its skill catalog; cannot isolate Ägir skills');
  const paths = new Set<string>();
  for (const entry of data) {
    if (!Array.isArray(entry.skills) || entry.errors?.length) throw new Error('Codex skill discovery failed; cannot isolate Ägir skills');
    for (const skill of entry.skills) {
      if (typeof skill.path !== 'string' || !isAbsolute(skill.path)) throw new Error('Codex returned an invalid skill path');
      paths.add(basename(skill.path) === 'SKILL.md' ? dirname(skill.path) : skill.path);
    }
  }
  return [...paths].map(path => ({ path, enabled: false }));
}
