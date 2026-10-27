export type SetupStep = 'setup' | 'codex' | 'memory' | 'connections';
export type SetupStatus = 'unchecked' | 'checking' | 'missing' | 'working' | 'needs-sign-in' | 'ready' | 'error';
export type SetupDependency = { status: SetupStatus; detail: string; diagnostic?: string };
export type OnboardingState = {
  showOnLaunch: boolean;
  completed: boolean;
  step: SetupStep;
  busy: boolean;
  codex: SetupDependency;
  memory: SetupDependency;
  setup?: import('./provider-setup.js').ProviderSetup;
  choiceRequired?: boolean;
};
