export type BrainBridgeConfig = {
  importEnabled: boolean;
  importDir: string;
  exportEnabled: boolean;
  exportDir: string;
  filingEnabled: boolean;
  filingDir: string;
};
export type BrainBridgeReport = { created: number; skipped: number; rejected: number; exported: boolean; deferred: number };
export type BrainBridgeState = BrainBridgeConfig & { externalSetup: boolean; paused: boolean; lastRunAt: string | null; error: string; report: BrainBridgeReport | null };
export const defaultBrainBridgeConfig = (): BrainBridgeConfig => ({ importEnabled: false, importDir: '', exportEnabled: false, exportDir: '', filingEnabled: false, filingDir: '' });
