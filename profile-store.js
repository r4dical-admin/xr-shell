'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { compileTheme } = require('./theme-engine');

function safeName(value) {
  return String(value || 'unknown-app').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 120);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function elementLabel(element) {
  return element.title || element.description || element.placeholder || '';
}

function frameChanged(left, right) {
  if (!left || !right) return true;
  return ['x', 'y', 'width', 'height'].some((key) => Math.abs(Number(left[key]) - Number(right[key])) > 0.002);
}

function diffSnapshots(previous, current) {
  if (!previous?.elements || !current?.elements) return [];
  const before = new Map(previous.elements.map((element) => [element.id, element]));
  const after = new Map(current.elements.map((element) => [element.id, element]));
  const events = [];
  for (const [id, element] of after) {
    const old = before.get(id);
    if (!old) events.push({ type: 'elementCreated', id, role: element.role });
    else {
      if (frameChanged(old.frame, element.frame)) events.push({ type: 'layoutChanged', id, role: element.role });
      if (JSON.stringify(old.state) !== JSON.stringify(element.state)) events.push({ type: 'stateChanged', id, role: element.role });
      if (old.value !== element.value) events.push({ type: 'valueChanged', id, role: element.role });
      if (element.state?.focused && !old.state?.focused) events.push({ type: 'focusChanged', id, role: element.role });
    }
  }
  for (const [id, element] of before) {
    if (!after.has(id)) events.push({ type: 'elementDestroyed', id, role: element.role });
  }
  return events.slice(0, 120).map((event) => ({ ...event, at: current.capturedAt }));
}

function aggregateEvents(previous = {}, events = []) {
  const result = {
    total: Number(previous.total) || 0,
    byType: { ...(previous.byType || {}) },
    byRole: { ...(previous.byRole || {}) },
    interactions: { ...(previous.interactions || {}) },
    firstObservedAt: previous.firstObservedAt || null,
    lastObservedAt: previous.lastObservedAt || null
  };
  for (const event of events) {
    const type = String(event.type || 'unknown').slice(0, 80);
    const role = String(event.role || 'AXUnknown').slice(0, 80);
    result.total += 1;
    result.byType[type] = (result.byType[type] || 0) + 1;
    result.byRole[role] = (result.byRole[role] || 0) + 1;
    const interaction = `${type}:${role}`;
    result.interactions[interaction] = (result.interactions[interaction] || 0) + 1;
    if (!result.firstObservedAt) result.firstObservedAt = event.at || new Date().toISOString();
    result.lastObservedAt = event.at || new Date().toISOString();
  }
  return result;
}

function summarizeSnapshot(snapshot, existing = null, events = []) {
  const roles = {};
  const samples = {};
  const allActions = [];
  const allAttributes = [];
  const allParameterized = [];
  for (const element of snapshot.elements || []) {
    const role = element.role || 'AXUnknown';
    roles[role] = (roles[role] || 0) + 1;
    allActions.push(...(element.actions || []));
    allAttributes.push(...(element.attributes || []));
    allParameterized.push(...(element.parameterizedAttributes || []));
    const label = elementLabel(element);
    if (label) {
      samples[role] ||= [];
      if (!samples[role].includes(label) && samples[role].length < 12) samples[role].push(label);
    }
  }
  const previousEvents = existing?.capabilities?.observedEvents || [];
  const observedEvents = unique([...previousEvents, ...events.map((event) => event.type)]);
  return {
    schemaVersion: 1,
    app: {
      bundleId: snapshot.app.bundleId,
      name: snapshot.app.name
    },
    updatedAt: new Date(snapshot.capturedAt || Date.now()).toISOString(),
    capabilities: {
      roles,
      actions: unique([...(existing?.capabilities?.actions || []), ...allActions]),
      attributes: unique([...(existing?.capabilities?.attributes || []), ...allAttributes]),
      parameterizedAttributes: unique([...(existing?.capabilities?.parameterizedAttributes || []), ...allParameterized]),
      supportedNotifications: unique([...(existing?.capabilities?.supportedNotifications || []), ...(snapshot.supportedNotifications || [])]),
      observedEvents,
      eventSources: ['AXObserver', 'accessibility-snapshot-diff']
    },
    eventPatterns: aggregateEvents(existing?.eventPatterns, events),
    roleSamples: { ...(existing?.roleSamples || {}), ...samples },
    xrTheme: existing?.xrTheme?.version >= 2 ? existing.xrTheme : compileTheme({ app: snapshot.app, capabilities: { roles } }),
    latestLayout: (snapshot.elements || []).map((element) => ({
      id: element.id,
      role: element.role,
      subrole: element.subrole,
      label: elementLabel(element),
      frame: element.frame,
      actions: element.actions,
      stateKeys: Object.keys(element.state || {})
    }))
  };
}

