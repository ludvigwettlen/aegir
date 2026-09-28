import { useCallback, useEffect, useState } from 'react';
import type { SkillLibrary } from '../../../shared/skills';
import { api } from '../views/common';
export function useSkillLibrary() {
  const [library, setLibrary] = useState<SkillLibrary | null>(null);
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    try { setLibrary(await api.skillLibrary()); setError(''); } catch (error) { setError(String(error)); }
  }, []);
  useEffect(() => { void reload(); return api.onEvent(event => { if (event.type === 'skills-changed') void reload(); }); }, [reload]);
  return { library, error, reload };
}
