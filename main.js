'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { app, BrowserWindow, desktopCapturer, ipcMain, screen, shell, systemPreferences } = require('electron');
const { ControlServer } = require('./control-server');
const { HeadTracker } = require('./tracking');
const { InputBridge } = require('./input-bridge');
const { ProfileStore, diffSnapshots } = require('./profile-store');
const { ProfileObserver } = require('./profile-observer');
const { ChatRunner } = require('./chat-runner');
const { ThemeAgent } = require('./theme-agent');

let mainWindow;
let chatRunner;
let themeAgent;
let controlServer;
let controlSequence = 0;
const controlPending = new Map();
const PROFILE_DURATION_MS = Math.max(10000, Number(process.env.XR_PROFILE_DURATION_MS) || 5 * 60 * 1000);
const inputBridge = new InputBridge();
const profileStore = new ProfileStore(path.join(__dirname, 'integration-profiles'));
const profilers = new Map();
const tracker = new HeadTracker((value) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('tracking:pose', value);
});

function displays() {
  return screen.getAllDisplays().map((display) => ({
    id: display.id,
    label: display.label || `Display ${display.id}`,
    bounds: display.bounds,
    workArea: display.workArea,
    scaleFactor: display.scaleFactor,
    internal: display.internal
  }));
}

function inputCommand(value) {
  if (!value || typeof value !== 'object') return null;
  const match = /^window:(\d+):\d+$/.exec(String(value.sourceId || ''));
  if (!match || !['pointer', 'activate', 'scroll', 'text', 'key'].includes(value.type)) return null;
  const command = {
    type: value.type,
    windowId: Number(match[1]),
    x: Math.max(0, Math.min(1, Number(value.x) || 0)),
    y: Math.max(0, Math.min(1, Number(value.y) || 0))
  };
  if (value.type === 'pointer') {
    if (!['down', 'up', 'move', 'drag'].includes(value.phase)) return null;
    command.phase = value.phase;
    command.button = [0, 1, 2].includes(value.button) ? value.button : 0;
    command.clickCount = Math.max(1, Math.min(3, Number(value.clickCount) || 1));
  }
  if (value.type === 'activate') {
    command.button = [0, 1, 2].includes(value.button) ? value.button : 0;
    command.clickCount = Math.max(1, Math.min(3, Number(value.clickCount) || 1));
  }
  if (value.type === 'scroll') {
    command.deltaX = Math.max(-1200, Math.min(1200, Number(value.deltaX) || 0));
    command.deltaY = Math.max(-1200, Math.min(1200, Number(value.deltaY) || 0));
  }
  if (value.type === 'text') command.text = String(value.text || '').slice(0, 1000);
  if (value.type === 'key') command.keyCode = Math.max(0, Math.min(255, Number(value.keyCode) || 0));
  command.modifiers = Array.isArray(value.modifiers)
    ? value.modifiers.filter((item) => ['command', 'shift', 'option', 'control'].includes(item))
    : [];
  return command;
}

function sourceWindowId(sourceId) {
  const match = /^window:(\d+):\d+$/.exec(String(sourceId || ''));
  return match ? Number(match[1]) : null;
}

async function availableApplicationWindows(includeImages = true) {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      fetchWindowIcons: includeImages,
      thumbnailSize: includeImages ? { width: 360, height: 220 } : { width: 0, height: 0 }
    });
    return sources
      .filter((source) => source.name && !/^XR Shell$/i.test(source.name))
      .map((source) => ({
        id: source.id,
        name: source.name,
        ...(includeImages ? {
          thumbnail: source.thumbnail.isEmpty() ? null : source.thumbnail.toDataURL(),
          appIcon: source.appIcon && !source.appIcon.isEmpty() ? source.appIcon.toDataURL() : null
        } : {})
      }));
  } catch {
    return [];
  }
}

function openApplication(params = {}) {
  const appName = String(params.app || '').trim().slice(0, 240);
  const bundleId = String(params.bundleId || '').trim().slice(0, 240);
  if (!appName && !bundleId) return Promise.reject(new Error('app or bundleId is required'));
  if (appName.includes('\0') || bundleId.includes('\0')) return Promise.reject(new Error('Invalid application identifier'));
  const args = bundleId ? ['-b', bundleId] : path.isAbsolute(appName) ? [appName] : ['-a', appName];
  if (path.isAbsolute(appName) && (!appName.endsWith('.app') || !fs.existsSync(appName))) return Promise.reject(new Error('Application path must point to an existing .app bundle'));
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/open', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let errorText = '';
    child.stderr.on('data', (chunk) => { errorText = `${errorText}${chunk}`.slice(-1200); });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(errorText.trim() || `Could not launch application (${code})`)));
  });
}

