import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('petApi', {
  minimize: () => ipcRenderer.invoke('pet:minimize'),
  openExternal: (url: string) => ipcRenderer.invoke('pet:openExternal', url),
  setExpanded: (expanded: boolean) => ipcRenderer.invoke('pet:setExpanded', expanded),
  getWindowBounds: () => ipcRenderer.invoke('pet:getWindowBounds'),
  setWindowPosition: (x: number, y: number) => ipcRenderer.invoke('pet:setWindowPosition', x, y),
  showContextMenu: () => ipcRenderer.invoke('pet:showContextMenu'),
  clearChat: () => ipcRenderer.invoke('pet:clearChat'),
  transcribeAudio: (samples: ArrayBuffer) => ipcRenderer.invoke('pet:transcribeAudio', samples),
  getDashboard: () => ipcRenderer.invoke('pet:getDashboard'),
  refreshDigest: () => ipcRenderer.invoke('pet:refreshDigest'),
  startAssistantTurn: (input: string, source: 'text' | 'voice') => ipcRenderer.invoke('pet:startAssistantTurn', input, source),
  reminderAction: (reminderId: string, action: 'complete' | 'delete' | 'snooze10') =>
    ipcRenderer.invoke('pet:reminderAction', reminderId, action),
  onAssistantStream: (listener: (payload: unknown) => void) => {
    const wrapped = (_event: unknown, payload: unknown) => listener(payload);
    ipcRenderer.on('pet:assistantStream', wrapped);
    return () => ipcRenderer.off('pet:assistantStream', wrapped);
  }
});
