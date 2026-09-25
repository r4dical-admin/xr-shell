'use strict';

const { HeadView, PitchStabilizer } = requireRendererHeadView();

function requireRendererHeadView() {
  // Renderer remains sandboxed; this small copy mirrors the tested projection
  // helper without exposing Node or Electron APIs.
  class RendererHeadView {
    constructor() { this.yaw = 0; this.pitch = 0; }
    reset() { this.yaw = 0; this.pitch = 0; }
    update(yaw, pitch, dt, width, height, fov, scale, heightScale = 1) {
      const focal = height / (2 * Math.tan(fov * Math.PI / 360));
      const maxPanX = width * Math.max(0, scale - 1) / 2;
      const maxPanY = Math.max(height * 0.08, height * Math.max(0, heightScale - 1) / 2);
      const clamp = (value, limit) => Math.max(-limit, Math.min(limit, value));
      const targetYaw = clamp(Number.isFinite(yaw) ? yaw : this.yaw, Math.atan(maxPanX / focal));
      const targetPitch = clamp(Number.isFinite(pitch) ? pitch : this.pitch, Math.atan(maxPanY / focal));
      const alpha = 1 - Math.exp(-Math.max(0, dt) / 0.04);
      this.yaw += (targetYaw - this.yaw) * alpha;
      this.pitch += (targetPitch - this.pitch) * alpha;
      return { yaw: this.yaw, pitch: this.pitch, targetYaw, targetPitch,
        x: -Math.tan(this.yaw) * focal, y: Math.tan(this.pitch) * focal, maxPanX, maxPanY };
    }
  }
  class RendererPitchStabilizer {
    constructor() { this.reset(); }
    reset() { this.neutral = undefined; this.previous = undefined; this.stillTime = 0; }
    update(pitch, dt) {
      if (!Number.isFinite(pitch)) return 0;
      if (this.neutral === undefined) {
        this.neutral = pitch;
        this.previous = pitch;
        return 0;
      }
      const elapsed = Math.max(0.001, Math.min(0.05, dt));
      const rate = this.previous === undefined ? Infinity : Math.abs(pitch - this.previous) / elapsed;
      this.previous = pitch;
      this.stillTime = rate < 0.035 ? this.stillTime + elapsed : 0;
      if (this.stillTime > 0.9) this.neutral += (pitch - this.neutral) * (1 - Math.exp(-elapsed / 7));
      const relative = pitch - this.neutral;
      return Math.sign(relative) * Math.max(0, Math.abs(relative) - 0.026) * 0.62;
    }
  }
  return { HeadView: RendererHeadView, PitchStabilizer: RendererPitchStabilizer };
}

const workspace = document.getElementById('workspace');
const viewport = document.getElementById('viewport');
const trackingState = document.getElementById('tracking-state');
const trackingStatus = document.querySelector('.tracking-status');
const displayPicker = document.getElementById('display-picker');
const scaleInput = document.getElementById('scale');
const scaleOutput = document.getElementById('scale-output');
const heightScaleInput = document.getElementById('height-scale');
const heightScaleOutput = document.getElementById('height-scale-output');
const canvasReadout = document.getElementById('canvas-readout');
const minimapView = document.getElementById('minimap-view');
const connectButton = document.getElementById('connect');
const enableInputButton = document.getElementById('enable-input');
const windowPicker = document.getElementById('window-picker');
const appStage = document.getElementById('app-stage');
const a2uiStage = document.getElementById('a2ui-stage');
const chatInput = document.getElementById('chat-input');
const chatSend = document.getElementById('chat-send');
const chatResponse = document.getElementById('chat-response');
const sessionList = document.getElementById('session-list');
const intensityDialog = document.getElementById('theme-intensity-dialog');
const intensityInput = document.getElementById('theme-intensity');
const intensityLabel = document.getElementById('theme-intensity-label');
const intensityTitle = document.getElementById('intensity-title');
const profileLibrary = document.getElementById('profile-library');
const profileLibraryList = document.getElementById('profile-library-list');
const profileLibraryDetail = document.getElementById('profile-library-detail');
const liveWindowSummary = document.getElementById('live-window-summary');
const liveWindowCount = document.getElementById('live-window-count');
const spatialMenuBar = document.getElementById('spatial-menubar');
const menuAppName = document.getElementById('menu-app-name');
const menuRoot = document.getElementById('menu-root');
const menuState = document.getElementById('menu-state');
const widgetLibrary = document.getElementById('widget-library');
const widgetLibraryList = document.getElementById('widget-library-list');

const headView = new HeadView();
const pitchStabilizer = new PitchStabilizer();
let targetYaw = 0;
let targetPitch = 0;
let trackingEnabled = false;
let poseTime = 0;
let headQuaternion = [0, 0, 0, 1];
let virtualScale = Number(scaleInput.value);
let virtualHeightScale = Number(heightScaleInput.value);
let availableWindows = [];
let availableWindowsSignature = null;
let windowRefreshPromise = null;
const capturedWindows = new Map();
let frontOrder = 0;
let inputEnabled = false;
let activeCaptureId = null;
let lastDragSent = 0;
let permissionPoll = null;
let sessions = [];
let activeSessionId = null;
let intensityPanel = null;
let intensityBeforePreview = 60;
let intensityModeBeforePreview = 'theme';
let menuRefreshSequence = 0;
const a2uiStore = window.XR_A2UI.createStore();
const a2uiNodes = new Map();
const a2uiEvents = [];
let a2uiEventSequence = 0;
let a2uiFrontOrder = 0;
let savedA2UIWidgets = [];
try { sessions = JSON.parse(localStorage.getItem('xr-shell:sessions') || '[]'); } catch { sessions = []; }
try {
  const saved = JSON.parse(localStorage.getItem('xr-shell:a2ui-widgets') || '[]');
  savedA2UIWidgets = Array.isArray(saved) ? saved.slice(0, 50) : [];
} catch { savedA2UIWidgets = []; }

const keyCodes = {
  Enter: 36, Tab: 48, ' ': 49, Backspace: 51, Escape: 53, Delete: 117,
  ArrowLeft: 123, ArrowRight: 124, ArrowDown: 125, ArrowUp: 126,
  Home: 115, End: 119, PageUp: 116, PageDown: 121,
  a: 0, s: 1, d: 2, f: 3, h: 4, g: 5, z: 6, x: 7, c: 8, v: 9,
  b: 11, q: 12, w: 13, e: 14, r: 15, y: 16, t: 17,
  1: 18, 2: 19, 3: 20, 4: 21, 6: 22, 5: 23, '=': 24, 9: 25,
  7: 26, '-': 27, 8: 28, 0: 29, ']': 30, o: 31, u: 32, '[': 33,
  i: 34, p: 35, l: 37, j: 38, "'": 39, k: 40, ';': 41, '\\': 42,
  ',': 43, '/': 44, n: 45, m: 46, '.': 47, '`': 50
};

const physicalKeyCodes = {
  KeyA: 0, KeyS: 1, KeyD: 2, KeyF: 3, KeyH: 4, KeyG: 5, KeyZ: 6, KeyX: 7, KeyC: 8, KeyV: 9,
  KeyB: 11, KeyQ: 12, KeyW: 13, KeyE: 14, KeyR: 15, KeyY: 16, KeyT: 17,
  Digit1: 18, Digit2: 19, Digit3: 20, Digit4: 21, Digit6: 22, Digit5: 23, Equal: 24, Digit9: 25,
  Digit7: 26, Minus: 27, Digit8: 28, Digit0: 29, BracketRight: 30, KeyO: 31, KeyU: 32,
  BracketLeft: 33, KeyI: 34, KeyP: 35, KeyL: 37, KeyJ: 38, Quote: 39, KeyK: 40,
  Semicolon: 41, Backslash: 42, Comma: 43, Slash: 44, KeyN: 45, KeyM: 46, Period: 47,
  Tab: 48, Space: 49, Backquote: 50, Backspace: 51, Enter: 36, Escape: 53, Delete: 117,
  Home: 115, End: 119, PageUp: 116, PageDown: 121,
  ArrowLeft: 123, ArrowRight: 124, ArrowDown: 125, ArrowUp: 126
};

function quaternionToYXZ([x, y, z, w]) {
  // Equivalent to extracting YXZ Euler angles for the small, roll-suppressed
  // rotations used by the panoramic workspace.
  const pitch = Math.asin(Math.max(-1, Math.min(1, 2 * (w * x - y * z))));
  const yaw = Math.atan2(2 * (w * y + x * z), 1 - 2 * (x * x + y * y));
  return { yaw, pitch };
}

async function loadDisplays() {
  const displays = await window.horizon.listDisplays();
  displayPicker.innerHTML = displays.map((display) => {
    const preferred = /xreal/i.test(display.label);
    const suffix = display.internal ? ' · built-in' : ' · external';
    return `<option value="${display.id}" ${preferred ? 'selected' : ''}>${escapeHtml(display.label)}${suffix}</option>`;
  }).join('');
}

async function loadWindows(force = false) {
  if (windowRefreshPromise) return windowRefreshPromise;
  windowRefreshPromise = (async () => {
  const selected = windowPicker.value;
  const nextWindows = await window.horizon.listWindows();
  const nextSignature = nextWindows.map((source) => `${source.id}:${source.name}`).sort().join('|');
  availableWindows = nextWindows;
  liveWindowCount.textContent = String(availableWindows.length);
  liveWindowSummary.textContent = `${availableWindows.length} active window${availableWindows.length === 1 ? '' : 's'} · refreshed live`;
  if (!force && nextSignature === availableWindowsSignature) return;
  availableWindowsSignature = nextSignature;
  if (!availableWindows.length) {
    const permission = await window.horizon.capturePermission();
    windowPicker.innerHTML = `<option value="">${permission === 'denied' ? 'Enable Screen Recording in System Settings' : 'No capturable windows found'}</option>`;
    return;
  }
  windowPicker.innerHTML = '<option value="">Choose an app window…</option>' + availableWindows
    .map((source) => `<option value="${escapeHtml(source.id)}">${escapeHtml(source.name)}</option>`)
    .join('');
  if (availableWindows.some((source) => source.id === selected)) windowPicker.value = selected;
  })();
  try { await windowRefreshPromise; } finally { windowRefreshPromise = null; }
}

