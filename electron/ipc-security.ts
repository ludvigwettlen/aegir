import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { feedbackInputSchema } from '../shared/ui-feedback.js';

const text = z.string().max(2 * 1024 * 1024);
const id = z.string().min(1).max(4096);
const bool = z.boolean();
const revision = z.number().int().nonnegative();
const agent = z.strictObject({ name: id, role: text, color: text, instructions: text });
const labels = z.array(z.string().max(40)).max(20);
const recurrence = z.enum(['daily', 'weekdays', 'weekly', 'monthly']).nullable();
const taskFields = { title: id.optional(), notes: text.optional(), label: text.nullable().optional(), labels: labels.optional(), dueAt: text.nullable().optional(), listId: id.nullable().optional(), recurrence: recurrence.optional() };
const taskStatus = z.enum(['proposed', 'ready', 'running', 'review', 'blocked', 'done', 'dismissed']);
const bytes = z.instanceof(Uint8Array).refine(value => value.byteLength <= 50 * 1024 * 1024, 'File exceeds 50 MB');
const email = z.strictObject({ to: text, cc: text, bcc: text, subject: text, body: text });
const slack = z.strictObject({ destination: text, threadTs: text, text, includeFooter: bool });
const skillFile = z.strictObject({ path: id, content: text, encoding: z.enum(['utf8', 'base64']) });
const files = z.array(skillFile).max(100);
const schemas: Record<string, z.ZodType> = Object.create(null);
function endpoints(names: string, args: z.ZodType[]) {
  for (const name of names.split(' ')) schemas[name] = z.tuple(args as [z.ZodType, ...z.ZodType[]]);
}
endpoints('snapshot setup-check setup-codex-login setup-codex-cancel ui-feedback-list ui-feedback-copy gmail-sync browser-open browser-stop skill-library one-on-ones-sync delegation-sync sync-reminders read-clipboard-text undo-task-action', []);
endpoints('brain-bridge-run', []);
endpoints('brain-bridge-folder', [z.enum(['import', 'export', 'filing'])]);
endpoints('brain-bridge-configure', [z.strictObject({ importEnabled: bool, importDir: text, exportEnabled: bool, exportDir: text, filingEnabled: bool, filingDir: text })]);
endpoints('brain-bridge-file', [id, id, z.enum(['document', 'attachment'])]);
endpoints('setup-brain-folder claude-routines', []);
endpoints('setup-select', [z.strictObject({ preset: z.enum(['aegir', 'legolas']), brainDir: text, brainId: id, sourceId: id })]);
endpoints('setup-install', [z.enum(['codex', 'memory'])]);
endpoints('setup-save', [z.enum(['setup', 'codex', 'memory', 'connections']), z.enum(['continue', 'later', 'finish'])]);
endpoints('ui-feedback-add', [feedbackInputSchema]);
endpoints('ui-feedback-resolve resolve-approval skill-resolve set-routine-enabled resolve-routine-change', [id, bool]);
endpoints('gmail-configure', [text, text, bool]);
endpoints('gmail-draft-update gmail-draft-send', [id, revision, email]);
endpoints('gmail-draft-cancel gmail-draft-manual slack-draft-cancel slack-draft-manual', [id, revision]);
endpoints('slack-draft-update slack-draft-send', [id, revision, slack]);
endpoints('slack-draft-targets', [z.enum(['people', 'channels']), text, text.optional(), id.optional()]);
endpoints('browser-enabled browser-review-enabled set-show-task-priorities launch-at-login', [bool]);
endpoints('set-typography', [z.strictObject({ system: id, editor: id, systemScale: z.number().finite(), editorSize: z.number().finite(), scratchpadSize: z.number().finite() })]);
endpoints('search-task-content start-thread capture-task delegation-configure delegation-people memory-instructions search-memories open-external', [text]);
endpoints('document-list skill-detail skill-export meeting-conversation one-on-ones-prepare copy-chat-transcript stop-thread close-thread mark-task-reviewed delete-task-list delete-task open-task-link remove-task-link stop-task open-task-output run-routine run-events delete-task-view', [id]);
endpoints('document-create document-read document-show-in-finder browser-review-start attachment-open rename-task-list hand-off', [id, text]);
endpoints('document-image-read', [id, id, text]);
endpoints('document-image-import', [id, id, text, bytes]);
endpoints('attachment-import', [id, text, bytes]);
endpoints('document-save', [id, id, id, text]);
endpoints('skill-create', [z.strictObject({ files, ownerAgentId: id.nullable() })]);
endpoints('skill-update', [id, id, files, text]);
endpoints('skill-configure', [id, z.strictObject({ enabled: bool.optional(), archived: bool.optional(), pinned: bool.optional(), enabledAgentIds: z.array(id).max(1000).nullable().optional(), disabledAgentIds: z.array(id).max(1000).optional() })]);
endpoints('skill-copy', [id, id.nullable()]);
endpoints('skill-restore', [id, id, id]);
endpoints('skill-revision-files forget-memory', [id, id]);
endpoints('skill-bind-routine', [id, z.array(id).max(200)]);
endpoints('skill-import', [id.nullable()]);
endpoints('one-on-ones-configure', [text, bool]);
endpoints('one-on-ones-update', [id, z.strictObject({ agenda: text.optional(), hidden: bool.optional(), autoPrepare: bool.optional() }), text.optional()]);
endpoints('thread-messages', [id, id.optional()]);
endpoints('create-agent', [agent]);
endpoints('update-agent', [agent.extend({ id, createdAt: text })]);
endpoints('create-task', [z.strictObject({ ...taskFields, title: id })]);
endpoints('save-task-view', [z.strictObject({ id, name: id, scope: id, filter: z.strictObject({ label: text, labels: labels.optional(), labelMode: z.enum(['all', 'any']).optional(), status: text, priority: text, sort: z.enum(['default', 'due', 'priority', 'title', 'newest']) }) })]);
endpoints('send-message', [id, text, z.array(id).max(10).optional()]);
const person = z.strictObject({ id, name: text, email: text.optional() });
endpoints('delegation-publish', [id, z.strictObject({ assignee: person, taggedPeople: z.array(person).max(100), brief: text })]);
endpoints('delegation-status', [id, z.enum(['Assigned', 'Accepted', 'In progress', 'Blocked', 'Ready for review', 'Done', 'Cancelled'])]);
endpoints('configure-reminders', [bool, text]);
endpoints('create-task-list', [text]);
endpoints('update-task', [id, z.strictObject({ ...taskFields, status: taskStatus.optional(), priority: z.union([z.literal(1), z.literal(2), z.literal(3), z.null()]).optional(), snoozedUntil: text.nullable().optional() })]);
endpoints('add-task-link', [id, text]);
endpoints('correct-memory', [id, id, text]);
endpoints('connect', [z.enum(['slack', 'notion', 'composio']), text.optional(), text.optional()]);
endpoints('disconnect', [z.enum(['slack', 'notion', 'composio'])]);

export function ipcArgumentSchema(channel: string): z.ZodType {
  const schema = schemas[channel];
  if (!schema) throw new Error(`IPC endpoint has no argument schema: ${channel}`);
  return schema;
}
export function validateIpcArgs(channel: string, args: unknown[]): unknown[] {
  const schema = ipcArgumentSchema(channel);
  const result = schema.safeParse(args);
  if (!result.success) throw new Error(`Invalid arguments for ${channel}`);
  return result.data as unknown[];
}
export function assertTrustedSender(event: IpcMainInvokeEvent, window: BrowserWindow | null, rendererUrl: string): void {
  if (!window || window.isDestroyed() || event.sender !== window.webContents || !event.senderFrame
    || event.senderFrame !== window.webContents.mainFrame) throw new Error('Untrusted IPC caller');
  try {
    const actual = new URL(event.senderFrame.url);
    actual.hash = '';
    const expected = new URL(rendererUrl); expected.hash = '';
    if (actual.href === expected.href) return;
  } catch { /* Invalid frame URLs are never trusted. */ }
  throw new Error('Untrusted IPC caller');
}
