import { contextBridge, ipcRenderer } from 'electron';
import type { AppEvent, DesktopApi } from '../shared/types.js';

const api: DesktopApi = {
  snapshot: () => ipcRenderer.invoke('snapshot'),
  onEvent: callback => { const handler = (_: unknown, event: AppEvent) => callback(event); ipcRenderer.on('app-event', handler); return () => ipcRenderer.removeListener('app-event', handler); },
  createGroup: (title, agentIds) => ipcRenderer.invoke('create-group', title, agentIds),
  createAgent: input => ipcRenderer.invoke('create-agent', input),
  updateAgent: input => ipcRenderer.invoke('update-agent', input),
  startThread: (groupId, content) => ipcRenderer.invoke('start-thread', groupId, content),
  sendMessage: (threadId, content) => ipcRenderer.invoke('send-message', threadId, content),
  stopThread: threadId => ipcRenderer.invoke('stop-thread', threadId),
  closeThread: threadId => ipcRenderer.invoke('close-thread', threadId),
  createTask: input => ipcRenderer.invoke('create-task', input),
  updateTask: (taskId, change) => ipcRenderer.invoke('update-task', taskId, change),
  handOff: (taskId, instruction) => ipcRenderer.invoke('hand-off', taskId, instruction),
  stopTask: taskId => ipcRenderer.invoke('stop-task', taskId),
  openTaskOutput: taskId => ipcRenderer.invoke('open-task-output', taskId),
  runRoutine: routineId => ipcRenderer.invoke('run-routine', routineId),
  setRoutineEnabled: (routineId, enabled) => ipcRenderer.invoke('set-routine-enabled', routineId, enabled),
  resolveRoutineChange: (messageId, apply) => ipcRenderer.invoke('resolve-routine-change', messageId, apply),
  runEvents: runId => ipcRenderer.invoke('run-events', runId),
  resolveApproval: (id, approved) => ipcRenderer.invoke('resolve-approval', id, approved),
  connect: (provider, clientId, clientSecret) => ipcRenderer.invoke('connect', provider, clientId, clientSecret),
  disconnect: provider => ipcRenderer.invoke('disconnect', provider),
  setMemoryInstructions: value => ipcRenderer.invoke('memory-instructions', value),
  forgetMemory: id => ipcRenderer.invoke('forget-memory', id),
  correctMemory: (id, content) => ipcRenderer.invoke('correct-memory', id, content),
  setLaunchAtLogin: enabled => ipcRenderer.invoke('launch-at-login', enabled),
  openExternal: url => ipcRenderer.invoke('open-external', url)
};
contextBridge.exposeInMainWorld('agentDesk', api);