async function captureWindow(source, profileName = source?.name) {
  if (!source) return null;
  if (capturedWindows.has(source.id)) {
    bringCaptureToFront(source.id, capturedWindows.get(source.id).panel);
    return capturedWindows.get(source.id);
  }
  if (capturedWindows.size >= window.XR_WINDOW_LAYOUT.MAX_WINDOWS) {
    trackingState.textContent = `Workspace limit reached · release an app before adding more than ${window.XR_WINDOW_LAYOUT.MAX_WINDOWS}`;
    return;
  }

  const panel = document.createElement('article');
  panel.className = 'captured-window glass';
  panel.innerHTML = `
    <header title="Drag to move this window in the workspace"><div class="capture-title">${source.appIcon ? `<img src="${source.appIcon}" alt="" />` : '<i></i>'}<div><small>HOLOGRAPHIC WINDOW LINK · GRAB TO MOVE</small><span>${escapeHtml(source.name)}</span></div></div><div class="capture-actions"><em>● LIVE</em><button type="button" data-profile aria-label="Learn accessibility profile">AX</button><button type="button" data-visual-mode aria-label="Cycle visual mode" title="Cycle FX and passthrough modes">FX</button><button type="button" data-front aria-label="Bring window to front">FRONT</button><button type="button" data-smaller aria-label="Make window smaller">−</button><button type="button" data-larger aria-label="Make window larger">+</button><button type="button" data-remove class="release-app" aria-label="Release app from XR workspace" title="Stop mirroring and release this app from XR Shell">RELEASE</button></div></header>
    <div class="capture-viewport">${source.thumbnail ? `<img class="capture-placeholder" src="${source.thumbnail}" alt="Preview of ${escapeHtml(source.name)}" />` : '<div class="capture-empty"><strong>SCREEN RECORDING REQUIRED</strong>Allow access in Privacy & Security, then add this window again.</div>'}<div class="semantic-layer" aria-hidden="true"></div><div class="xr-cursor" aria-hidden="true"><i></i></div><div class="capture-overlay"><i></i><i></i><i></i><i></i><span>OPTICAL FEED · SECURE</span></div></div>
    <footer><span>30 FPS · GLASS-02 · MIRRORED SURFACE</span><b>DRAG CORNER TO RESIZE</b></footer><div class="resize-grip" title="Drag to resize" aria-hidden="true"></div>`;
  appStage.append(panel);
  const captured = { source, panel, stream: null, profiling: false, profileEndsAt: 0, theme: null, spatialCleanup: null };
  capturedWindows.set(source.id, captured);
  setVisualMode(panel, 'fx', false);
  try {
    const theme = await window.horizon.themeForApp(profileName) || (profileName !== source.name ? await window.horizon.themeForApp(source.name) : null);
    if (theme && capturedWindows.has(source.id)) {
      captured.theme = theme;
      applyProfileTheme(panel, theme);
    }
  } catch { /* an app without a profile keeps the generic FX treatment */ }
  panel.querySelector('.capture-viewport').classList.toggle('input-enabled', inputEnabled);
  panel.querySelector('[data-remove]').addEventListener('click', () => removeCapturedWindow(source.id));
  bindCapturedInput(source.id, panel);
  bindSpatialControls(source.id, panel);
  bindProfileControls(source.id, panel);
  panel.querySelector('[data-visual-mode]').addEventListener('click', () => {
    const modes = panel.xrTheme ? ['theme', 'fx', 'pass'] : ['fx', 'pass'];
    const currentIndex = Math.max(0, modes.indexOf(panel.visualMode));
    setVisualMode(panel, modes[(currentIndex + 1) % modes.length]);
  });
  panel.querySelector('[data-front]').addEventListener('click', () => bringCaptureToFront(source.id, panel));
  layoutCapturedWindows();
  bringCaptureToFront(source.id, panel);
  centerWorkspace();

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: source.id,
          maxFrameRate: 30
        }
      }
    });
    const video = document.createElement('video');
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    const captureViewport = panel.querySelector('.capture-viewport');
    captureViewport.querySelector('.capture-placeholder, .capture-empty')?.remove();
    captureViewport.prepend(video);
    capturedWindows.get(source.id).stream = stream;
    const fitToSource = () => {
      if (panel.dataset.manualSize === 'true' || !video.videoWidth || !video.videoHeight) return;
      const size = window.XR_WINDOW_LAYOUT.fittedPanelSize(video.videoWidth, video.videoHeight, appStage.clientWidth, appStage.clientHeight);
      setPanelSize(panel, size.width, size.height);
    };
    video.addEventListener('resize', fitToSource);
    await video.play();
    fitToSource();
  } catch (error) {
    const permission = await window.horizon.capturePermission();
    trackingState.textContent = permission === 'denied'
      ? 'Screen Recording denied · enable it in System Settings'
      : 'Could not start live capture · preview retained';
  }
  return captured;
}

function removeCapturedWindow(id) {
  const captured = capturedWindows.get(id);
  if (!captured) return;
  captured.stream?.getTracks().forEach((track) => track.stop());
  captured.resizeObserver?.disconnect();
  captured.spatialCleanup?.();
  if (captured.profiling) window.horizon.toggleProfile(id, false);
  captured.panel.remove();
  capturedWindows.delete(id);
  if (activeCaptureId === id) activeCaptureId = null;
  layoutCapturedWindows();
  const remaining = [...capturedWindows.entries()].at(-1);
  if (remaining) bringCaptureToFront(remaining[0], remaining[1].panel);
  else refreshSpatialMenu();
  centerWorkspace();
  trackingState.textContent = 'App released from XR workspace · original macOS app remains open';
}

function semanticLabel(element) {
  return element.title || element.description || element.placeholder
    || (element.role === 'AXStaticText' ? element.value : '') || '';
}

function applyProfileTheme(panel, theme) {
  if (!theme?.palette) return;
  panel.xrTheme = theme;
  panel.dataset.motif = theme.motif || 'system';
  panel.style.setProperty('--profile-accent', theme.palette.accent);
  panel.style.setProperty('--profile-secondary', theme.palette.secondary);
  panel.style.setProperty('--profile-surface', theme.palette.surface);
  panel.style.setProperty('--profile-line', theme.palette.line);
  panel.style.setProperty('--profile-ink', theme.palette.ink);
  panel.style.setProperty('--profile-video-filter', theme.videoFilter);
  const preference = readThemePreference(theme);
  setThemeIntensity(panel, preference.intensity, false);
  setVisualMode(panel, preference.mode, false);
}

function themePreferenceKey(theme) {
  return `xr-shell:theme:${String(theme?.name || 'unknown')}`;
}

function readThemePreference(theme) {
  try {
    const saved = JSON.parse(localStorage.getItem(themePreferenceKey(theme)) || '{}');
    const mode = ['theme', 'fx', 'pass'].includes(saved.mode) ? saved.mode : saved.enabled === false ? 'fx' : 'theme';
    return { intensity: clamp(Number(saved.intensity) || 60, 15, 100), mode };
  } catch { return { intensity: 60, mode: 'theme' }; }
}

function saveThemePreference(panel) {
  if (!panel.xrTheme) return;
  localStorage.setItem(themePreferenceKey(panel.xrTheme), JSON.stringify({
    intensity: panel.themeIntensity || 60,
    mode: panel.visualMode || 'fx'
  }));
}

function intensityDescription(value) {
  if (value <= 35) return 'Light';
  if (value <= 70) return 'Balanced';
  if (value <= 88) return 'Bold';
  return 'Extreme';
}

function setThemeIntensity(panel, value, persist = true) {
  const intensity = clamp(Number(value) || 60, 15, 100);
  const strength = intensity / 100;
  panel.themeIntensity = intensity;
  panel.dataset.themeLevel = intensity <= 35 ? 'light' : intensity >= 89 ? 'extreme' : 'balanced';
  panel.style.setProperty('--theme-strength', strength.toFixed(2));
  panel.style.setProperty('--theme-mix', `${Math.round(7 + strength * 25)}%`);
  panel.style.setProperty('--theme-inner-mix', `${Math.round(5 + strength * 14)}%`);
  if (persist) saveThemePreference(panel);
  const button = panel.querySelector('[data-visual-mode]');
  if (panel.xrTheme) button.title = `${panel.xrTheme.name} · ${intensityDescription(intensity)} ${Math.round(intensity)}% · click to toggle`;
}

function setVisualMode(panel, requestedMode, persist = true) {
  const mode = requestedMode === 'theme' && !panel.xrTheme ? 'fx' : ['theme', 'fx', 'pass'].includes(requestedMode) ? requestedMode : 'fx';
  panel.visualMode = mode;
  panel.classList.toggle('profile-themed', mode === 'theme');
  panel.classList.toggle('clean', mode === 'pass');
  const button = panel.querySelector('[data-visual-mode]');
  button.dataset.mode = mode;
  button.textContent = mode === 'theme' ? 'THEME' : mode === 'pass' ? 'PASS' : 'FX';
  button.title = mode === 'theme'
    ? `${panel.xrTheme.name} · ${intensityDescription(panel.themeIntensity || 60)} ${Math.round(panel.themeIntensity || 60)}% · click for FX`
    : mode === 'fx' ? 'Generic holographic FX · click for passthrough' : `Passthrough view · click for ${panel.xrTheme ? 'theme' : 'FX'}`;
  panel.querySelector('.capture-title small').textContent = mode === 'theme'
    ? `${String(panel.xrTheme.name || 'XR PROFILE').toUpperCase()} · THEME`
    : mode === 'fx' ? 'HOLOGRAPHIC WINDOW LINK · FX' : 'ORIGINAL APP VIEW · PASSTHROUGH';
  trackingState.textContent = `${panel.xrTheme?.name || 'App'} · ${mode === 'pass' ? 'passthrough' : mode} mode`;
  if (persist) saveThemePreference(panel);
}

function updateIntensityPreview(value) {
  if (!intensityPanel) return;
  setVisualMode(intensityPanel, 'theme', false);
  setThemeIntensity(intensityPanel, value, false);
  intensityLabel.value = `${intensityDescription(Number(value))} · ${Math.round(Number(value))}%`;
}

function showThemeIntensity(panel, appName) {
  if (!panel?.xrTheme) return;
  if (profileLibrary.open) profileLibrary.close();
  if (intensityDialog.open) intensityDialog.close();
  intensityPanel = panel;
  intensityBeforePreview = panel.themeIntensity || 60;
  intensityModeBeforePreview = panel.visualMode || 'theme';
  intensityTitle.textContent = `How much should ${appName || 'this app'} be reskinned?`;
  intensityInput.value = String(intensityBeforePreview);
  updateIntensityPreview(intensityBeforePreview);
  intensityDialog.showModal();
}

function closeIntensity(restore) {
  if (restore && intensityPanel) {
    setThemeIntensity(intensityPanel, intensityBeforePreview, false);
    setVisualMode(intensityPanel, intensityModeBeforePreview, false);
  }
  intensityDialog.close();
  intensityPanel = null;
}

async function showProfileDetails(bundleId, kind) {
  const detail = await window.horizon.profileDetails(bundleId, kind);
  profileLibraryDetail.textContent = detail ? JSON.stringify(detail, null, 2) : 'This item no longer exists.';
}

function removeDeletedProfileTheme(appName) {
  for (const captured of capturedWindows.values()) {
    const title = captured.panel.querySelector('.capture-title span')?.textContent || '';
    if (!title.toLowerCase().includes(String(appName).toLowerCase())) continue;
    setVisualMode(captured.panel, 'fx', false);
    captured.panel.xrTheme = null;
    captured.panel.removeAttribute('data-motif');
    captured.panel.querySelector('[data-visual-mode]').textContent = 'FX';
    captured.panel.querySelector('[data-visual-mode]').title = 'Generic holographic FX · click for passthrough';
  }
}

