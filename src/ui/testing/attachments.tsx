import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@usefragments/ui';
import '../styles';
import type { AppEvent, DesktopApi, Message, Snapshot, StagedAttachment, Task, TaskFile } from '../../../shared/types';

// Isolated fixture for attachments: a task with a conversation, an API that copies a dropped file the way the
// main process does (refusing one that is too big), and a send that can be rejected once.
const now = new Date().toISOString();
const threadId = 'board-thread';
const task: Task = {
  id: 'board', title: 'Read the Q3 board pack', notes: '', label: 'board', dueAt: null, status: 'review',
  agentId: 'lead', threadId, outputDir: '/Users/m/Documents/Legolas/board-abc123', sourceUrl: null,
  sourceKey: null, createdAt: now, updatedAt: now, completedAt: null,
};
const data = {
  agents: [{ id: 'lead', name: 'Claude', role: 'Lead', color: '#ede7fc', instructions: '', createdAt: now }],
  groups: [{ id: 'team', title: 'Team', kind: 'group', agentIds: ['lead'], leadAgentId: 'lead', instructions: '', createdAt: now }],
  threads: [{ id: threadId, groupId: 'team', title: task.title, kind: 'task', taskId: task.id, status: 'active',
    createdAt: now, updatedAt: now, agentIds: ['lead'], busyAgentIds: [], snippet: '', messageCount: 1 }],
  tasks: [task],
  taskLinks: [], taskFiles: [] as TaskFile[], routines: [], routineRuns: [], connectors: [], approvals: [],
  legacyMemoryCount: 0, memoryInstructions: '', codexStatus: 'Connected', engine: 'Claude Code',
  memoryProvider: 'gbrain', reminders: { enabled: false, list: '', state: 'off', detail: '', lastSyncAt: null },
  launchAtLogin: false, brainDir: '/Users/m/brain',
  browser: { enabled: false, status: 'disabled', detail: '', threadId: null },
  mcpSettings: { slackClientId: '', slackConfigured: false },
} as unknown as Snapshot;

const messages: Message[] = [];
const listeners = new Set<(event: AppEvent) => void>();
const fixture = { calls: [] as Array<[string, ...unknown[]]>, rejectNextSend: false };
Object.assign(window, { fixture });
const record = (name: string, ...args: unknown[]) => { fixture.calls.push([name, ...args]); };
const emit = () => { const value = structuredClone(data); for (const listener of listeners) listener({ type: 'snapshot', value }); };

const kinds: Record<string, TaskFile['kind']> = { pdf: 'pdf', xlsx: 'office', png: 'image', md: 'text' };
let staged = 0;
const stage = (path: string): StagedAttachment => {
  const name = path.split('/').pop()!;
  // The one cap the fixture enforces, so a refused chip can be seen next to a copied one.
  if (name === 'huge.bin') return { name, file: null, error: 'huge.bin is 62 MB; the limit is 50 MB' };
  const file: TaskFile = {
    id: `file-${++staged}`, taskId: task.id, threadId, messageId: null, root: 'task',
    path: `attachments/${name}`, name, kind: kinds[name.split('.').pop()!] || 'other',
    mime: 'application/octet-stream', bytes: 8, sha256: name, originalPath: path, brainPath: null,
    brainFiledAt: null, createdAt: new Date().toISOString(),
  };
  data.taskFiles = [...data.taskFiles, file];
  return { name, file, error: null };
};

window.aegir = {
  snapshot: async () => structuredClone(data),
  onEvent: (listener: (event: AppEvent) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
  threadMessages: async () => ({ messages: structuredClone(messages), before: null }),
  skillLibrary: async () => ({ skills: [], proposals: [], routineBindings: {} }),
  listDocuments: async () => [],
  runEvents: async () => [],
  claudeRoutines: async () => ({ source: null, tasks: [] }),
  // Electron answers with an empty string for a file that has no path on disk, as a pasted screenshot has.
  pathForFile: (file: File) => (file.name === 'image.png' ? '' : `/Users/m/Downloads/${file.name}`),
  stageFiles: async (thread: string, paths: string[]) => {
    record('stageFiles', thread, paths);
    const items = paths.map(stage);
    emit();
    return items;
  },
  stageClipboardFile: async (thread: string) => { record('stageClipboardFile', thread); const item = stage('/private/tmp/pasted.png'); emit(); return item; },
  sendMessage: async (thread: string, content: string, fileIds?: string[]) => {
    record('sendMessage', thread, content, fileIds);
    if (fixture.rejectNextSend) { fixture.rejectNextSend = false; throw new Error('An agent is already working in this thread'); }
    const message: Message = { id: `message-${messages.length}`, threadId: thread, agentId: null, role: 'user', content,
      status: 'complete', createdAt: new Date().toISOString(),
      meta: fileIds?.length ? { type: 'attachments', files: data.taskFiles.filter(file => fileIds.includes(file.id)) } : null };
    messages.push(message);
    // Like the app: the saved message arrives as its own event, then the snapshot.
    for (const listener of listeners) listener({ type: 'message', value: structuredClone(message) });
    emit();
  },
  removeTaskFile: async (fileId: string) => {
    record('removeTaskFile', fileId);
    data.taskFiles = data.taskFiles.filter(file => file.id !== fileId);
    emit();
  },
  fileToBrain: async (fileId: string, slug: string) => {
    record('fileToBrain', fileId, slug);
    const brainPath = `/Users/m/brain/sources/${slug}/.raw/${data.taskFiles.find(file => file.id === fileId)!.name}`;
    data.taskFiles = data.taskFiles.map(file => (file.id === fileId ? { ...file, brainPath, brainFiledAt: new Date().toISOString() } : file));
    emit();
    return data.taskFiles.find(file => file.id === fileId)!;
  },
  openTaskFile: async (fileId: string) => { record('openTaskFile', fileId); },
  revealTaskFile: async (fileId: string) => { record('revealTaskFile', fileId); },
  updateTask: async (id: string, change: unknown) => { record('updateTask', id, change); },
  copyChatTranscript: async (id: string) => { record('copyChatTranscript', id); },
} as unknown as DesktopApi;

const { App } = await import('../App');
createRoot(document.getElementById('root')!).render(<ThemeProvider defaultMode="light"><App /></ThemeProvider>);
