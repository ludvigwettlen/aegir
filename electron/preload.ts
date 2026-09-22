import { contextBridge, ipcRenderer } from 'electron';
import type { AppEvent, DesktopApi } from '../shared/types.js';

const api: DesktopApi = {
  snapshot: () => ipcRenderer.invoke('snapshot'),
  onEvent: callback => { const handler = (_: unknown, event: AppEvent) => callback(event); ipcRenderer.on('app-event', handler); return () => ipcRenderer.removeListener('app-event', handler); },
  createRoom: (title, leadAgentId) => ipcRenderer.invoke('create-room', title, leadAgentId),
  createAgent: input => ipcRenderer.invoke('create-agent', input),
  updateAgent: input => ipcRenderer.invoke('update-agent', input),
  sendMessage: (roomId, content) => ipcRenderer.invoke('send-message', roomId, content),
  stopRoom: roomId => ipcRenderer.invoke('stop-room', roomId),
  createTask: (title, notes) => ipcRenderer.invoke('create-task', title, notes),
  updateTask: (taskId, change) => ipcRenderer.invoke('update-task', taskId, change),
  startGoal: (taskId, agentId) => ipcRenderer.invoke('start-goal', taskId, agentId),
  stopGoal: taskId => ipcRenderer.invoke('stop-goal', taskId),
  resolveApproval: (id, approved) => ipcRenderer.invoke('resolve-approval', id, approved),
  connect: (provider, clientId, clientSecret) => ipcRenderer.invoke('connect', provider, clientId, clientSecret),
  disconnect: provider => ipcRenderer.invoke('disconnect', provider),
  runReview: () => ipcRenderer.invoke('run-review'),
  setMemoryInstructions: value => ipcRenderer.invoke('memory-instructions', value),
  forgetMemory: id => ipcRenderer.invoke('forget-memory', id),
  correctMemory: (id, content) => ipcRenderer.invoke('correct-memory', id, content),
  setLaunchAtLogin: enabled => ipcRenderer.invoke('launch-at-login', enabled),
  openExternal: url => ipcRenderer.invoke('open-external', url)
};
contextBridge.exposeInMainWorld('agentDesk', api);