async function launchApplicationWindow(params = {}) {
  const before = new Set((await availableApplicationWindows(false)).map((item) => item.id));
  await openApplication(params);
  const query = String(params.windowQuery || params.app || '').replace(/\.app$/i, '').trim().toLowerCase();
  const waitMs = Math.max(1000, Math.min(30000, Number(params.waitMs) || 12000));
  const deadline = Date.now() + waitMs;
  let latest = [];
  while (Date.now() < deadline) {
    latest = await availableApplicationWindows(false);
    const fresh = latest.filter((item) => !before.has(item.id));
    const match = fresh.find((item) => query && item.name.toLowerCase().includes(query))
      || fresh[0]
      || latest.find((item) => query && item.name.toLowerCase().includes(query));
    if (match) return { ok: true, source: match, launched: params.bundleId || params.app };
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error('Application launched, but no capturable window appeared before the timeout');
}

function requestRendererControl(method, params = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return Promise.reject(new Error('XR Shell window is not ready'));
  const id = ++controlSequence;
  return new Promise((resolve, reject) => {
    const timeoutMs = ['launch_app', 'open_layout'].includes(method) ? 45000 : 10000;
    const timeout = setTimeout(() => {
      controlPending.delete(id);
      reject(new Error(`XR Shell control timed out: ${method}`));
    }, timeoutMs);
    controlPending.set(id, { resolve, reject, timeout });
    mainWindow.webContents.send('control:request', { id, method, params });
  });
}

async function handleControlRequest(method, params = {}) {
  if (method === 'list_apps') {
    const [apps, layout] = await Promise.all([
      availableApplicationWindows(false),
      requestRendererControl('get_layout').catch(() => ({ windows: [], activeSourceId: null }))
    ]);
    const captured = new Set((layout.windows || []).map((item) => item.sourceId));
    return { apps: apps.map((item) => ({ ...item, captured: captured.has(item.id) })), ...layout };
  }
  return requestRendererControl(method, params);
}

async function snapshotForSource(sourceId) {
  const windowId = sourceWindowId(sourceId);
  if (windowId === null) return { ok: false, error: 'invalid-window-source' };
  return inputBridge.request({ type: 'snapshot', windowId });
}

function stopProfiler(sourceId) {
  const profiler = profilers.get(sourceId);
  if (!profiler) return;
  clearInterval(profiler.timer);
  clearTimeout(profiler.deadlineTimer);
  profiler.observer?.stop();
  profilers.delete(sourceId);
}

function stopProfilersForBundleId(bundleId) {
  for (const [sourceId, profiler] of profilers) {
    if (profiler.previous?.app?.bundleId === bundleId) stopProfiler(sourceId);
  }
}

function sendProfileStatus(sourceId, value) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('profile:status', { sourceId, ...value });
}

async function profileOnce(sourceId, previous = null) {
  const snapshot = await snapshotForSource(sourceId);
  if (!snapshot.ok) return snapshot;
  const events = diffSnapshots(previous, snapshot);
  return { ...snapshot, events };
}

async function captureProfilerUpdate(sourceId, state) {
  if (state.busy || state.finalizing) return null;
  state.busy = true;
  try {
    const update = await profileOnce(sourceId, state.previous);
    if (!update.ok) return update;
    const rawEvents = state.rawEvents.splice(0);
    update.supportedNotifications = state.supportedNotifications;
    update.events.push(...rawEvents);
    const saved = profileStore.save(update, update.events);
    update.profilePath = saved.outputPath;
    update.theme = saved.profile.xrTheme;
    state.previous = update;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('profile:update', { sourceId, snapshot: update, events: update.events, profilePath: update.profilePath });
    }
    return { update, saved };
  } finally {
    state.busy = false;
  }
}