class ProfileStore {
  constructor(directory) {
    this.directory = directory;
  }

  save(snapshot, events = []) {
    fs.mkdirSync(this.directory, { recursive: true });
    const filename = `${safeName(snapshot.app.bundleId)}.json`;
    const outputPath = path.join(this.directory, filename);
    let existing = null;
    try { existing = JSON.parse(fs.readFileSync(outputPath, 'utf8')); } catch { /* first capture */ }
    const profile = summarizeSnapshot(snapshot, existing, events);
    fs.writeFileSync(outputPath, `${JSON.stringify(profile, null, 2)}\n`);
    return { profile, outputPath };
  }

  themeForAppName(appName) {
    let filenames = [];
    try { filenames = fs.readdirSync(this.directory).filter((name) => name.endsWith('.json')); } catch { return null; }
    const requested = String(appName || '').toLowerCase();
    for (const filename of filenames) {
      try {
        const profile = JSON.parse(fs.readFileSync(path.join(this.directory, filename), 'utf8'));
        const known = String(profile.app?.name || '').toLowerCase();
        if (known && (requested.includes(known) || known.includes(requested))) {
          return profile.xrTheme?.version >= 2 ? profile.xrTheme : compileTheme(profile);
        }
      } catch { /* skip malformed profile */ }
    }
    return null;
  }

  installTheme(bundleId, theme) {
    const outputPath = path.join(this.directory, `${safeName(bundleId)}.json`);
    const profile = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
    profile.xrTheme = theme;
    profile.updatedAt = new Date().toISOString();
    fs.writeFileSync(outputPath, `${JSON.stringify(profile, null, 2)}\n`);
    return { profile, outputPath };
  }

  entries() {
    let filenames = [];
    try { filenames = fs.readdirSync(this.directory).filter((name) => name.endsWith('.json')); } catch { return []; }
    const entries = [];
    for (const filename of filenames) {
      try {
        const outputPath = path.join(this.directory, filename);
        const profile = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
        if (profile.app?.bundleId) entries.push({ filename, outputPath, profile });
      } catch { /* skip malformed or unreadable profiles */ }
    }
    return entries;
  }

  list() {
    return this.entries().map(({ profile }) => ({
      bundleId: profile.app.bundleId,
      name: profile.app.name,
      updatedAt: profile.updatedAt,
      themeName: profile.xrTheme?.name || null,
      themeVersion: profile.xrTheme?.version || null,
      roleCount: Object.keys(profile.capabilities?.roles || {}).length,
      nodeCount: (profile.latestLayout || []).length,
      eventCount: Number(profile.eventPatterns?.total) || 0,
      hasRecording: Boolean((profile.latestLayout || []).length || Number(profile.eventPatterns?.total))
    })).sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
  }

  details(bundleId, kind = 'profile') {
    const entry = this.entries().find(({ profile }) => profile.app.bundleId === bundleId);
    if (!entry) return null;
    if (kind === 'recording') {
      return {
        app: entry.profile.app,
        updatedAt: entry.profile.updatedAt,
        eventPatterns: entry.profile.eventPatterns || {},
        roleSamples: entry.profile.roleSamples || {},
        latestLayout: entry.profile.latestLayout || []
      };
    }
    return entry.profile;
  }

  delete(bundleId) {
    const entry = this.entries().find(({ profile }) => profile.app.bundleId === bundleId);
    if (!entry) return false;
    fs.unlinkSync(entry.outputPath);
    return true;
  }

  clearRecording(bundleId) {
    const entry = this.entries().find(({ profile }) => profile.app.bundleId === bundleId);
    if (!entry) return false;
    entry.profile.eventPatterns = aggregateEvents();
    entry.profile.roleSamples = {};
    entry.profile.latestLayout = [];
    if (entry.profile.capabilities) entry.profile.capabilities.observedEvents = [];
    entry.profile.recordingClearedAt = new Date().toISOString();
    fs.writeFileSync(entry.outputPath, `${JSON.stringify(entry.profile, null, 2)}\n`);
    return true;
  }
}

module.exports = { ProfileStore, aggregateEvents, diffSnapshots, summarizeSnapshot };
