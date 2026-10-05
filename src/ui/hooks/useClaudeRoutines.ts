import { useEffect, useState } from 'react';
import type { ClaudeRoutines } from '../../../shared/types';
import { api } from '../views/common';

// Claude Code scheduled tasks are not part of the snapshot; poll them every minute.
export function useClaudeRoutines(): ClaudeRoutines {
  const [value, setValue] = useState<ClaudeRoutines>({ tasks: [], source: null });
  useEffect(() => {
    let live = true;
    const load = () => { void api.claudeRoutines?.().then(next => { if (live && next && Array.isArray(next.tasks)) setValue(next); }).catch(() => {}); };
    load();
    const timer = window.setInterval(load, 60_000);
    return () => { live = false; window.clearInterval(timer); };
  }, []);
  return value;
}
