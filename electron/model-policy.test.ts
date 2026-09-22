import { describe, expect, it } from 'vitest';
import { chooseLightweightModel, modelTierForRole } from '../shared/model-policy.js';

describe('agent model routing', () => {
  it('keeps the lead on the account default and routes specialists to lightweight', () => {
    expect(modelTierForRole('Lead')).toBe('default');
    expect(modelTierForRole('Research')).toBe('lightweight');
    expect(modelTierForRole('Writing')).toBe('lightweight');
  });

  it('chooses an available Luna model with low effort', () => {
    expect(chooseLightweightModel([
      { model: 'gpt-6-sol', supportedReasoningEfforts: [{ reasoningEffort: 'low' }] },
      { model: 'gpt-5.6-luna', supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'medium' }] }
    ])).toEqual({ model: 'gpt-5.6-luna', effort: 'low' });
    expect(chooseLightweightModel([{ model: 'gpt-6-luna', supportedReasoningEfforts: [{ reasoningEffort: 'low' }] }])).toEqual({ model: 'gpt-6-luna', effort: 'low' });
  });

  it('does not silently select a larger model', () => {
    expect(chooseLightweightModel([{ model: 'gpt-6-sol', defaultReasoningEffort: 'medium' }])).toBeNull();
  });
});