async function renderProfileLibrary() {
  const profiles = await window.horizon.listProfiles();
  profileLibraryList.replaceChildren();
  if (!profiles.length) {
    const empty = document.createElement('p');
    empty.className = 'profile-library-empty';
    empty.textContent = 'No learned app profiles yet.';
    profileLibraryList.append(empty);
    return;
  }
  for (const profile of profiles) {
    const card = document.createElement('article');
    card.className = 'profile-entry';
    const header = document.createElement('header');
    const name = document.createElement('strong');
    name.textContent = profile.name;
    const count = document.createElement('small');
    count.textContent = `${profile.eventCount} events`;
    header.append(name, count);
    const summary = document.createElement('p');
    summary.textContent = `${profile.bundleId} · ${profile.roleCount} AX roles · ${profile.nodeCount} layout nodes · ${profile.themeName || 'no theme'}`;
    const actions = document.createElement('nav');
    const viewProfile = document.createElement('button');
    viewProfile.type = 'button';
    viewProfile.textContent = 'View profile';
    viewProfile.addEventListener('click', () => showProfileDetails(profile.bundleId, 'profile'));
    const viewRecording = document.createElement('button');
    viewRecording.type = 'button';
    viewRecording.textContent = 'View recording';
    viewRecording.disabled = !profile.hasRecording;
    viewRecording.addEventListener('click', () => showProfileDetails(profile.bundleId, 'recording'));
    const clearRecording = document.createElement('button');
    clearRecording.type = 'button';
    clearRecording.className = 'danger';
    clearRecording.textContent = 'Clear recording';
    clearRecording.disabled = !profile.hasRecording;
    clearRecording.addEventListener('click', async () => {
      if (!confirm(`Clear learned AX layout and event data for ${profile.name}? The generated profile and theme will remain.`)) return;
      await window.horizon.deleteRecording(profile.bundleId);
      profileLibraryDetail.textContent = `${profile.name} recording data cleared. Its profile and theme were preserved.`;
      await renderProfileLibrary();
    });
    const deleteProfile = document.createElement('button');
    deleteProfile.type = 'button';
    deleteProfile.className = 'danger';
    deleteProfile.textContent = 'Delete profile';
    deleteProfile.addEventListener('click', async () => {
      if (!confirm(`Delete the complete ${profile.name} integration profile and generated theme?`)) return;
      await window.horizon.deleteProfile(profile.bundleId);
      removeDeletedProfileTheme(profile.name);
      profileLibraryDetail.textContent = `${profile.name} profile deleted.`;
      await renderProfileLibrary();
    });
    actions.append(viewProfile, viewRecording, clearRecording, deleteProfile);
    card.append(header, summary, actions);
    profileLibraryList.append(card);
  }
}

function bringCaptureToFront(sourceId, panel) {
  activeCaptureId = sourceId;
  frontOrder += 1;
  for (const [id, captured] of capturedWindows) {
    const isFront = id === sourceId;
    captured.panel.classList.toggle('frontmost', isFront);
    const button = captured.panel.querySelector('[data-front]');
    button.classList.toggle('active', isFront);
    button.textContent = isFront ? '● FRONT' : 'FRONT';
  }
  panel.style.zIndex = String(100 + frontOrder);
  refreshSpatialMenu(sourceId);
}

function menuShortcut(item) {
  const symbols = { control: '⌃', option: '⌥', shift: '⇧', command: '⌘' };
  const modifiers = (item.modifiers || []).map((modifier) => symbols[modifier] || '').join('');
  return `${modifiers}${item.command || ''}`;
}

function closeSpatialMenus() {
  menuRoot.querySelectorAll('.spatial-menu-group.open').forEach((group) => group.classList.remove('open'));
}

function buildSpatialMenuItems(items, sourceId) {
  const list = document.createElement('ul');
  list.className = 'spatial-menu-list';
  for (const item of items || []) {
    const row = document.createElement('li');
    if (item.separator) {
      row.className = 'spatial-menu-separator';
      list.append(row);
      continue;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.disabled = item.enabled === false;
    const mark = document.createElement('span');
    mark.className = 'menu-mark';
    mark.textContent = item.mark || '';
    const label = document.createElement('span');
    label.className = 'menu-label';
    label.textContent = item.title || 'Untitled';
    const shortcut = document.createElement('kbd');
    shortcut.textContent = menuShortcut(item);
    button.append(mark, label, shortcut);
    if (item.items?.length) {
      row.className = 'has-submenu';
      const arrow = document.createElement('span');
      arrow.className = 'submenu-arrow';
      arrow.textContent = '›';
      button.append(arrow);
      row.append(button, buildSpatialMenuItems(item.items, sourceId));
    } else {
      button.addEventListener('click', async (event) => {
        event.stopPropagation();
        closeSpatialMenus();
        menuState.textContent = 'EXECUTING';
        const result = await window.horizon.activateMenu(sourceId, item.path);
        menuState.textContent = result.ok ? 'COMMAND SENT' : 'ACTION FAILED';
        setTimeout(() => refreshSpatialMenu(sourceId), 250);
      });
      row.append(button);
    }
    list.append(row);
  }
  return list;
}

function renderSpatialMenu(snapshot, sourceId) {
  if (sourceId !== activeCaptureId || !capturedWindows.has(sourceId)) return;
  const captured = capturedWindows.get(sourceId);
  spatialMenuBar.hidden = false;
  menuAppName.textContent = snapshot.app?.name || captured.source?.name || 'APP';
  menuState.textContent = snapshot.ok ? 'AX MENU · LIVE' : 'AX ACCESS NEEDED';
  menuRoot.replaceChildren();
  for (const menu of snapshot.menus || []) {
    const group = document.createElement('div');
    group.className = 'spatial-menu-group';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'spatial-menu-trigger';
    trigger.textContent = menu.title;
    trigger.disabled = menu.enabled === false;
    trigger.addEventListener('click', (event) => {
      event.stopPropagation();
      const willOpen = !group.classList.contains('open');
      closeSpatialMenus();
      group.classList.toggle('open', willOpen);
    });
    group.append(trigger, buildSpatialMenuItems(menu.items, sourceId));
    menuRoot.append(group);
  }
  const theme = captured.panel.xrTheme;
  spatialMenuBar.style.setProperty('--menu-accent', theme?.palette?.accent || '#54ddff');
  spatialMenuBar.style.setProperty('--menu-surface', theme?.palette?.surface || '#061620');
}

async function refreshSpatialMenu(sourceId = activeCaptureId) {
  const sequence = ++menuRefreshSequence;
  if (!sourceId || !capturedWindows.has(sourceId)) {
    spatialMenuBar.hidden = true;
    menuRoot.replaceChildren();
    return;
  }
  const captured = capturedWindows.get(sourceId);
  if (sourceId === 'preview-window') return;
  menuAppName.textContent = captured.source?.name || 'APP';
  spatialMenuBar.hidden = false;
  menuState.textContent = 'READING MENU';
  try {
    const snapshot = await window.horizon.menuSnapshot(sourceId);
    if (sequence !== menuRefreshSequence) return;
    renderSpatialMenu(snapshot, sourceId);
  } catch {
    if (sequence !== menuRefreshSequence) return;
    renderSpatialMenu({ ok: false, menus: [] }, sourceId);
  }
}

function bindSpatialMenuDrag() {
  const handle = spatialMenuBar.querySelector('.menu-drag');
  let gesture = null;
  const finish = (event = {}) => {
    if (!gesture || (Number.isFinite(event.pointerId) && event.pointerId !== gesture.pointerId)) return;
    const previous = gesture;
    gesture = null;
    spatialMenuBar.classList.remove('dragging');
    try {
      if (handle.hasPointerCapture(previous.pointerId)) handle.releasePointerCapture(previous.pointerId);
    } catch { /* capture can already be gone */ }
  };
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    gesture = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: Number(spatialMenuBar.dataset.x || 0), y: Number(spatialMenuBar.dataset.y || 0) };
    handle.setPointerCapture(event.pointerId);
    spatialMenuBar.classList.add('dragging');
  });
  handle.addEventListener('pointermove', (event) => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    if (!(event.buttons & 1)) return finish(event);
    const x = clamp(gesture.x + event.clientX - gesture.startX, -appStage.clientWidth * .42, appStage.clientWidth * .42);
    const y = clamp(gesture.y + event.clientY - gesture.startY, -appStage.clientHeight * .35, appStage.clientHeight * .55);
    spatialMenuBar.dataset.x = String(x);
    spatialMenuBar.dataset.y = String(y);
    spatialMenuBar.style.setProperty('--menu-x', `${x}px`);
    spatialMenuBar.style.setProperty('--menu-y', `${y}px`);
  });
  handle.addEventListener('pointerup', finish);
  handle.addEventListener('pointercancel', finish);
  handle.addEventListener('lostpointercapture', finish);
  addEventListener('pointerup', finish, true);
  addEventListener('blur', finish);
}

function recordA2UIEvent(surface, componentId, name, context = {}, result) {
  const item = {
    sequence: ++a2uiEventSequence,
    version: window.XR_A2UI.VERSION,
    action: {
      name,
      surfaceId: surface.surfaceId,
      sourceComponentId: componentId,
      timestamp: new Date().toISOString(),
      context
    }
  };
  if (result !== undefined) item.result = result;
  a2uiEvents.push(item);
  if (a2uiEvents.length > 100) a2uiEvents.shift();
  return item;
}

function persistSavedWidgets() {
  localStorage.setItem('xr-shell:a2ui-widgets', JSON.stringify(savedA2UIWidgets.slice(0, 50)));
}

function a2uiSurfaceTitle(surface) {
  const fallback = [...surface.components.values()].find((component) => component.component === 'Text');
  return String(surface.placement.title || resolveA2UIValue(fallback?.text, surface) || surface.surfaceId).slice(0, 80);
}

function serializeA2UISurface(surface) {
  return {
    surfaceId: surface.surfaceId,
    title: a2uiSurfaceTitle(surface),
    catalogId: surface.catalogId,
    theme: surface.theme,
    sendDataModel: surface.sendDataModel,
    components: [...surface.components.values()],
    data: surface.data,
    placement: surface.placement,
    resumeAction: surface.resumeAction || null,
    savedAt: Date.now()
  };
}

function saveA2UISurface(surface, quiet = false) {
  const snapshot = serializeA2UISurface(surface);
  const index = savedA2UIWidgets.findIndex((item) => item.surfaceId === surface.surfaceId);
  if (index >= 0) savedA2UIWidgets[index] = snapshot;
  else savedA2UIWidgets.unshift(snapshot);
  persistSavedWidgets();
  const button = a2uiNodes.get(surface.surfaceId)?.node.querySelector('[data-a2ui-save]');
  if (button) {
    button.textContent = 'SAVED';
    button.classList.add('saved');
  }
  if (!quiet) trackingState.textContent = `${snapshot.title} saved to the widget library`;
  if (widgetLibrary.open) renderWidgetLibrary();
  return snapshot;
}

async function restoreSavedWidget(saved) {
  if (a2uiStore.surfaces.has(saved.surfaceId)) {
    const node = a2uiNodes.get(saved.surfaceId)?.node;
    if (node) node.style.zIndex = String(700 + ++a2uiFrontOrder);
    return;
  }
  if (saved.resumeAction?.method === 'open_layout') {
    await handleAgentControl('open_layout', { ...saved.resumeAction.params, surfaceId: saved.surfaceId });
  } else {
    const messages = [
      { version: window.XR_A2UI.VERSION, createSurface: { surfaceId: saved.surfaceId, catalogId: saved.catalogId, theme: saved.theme, sendDataModel: saved.sendDataModel } },
      { version: window.XR_A2UI.VERSION, updateComponents: { surfaceId: saved.surfaceId, components: saved.components } },
      { version: window.XR_A2UI.VERSION, updateDataModel: { surfaceId: saved.surfaceId, value: saved.data || {} } }
    ];
    applyA2UI(messages, saved.placement || {});
  }
  const surface = a2uiStore.surfaces.get(saved.surfaceId);
  if (surface) {
    surface.resumeAction = saved.resumeAction || null;
    surface.placement = { ...surface.placement, ...(saved.placement || {}) };
    renderA2UISurface(saved.surfaceId);
    saveA2UISurface(surface, true);
  }
}

