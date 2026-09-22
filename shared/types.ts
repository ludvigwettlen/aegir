export type Agent = { id: string; name: string; role: string; color: string; instructions: string; createdAt: string };
export type Room = { id: string; title: string; leadAgentId: string; createdAt: string };
export type Message = { id: string; roomId: string; agentId: string | null; role: 'user' | 'agent' | 'system'; content: string; status: 'complete' | 'streaming' | 'failed'; createdAt: string };
export type Task = { id: string; title: string; notes: string; status: 'proposed' | 'ready' | 'running' | 'blocked' | 'done' | 'dismissed'; agentId: string | null; sourceUrl: string | null; sourceKey: string | null; createdAt: string; updatedAt: string };
export type Goal = { id: string; taskId: string; agentId: string; status: 'running' | 'blocked' | 'done' | 'failed' | 'awaiting_approval'; threadId: string | null; detail: string; createdAt: string; updatedAt: string };
export type Scan = { id: string; provider: 'slack' | 'notion'; status: 'running' | 'complete' | 'failed'; query: string; found: number; created: number; error: string | null; startedAt: string; endedAt: string | null };
export type Connector = { id: 'slack' | 'notion'; status: 'disconnected' | 'connecting' | 'connected' | 'error'; detail: string; tools: string[]; checkedAt: string | null };
export type Approval = { id: string; method: string; title: string; detail: string; agentId: string | null; threadId?: string; createdAt: string };
export type Memory = { id: string; scope: string; content: string; sourceUrl: string | null; createdAt: string };
export type Snapshot = { agents: Agent[]; rooms: Room[]; messages: Message[]; tasks: Task[]; goals: Goal[]; scans: Scan[]; connectors: Connector[]; approvals: Approval[]; memories: Memory[]; memoryInstructions: string; codexStatus: string; launchAtLogin: boolean; mcpSettings: { slackClientId: string; slackConfigured: boolean } };
export type AppEvent = { type: 'snapshot'; value: Snapshot } | { type: 'message-delta'; roomId: string; messageId: string; delta: string };

export interface DesktopApi {
  snapshot(): Promise<Snapshot>;
  onEvent(callback: (event: AppEvent) => void): () => void;
  createRoom(title: string, leadAgentId: string): Promise<void>;
  createAgent(input: Pick<Agent, 'name' | 'role' | 'color' | 'instructions'>): Promise<void>;
  updateAgent(agent: Agent): Promise<void>;
  sendMessage(roomId: string, content: string): Promise<void>;
  stopRoom(roomId: string): Promise<void>;
  createTask(title: string, notes: string): Promise<void>;
  updateTask(taskId: string, change: Partial<Pick<Task, 'title' | 'notes' | 'status' | 'agentId'>>): Promise<void>;
  startGoal(taskId: string, agentId: string): Promise<void>;
  stopGoal(taskId: string): Promise<void>;
  resolveApproval(id: string, approved: boolean): Promise<void>;
  connect(provider: 'slack' | 'notion', slackClientId?: string, slackClientSecret?: string): Promise<void>;
  disconnect(provider: 'slack' | 'notion'): Promise<void>;
  runReview(): Promise<void>;
  setMemoryInstructions(value: string): Promise<void>;
  forgetMemory(id: string): Promise<void>;
  correctMemory(id: string, content: string): Promise<void>;
  setLaunchAtLogin(enabled: boolean): Promise<void>;
  openExternal(url: string): Promise<void>;
}