async function finishProfiler(sourceId) {
  const state = profilers.get(sourceId);
  if (!state || state.finalizing) return { ok: false, error: 'profile-session-unavailable' };
  state.finalizing = true;
  clearInterval(state.timer);
  clearTimeout(state.deadlineTimer);
  state.observer?.stop();
  while (state.busy) await new Promise((resolve) => setTimeout(resolve, 25));
  state.finalizing = false;
  const finalCapture = await captureProfilerUpdate(sourceId, state);
  state.finalizing = true;
  profilers.delete(sourceId);
  if (!finalCapture?.saved) {
    sendProfileStatus(sourceId, { stage: 'error', error: finalCapture?.error || 'final-profile-capture-failed' });
    return finalCapture || { ok: false, error: 'final-profile-capture-failed' };
  }
  const { profile, outputPath } = finalCapture.saved;
  sendProfileStatus(sourceId, { stage: 'generating', appName: profile.app.name, eventCount: profile.eventPatterns?.total || 0 });
  try {
    const theme = await themeAgent.generate(profile);
    profileStore.installTheme(profile.app.bundleId, theme);
    sendProfileStatus(sourceId, { stage: 'complete', appName: profile.app.name, eventCount: profile.eventPatterns?.total || 0, theme, profilePath: outputPath });
    return { ok: true, theme, profilePath: outputPath };
  } catch (error) {
    sendProfileStatus(sourceId, { stage: 'complete', appName: profile.app.name, eventCount: profile.eventPatterns?.total || 0, theme: profile.xrTheme, profilePath: outputPath, fallback: true, error: error.message });
    return { ok: true, theme: profile.xrTheme, profilePath: outputPath, fallback: true };
  }
}

async function startProfiler(sourceId) {
  stopProfiler(sourceId);
  const initial = await profileOnce(sourceId);
  if (!initial.ok) return initial;
  const initialSaved = profileStore.save(initial, initial.events);
  initial.profilePath = initialSaved.outputPath;
  initial.theme = initialSaved.profile.xrTheme;
  const state = { previous: initial, busy: false, finalizing: false, timer: null, deadlineTimer: null, rawEvents: [], supportedNotifications: [], observer: null, startedAt: Date.now() };
  state.observer = new ProfileObserver(sourceWindowId(sourceId), (event) => {
    if (event.ready) {
      state.supportedNotifications = event.notifications || [];
      state.previous.supportedNotifications = state.supportedNotifications;
      profileStore.save(state.previous);
      return;
    }
    if (!event.event) return;
    state.rawEvents.push({ type: event.event, role: event.role, label: event.label, frame: event.frame, at: event.at, source: 'AXObserver' });
    if (state.rawEvents.length > 200) state.rawEvents.shift();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('profile:event', { sourceId, event });
  });
  state.observer.start();
  state.timer = setInterval(() => { captureProfilerUpdate(sourceId, state).catch(() => {}); }, 1400);
  state.deadlineTimer = setTimeout(() => { finishProfiler(sourceId).catch(() => {}); }, PROFILE_DURATION_MS);
  profilers.set(sourceId, state);
  sendProfileStatus(sourceId, { stage: 'learning', appName: initial.app.name, startedAt: state.startedAt, endsAt: state.startedAt + PROFILE_DURATION_MS });
  return { ...initial, durationMs: PROFILE_DURATION_MS, startedAt: state.startedAt, endsAt: state.startedAt + PROFILE_DURATION_MS };
}

function createWindow() {
  const allDisplays = screen.getAllDisplays();
  const preferred = allDisplays.find((display) => /xreal/i.test(display.label)) || screen.getPrimaryDisplay();
  mainWindow = new BrowserWindow({
    x: preferred.workArea.x + 40,
    y: preferred.workArea.y + 40,
    width: Math.min(1500, preferred.workArea.width - 80),
    height: Math.min(940, preferred.workArea.height - 80),
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#03070c',
    titleBarStyle: 'hiddenInset',
    title: 'XR Shell',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });
  mainWindow.loadFile('index.html');
  if (process.env.HORIZON_CAPTURE === '1') {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const image = await mainWindow.webContents.capturePage();
        const artifactDirectory = path.join(__dirname, 'artifacts');
        fs.mkdirSync(artifactDirectory, { recursive: true });
        fs.writeFileSync(path.join(artifactDirectory, 'preview.png'), image.toPNG());
        app.quit();
      }, 900);
    });
  }
  mainWindow.on('closed', () => { mainWindow = undefined; tracker.stop(false); });
}

