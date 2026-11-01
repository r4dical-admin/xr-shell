'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');

const GA_MEASUREMENT_ID = 'G-HP3GB9SYXQ';
const ACTIVE_REPORT_INTERVAL_MS = 60 * 1000;
const ANALYTICS_ORIGIN = 'http://xr-shell.localhost';
const CONSENT_SCHEMA_VERSION = 2;
let analyticsProtocolRegistered = false;

function readConsent(filePath) {
  try {
    const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (saved?.consent === 'granted' && typeof saved.clientId === 'string' && saved.clientId.length < 100) {
      return { consent: 'granted', clientId: saved.clientId,
        installReported: saved.schemaVersion === CONSENT_SCHEMA_VERSION && saved.installReported === true };
    }
    if (saved?.consent === 'denied') return { consent: 'denied', clientId: null, installReported: false };
  } catch { /* A missing or unreadable preference is treated as no consent. */ }
  return { consent: 'unset', clientId: null, installReported: false };
}

class UsageAnalytics {
  constructor(options) {
    this.filePath = options.filePath;
    this.version = options.version;
    this.enabled = options.enabled;
    this.createTransport = options.createTransport;
    this.clock = options.clock || (() => performance.now());
    this.state = readConsent(this.filePath);
    this.transport = null;
    this.openReported = false;
    this.activeSince = null;
    this.timer = null;
  }

  status() {
    return { available: this.enabled, consent: this.state.consent };
  }

  save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify({ ...this.state, schemaVersion: CONSENT_SCHEMA_VERSION }), { mode: 0o600 });
  }

  setConsent(choice) {
    if (!this.enabled || !['granted', 'denied'].includes(choice)) throw new Error('Analytics choice unavailable');
    if (choice === 'denied') {
      this.flushActive(false);
      this.state = { consent: 'denied', clientId: null, installReported: false };
      this.openReported = false;
      this.save();
      this.stopTransport();
      return this.status();
    }
    if (this.state.consent !== 'granted') {
      this.state = { consent: 'granted', clientId: randomUUID(), installReported: false };
      this.save();
    }
    this.start();
    return this.status();
  }

  start() {
    if (!this.enabled || this.state.consent !== 'granted') return;
    if (!this.transport) this.transport = this.createTransport(GA_MEASUREMENT_ID, this.state.clientId);
    if (!this.timer) this.timer = setInterval(() => this.flushActive(), ACTIVE_REPORT_INTERVAL_MS);
    if (!this.state.installReported) {
      this.send('xr_install');
      this.state.installReported = true;
      this.save();
    }
    if (!this.openReported) {
      this.send('xr_app_open');
      this.openReported = true;
    }
  }

  focus() {
    this.start();
    if (this.enabled && this.state.consent === 'granted' && this.activeSince === null) this.activeSince = this.clock();
  }

  blur() { this.flushActive(false); }

  flushActive(resume = true) {
    if (this.activeSince === null) return;
    const elapsed = Math.max(0, Math.round(this.clock() - this.activeSince));
    this.activeSince = null;
    if (elapsed >= 1000) this.send('xr_active_time', {
      duration_seconds: Math.round(elapsed / 1000),
      engagement_time_msec: elapsed
    });
    if (resume && this.enabled && this.state.consent === 'granted') this.activeSince = this.clock();
  }

  send(name, params = {}) {
    if (!this.enabled || this.state.consent !== 'granted' || !this.transport) return;
    this.transport.send(name, { app_version: this.version, ...params });
  }

  stopTransport() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.activeSince = null;
    this.transport?.close();
    this.transport = null;
  }

  closeWindow() {
    this.blur();
    this.stopTransport();
  }

  shutdown() { this.closeWindow(); }
}

function createGoogleTagTransport(BrowserWindow, analyticsSession, measurementId, clientId) {
  if (!analyticsProtocolRegistered) {
    analyticsSession.protocol.handle('http', (request) => {
      const url = new URL(request.url);
      if (url.origin !== ANALYTICS_ORIGIN || request.method !== 'GET') return new Response('Not found', { status: 404 });
      const resource = url.pathname === '/analytics.html' ? 'analytics.html'
        : url.pathname === '/analytics-renderer.js' ? 'analytics-renderer.js' : null;
      if (!resource) return new Response('Not found', { status: 404 });
      return new Response(fs.readFileSync(path.join(__dirname, resource)), {
        headers: { 'content-type': resource.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8',
          'cache-control': 'no-store' }
      });
    });
    analyticsProtocolRegistered = true;
  }
  const window = new BrowserWindow({
    show: false,
    width: 1,
    height: 1,
    skipTaskbar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, session: analyticsSession }
  });
  let active = true;
  const ready = new Promise((resolve, reject) => {
    window.webContents.once('did-finish-load', resolve);
    window.webContents.once('did-fail-load', (_event, _code, description) => reject(new Error(description)));
  });
  const pageUrl = new URL('/analytics.html', ANALYTICS_ORIGIN);
  pageUrl.searchParams.set('id', measurementId);
  pageUrl.searchParams.set('clientId', clientId);
  window.loadURL(pageUrl.toString()).catch(() => {});
  let queue = Promise.resolve();
  return {
    send(name, params) {
      queue = queue.then(() => ready).then(() => {
        if (!active || window.isDestroyed()) return;
        return window.webContents.executeJavaScript(`window.xrAnalyticsSend(${JSON.stringify(name)}, ${JSON.stringify(params)})`);
      }).catch(() => {});
    },
    close() {
      active = false;
      if (!window.isDestroyed()) window.destroy();
    }
  };
}

module.exports = { UsageAnalytics, GA_MEASUREMENT_ID, createGoogleTagTransport };
