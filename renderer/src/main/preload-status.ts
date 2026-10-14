// Preload of the status window. Sandboxed: only 'electron' may be required here.

import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('lzStatus', {
  get: () => ipcRenderer.invoke('status:get'),
  onState: (cb: (s: unknown) => void) => ipcRenderer.on('status:state', (_e, s) => cb(s)),
  onPreview: (cb: (p: unknown) => void) => ipcRenderer.on('status:preview', (_e, p) => cb(p)),
  setPreview: (on: boolean) => ipcRenderer.send('status:preview', on),
  rescan: () => ipcRenderer.send('status:rescan'),
  openFolder: () => ipcRenderer.send('status:open-folder'),
})
