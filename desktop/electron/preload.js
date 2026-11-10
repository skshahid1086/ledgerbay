'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('billsetuDesktop', {
  isDesktop: true,
  /** store/personal builds never auto-seed demo; mirrors LEDGERBAY_BUILD.VARIANT */
  noDemoSeed: true,
  getInfo: () => ipcRenderer.invoke('billsetu:get-info'),
  syncStatus: () => ipcRenderer.invoke('billsetu:sync-status'),
  startSyncServer: (passcode) => ipcRenderer.invoke('billsetu:sync-start', passcode),
  stopSyncServer: () => ipcRenderer.invoke('billsetu:sync-stop'),
  printToPdf: () => ipcRenderer.invoke('billsetu:print-to-pdf'),
  onSyncStatus: (cb) => {
    const handler = (_e, status) => {
      try { cb(status); } catch (_) {}
    };
    ipcRenderer.on('billsetu:sync-status', handler);
    return () => ipcRenderer.removeListener('billsetu:sync-status', handler);
  }
});