function renderWidgetLibrary() {
  widgetLibraryList.replaceChildren();
  if (!savedA2UIWidgets.length) {
    const empty = document.createElement('p');
    empty.className = 'profile-library-empty';
    empty.textContent = 'No saved widgets yet. Use SAVE on any generated surface.';
    widgetLibraryList.append(empty);
    return;
  }
  for (const saved of savedA2UIWidgets) {
    const active = a2uiStore.surfaces.has(saved.surfaceId);
    const row = document.createElement('article');
    row.className = 'widget-library-row';
    const copy = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = saved.title || saved.surfaceId;
    const detail = document.createElement('small');
    detail.textContent = `${saved.components?.length || 0} components · ${new Date(saved.savedAt).toLocaleString()}`;
    copy.append(title, detail);
    const actions = document.createElement('div');
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.textContent = active ? 'Turn off' : 'Turn on';
    toggle.className = active ? 'active' : '';
    toggle.addEventListener('click', async () => {
      if (active) removeA2UISurface(saved.surfaceId, false);
      else await restoreSavedWidget(saved);
      renderWidgetLibrary();
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'danger';
    remove.textContent = 'Delete';
    remove.addEventListener('click', () => {
      if (!confirm(`Delete saved widget “${saved.title || saved.surfaceId}”?`)) return;
      removeA2UISurface(saved.surfaceId, false);
      savedA2UIWidgets = savedA2UIWidgets.filter((item) => item.surfaceId !== saved.surfaceId);
      persistSavedWidgets();
      renderWidgetLibrary();
    });
    actions.append(toggle, remove);
    row.append(copy, actions);
    widgetLibraryList.append(row);
  }
}

function resolveA2UIValue(value, surface) {
  if (Array.isArray(value)) return value.map((item) => resolveA2UIValue(item, surface));
  if (value && typeof value === 'object') {
    if (typeof value.path === 'string' && Object.keys(value).length === 1) return window.XR_A2UI.resolveValue(value, surface.data);
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveA2UIValue(item, surface)]));
  }
  return value;
}

const a2uiActionMethods = {
  xr_shell_pull_app: 'pull_app',
  xr_shell_launch_app: 'launch_app',
  xr_shell_focus_app: 'focus_app',
  xr_shell_transform_app: 'transform_app',
  xr_shell_release_app: 'release_app',
  xr_shell_open_layout: 'open_layout',
  xr_shell_add_note: 'add_note',
  xr_shell_a2ui_delete: 'a2ui_delete'
};

async function dispatchA2UIAction(surface, component) {
  const event = component.action?.event;
  if (!event?.name) return;
  const context = resolveA2UIValue(event.context || {}, surface);
  if (event.name !== 'mcp.call') {
    recordA2UIEvent(surface, component.id, event.name, context);
    return;
  }
  const method = a2uiActionMethods[context.tool];
  if (!method) {
    recordA2UIEvent(surface, component.id, event.name, context, { ok: false, error: 'tool-not-allowed' });
    return;
  }
  try {
    const result = await handleAgentControl(method, context.arguments || {});
    recordA2UIEvent(surface, component.id, event.name, context, { ok: true, value: result });
  } catch (error) {
    recordA2UIEvent(surface, component.id, event.name, context, { ok: false, error: error.message });
  }
}

function renderA2UIComponent(surface, componentId, ancestry = new Set()) {
  if (ancestry.has(componentId)) {
    const error = document.createElement('p');
    error.className = 'a2ui-error';
    error.textContent = 'Circular component reference';
    return error;
  }
  const component = surface.components.get(componentId);
  if (!component) {
    const placeholder = document.createElement('span');
    placeholder.className = 'a2ui-placeholder';
    placeholder.textContent = `Waiting for ${componentId}`;
    return placeholder;
  }
  const nextAncestry = new Set(ancestry).add(componentId);
  const renderChild = (id) => renderA2UIComponent(surface, id, nextAncestry);
  let node;
  if (component.component === 'Text') {
    node = document.createElement(component.variant === 'h1' || component.variant === 'h2' ? 'h3' : 'p');
    node.textContent = String(resolveA2UIValue(component.text, surface) ?? '').slice(0, 5000);
  } else if (component.component === 'Button') {
    node = document.createElement('button');
    node.type = 'button';
    if (component.child) node.append(renderChild(component.child));
    else node.textContent = String(resolveA2UIValue(component.label || component.text, surface) || 'Action').slice(0, 120);
    node.addEventListener('click', () => dispatchA2UIAction(surface, component));
  } else if (component.component === 'TextField') {
    node = document.createElement('label');
    node.className = 'a2ui-field';
    const label = document.createElement('span');
    label.textContent = String(component.label || 'Value').slice(0, 120);
    const input = document.createElement('input');
    input.type = component.variant === 'longText' ? 'text' : 'text';
    input.value = String(resolveA2UIValue(component.value, surface) ?? '').slice(0, 2000);
    if (component.value?.path) input.addEventListener('input', () => { surface.data = window.XR_A2UI.setPointer(surface.data, component.value.path, input.value); });
    node.append(label, input);
  } else if (component.component === 'Divider') {
    node = document.createElement('hr');
  } else if (component.component === 'Icon') {
    node = document.createElement('span');
    node.className = 'a2ui-icon';
    node.textContent = { note: '◇', apps: '◫', terminal: '⌁', info: 'i' }[component.name] || '✦';
  } else {
    node = document.createElement('div');
    if (component.component === 'Card') node.className = 'a2ui-card';
    if (component.component === 'Column') node.className = 'a2ui-column';
    if (component.component === 'Row') node.className = 'a2ui-row';
    if (component.child) node.append(renderChild(component.child));
    for (const child of Array.isArray(component.children) ? component.children : []) node.append(renderChild(child));
  }
  node.dataset.a2uiComponent = component.id;
  return node;
}

function removeA2UISurface(surfaceId, emitClose = false) {
  const surface = a2uiStore.surfaces.get(surfaceId);
  if (emitClose && surface) recordA2UIEvent(surface, 'xr_shell_close', 'xr.shell.surfaceClosed', {});
  const record = a2uiNodes.get(surfaceId);
  record?.cleanup?.();
  record?.node.remove();
  a2uiNodes.delete(surfaceId);
  if (surface) window.XR_A2UI.applyMessages(a2uiStore, { version: window.XR_A2UI.VERSION, deleteSurface: { surfaceId } });
  if (widgetLibrary.open) renderWidgetLibrary();
}

function bindA2UISurfaceDrag(surface, node) {
  const handle = node.querySelector('.a2ui-surface-header');
  let gesture = null;
  const finish = (event = {}) => {
    if (!gesture || (Number.isFinite(event.pointerId) && event.pointerId !== gesture.pointerId)) return;
    const previous = gesture;
    gesture = null;
    node.classList.remove('dragging');
    try { if (handle.hasPointerCapture(previous.pointerId)) handle.releasePointerCapture(previous.pointerId); } catch { /* already released */ }
  };
  const update = (event) => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    if (!(event.buttons & 1)) return finish(event);
    const x = clamp(gesture.x + event.clientX - gesture.startX, -a2uiStage.clientWidth * .46, a2uiStage.clientWidth * .46);
    const y = clamp(gesture.y + event.clientY - gesture.startY, -a2uiStage.clientHeight * .44, a2uiStage.clientHeight * .44);
    surface.placement.x = x;
    surface.placement.y = y;
    node.style.setProperty('--surface-x', `${x}px`);
    node.style.setProperty('--surface-y', `${y}px`);
  };
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest('button')) return;
    event.preventDefault();
    a2uiFrontOrder += 1;
    node.style.zIndex = String(700 + a2uiFrontOrder);
    gesture = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: Number(surface.placement.x || 0), y: Number(surface.placement.y || 0) };
    handle.setPointerCapture(event.pointerId);
    node.classList.add('dragging');
  });
  handle.addEventListener('pointermove', update);
  handle.addEventListener('pointerup', finish);
  handle.addEventListener('pointercancel', finish);
  handle.addEventListener('lostpointercapture', finish);
  addEventListener('pointerup', finish, true);
  const blur = () => finish({});
  addEventListener('blur', blur);
  return () => { removeEventListener('pointerup', finish, true); removeEventListener('blur', blur); };
}

function renderA2UISurface(surfaceId) {
  const surface = a2uiStore.surfaces.get(surfaceId);
  if (!surface || !surface.components.has('root')) return;
  let record = a2uiNodes.get(surfaceId);
  if (!record) {
    const node = document.createElement('article');
    node.className = 'a2ui-surface glass';
    node.innerHTML = `<header class="a2ui-surface-header"><div><small>AGENT UI · A2UI ${window.XR_A2UI.VERSION.slice(1)}</small><strong></strong></div><nav><button type="button" data-a2ui-save title="Save this widget">SAVE</button><button type="button" data-a2ui-close aria-label="Close generated widget" title="Close">×</button></nav></header><div class="a2ui-surface-content"></div>`;
    node.querySelector('[data-a2ui-close]').addEventListener('click', () => removeA2UISurface(surfaceId, true));
    node.querySelector('[data-a2ui-save]').addEventListener('click', () => {
      const current = a2uiStore.surfaces.get(surfaceId);
      if (current) saveA2UISurface(current);
    });
    a2uiStage.append(node);
    record = { node, cleanup: bindA2UISurfaceDrag(surface, node) };
    a2uiNodes.set(surfaceId, record);
  }
  const { node } = record;
  const fallback = [...surface.components.values()].find((component) => component.component === 'Text');
  node.querySelector('header strong').textContent = String(surface.placement.title || resolveA2UIValue(fallback?.text, surface) || surfaceId).slice(0, 80);
  const isSaved = savedA2UIWidgets.some((item) => item.surfaceId === surfaceId);
  const saveButton = node.querySelector('[data-a2ui-save]');
  saveButton.textContent = isSaved ? 'SAVED' : 'SAVE';
  saveButton.classList.toggle('saved', isSaved);
  node.querySelector('.a2ui-surface-content').replaceChildren(renderA2UIComponent(surface, 'root'));
  const ordinal = Math.max(0, a2uiNodes.size - 1);
  if (!Number.isFinite(surface.placement.x)) surface.placement.x = (ordinal % 3 - 1) * 360;
  if (!Number.isFinite(surface.placement.y)) surface.placement.y = (ordinal % 2) * 150 - 75;
  node.style.setProperty('--surface-x', `${surface.placement.x}px`);
  node.style.setProperty('--surface-y', `${surface.placement.y}px`);
  node.style.setProperty('--surface-width', `${clamp(Number(surface.placement.width) || 360, 260, 620)}px`);
  a2uiFrontOrder += 1;
  node.style.zIndex = String(700 + a2uiFrontOrder);
}

function applyA2UI(messages, placement = {}) {
  const result = window.XR_A2UI.applyMessages(a2uiStore, messages, { placement });
  result.deleted.forEach((surfaceId) => {
    const record = a2uiNodes.get(surfaceId);
    record?.cleanup?.();
    record?.node.remove();
    a2uiNodes.delete(surfaceId);
  });
  result.changed.forEach(renderA2UISurface);
  return { ok: true, ...result, surfaces: window.XR_A2UI.summarize(a2uiStore) };
}

