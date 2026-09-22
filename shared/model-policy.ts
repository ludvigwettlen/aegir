export type ModelTier = 'default' | 'lightweight';
export type AvailableModel = {
  id?: string;
  model?: string;
  defaultReasoningEffort?: string;
  supportedReasoningEfforts?: Array<{ reasoningEffort: string }>;
};

// The room lead keeps the user's Codex default; specialists use a smaller tier.
export function modelTierForRole(role: string): ModelTier {
  return role.trim().toLowerCase() === 'lead' ? 'default' : 'lightweight';
}

export function chooseLightweightModel(models: AvailableModel[]): { model: string; effort: string } | null {
  const preferred = ['gpt-6-luna', 'gpt-5.6-luna'];
  const selected = preferred.map(id => models.find(item => (item.model || item.id) === id)).find(Boolean);
  if (!selected) return null;
  const supported = selected.supportedReasoningEfforts?.map(item => item.reasoningEffort) || [];
  const effort = supported.includes('low') ? 'low' : supported.includes('minimal') ? 'minimal' : null;
  return effort ? { model: selected.model || selected.id!, effort } : null;
}
