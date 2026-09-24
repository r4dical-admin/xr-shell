'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('horizon', {
  isPreviewMode: () => ipcRenderer.invoke('app:preview-mode'),
  inputStatus: () => ipcRenderer.invoke('input:status'),
  enableInput: () => ipcRenderer.invoke('input:enable'),
  openInputSettings: () => ipcRenderer.invoke('input:open-settings'),
  toggleProfile: (sourceId, enabled) => ipcRenderer.invoke('profile:toggle', sourceId, enabled),
  themeForApp: (appName) => ipcRenderer.invoke('profile:theme-for-app', appName),
  listProfiles: () => ipcRenderer.invoke('profile:list'),
  profileDetails: (bundleId, kind) => ipcRenderer.invoke('profile:details', bundleId, kind),
  deleteProfile: (bundleId) => ipcRenderer.invoke('profile:delete', bundleId),
  deleteRecording: (bundleId) => ipcRenderer.invoke('profile:recording-delete', bundleId),
  sendChat: (request) => ipcRenderer.invoke('chat:send', request),
  deleteChat: (clientId) => ipcRenderer.invoke('chat:delete', clientId),
  onChatEvent: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('chat:event', listener);
    return () => ipcRenderer.removeListener('chat:event', listener);
  },
  onProfileUpdate: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('profile:update', listener);
    return () => ipcRenderer.removeListener('profile:update', listener);
  },
  onProfileEvent: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('profile:event', listener);
    return () => ipcRenderer.removeListener('profile:event', listener);
  },
  onProfileStatus: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('profile:status', listener);
    return () => ipcRenderer.removeListener('profile:status', listener);
  },
  sendInput: (value) => ipcRenderer.send('input:event', value),
  onInputError: (callback) => {
    const listener = (_event, error) => callback(error);
    ipcRenderer.on('input:error', listener);
    return () => ipcRenderer.removeListener('input:error', listener);
  },
  listDisplays: () => ipcRenderer.invoke('display:list'),
  listWindows: () => ipcRenderer.invoke('window:list'),
  capturePermission: () => ipcRenderer.invoke('capture:permission'),
  moveToDisplay: (id) => ipcRenderer.invoke('display:move', id),
  toggleFullscreen: () => ipcRenderer.invoke('window:toggle-fullscreen'),
  trackingControl: (command) => ipcRenderer.invoke('tracking:control', command),
  onPose: (callback) => {
    const listener = (_event, pose) => callback(pose);
    ipcRenderer.on('tracking:pose', listener);
    return () => ipcRenderer.removeListener('tracking:pose', listener);
  }
});
