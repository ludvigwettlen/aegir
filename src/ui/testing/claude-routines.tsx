import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@usefragments/ui';
import '../styles';
import type { ClaudeRoutines, DesktopApi, Snapshot } from '../../../shared/types';

// Isolated visual fixture for the read-only Claude Code routines: no Claude app files, no database.
const now = new Date().toISOString();
const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
const data = {
  agents: [{ id: 'lead', name: 'Aegir', role: 'Lead', color: '#abc', createdAt: now }],
  groups: [{ id: 'team', title: 'Team', kind: 'group', leadAgentId: 'lead', agentIds: ['lead'] }],
  threads: [], tasks: [], taskLinks: [], approvals: [], connectors: [], routineRuns: [],
  routines: [{ id: 'r1', name: 'Hourly discovery', instructions: '', agentId: 'lead', schedule: { every: 'hour' }, enabled: false, lastRunAt: null, createdAt: now, updatedAt: now }],
} as unknown as Snapshot;
const claude: ClaudeRoutines = { source: '/fixture/scheduled-tasks.json', tasks: [
  { id: 'cron-daily-brief', name: 'cron-daily-brief', description: 'Writes the morning brief.', schedule: 'Daily at 05:00', cron: '0 5 * * *', enabled: true, lastRunAt: ago(1), runs: [
    { startedAt: ago(1), endedAt: ago(0.9), status: 'needs_action', detail: 'Gmail auth failed', needsAction: 'create a new app password' },
    { startedAt: ago(25), endedAt: ago(24.9), status: 'completed', detail: 'wrote the brief', needsAction: null },
    { startedAt: ago(49), endedAt: null, status: 'failed', detail: 'API Error: Connection dropped', needsAction: null },
  ] },
  { id: 'cron-queue-reconciler', name: 'cron-queue-reconciler', description: '', schedule: 'Hourly at :30, 07–22', cron: '30 7-22 * * *', enabled: false, lastRunAt: null, runs: [] },
] };
window.aegir = { snapshot: async () => data, onEvent: () => () => {}, claudeRoutines: async () => claude } as unknown as DesktopApi;
const { App } = await import('../App');
createRoot(document.getElementById('root')!).render(<ThemeProvider defaultMode="light"><App /></ThemeProvider>);