app.whenReady().then(() => {
  chatRunner = new ChatRunner({
    homeDirectory: app.getPath('home'),
    workingDirectory: __dirname,
    onEvent: (event) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('chat:event', event);
    }
  });
  themeAgent = new ThemeAgent({ homeDirectory: app.getPath('home'), workingDirectory: __dirname });
  ipcMain.handle('app:preview-mode', () => process.env.HORIZON_CAPTURE === '1');
  ipcMain.handle('input:status', () => inputBridge.request({ type: 'status', prompt: false }));
  ipcMain.handle('input:enable', () => inputBridge.request({ type: 'status', prompt: true }));
  ipcMain.handle('input:open-settings', () => shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'));
  ipcMain.handle('app:launch', (_event, params) => launchApplicationWindow(params || {}));
  ipcMain.handle('menu:snapshot', async (_event, sourceId) => {
    const windowId = sourceWindowId(sourceId);
    return windowId === null ? { ok: false, error: 'invalid-window-source' } : inputBridge.request({ type: 'menu-snapshot', windowId });
  });
  ipcMain.handle('menu:activate', async (_event, sourceId, rawPath) => {
    const windowId = sourceWindowId(sourceId);
    const menuPath = Array.isArray(rawPath) ? rawPath.map(Number) : [];
    if (windowId === null || !menuPath.length || menuPath.length > 8 || menuPath.some((value) => !Number.isInteger(value) || value < 0 || value > 500)) {
      return { ok: false, error: 'invalid-menu-path' };
    }
    return inputBridge.request({ type: 'menu-activate', windowId, path: menuPath });
  });
  ipcMain.handle('profile:toggle', async (_event, sourceId, enabled) => {
    if (!enabled) {
      stopProfiler(sourceId);
      return { ok: true, stopped: true };
    }
    return startProfiler(sourceId);
  });
  ipcMain.handle('profile:theme-for-app', (_event, appName) => profileStore.themeForAppName(String(appName || '').slice(0, 300)));
  ipcMain.handle('profile:list', () => profileStore.list());
  ipcMain.handle('profile:details', (_event, bundleId, kind) => profileStore.details(String(bundleId || '').slice(0, 300), kind === 'recording' ? 'recording' : 'profile'));
  ipcMain.handle('profile:delete', (_event, bundleId) => {
    const safeBundleId = String(bundleId || '').slice(0, 300);
    stopProfilersForBundleId(safeBundleId);
    return { ok: profileStore.delete(safeBundleId) };
  });
  ipcMain.handle('profile:recording-delete', (_event, bundleId) => {
    const safeBundleId = String(bundleId || '').slice(0, 300);
    stopProfilersForBundleId(safeBundleId);
    return { ok: profileStore.clearRecording(safeBundleId) };
  });
  ipcMain.handle('chat:send', (_event, request) => chatRunner.send(request || {}));
  ipcMain.handle('chat:delete', (_event, clientId) => ({ ok: true, stopped: chatRunner.stop(String(clientId || '')) }));
  ipcMain.on('input:event', (_event, value) => {
    const command = inputCommand(value);
    if (!command) return;
    inputBridge.request(command).then((result) => {
      if (!result.ok && mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('input:error', result.error);
    }).catch(() => {});
  });
  ipcMain.handle('display:list', () => displays());
  ipcMain.handle('capture:permission', () => process.platform === 'darwin'
    ? systemPreferences.getMediaAccessStatus('screen')
    : 'granted');
  ipcMain.handle('window:list', () => availableApplicationWindows(true));
  ipcMain.on('control:response', (_event, response) => {
    const pending = controlPending.get(response?.id);
    if (!pending) return;
    controlPending.delete(response.id);
    clearTimeout(pending.timeout);
    if (response.ok) pending.resolve(response.result);
    else pending.reject(new Error(response.error || 'XR Shell control failed'));
  });
  ipcMain.handle('display:move', (_event, requestedId) => {
    const target = screen.getAllDisplays().find((display) => display.id === Number(requestedId));
    if (!target || !mainWindow) return false;
    mainWindow.setFullScreen(false);
    mainWindow.setBounds(target.workArea, false);
    mainWindow.setFullScreen(true);
    return true;
  });
  ipcMain.handle('window:toggle-fullscreen', () => {
    if (!mainWindow) return false;
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
    return mainWindow.isFullScreen();
  });
  ipcMain.handle('tracking:control', (_event, command) => {
    if (!['connect', 'disconnect', 'recenter'].includes(command)) throw new Error('Unsupported tracking command');
    if (command === 'connect') tracker.start();
    if (command === 'disconnect') tracker.stop();
    if (command === 'recenter') tracker.recenter();
    return true;
  });

  createWindow();
  controlServer = new ControlServer({ onRequest: handleControlRequest });
  controlServer.start();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  chatRunner?.stopAll();
  themeAgent?.stopAll();
  for (const sourceId of profilers.keys()) stopProfiler(sourceId);
  tracker.stop(false);
  inputBridge.stop();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  controlServer?.stop();
  for (const pending of controlPending.values()) {
    clearTimeout(pending.timeout);
    pending.reject(new Error('XR Shell stopped'));
  }
  controlPending.clear();
});
