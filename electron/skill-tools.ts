import type { Tool } from './codex.js';
import type { SkillFile } from '../shared/skills.js';
import type { SkillRegistry, SkillSession } from './skills.js';
const fileSchema = { type: 'array', minItems: 1, maxItems: 100, items: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' }, encoding: { type: 'string', enum: ['utf8'] } }, required: ['path', 'content', 'encoding'], additionalProperties: false } };
const tool = (name: string, description: string, properties: Record<string, unknown>, required: string[], readOnly: boolean): Tool => ({ name: `skills__${name}`, description, readOnly, inputSchema: { type: 'object', properties, required, additionalProperties: false } });
export const skillTools: Tool[] = [
  tool('list', 'List this run’s available skills. Results are paginated.', { offset: { type: 'integer', minimum: 0 } }, [], true),
  tool('search', 'Search skill names and descriptions in this run’s catalog.', { query: { type: 'string' }, offset: { type: 'integer', minimum: 0 } }, ['query'], true),
  tool('read', 'Load a skill before applying it, or read a supporting text file. Returns the run’s frozen revision.', { id: { type: 'string' }, path: { type: 'string' } }, ['id'], true),
  tool('create', 'Save a verified reusable skill in your own library. Files must include SKILL.md with YAML name and description. Prefer improving an existing skill.', { files: fileSchema }, ['files'], false),
  ...['update', 'propose_change'].map(name => tool(name, name === 'update' ? 'Update your own agent-created skill. For other skills use propose_change. Send the complete text package; existing binary assets are preserved.' : 'Propose a revision to a shared or user-authored skill for user review. Send the complete text package; existing binary assets are preserved.', { id: { type: 'string' }, expectedRevision: { type: 'string' }, reason: { type: 'string' }, files: fileSchema }, ['id', 'expectedRevision', 'reason', 'files'], false)),
];
export function handleSkillTool(registry: SkillRegistry, session: SkillSession, name: string, args: Record<string, unknown>) {
  const actor = { agentId: session.agentId, runId: session.runId };
  if (name === 'list' || name === 'search') {
    if (name === 'search' && (typeof args.query !== 'string' || args.query.length > 2000)) throw new Error('Invalid skill search');
    const query = String(args.query || '').toLowerCase(); const offset = args.offset === undefined ? 0 : Number(args.offset);
    if (!Number.isInteger(offset) || offset < 0) throw new Error('Invalid offset');
    const all = [...session.entries.values()].filter(({ skill }) => `${skill.name} ${skill.description}`.toLowerCase().includes(query));
    return { skills: all.slice(offset, offset + 50).map(({ skill, unavailable }) => ({ id: skill.id, name: skill.name, description: skill.description, revision: skill.revision, unavailable })), nextOffset: offset + 50 < all.length ? offset + 50 : null };
  }
  if (name === 'read') return registry.read(session, String(args.id), args.path === undefined ? undefined : String(args.path));
  if (name === 'create') return registry.create({ ownerAgentId: session.agentId, files: args.files as SkillFile[] }, actor);
  if (name === 'update' || name === 'propose_change') {
    const id = String(args.id); const entry = session.entries.get(id);
    if (!entry) throw new Error('Skill is not available to this agent');
    if (typeof args.expectedRevision !== 'string' || typeof args.reason !== 'string' || !Array.isArray(args.files)) throw new Error('Invalid skill change');
    const files = [...args.files as SkillFile[], ...entry.files.filter(file => file.encoding === 'base64')];
    return name === 'update' ? registry.update(id, args.expectedRevision, files, args.reason, actor) : registry.propose(id, args.expectedRevision, files, args.reason, actor);
  }
  throw new Error('Unknown skill tool');
}
