'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { UsageAnalytics, GA_MEASUREMENT_ID } = require('../usage-analytics');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xr-shell-analytics-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const events = [];
  let now = 0;
  let closed = 0;
  const options = {
    filePath: path.join(directory, 'consent.json'),
    version: '0.1.0',
    enabled: true,
    clock: () => now,
    createTransport: (id, clientId) => {
      assert.equal(id, GA_MEASUREMENT_ID);
      assert.ok(clientId);
      return { send: (name, params) => events.push({ name, params }), close: () => { closed++; } };
    }
  };
  return { options, events, advance: (ms) => { now += ms; }, get closed() { return closed; } };
}

test('usage analytics sends nothing until explicit approval and never reports prior time', (t) => {
  const f = fixture(t);
  const analytics = new UsageAnalytics(f.options);
  analytics.start();
  analytics.focus();
  f.advance(40000);
  analytics.blur();
  assert.deepEqual(f.events, []);
  analytics.setConsent('denied');
  analytics.start();
  assert.deepEqual(f.events, []);
  analytics.setConsent('granted');
  assert.deepEqual(f.events.map((event) => event.name), ['xr_install', 'xr_app_open']);
  analytics.focus();
  f.advance(5000);
  analytics.blur();
  assert.deepEqual(f.events[2], {
    name: 'xr_active_time',
    params: { app_version: '0.1.0', duration_seconds: 5, engagement_time_msec: 5000 }
  });
  f.advance(3000);
  analytics.shutdown();
  assert.equal(f.events.length, 3, 'unfocused time is not collected');
});

test('install is reported once, open on each launch, and revocation stops collection', (t) => {
  const f = fixture(t);
  const first = new UsageAnalytics(f.options);
  first.setConsent('granted');
  first.shutdown();
  const second = new UsageAnalytics(f.options);
  second.start();
  assert.deepEqual(f.events.map((event) => event.name), ['xr_install', 'xr_app_open', 'xr_app_open']);
  second.setConsent('denied');
  second.focus();
  f.advance(60000);
  second.blur();
  assert.equal(f.events.length, 3);
  assert.equal(f.closed, 2);
  assert.deepEqual(new UsageAnalytics(f.options).status(), { available: true, consent: 'denied' });
});

test('disabled development build never sends or accepts consent', (t) => {
  const f = fixture(t);
  const analytics = new UsageAnalytics({ ...f.options, enabled: false });
  analytics.start();
  analytics.focus();
  assert.throws(() => analytics.setConsent('granted'), /unavailable/);
  assert.deepEqual(f.events, []);
});

test('a consent record from the pre-HTTP tag retries its first-use event', (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.options.filePath, JSON.stringify({ consent: 'granted', clientId: 'prior-id', installReported: true }));
  const analytics = new UsageAnalytics(f.options);
  analytics.start();
  assert.deepEqual(f.events.map((event) => event.name), ['xr_install', 'xr_app_open']);
  analytics.shutdown();
});