function safeSurfaceId(prefix, requested) {
  const candidate = String(requested || `${prefix}_${Date.now()}`).replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 128);
  return /^[A-Za-z_]/.test(candidate) ? candidate : `${prefix}_${candidate}`;
}

function noteMessages(params) {
  const surfaceId = safeSurfaceId('note', params.surfaceId);
  return { surfaceId, messages: [
    { version: window.XR_A2UI.VERSION, createSurface: { surfaceId, catalogId: window.XR_A2UI.BASIC_CATALOG } },
    { version: window.XR_A2UI.VERSION, updateComponents: { surfaceId, components: [
      { id: 'root', component: 'Card', child: 'note_column' },
      { id: 'note_column', component: 'Column', children: ['note_icon', 'note_title', 'note_divider', 'note_body'] },
      { id: 'note_icon', component: 'Icon', name: 'note' },
      { id: 'note_title', component: 'Text', variant: 'h2', text: String(params.title || 'Floating note').slice(0, 120) },
      { id: 'note_divider', component: 'Divider' },
      { id: 'note_body', component: 'Text', text: String(params.body || '').slice(0, 5000) }
    ] } }
  ] };
}

function layoutSurfaceMessages(params, opened, failures) {
  const surfaceId = safeSurfaceId('layout', params.surfaceId);
  const components = [
    { id: 'root', component: 'Card', child: 'layout_column' },
    { id: 'layout_column', component: 'Column', children: ['layout_icon', 'layout_title', 'layout_divider'] },
    { id: 'layout_icon', component: 'Icon', name: 'apps' },
    { id: 'layout_title', component: 'Text', variant: 'h2', text: String(params.title || 'App layout').slice(0, 120) },
    { id: 'layout_divider', component: 'Divider' }
  ];
  opened.forEach((app, index) => {
    const row = `app_${index}`;
    const name = `${row}_name`;
    const focus = `${row}_focus`;
    const focusLabel = `${focus}_label`;
    const release = `${row}_release`;
    const releaseLabel = `${release}_label`;
    components.find((item) => item.id === 'layout_column').children.push(row);
    components.push(
      { id: row, component: 'Row', children: [name, focus, release] },
      { id: name, component: 'Text', text: app.name },
      { id: focusLabel, component: 'Text', text: 'Bring forward' },
      { id: focus, component: 'Button', child: focusLabel, action: { event: { name: 'mcp.call', context: { tool: 'xr_shell_focus_app', arguments: { sourceId: app.sourceId } } } } },
      { id: releaseLabel, component: 'Text', text: 'Release' },
      { id: release, component: 'Button', child: releaseLabel, action: { event: { name: 'mcp.call', context: { tool: 'xr_shell_release_app', arguments: { sourceId: app.sourceId } } } } }
    );
  });
  failures.forEach((failure, index) => {
    const id = `failure_${index}`;
    components.find((item) => item.id === 'layout_column').children.push(id);
    components.push({ id, component: 'Text', text: `Could not open ${failure.query}: ${failure.error}` });
  });
  return { surfaceId, messages: [
    { version: window.XR_A2UI.VERSION, createSurface: { surfaceId, catalogId: window.XR_A2UI.BASIC_CATALOG } },
    { version: window.XR_A2UI.VERSION, updateComponents: { surfaceId, components } }
  ] };
}

function syncSemanticGeometry(panel) {
  const surface = panel.querySelector('.capture-viewport');
  const video = surface.querySelector('video');
  const layer = surface.querySelector('.semantic-layer');
  if (!video || !video.videoWidth || !video.videoHeight) return;
  const rect = surface.getBoundingClientRect();
  const scale = Math.min(rect.width / video.videoWidth, rect.height / video.videoHeight);
  const width = video.videoWidth * scale;
  const height = video.videoHeight * scale;
  layer.style.left = `${(rect.width - width) / 2}px`;
  layer.style.top = `${(rect.height - height) / 2}px`;
  layer.style.width = `${width}px`;
  layer.style.height = `${height}px`;
}

function renderSemanticLayer(panel, snapshot, events = []) {
  const layer = panel.querySelector('.semantic-layer');
  layer.replaceChildren();
  syncSemanticGeometry(panel);
  const changed = new Set(events.map((event) => event.id));
  const visibleRoles = new Set(['AXButton', 'AXTextField', 'AXTextArea', 'AXLink', 'AXCheckBox',
    'AXRadioButton', 'AXSlider', 'AXTab', 'AXPopUpButton', 'AXMenuButton', 'AXToolbar', 'AXGroup']);
  for (const element of (snapshot.elements || []).filter((item) => visibleRoles.has(item.role)).slice(0, 140)) {
    const frame = element.frame;
    if (!frame || frame.width > 1.05 || frame.height > 1.05) continue;
    const node = document.createElement('div');
    node.className = `ax-element ax-${element.role.slice(2).toLowerCase()}${changed.has(element.id) ? ' changed' : ''}`;
    node.style.left = `${clamp(frame.x, 0, 1) * 100}%`;
    node.style.top = `${clamp(frame.y, 0, 1) * 100}%`;
    node.style.width = `${clamp(frame.width, 0.005, 1) * 100}%`;
    node.style.height = `${clamp(frame.height, 0.005, 1) * 100}%`;
    const label = semanticLabel(element);
    if (label && frame.width > 0.08 && frame.height > 0.025) {
      const tag = document.createElement('span');
      tag.textContent = label.slice(0, 42);
      node.append(tag);
    }
    layer.append(node);
  }
  panel.querySelector('footer b').textContent = `${snapshot.elements?.length || 0} AX NODES · PROFILE LEARNING`;
}

function bindProfileControls(sourceId, panel) {
  const button = panel.querySelector('[data-profile]');
  const resizeObserver = new ResizeObserver(() => syncSemanticGeometry(panel));
  resizeObserver.observe(panel);
  capturedWindows.get(sourceId).resizeObserver = resizeObserver;
  button.addEventListener('click', async () => {
    const captured = capturedWindows.get(sourceId);
    if (!captured) return;
    const enabled = !captured.profiling;
    button.textContent = enabled ? '5:00' : 'AX';
    const result = await window.horizon.toggleProfile(sourceId, enabled);
    if (!result.ok) {
      button.textContent = 'AX!';
      trackingState.textContent = result.error === 'accessibility-permission-required'
        ? 'Grant Accessibility access before learning an app profile'
        : `Could not inspect app UI · ${result.error}`;
      return;
    }
    captured.profiling = enabled;
    captured.profileEndsAt = enabled ? Number(result.endsAt) || Date.now() + 5 * 60 * 1000 : 0;
    button.classList.toggle('active', enabled);
    button.textContent = enabled ? '5:00' : 'AX';
    panel.querySelector('.semantic-layer').classList.toggle('visible', enabled);
    if (enabled) {
      applyProfileTheme(panel, result.theme);
      renderSemanticLayer(panel, result);
      trackingState.textContent = `Learning ${result.app.name} for 5 minutes · use the app normally`;
    } else {
      panel.querySelector('footer b').textContent = 'DRAG CORNER TO RESIZE';
    }
  });
}

function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function centerWorkspace() {
  targetYaw = 0;
  targetPitch = 0;
  poseTime = 0;
  headView.reset();
  pitchStabilizer.reset();
  window.horizon.trackingControl('recenter');
}

function layoutCapturedWindows() {
  const items = [...capturedWindows.values()];
  const requiredScale = window.XR_WINDOW_LAYOUT.requiredHorizontalScale(items.length, virtualScale);
  if (requiredScale > virtualScale) setHorizontalScale(requiredScale);
  const positions = window.XR_WINDOW_LAYOUT.horizontalSlots(items.length, virtualScale);
  items.forEach((item, index) => {
    const position = positions[index];
    item.panel.dataset.slot = String(index);
    item.panel.style.setProperty('--slot-x', `${position}vw`);
    item.panel.style.setProperty('--tilt', `${position === 0 ? 0 : position < 0 ? 2.5 : -2.5}deg`);
  });
}

function capturedLayoutItem(sourceId, captured) {
  return {
    sourceId,
    name: captured.source?.name || captured.panel.querySelector('.capture-title span')?.textContent || 'App',
    active: sourceId === activeCaptureId,
    x: Number(captured.panel.dataset.offsetX || 0),
    y: Number(captured.panel.dataset.offsetY || 0),
    width: captured.panel.offsetWidth,
    height: captured.panel.offsetHeight,
    visualMode: captured.panel.visualMode || 'fx',
    profileApplied: Boolean(captured.panel.xrTheme)
  };
}

function resolveCapturedApp(params = {}) {
  if (params.sourceId && capturedWindows.has(params.sourceId)) return [params.sourceId, capturedWindows.get(params.sourceId)];
  const query = String(params.query || '').trim().toLowerCase();
  if (!query) return null;
  return [...capturedWindows.entries()].find(([, captured]) => captured.source?.name?.toLowerCase() === query)
    || [...capturedWindows.entries()].find(([, captured]) => captured.source?.name?.toLowerCase().includes(query));
}

