'use strict';

const { HeadView, PitchStabilizer } = requireRendererHeadView();

function requireRendererHeadView() {
  // Renderer remains sandboxed; this small copy mirrors the tested projection
  // helper without exposing Node or Electron APIs.
  class RendererHeadView {
    constructor() { this.yaw = 0; this.pitch = 0; }
    reset() { this.yaw = 0; this.pitch = 0; }
    update(yaw, pitch, dt, width, height, fov, scale) {
      const focal = height / (2 * Math.tan(fov * Math.PI / 360));
      const maxPanX = width * Math.max(0, scale - 1) / 2;
      const maxPanY = height * 0.08;
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
const canvasReadout = document.getElementById('canvas-readout');
const minimapView = document.getElementById('minimap-view');
const connectButton = document.getElementById('connect');
const enableInputButton = document.getElementById('enable-input');
const windowPicker = document.getElementById('window-picker');
const appStage = document.getElementById('app-stage');
const chatInput = document.getElementById('chat-input');
const chatSend = document.getElementById('chat-send');
const chatResponse = document.getElementById('chat-response');
const sessionList = document.getElementById('session-list');

const headView = new HeadView();
const pitchStabilizer = new PitchStabilizer();
let targetYaw = 0;
let targetPitch = 0;
let trackingEnabled = false;
let poseTime = 0;
let headQuaternion = [0, 0, 0, 1];
let virtualScale = Number(scaleInput.value);
let availableWindows = [];
const capturedWindows = new Map();
let inputEnabled = false;
let activeCaptureId = null;
let lastDragSent = 0;
let permissionPoll = null;
let sessions = [];
let activeSessionId = null;
try { sessions = JSON.parse(localStorage.getItem('xr-shell:sessions') || '[]'); } catch { sessions = []; }

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

async function loadWindows() {
  const selected = windowPicker.value;
  availableWindows = await window.horizon.listWindows();
  if (!availableWindows.length) {
    const permission = await window.horizon.capturePermission();
    windowPicker.innerHTML = `<option value="">${permission === 'denied' ? 'Enable Screen Recording in System Settings' : 'No capturable windows found'}</option>`;
    return;
  }
  windowPicker.innerHTML = '<option value="">Choose an app window…</option>' + availableWindows
    .map((source) => `<option value="${escapeHtml(source.id)}">${escapeHtml(source.name)}</option>`)
    .join('');
  if (availableWindows.some((source) => source.id === selected)) windowPicker.value = selected;
}

async function captureWindow(source) {
  if (!source || capturedWindows.has(source.id)) return;
  if (capturedWindows.size >= 3) {
    trackingState.textContent = 'POC limit reached · remove a window before adding another';
    return;
  }

  const panel = document.createElement('article');
  panel.className = 'captured-window glass';
  panel.innerHTML = `
    <header title="Drag to move this window in the workspace"><div class="capture-title">${source.appIcon ? `<img src="${source.appIcon}" alt="" />` : '<i></i>'}<div><small>HOLOGRAPHIC WINDOW LINK · GRAB TO MOVE</small><span>${escapeHtml(source.name)}</span></div></div><div class="capture-actions"><em>● LIVE</em><button type="button" data-profile aria-label="Learn accessibility profile">AX</button><button type="button" data-smaller aria-label="Make window smaller">−</button><button type="button" data-larger aria-label="Make window larger">+</button><button type="button" data-fx>FX</button><button type="button" data-remove aria-label="Remove window">×</button></div></header>
    <div class="capture-viewport">${source.thumbnail ? `<img class="capture-placeholder" src="${source.thumbnail}" alt="Preview of ${escapeHtml(source.name)}" />` : '<div class="capture-empty"><strong>SCREEN RECORDING REQUIRED</strong>Allow access in Privacy & Security, then add this window again.</div>'}<div class="semantic-layer" aria-hidden="true"></div><div class="xr-cursor" aria-hidden="true"><i></i></div><div class="capture-overlay"><i></i><i></i><i></i><i></i><span>OPTICAL FEED · SECURE</span></div></div>
    <footer><span>30 FPS · GLASS-02 · MIRRORED SURFACE</span><b>DRAG CORNER TO RESIZE</b></footer><div class="resize-grip" title="Drag to resize" aria-hidden="true"></div>`;
  appStage.append(panel);
  capturedWindows.set(source.id, { panel, stream: null, profiling: false, profileEndsAt: 0 });
  window.horizon.themeForApp(source.name).then((theme) => {
    if (theme && capturedWindows.has(source.id)) applyProfileTheme(panel, theme);
  });
  panel.querySelector('.capture-viewport').classList.toggle('input-enabled', inputEnabled);
  panel.querySelector('[data-remove]').addEventListener('click', () => removeCapturedWindow(source.id));
  panel.querySelector('[data-fx]').addEventListener('click', () => panel.classList.toggle('clean'));
  bindCapturedInput(source.id, panel);
  bindSpatialControls(source.id, panel);
  bindProfileControls(source.id, panel);
  layoutCapturedWindows();
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
    await video.play();
  } catch (error) {
    const permission = await window.horizon.capturePermission();
    trackingState.textContent = permission === 'denied'
      ? 'Screen Recording denied · enable it in System Settings'
      : 'Could not start live capture · preview retained';
  }
}

function removeCapturedWindow(id) {
  const captured = capturedWindows.get(id);
  if (!captured) return;
  captured.stream?.getTracks().forEach((track) => track.stop());
  captured.resizeObserver?.disconnect();
  if (captured.profiling) window.horizon.toggleProfile(id, false);
  captured.panel.remove();
  capturedWindows.delete(id);
  if (activeCaptureId === id) activeCaptureId = null;
  layoutCapturedWindows();
  centerWorkspace();
}

function semanticLabel(element) {
  return element.title || element.description || element.placeholder
    || (element.role === 'AXStaticText' ? element.value : '') || '';
}

function applyProfileTheme(panel, theme) {
  if (!theme?.palette) return;
  panel.classList.add('profile-themed');
  panel.dataset.motif = theme.motif || 'system';
  panel.style.setProperty('--profile-accent', theme.palette.accent);
  panel.style.setProperty('--profile-secondary', theme.palette.secondary);
  panel.style.setProperty('--profile-surface', theme.palette.surface);
  panel.style.setProperty('--profile-line', theme.palette.line);
  panel.style.setProperty('--profile-ink', theme.palette.ink);
  panel.style.setProperty('--profile-video-filter', theme.videoFilter);
  panel.querySelector('.capture-title small').textContent = `${String(theme.name || 'XR PROFILE').toUpperCase()} · GRAB TO MOVE`;
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
  const positions = items.length === 1 ? [0] : items.length === 2 ? [-43, 43] : [-66, 0, 66];
  items.forEach((item, index) => {
    const position = positions[index];
    item.panel.dataset.slot = String(index);
    item.panel.style.setProperty('--slot-x', `${position}vw`);
    item.panel.style.setProperty('--tilt', `${position === 0 ? 0 : position < 0 ? 2.5 : -2.5}deg`);
  });
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
  for (const session of sessions.slice(0, 6)) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `session-row${session.clientId === activeSessionId ? ' active' : ''}`;
    const indicator = document.createElement('i');
    indicator.className = ['starting', 'working', 'command_execution'].includes(session.status) ? 'running' : '';
    indicator.textContent = session.status === 'complete' ? '✓' : '◌';
    const copy = document.createElement('p');
    const title = document.createElement('strong');
    title.textContent = session.title;
    const detail = document.createElement('small');
    detail.textContent = session.status === 'complete' ? 'Ready to continue' : session.status;
    copy.append(title, detail);
    const time = document.createElement('time');
    time.textContent = relativeSessionTime(session.updatedAt);
    row.append(indicator, copy, time);
    row.addEventListener('click', () => { activeSessionId = session.clientId; renderSessions(); renderChat(session); });
    sessionList.append(row);
  }
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
  panel.style.setProperty('--panel-width', `${clamp(width, 360, maxWidth)}px`);
  panel.style.setProperty('--panel-height', `${clamp(height, 260, maxHeight)}px`);
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
    if (!gesture) return;
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    if (gesture.mode === 'resize') {
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
    if (!gesture) return;
    gesture = null;
    panel.classList.remove('positioning');
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  header.addEventListener('pointerdown', (event) => begin(event, 'move'));
  header.addEventListener('pointermove', update);
  header.addEventListener('pointerup', finish);
  header.addEventListener('pointercancel', finish);
  grip.addEventListener('pointerdown', (event) => begin(event, 'resize'));
  grip.addEventListener('pointermove', update);
  grip.addEventListener('pointerup', finish);
  grip.addEventListener('pointercancel', finish);

  panel.querySelector('[data-smaller]').addEventListener('click', () => {
    const rect = panel.getBoundingClientRect();
    setPanelSize(panel, rect.width * 0.88, rect.height * 0.88);
  });
  panel.querySelector('[data-larger]').addEventListener('click', () => {
    const rect = panel.getBoundingClientRect();
    setPanelSize(panel, rect.width * 1.12, rect.height * 1.12);
  });
}

document.getElementById('open-display').addEventListener('click', () => window.horizon.moveToDisplay(Number(displayPicker.value)));
document.getElementById('add-window').addEventListener('click', () => {
  const source = availableWindows.find((item) => item.id === windowPicker.value);
  captureWindow(source);
});
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
scaleInput.addEventListener('input', () => {
  virtualScale = Number(scaleInput.value);
  workspace.style.width = `${virtualScale * 100}vw`;
  scaleOutput.value = `${virtualScale.toFixed(2).replace(/0$/, '')}×`;
  canvasReadout.textContent = `${virtualScale.toFixed(2).replace(/0$/, '')}× physical width`;
  minimapView.style.width = `${100 / virtualScale}%`;
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
  const view = headView.update(targetYaw, targetPitch, dt, bounds.width, bounds.height, 46, virtualScale);
  targetYaw = view.targetYaw;
  targetPitch = view.targetPitch;
  workspace.style.transform = `translate3d(calc(-50% + ${view.x}px), ${view.y}px, 0)`;
  const travel = view.maxPanX ? (-view.x + view.maxPanX) / (view.maxPanX * 2) : 0.5;
  const miniWidth = 100 / virtualScale;
  minimapView.style.left = `${Math.max(0, Math.min(100 - miniWidth, travel * (100 - miniWidth)))}%`;
}

loadDisplays().catch(() => {
  displayPicker.innerHTML = '<option>Current display</option>';
});
Promise.all([loadWindows(), window.horizon.isPreviewMode()]).then(([, previewMode]) => {
  if (!previewMode) return;
  const mock = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#071925"/><stop offset="1" stop-color="#02080d"/></linearGradient></defs><rect width="1200" height="700" fill="url(#g)"/><rect x="36" y="36" width="250" height="628" rx="18" fill="#0a2231" stroke="#2a7795"/><rect x="315" y="36" width="850" height="628" rx="18" fill="#06141e" stroke="#1f5a73"/><g fill="#66dfff" font-family="sans-serif"><text x="62" y="84" font-size="18">CODEX</text><text x="350" y="88" font-size="16">ACTIVE WORKSPACE</text></g><g fill="#88a8b7" font-family="monospace" font-size="15"><text x="62" y="138">Projects</text><text x="62" y="184">Tasks</text><text x="62" y="230">Agents</text><text x="350" y="150">Design a spatial application shell</text><text x="350" y="196">Inspecting workspace mechanics…</text></g><rect x="350" y="560" width="770" height="62" rx="31" fill="#0a2635" stroke="#3cb8e6"/><text x="382" y="598" fill="#91adba" font-family="sans-serif" font-size="16">Ask Codex anything…</text></svg>`;
  captureWindow({ id: 'preview-window', name: 'Codex · Spatial workspace', appIcon: null, thumbnail: `data:image/svg+xml,${encodeURIComponent(mock)}` });
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
  activeSessionId = null;
  renderSessions();
  renderChat(null);
  chatInput.focus();
});
document.querySelectorAll('.quick-actions [data-prompt]').forEach((button) => button.addEventListener('click', () => {
  chatInput.value = button.dataset.prompt;
  chatInput.focus();
}));
renderSessions();
renderChat(sessions.find((item) => item.clientId === activeSessionId) || null);
setInterval(() => {
  if (document.visibilityState === 'visible' && document.activeElement !== windowPicker) loadWindows().catch(() => {});
}, 4000);
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
