export type SetupPreset = 'aegir' | 'legolas';
export type ProviderSetup = {
  preset: SetupPreset;
  engine: 'codex' | 'claude';
  memory: 'mnemosyne' | 'gbrain';
  connections: 'aegir' | 'claude';
  intake: 'builtin' | 'external';
  brainDir: string;
  brainId: string;
  sourceId: string;
};
export type SetupChoice = Pick<ProviderSetup, 'preset' | 'brainDir' | 'brainId' | 'sourceId'>;

export function providerSetup(choice: SetupChoice): ProviderSetup {
  if (choice.preset !== 'aegir' && choice.preset !== 'legolas') throw new Error('Choose Aegir or Legolas setup.');
  for (const field of ['brainDir', 'brainId', 'sourceId'] as const) {
    if (typeof choice[field] !== 'string' || choice[field].includes('\0') || choice[field].length > 4096) throw new Error(`Invalid ${field}.`);
  }
  if (![choice.brainId, choice.sourceId].every(id => /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(id))) throw new Error('Brain and source IDs must use letters, numbers, dots, underscores or hyphens.');
  const legolas = choice.preset === 'legolas';
  return { ...choice, brainDir: choice.brainDir.trim(), engine: legolas ? 'claude' : 'codex',
    memory: legolas ? 'gbrain' : 'mnemosyne', connections: legolas ? 'claude' : 'aegir', intake: legolas ? 'external' : 'builtin' };
}

export const defaultProviderSetup = (): ProviderSetup => providerSetup({ preset: 'aegir', brainDir: '', brainId: 'host', sourceId: 'default' });
export function readProviderSetup(value?: string): ProviderSetup {
  if (!value) return defaultProviderSetup();
  // A corrupt saved selection must not silently route data to another provider.
  try { return providerSetup(JSON.parse(value)); }
  catch { throw new Error('The saved provider setup is invalid. Restore the providerSetup setting before starting Aegir.'); }
}