async function handleAgentControl(method, params = {}) {
  if (method === 'get_layout') return { activeSourceId: activeCaptureId, windows: [...capturedWindows.entries()].map(([id, captured]) => capturedLayoutItem(id, captured)) };
  if (method === 'a2ui_capabilities') return {
    version: window.XR_A2UI.VERSION,
    supportedCatalogIds: [window.XR_A2UI.BASIC_CATALOG, window.XR_A2UI.XR_CATALOG],
    components: window.XR_A2UI.COMPONENTS,
    actionTools: Object.keys(a2uiActionMethods),
    guarantees: ['draggable', 'closable'],
    surfaces: window.XR_A2UI.summarize(a2uiStore)
  };
  if (method === 'a2ui_apply') return applyA2UI(params.messages, params.placement || {});
  if (method === 'a2ui_delete') {
    const surfaceId = safeSurfaceId('surface', params.surfaceId);
    const existed = a2uiStore.surfaces.has(surfaceId);
    removeA2UISurface(surfaceId, false);
    return { ok: true, deleted: existed, surfaceId };
  }
  if (method === 'a2ui_events') {
    const after = Math.max(0, Number(params.after) || 0);
    const events = a2uiEvents.filter((event) => event.sequence > after);
    return { events, cursor: a2uiEventSequence };
  }
  if (method === 'add_note') {
    const note = noteMessages(params);
    return applyA2UI(note.messages, { title: params.title || 'Floating note', x: params.x, y: params.y, width: params.width });
  }
  if (method === 'launch_app') {
    const launched = await window.horizon.launchApp(params);
    const captured = await handleAgentControl('pull_app', { sourceId: launched.source.id, profileName: params.app || params.bundleId });
    const transformed = await handleAgentControl('transform_app', { sourceId: captured.sourceId, x: params.x, y: params.y, width: params.width, height: params.height });
    return { ...transformed, launched: launched.launched, profileApplied: transformed.profileApplied };
  }
  if (method === 'open_layout') {
    if (!Array.isArray(params.apps) || !params.apps.length || params.apps.length > window.XR_WINDOW_LAYOUT.MAX_WINDOWS) throw new Error(`A layout requires 1–${window.XR_WINDOW_LAYOUT.MAX_WINDOWS} apps`);
    const opened = [];
    const failures = [];
    for (const spec of params.apps) {
      try {
        let app;
        try {
          app = await handleAgentControl('pull_app', spec);
        } catch (pullError) {
          if (spec.launch === false) throw pullError;
          app = await handleAgentControl('launch_app', {
            app: spec.app || spec.query,
            bundleId: spec.bundleId,
            windowQuery: spec.windowQuery || spec.query,
            waitMs: spec.waitMs
          });
        }
        const transformed = await handleAgentControl('transform_app', { sourceId: app.sourceId, x: spec.x, y: spec.y, width: spec.width, height: spec.height });
        opened.push(transformed);
      } catch (error) {
        failures.push({ query: spec.query || spec.sourceId || 'app', error: error.message });
      }
    }
    const layout = layoutSurfaceMessages(params, opened, failures);
    const surface = applyA2UI(layout.messages, { title: params.title || 'App layout', x: params.x, y: params.y, width: 430 });
    const liveSurface = a2uiStore.surfaces.get(layout.surfaceId);
    if (liveSurface) liveSurface.resumeAction = { method: 'open_layout', params: JSON.parse(JSON.stringify({ ...params, surfaceId: layout.surfaceId })) };
    return { opened, failures, surfaceId: layout.surfaceId, surface };
  }
  if (method === 'pull_app') {
    await loadWindows(true);
    const query = String(params.query || '').trim().toLowerCase();
    const source = availableWindows.find((item) => item.id === params.sourceId)
      || availableWindows.find((item) => item.name.toLowerCase() === query)
      || availableWindows.find((item) => query && item.name.toLowerCase().includes(query));
    if (!source) throw new Error('No matching open application window');
    await captureWindow(source, params.profileName || source.name);
    return capturedLayoutItem(source.id, capturedWindows.get(source.id));
  }
  const match = resolveCapturedApp(params);
  if (!match) throw new Error('No matching captured XR application');
  const [sourceId, captured] = match;
  if (method === 'release_app') {
    const released = capturedLayoutItem(sourceId, captured);
    removeCapturedWindow(sourceId);
    return { released };
  }
  if (method === 'focus_app') {
    selectCapture(sourceId, captured.panel);
    return capturedLayoutItem(sourceId, captured);
  }
  if (method === 'transform_app') {
    if (Number.isFinite(params.width) || Number.isFinite(params.height)) {
      captured.panel.dataset.manualSize = 'true';
      setPanelSize(captured.panel, Number.isFinite(params.width) ? params.width : captured.panel.offsetWidth, Number.isFinite(params.height) ? params.height : captured.panel.offsetHeight);
    }
    if (Number.isFinite(params.x)) {
      const x = clamp(params.x, -appStage.clientWidth * .42, appStage.clientWidth * .42);
      captured.panel.dataset.offsetX = String(x);
      captured.panel.style.setProperty('--offset-x', `${x}px`);
    }
    if (Number.isFinite(params.y)) {
      const halfTravel = Math.max(0, (appStage.clientHeight - captured.panel.offsetHeight) / 2 - 8);
      const y = clamp(params.y, -halfTravel, halfTravel);
      captured.panel.dataset.offsetY = String(y);
      captured.panel.style.setProperty('--offset-y', `${y}px`);
    }
    bringCaptureToFront(sourceId, captured.panel);
    return capturedLayoutItem(sourceId, captured);
  }
  throw new Error(`Unsupported XR Shell operation: ${method}`);
}

function eventModifiers(event) {
  return [
    event.metaKey && 'command',
    event.shiftKey && 'shift',
    event.altKey && 'option',
    event.ctrlKey && 'control'
  ].filter(Boolean);
}

function mediaPoint(event, video, clampOutside = false) {
  const boxWidth = video.clientWidth;
  const boxHeight = video.clientHeight;
  const mediaWidth = video.videoWidth || boxWidth;
  const mediaHeight = video.videoHeight || boxHeight;
  if (!boxWidth || !boxHeight || !mediaWidth || !mediaHeight) return null;

  const scale = Math.min(boxWidth / mediaWidth, boxHeight / mediaHeight);
  const width = mediaWidth * scale;
  const height = mediaHeight * scale;
  const left = (boxWidth - width) / 2;
  const top = (boxHeight - height) / 2;
  let localX;
  let localY;
  if (event.target === video && Number.isFinite(event.offsetX) && Number.isFinite(event.offsetY)) {
    localX = event.offsetX;
    localY = event.offsetY;
  } else {
    const rect = video.getBoundingClientRect();
    localX = (event.clientX - rect.left) * boxWidth / rect.width;
    localY = (event.clientY - rect.top) * boxHeight / rect.height;
  }
  let x = (localX - left) / width;
  let y = (localY - top) / height;
  if (!clampOutside && (x < 0 || x > 1 || y < 0 || y > 1)) return null;
  x = Math.max(0, Math.min(1, x));
  y = Math.max(0, Math.min(1, y));
  return { x, y };
}

function updateXRCursor(surface, video, point, pressed = false) {
  const cursor = surface.querySelector('.xr-cursor');
  const mediaWidth = video.videoWidth || video.clientWidth;
  const mediaHeight = video.videoHeight || video.clientHeight;
  const scale = Math.min(video.clientWidth / mediaWidth, video.clientHeight / mediaHeight);
  const width = mediaWidth * scale;
  const height = mediaHeight * scale;
  cursor.style.left = `${(video.clientWidth - width) / 2 + point.x * width}px`;
  cursor.style.top = `${(video.clientHeight - height) / 2 + point.y * height}px`;
  cursor.classList.toggle('pressed', pressed);
  cursor.classList.add('visible');
}

function selectCapture(sourceId, panel) {
  activeCaptureId = sourceId;
  for (const captured of capturedWindows.values()) captured.panel.classList.remove('input-active');
  panel.classList.add('input-active');
  bringCaptureToFront(sourceId, panel);
  panel.focus({ preventScroll: true });
}

function bindCapturedInput(sourceId, panel) {
  const surface = panel.querySelector('.capture-viewport');
  panel.tabIndex = 0;
  let gesture = null;

  surface.addEventListener('pointerdown', (event) => {
    selectCapture(sourceId, panel);
    if (!inputEnabled) {
      trackingState.textContent = 'App input is off · choose Enable app input below';
      return;
    }
    const video = surface.querySelector('video');
    const point = video && mediaPoint(event, video);
    if (!point) return;
    event.preventDefault();
    surface.setPointerCapture(event.pointerId);
    gesture = { button: event.button, clickCount: event.detail, startPoint: point, startX: event.clientX, startY: event.clientY, dragging: false };
    updateXRCursor(surface, video, point, true);
  });

  surface.addEventListener('pointermove', (event) => {
    if (!inputEnabled) return;
    const now = performance.now();
    if (now - lastDragSent < 16) return;
    const video = surface.querySelector('video');
    const dragging = Boolean(event.buttons && surface.hasPointerCapture(event.pointerId));
    const point = video && mediaPoint(event, video, dragging);
    if (!point) return;
    lastDragSent = now;
    if (dragging) {
      if (gesture && !gesture.dragging && Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) > 5) {
        gesture.dragging = true;
        window.horizon.sendInput({ sourceId, type: 'pointer', phase: 'down', button: gesture.button, ...gesture.startPoint });
      }
      if (gesture?.dragging) {
        const button = event.buttons & 2 ? 2 : event.buttons & 4 ? 1 : 0;
        window.horizon.sendInput({ sourceId, type: 'pointer', phase: 'drag', button, ...point });
      }
    } else {
      window.horizon.sendInput({ sourceId, type: 'pointer', phase: 'move', button: 0, ...point });
    }
    updateXRCursor(surface, video, point, Boolean(event.buttons));
  });

  surface.addEventListener('pointerup', (event) => {
    if (!inputEnabled) return;
    const video = surface.querySelector('video');
    const point = video && mediaPoint(event, video, true);
    if (!point) return;
    if (gesture?.dragging) {
      window.horizon.sendInput({ sourceId, type: 'pointer', phase: 'up', button: gesture.button, ...point });
    } else {
      window.horizon.sendInput({ sourceId, type: 'activate', button: gesture?.button ?? event.button, clickCount: gesture?.clickCount || event.detail, ...(gesture?.startPoint || point) });
    }
    gesture = null;
    updateXRCursor(surface, video, point, false);
    if (surface.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId);
  });
  surface.addEventListener('pointerleave', () => {
    if (!gesture) surface.querySelector('.xr-cursor').classList.remove('visible');
  });
  surface.addEventListener('pointercancel', (event) => {
    if (gesture?.dragging) {
      const video = surface.querySelector('video');
      const point = video && mediaPoint(event, video, true);
      if (point) window.horizon.sendInput({ sourceId, type: 'pointer', phase: 'up', button: gesture.button, ...point });
    }
    gesture = null;
    surface.querySelector('.xr-cursor').classList.remove('visible', 'pressed');
  });

  surface.addEventListener('wheel', (event) => {
    selectCapture(sourceId, panel);
    if (!inputEnabled) return;
    const video = surface.querySelector('video');
    const point = video && mediaPoint(event, video);
    if (!point) return;
    event.preventDefault();
    window.horizon.sendInput({ sourceId, type: 'scroll', deltaX: event.deltaX, deltaY: event.deltaY, ...point });
  }, { passive: false });

  panel.addEventListener('keydown', (event) => {
    if (!inputEnabled || activeCaptureId !== sourceId || event.target.closest('button')) return;
    const modifiers = eventModifiers(event);
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const keyCode = physicalKeyCodes[event.code] ?? keyCodes[key];
    if (keyCode !== undefined) {
      window.horizon.sendInput({ sourceId, type: 'key', keyCode, modifiers });
    } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      window.horizon.sendInput({ sourceId, type: 'text', text: event.key, modifiers: [] });
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  });
}

function saveSessions() {
  localStorage.setItem('xr-shell:sessions', JSON.stringify(sessions.slice(0, 20)));
}

