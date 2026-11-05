export type UpdateState = {
  version: string;
  configured: boolean;
  authenticated: boolean;
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'installing' | 'error';
  availableVersion?: string;
  notes?: string;
  progress?: number;
  message: string;
};
