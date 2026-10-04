import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc';
import type { PomodoroState, SettingsBridge } from '../shared/types';

const bridge: SettingsBridge = {
  get: () => ipcRenderer.invoke(IPC.getSettings),
  set: (patch) => ipcRenderer.invoke(IPC.setSettings, patch),
  pomodoro: (cmd) => ipcRenderer.invoke(IPC.pomodoroCmd, cmd),
  pomodoroState: () => ipcRenderer.invoke(IPC.pomodoroState),
  onPomodoro: (cb) => {
    const h = (_e: Electron.IpcRendererEvent, s: PomodoroState): void => cb(s);
    ipcRenderer.on(IPC.pomodoroState, h);
    return () => ipcRenderer.removeListener(IPC.pomodoroState, h);
  },
  agentStatus: () => ipcRenderer.invoke(IPC.agentStatus),
  installAgent: (id) => ipcRenderer.invoke(IPC.installAgent, id),
  uninstallAgent: (id) => ipcRenderer.invoke(IPC.uninstallAgent, id),
  testEvent: (type) => ipcRenderer.invoke(IPC.testEvent, type),
  testReminder: (kind) => ipcRenderer.invoke(IPC.testReminder, kind),
  exportSettings: () => ipcRenderer.invoke(IPC.exportSettings),
  importSettings: () => ipcRenderer.invoke(IPC.importSettings),
};

contextBridge.exposeInMainWorld('critterSettings', bridge);