function relativeSessionTime(timestamp) {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  return minutes < 1 ? 'now' : minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h`;
}

function renderSessions() {
  sessionList.replaceChildren();
  if (!sessions.length) {
    const empty = document.createElement('p');
    empty.className = 'session-empty';
    empty.textContent = 'No sessions yet · use the command deck';
    sessionList.append(empty);
    return;
  }
  for (const session of sessions.slice(0, 20)) {
    const row = document.createElement('div');
    row.className = `session-row${session.clientId === activeSessionId ? ' active' : ''}`;
    const select = document.createElement('button');
    select.type = 'button';
    select.className = 'session-select';
    const indicator = document.createElement('i');
    indicator.className = ['starting', 'working', 'command_execution'].includes(session.status) ? 'running' : '';
    indicator.textContent = session.status === 'complete' ? '✓' : '◌';
    const copy = document.createElement('p');
    const title = document.createElement('strong');
    title.textContent = session.title;
    const detail = document.createElement('small');
    detail.textContent = session.status === 'complete' ? 'Ready to continue' : session.status === 'draft' ? 'New session' : session.status;
    copy.append(title, detail);
    const time = document.createElement('time');
    time.textContent = relativeSessionTime(session.updatedAt);
    select.append(indicator, copy, time);
    select.addEventListener('click', () => { activeSessionId = session.clientId; renderSessions(); renderChat(session); });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'session-delete';
    remove.setAttribute('aria-label', `Delete ${session.title}`);
    remove.title = 'Delete this session from XR Shell';
    remove.textContent = '×';
    remove.addEventListener('click', async () => {
      await window.horizon.deleteChat(session.clientId);
      sessions = sessions.filter((item) => item.clientId !== session.clientId);
      if (activeSessionId === session.clientId) activeSessionId = sessions[0]?.clientId || null;
      saveSessions();
      renderSessions();
      renderChat(sessions.find((item) => item.clientId === activeSessionId) || null);
    });
    row.append(select, remove);
    sessionList.append(row);
  }
}

function createChatSession() {
  const session = { clientId: crypto.randomUUID(), threadId: null, title: 'New session', status: 'draft', updatedAt: Date.now(), messages: [] };
  sessions.unshift(session);
  activeSessionId = session.clientId;
  saveSessions();
  renderSessions();
  renderChat(session);
  chatInput.focus();
  return session;
}

function renderChat(session) {
  chatResponse.replaceChildren();
  const label = document.createElement('small');
  label.textContent = session ? `SESSION · ${session.status.toUpperCase()}` : 'XR AGENT';
  chatResponse.append(label);
  const messages = session?.messages || [];
  if (!messages.length) {
    const message = document.createElement('p');
    message.textContent = 'Start a read-only Codex session from the command deck.';
    chatResponse.append(message);
    return;
  }
  for (const item of messages.slice(-4)) {
    const message = document.createElement('p');
    message.className = item.role;
    message.textContent = item.text;
    chatResponse.append(message);
  }
  chatResponse.scrollTop = chatResponse.scrollHeight;
}

async function submitChat() {
  const prompt = chatInput.value.trim();
  if (!prompt) return;
  let session = sessions.find((item) => item.clientId === activeSessionId);
  if (!session || ['starting', 'working', 'command_execution'].includes(session.status)) {
    session = { clientId: crypto.randomUUID(), threadId: null, title: prompt.slice(0, 48), status: 'starting', updatedAt: Date.now(), messages: [] };
    sessions.unshift(session);
    activeSessionId = session.clientId;
  }
  if (session.status === 'draft') session.title = prompt.slice(0, 48);
  session.messages.push({ role: 'user', text: prompt });
  session.status = 'starting';
  session.updatedAt = Date.now();
  chatInput.value = '';
  saveSessions();
  renderSessions();
  renderChat(session);
  const result = await window.horizon.sendChat({ clientId: session.clientId, threadId: session.threadId, prompt });
  if (!result.accepted) {
    session.status = 'error';
    session.messages.push({ role: 'error', text: result.error });
    saveSessions();
    renderSessions();
    renderChat(session);
  }
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function setPanelSize(panel, width, height) {
  const maxWidth = Math.min(1100, appStage.clientWidth * 0.48);
  const maxHeight = appStage.clientHeight * 0.9;
  panel.style.setProperty('--panel-width', `${clamp(width, 420, maxWidth)}px`);
  panel.style.setProperty('--panel-height', `${clamp(height, 280, maxHeight)}px`);
}

function bindSpatialControls(sourceId, panel) {
  const header = panel.querySelector('header');
  const grip = panel.querySelector('.resize-grip');
  let gesture = null;

  const begin = (event, mode) => {
    if (event.button !== 0 || (mode === 'move' && event.target.closest('button'))) return;
    event.preventDefault();
    event.stopPropagation();
    selectCapture(sourceId, panel);
    const rect = panel.getBoundingClientRect();
    gesture = {
      mode,
      pointerId: event.pointerId,
      captureTarget: event.currentTarget,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: Number(panel.dataset.offsetX || 0),
      offsetY: Number(panel.dataset.offsetY || 0),
      width: rect.width,
      height: rect.height
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    panel.classList.add('positioning');
  };

  const update = (event) => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    if ((event.buttons & 1) === 0) {
      finish(event);
      return;
    }
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    if (gesture.mode === 'resize') {
      panel.dataset.manualSize = 'true';
      setPanelSize(panel, gesture.width + dx, gesture.height + dy);
      return;
    }
    const maxX = appStage.clientWidth * 0.42;
    const halfTravel = Math.max(0, (appStage.clientHeight - panel.offsetHeight) / 2 - 8);
    const minimumY = -halfTravel;
    const maximumY = halfTravel;
    const x = clamp(gesture.offsetX + dx, -maxX, maxX);
    const y = clamp(gesture.offsetY + dy, minimumY, maximumY);
    panel.dataset.offsetX = String(x);
    panel.dataset.offsetY = String(y);
    panel.style.setProperty('--offset-x', `${x}px`);
    panel.style.setProperty('--offset-y', `${y}px`);
  };

  const finish = (event) => {
    if (!gesture || (Number.isFinite(event.pointerId) && event.pointerId !== gesture.pointerId)) return;
    const { captureTarget, pointerId } = gesture;
    gesture = null;
    panel.classList.remove('positioning');
    try {
      if (captureTarget.hasPointerCapture(pointerId)) captureTarget.releasePointerCapture(pointerId);
    } catch { /* pointer capture may already have been released by the OS */ }
  };

  header.addEventListener('pointerdown', (event) => begin(event, 'move'));
  header.addEventListener('pointermove', update);
  header.addEventListener('pointerup', finish);
  header.addEventListener('pointercancel', finish);
  grip.addEventListener('pointerdown', (event) => begin(event, 'resize'));
  grip.addEventListener('pointermove', update);
  grip.addEventListener('pointerup', finish);
  grip.addEventListener('pointercancel', finish);
  header.addEventListener('lostpointercapture', finish);
  grip.addEventListener('lostpointercapture', finish);
  addEventListener('pointerup', finish, true);
  addEventListener('pointercancel', finish, true);
  const finishOnBlur = () => finish({});
  addEventListener('blur', finishOnBlur);
  capturedWindows.get(sourceId).spatialCleanup = () => {
    removeEventListener('pointerup', finish, true);
    removeEventListener('pointercancel', finish, true);
    removeEventListener('blur', finishOnBlur);
  };

  panel.querySelector('[data-smaller]').addEventListener('click', () => {
    panel.dataset.manualSize = 'true';
    const rect = panel.getBoundingClientRect();
    setPanelSize(panel, rect.width * 0.88, rect.height * 0.88);
  });
  panel.querySelector('[data-larger]').addEventListener('click', () => {
    panel.dataset.manualSize = 'true';
    const rect = panel.getBoundingClientRect();
    setPanelSize(panel, rect.width * 1.12, rect.height * 1.12);
  });
}

document.getElementById('open-display').addEventListener('click', () => window.horizon.moveToDisplay(Number(displayPicker.value)));
document.getElementById('add-window').addEventListener('click', () => {
  const source = availableWindows.find((item) => item.id === windowPicker.value);
  captureWindow(source);
});
document.getElementById('refresh-windows').addEventListener('click', async (event) => {
  event.currentTarget.classList.add('active');
  await loadWindows(true).catch(() => {});
  event.currentTarget.classList.remove('active');
});
document.getElementById('open-widgets').addEventListener('click', () => {
  renderWidgetLibrary();
  widgetLibrary.showModal();
});
widgetLibrary.querySelector('[data-widgets-close]').addEventListener('click', () => widgetLibrary.close());
document.getElementById('fullscreen').addEventListener('click', () => window.horizon.toggleFullscreen());
document.getElementById('recenter').addEventListener('click', () => {
  centerWorkspace();
});
connectButton.addEventListener('click', () => {
  trackingEnabled = !trackingEnabled;
  connectButton.textContent = trackingEnabled ? '◎ Disconnect XREAL' : '◎ Connect XREAL';
  window.horizon.trackingControl(trackingEnabled ? 'connect' : 'disconnect');
  if (!trackingEnabled) trackingStatus.classList.remove('live');
});
function applyInputStatus(status) {
  inputEnabled = Boolean(status?.trusted);
  for (const captured of capturedWindows.values()) {
    captured.panel.querySelector('.capture-viewport').classList.toggle('input-enabled', inputEnabled);
  }
  enableInputButton.classList.toggle('enabled', inputEnabled);
  enableInputButton.textContent = inputEnabled ? '● App input enabled' : 'Grant Accessibility access';
  trackingState.textContent = inputEnabled
    ? 'App input live · click a captured window, then type or scroll'
    : 'Enable input-bridge in Privacy & Security → Accessibility';
  if (inputEnabled && permissionPoll) {
    clearInterval(permissionPoll);
    permissionPoll = null;
  }
}

async function refreshInputStatus() {
  try { applyInputStatus(await window.horizon.inputStatus()); } catch { /* bridge startup errors are shown below */ }
}

enableInputButton.addEventListener('click', async () => {
  const status = await window.horizon.enableInput();
  applyInputStatus(status);
  if (inputEnabled) return;
  await window.horizon.openInputSettings();
  if (permissionPoll) clearInterval(permissionPoll);
  const poll = setInterval(refreshInputStatus, 1500);
  permissionPoll = poll;
  setTimeout(() => {
    if (permissionPoll === poll) {
      clearInterval(poll);
      permissionPoll = null;
    }
  }, 120000);
});
function setHorizontalScale(value) {
  virtualScale = clamp(Number(value) || 2.25, Number(scaleInput.min), Number(scaleInput.max));
  scaleInput.value = String(virtualScale);
  workspace.style.width = `${virtualScale * 100}vw`;
  scaleOutput.value = `${virtualScale.toFixed(2).replace(/0$/, '')}×`;
  canvasReadout.textContent = `${virtualScale.toFixed(2).replace(/0$/, '')}× width · ${virtualHeightScale.toFixed(2).replace(/0$/, '')}× height`;
  minimapView.style.width = `${100 / virtualScale}%`;
}
scaleInput.addEventListener('input', () => {
  setHorizontalScale(scaleInput.value);
});
heightScaleInput.addEventListener('input', () => {
  virtualHeightScale = Number(heightScaleInput.value);
  workspace.style.height = `${virtualHeightScale * 100}%`;
  heightScaleOutput.value = `${virtualHeightScale.toFixed(2).replace(/0$/, '')}×`;
  canvasReadout.textContent = `${virtualScale.toFixed(2).replace(/0$/, '')}× width · ${virtualHeightScale.toFixed(2).replace(/0$/, '')}× height`;
  minimapView.style.height = `${100 / virtualHeightScale}%`;
});

window.horizon.onPose((pose) => {
  const labels = {
    calibrating: 'Hold still · calibrating IMU',
    tracking: 'XREAL One Pro · 3DoF live',
    connecting: 'Searching for XREAL Ethernet link…',
    disconnected: pose.message || 'No signal · view held'
  };
  trackingState.textContent = labels[pose.state] || 'Mouse simulation · right-drag to look';
  trackingStatus.classList.toggle('live', pose.state === 'tracking');
  if (pose.state === 'tracking' && Array.isArray(pose.quaternion)
      && pose.quaternion.length === 4 && pose.quaternion.every(Number.isFinite)) {
    const length = Math.hypot(...pose.quaternion);
    if (length > 0.5) {
      headQuaternion = pose.quaternion.map((value) => value / length);
      poseTime = performance.now();
    }
  }
});

addEventListener('pointermove', (event) => {
  if (event.target.closest?.('.capture-viewport')) return;
  if (!trackingEnabled && event.buttons === 2) {
    targetYaw -= event.movementX * 0.002;
    targetPitch -= event.movementY * 0.002;
  }
});
addEventListener('contextmenu', (event) => event.preventDefault());
addEventListener('keydown', (event) => {
  if (!trackingEnabled && event.key === 'ArrowLeft') targetYaw -= 0.08;
  if (!trackingEnabled && event.key === 'ArrowRight') targetYaw += 0.08;
  if (!trackingEnabled && event.key === 'ArrowUp') targetPitch -= 0.04;
  if (!trackingEnabled && event.key === 'ArrowDown') targetPitch += 0.04;
  if (event.key === '0') document.getElementById('recenter').click();
});

let previous = performance.now();
function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min((now - previous) / 1000, 0.05);
  previous = now;
  if (trackingEnabled && poseTime && now - poseTime < 250) {
    const angles = quaternionToYXZ(headQuaternion);
    targetYaw = angles.yaw;
    targetPitch = pitchStabilizer.update(angles.pitch, dt);
  } else if (trackingEnabled && poseTime && now - poseTime >= 250) {
    trackingState.textContent = 'Signal stale · view held';
  }

  const bounds = viewport.getBoundingClientRect();
  const view = headView.update(targetYaw, targetPitch, dt, bounds.width, bounds.height, 46, virtualScale, virtualHeightScale);
  targetYaw = view.targetYaw;
  targetPitch = view.targetPitch;
  workspace.style.transform = `translate3d(calc(-50% + ${view.x}px), calc(-50% + ${view.y}px), 0)`;
  const travel = view.maxPanX ? (-view.x + view.maxPanX) / (view.maxPanX * 2) : 0.5;
  const miniWidth = 100 / virtualScale;
  minimapView.style.left = `${Math.max(0, Math.min(100 - miniWidth, travel * (100 - miniWidth)))}%`;
  const verticalTravel = view.maxPanY ? (-view.y + view.maxPanY) / (view.maxPanY * 2) : 0.5;
  const miniHeight = 100 / virtualHeightScale;
  minimapView.style.top = `${Math.max(0, Math.min(100 - miniHeight, verticalTravel * (100 - miniHeight)))}%`;
}

loadDisplays().catch(() => {
  displayPicker.innerHTML = '<option>Current display</option>';
});
Promise.all([loadWindows(), window.horizon.isPreviewMode()]).then(async ([, previewMode]) => {
  if (!previewMode) return;
  const mock = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#071925"/><stop offset="1" stop-color="#02080d"/></linearGradient></defs><rect width="1200" height="700" fill="url(#g)"/><rect x="36" y="36" width="250" height="628" rx="18" fill="#0a2231" stroke="#2a7795"/><rect x="315" y="36" width="850" height="628" rx="18" fill="#06141e" stroke="#1f5a73"/><g fill="#66dfff" font-family="sans-serif"><text x="62" y="84" font-size="18">CODEX</text><text x="350" y="88" font-size="16">ACTIVE WORKSPACE</text></g><g fill="#88a8b7" font-family="monospace" font-size="15"><text x="62" y="138">Projects</text><text x="62" y="184">Tasks</text><text x="62" y="230">Agents</text><text x="350" y="150">Design a spatial application shell</text><text x="350" y="196">Inspecting workspace mechanics…</text></g><rect x="350" y="560" width="770" height="62" rx="31" fill="#0a2635" stroke="#3cb8e6"/><text x="382" y="598" fill="#91adba" font-family="sans-serif" font-size="16">Ask Codex anything…</text></svg>`;
  await captureWindow({ id: 'preview-window', name: 'Codex · Spatial workspace', appIcon: null, thumbnail: `data:image/svg+xml,${encodeURIComponent(mock)}` });
  renderSpatialMenu({ ok: true, app: { name: 'Codex' }, menus: [
    { title: 'Codex', items: [{ title: 'About Codex', enabled: true, path: [0, 0, 0] }, { separator: true }] },
    { title: 'File', items: [{ title: 'New Task', enabled: true, command: 'N', modifiers: ['command'], path: [1, 0, 0] }, { title: 'Open…', enabled: true, command: 'O', modifiers: ['command'], path: [1, 0, 1] }] },
    { title: 'Edit', items: [{ title: 'Undo', enabled: true, command: 'Z', modifiers: ['command'], path: [2, 0, 0] }] },
    { title: 'View', items: [{ title: 'Spatial Mode', enabled: true, mark: '✓', path: [3, 0, 0] }] },
    { title: 'Help', items: [{ title: 'XR Shell Help', enabled: true, path: [4, 0, 0] }] }
  ] }, 'preview-window');
  await handleAgentControl('add_note', { title: 'Spatial note', body: 'A2UI surfaces stay in XR Shell after the agent finishes. Drag this card anywhere; close it when you are done.', x: -520, y: -210, width: 330 });
}).catch(() => {
  windowPicker.innerHTML = '<option>Window capture unavailable</option>';
});
window.horizon.inputStatus().then(applyInputStatus).catch(() => {
  enableInputButton.textContent = 'Input bridge unavailable';
});
addEventListener('focus', refreshInputStatus);
window.horizon.onInputError((error) => {
  if (error === 'accessibility-permission-required') {
    inputEnabled = false;
    enableInputButton.classList.remove('enabled');
    enableInputButton.textContent = 'Enable app input';
    trackingState.textContent = 'Accessibility permission is required for app input';
  } else if (error === 'source-window-unavailable') {
    trackingState.textContent = 'Original app window is no longer available';
  }
});
window.horizon.onControlRequest(async ({ id, method, params }) => {
  try {
    const result = await handleAgentControl(method, params);
    window.horizon.respondControl({ id, ok: true, result });
  } catch (error) {
    window.horizon.respondControl({ id, ok: false, error: error.message });
  }
});
bindSpatialMenuDrag();
document.addEventListener('pointerdown', (event) => {
  if (!event.target.closest('.spatial-menu-group')) closeSpatialMenus();
});
window.horizon.onProfileUpdate(({ sourceId, snapshot, events, profilePath }) => {
  const captured = capturedWindows.get(sourceId);
  if (!captured?.profiling) return;
  applyProfileTheme(captured.panel, snapshot.theme);
  renderSemanticLayer(captured.panel, snapshot, events);
  if (events.length) trackingState.textContent = `${snapshot.app.name} · learned ${events.length} UI event${events.length === 1 ? '' : 's'} · ${profilePath.split('/').pop()}`;
});
window.horizon.onProfileEvent(({ sourceId, event }) => {
  const captured = capturedWindows.get(sourceId);
  if (!captured?.profiling) return;
  captured.panel.classList.remove('ax-event');
  requestAnimationFrame(() => captured.panel.classList.add('ax-event'));
  trackingState.textContent = `${event.event.replace(/^AX/, '')} · ${event.role.replace(/^AX/, '')}${event.label ? ` · ${event.label}` : ''}`;
});
window.horizon.onProfileStatus(({ sourceId, stage, appName, endsAt, eventCount, theme, fallback, error }) => {
  const captured = capturedWindows.get(sourceId);
  if (!captured) return;
  const button = captured.panel.querySelector('[data-profile]');
  if (stage === 'learning') {
    captured.profiling = true;
    captured.profileEndsAt = Number(endsAt) || Date.now() + 5 * 60 * 1000;
    button.classList.add('active');
    return;
  }
  if (stage === 'generating') {
    captured.profileEndsAt = 0;
    button.textContent = 'AI…';
    captured.panel.querySelector('footer b').textContent = `${eventCount || 0} EVENTS · CODEX DESIGNING THEME`;
    trackingState.textContent = `${appName} profile learned · Codex is designing its XR theme`;
    return;
  }
  captured.profiling = false;
  captured.profileEndsAt = 0;
  button.classList.remove('active');
  button.textContent = stage === 'complete' ? 'AX✓' : 'AX!';
  captured.panel.querySelector('.semantic-layer').classList.remove('visible');
  if (stage === 'complete' && theme) {
    applyProfileTheme(captured.panel, theme);
    captured.panel.querySelector('footer b').textContent = `${eventCount || 0} AX EVENTS · ${fallback ? 'ADAPTIVE' : 'CODEX'} THEME`;
    trackingState.textContent = `${appName} XR theme installed${fallback ? ' using the local fallback' : ' by Codex'}`;
    requestAnimationFrame(() => showThemeIntensity(captured.panel, appName));
  } else {
    trackingState.textContent = `Theme learning failed · ${error || 'unknown error'}`;
  }
});
window.horizon.onChatEvent((event) => {
  const session = sessions.find((item) => item.clientId === event.clientId);
  if (!session) return;
  if (event.type === 'thread') session.threadId = event.threadId;
  if (event.type === 'status') session.status = event.status === 'agent_message' ? 'working' : event.status;
  if (event.type === 'message') session.messages.push({ role: 'assistant', text: event.text });
  if (event.type === 'error') {
    session.status = 'error';
    session.messages.push({ role: 'error', text: event.error });
  }
  if (event.type === 'done' && session.status !== 'error') session.status = 'complete';
  session.updatedAt = Date.now();
  saveSessions();
  renderSessions();
  if (activeSessionId === session.clientId) renderChat(session);
});
chatSend.addEventListener('click', submitChat);
chatInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submitChat(); }
});
document.getElementById('new-session').addEventListener('click', () => {
  createChatSession();
});
document.getElementById('open-profiles').addEventListener('click', async () => {
  if (intensityDialog.open) closeIntensity(false);
  profileLibraryDetail.textContent = 'Select View profile or View recording to inspect its local JSON.';
  await renderProfileLibrary();
  profileLibrary.showModal();
});
profileLibrary.querySelector('[data-library-close]').addEventListener('click', () => profileLibrary.close());
intensityInput.addEventListener('input', () => updateIntensityPreview(intensityInput.value));
intensityDialog.querySelector('[data-intensity-close]').addEventListener('click', () => closeIntensity(true));
intensityDialog.querySelector('[data-intensity-off]').addEventListener('click', () => {
  if (intensityPanel) {
    setThemeIntensity(intensityPanel, intensityInput.value, false);
    setVisualMode(intensityPanel, 'pass', true);
  }
  closeIntensity(false);
});
intensityDialog.querySelector('[data-intensity-apply]').addEventListener('click', () => {
  if (intensityPanel) {
    setThemeIntensity(intensityPanel, intensityInput.value, false);
    setVisualMode(intensityPanel, 'theme', true);
  }
  closeIntensity(false);
});
intensityDialog.addEventListener('cancel', (event) => {
  event.preventDefault();
  closeIntensity(true);
});
document.querySelectorAll('.quick-actions [data-prompt]').forEach((button) => button.addEventListener('click', () => {
  chatInput.value = button.dataset.prompt;
  chatInput.focus();
}));
renderSessions();
renderChat(sessions.find((item) => item.clientId === activeSessionId) || null);
setInterval(() => {
  if (document.visibilityState === 'visible') loadWindows().catch(() => {});
}, 2000);
setInterval(() => {
  if (document.visibilityState === 'visible' && !menuRoot.querySelector('.spatial-menu-group.open')) refreshSpatialMenu();
}, 3000);
setInterval(() => {
  for (const captured of capturedWindows.values()) {
    if (!captured.profiling || !captured.profileEndsAt) continue;
    const remaining = Math.max(0, captured.profileEndsAt - Date.now());
    const seconds = Math.ceil(remaining / 1000);
    const button = captured.panel.querySelector('[data-profile]');
    button.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    captured.panel.querySelector('footer b').textContent = `${seconds ? 'LEARNING AX PATTERNS' : 'FINALIZING PROFILE'} · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }
}, 1000);
requestAnimationFrame(animate);
