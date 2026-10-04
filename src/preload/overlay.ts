import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC } from '../shared/ipc';
import type { OverlayBridge } from '../shared/types';

function on<T>(channel: string, cb: (v: T) => void): () => void {
  const handler = (_e: IpcRendererEvent, v: T) => cb(v);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const bridge: OverlayBridge = {
  onInput: (cb) => on(IPC.input, cb),
  onCursor: (cb) => on(IPC.cursor, cb),
  onAgent: (cb) => on(IPC.agent, cb),
  onReminder: (cb) => on(IPC.reminder, cb),
  onPomodoro: (cb) => on(IPC.pomodoro, cb),
  onSettings: (cb) => on(IPC.settings, cb),
  onPeek: (cb) => on(IPC.peek, cb),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  setInteractive: (v) => ipcRenderer.send(IPC.setInteractive, v),
  dragStart: () => ipcRenderer.send(IPC.dragStart),
  dragMove: (dx, dy) => ipcRenderer.send(IPC.dragMove, dx, dy),
  dragEnd: () => ipcRenderer.send(IPC.dragEnd),
  openSettings: () => ipcRenderer.send(IPC.openSettings),
  showContextMenu: () => ipcRenderer.send(IPC.contextMenu),
};

contextBridge.exposeInMainWorld('critter', bridge);
