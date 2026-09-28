export type BrowserState = {
  enabled: boolean;
  status: 'disabled' | 'ready' | 'opening' | 'approval' | 'working' | 'error';
  detail: string;
  threadId: string | null;
};
