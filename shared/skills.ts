export type SkillFile = { path: string; content: string; encoding: 'utf8' | 'base64' };
export type Skill = {
  directory?: string;
  requirements?: { platforms: string[]; tools: string[]; runKinds: string[] };
  id: string; name: string; description: string; ownerAgentId: string | null;
  revision: string; enabled: boolean; archived: boolean; pinned: boolean;
  origin: 'bundled' | 'user' | 'agent' | 'imported'; source: string | null;
  extendsSkillId: string | null; extendsRevision: string | null;
  enabledAgentIds: string[] | null; disabledAgentIds: string[];
  error: string | null; updatedAt: string; loads: number;
};
export type SkillRevision = { id: string; skillId: string; hash: string; parent: string | null; actor: string; reason: string; sourceRun: string | null; createdAt: string };
export type SkillProposal = { id: string; skillId: string; baseRevision: string; actor: string; reason: string; sourceRun: string | null; state: 'pending' | 'applied' | 'discarded'; createdAt: string; files: SkillFile[] };
export type SkillLoad = { skillId: string; revision: string; agentId: string; runId: string; path: string; createdAt: string };
export type SkillDetail = { skill: Skill; files: SkillFile[]; revisions: SkillRevision[]; proposals: SkillProposal[]; recentLoads: SkillLoad[] };
export type SkillLibrary = { skills: Skill[]; proposals: SkillProposal[]; routineBindings: Record<string, string[]> };
export type SkillCreate = { files: SkillFile[]; ownerAgentId: string | null };
export type SkillSettings = Partial<Pick<Skill, 'enabled' | 'archived' | 'pinned' | 'enabledAgentIds' | 'disabledAgentIds'>>;
export const newSkillText = `---\nname: new-skill\ndescription: Describe when to use this skill.\n---\n\n# New skill\n\n## When to use\n\n## Procedure\n\n## Pitfalls\n\n## Verification\n`;
export interface SkillsApi {
  skillLibrary(): Promise<SkillLibrary>;
  skillDetail(id: string): Promise<SkillDetail>;
  createSkill(input: SkillCreate): Promise<Skill>;
  updateSkill(id: string, expectedRevision: string, files: SkillFile[], reason: string): Promise<Skill>;
  configureSkill(id: string, settings: SkillSettings): Promise<Skill>;
  copySkill(id: string, ownerAgentId: string | null): Promise<Skill>;
  restoreSkillRevision(id: string, expectedRevision: string, revision: string): Promise<Skill>;
  skillRevisionFiles(id: string, revision: string): Promise<SkillFile[]>;
  resolveSkillProposal(id: string, apply: boolean): Promise<void>;
  bindRoutineSkills(routineId: string, ids: string[]): Promise<void>;
  importSkill(ownerAgentId: string | null): Promise<Skill | null>;
  exportSkill(id: string): Promise<void>;
}
