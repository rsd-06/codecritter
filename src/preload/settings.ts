import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc';
import type { SettingsBridge } from '../shared/types';

const bridge: SettingsBridge = {
  get: () => ipcRenderer.invoke(IPC.getSettings),
  set: (patch) => ipcRenderer.invoke(IPC.setSettings, patch),
  pomodoro: (cmd) => ipcRenderer.invoke(IPC.pomodoroCmd, cmd),
  agentStatus: () => ipcRenderer.invoke(IPC.agentStatus),
  installAgent: (id) => ipcRenderer.invoke(IPC.installAgent, id),
  uninstallAgent: (id) => ipcRenderer.invoke(IPC.uninstallAgent, id),
  testEvent: (type) => ipcRenderer.invoke(IPC.testEvent, type),
  testReminder: (kind) => ipcRenderer.invoke(IPC.testReminder, kind),
  exportSettings: () => ipcRenderer.invoke(IPC.exportSettings),
  importSettings: () => ipcRenderer.invoke(IPC.importSettings),
};

contextBridge.exposeInMainWorld('critterSettings', bridge);
