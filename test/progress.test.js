'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore, prepare, configure, report, presentation } = require('../progress');
const { parseArgs, sendProgress } = require('../bin/xr-shell-progress');
const { ControlServer } = require('../control-server');
const { PROGRESS_METHODS } = require('../progress-socket');

test('a prepared progress job reports changing totals without an agent turn', () => {
  const store = createStore();
  assert.equal(prepare(store, { jobId: 'ide_import', title: 'IDE import' }, 1000).status, 'waiting');
  assert.equal(report(store, 'start', { jobId: 'ide_import', total: 8 }, 2000).remaining, 8);
  const updated = report(store, 'update', { jobId: 'ide_import', completed: 3, total: 10, metrics: { files: 120 } }, 32000);
  assert.equal(updated.remaining, 7);
  assert.equal(updated.etaSeconds, 70);
  assert.equal(updated.metrics.files, 120);
  assert.match(presentation(updated).headline, /7 runs remaining/);
  assert.match(presentation(configure(store, { jobId: 'ide_import', view: 'eta' }, 32000)).headline, /left/);
  const completed = report(store, 'finish', { jobId: 'ide_import', status: 'success' }, 42000);
  assert.equal(completed.status, 'succeeded');
  assert.equal(completed.remaining, 0);
  assert.equal(report(store, 'start', { jobId: 'ide_import', total: 2 }, 50000).runNumber, 2);
});

test('progress jobs isolate failures and reject unprepared or malformed reports', () => {
  const store = createStore();
  prepare(store, { jobId: 'one' });
  prepare(store, { jobId: 'two' });
  report(store, 'start', { jobId: 'one', total: 2 });
  report(store, 'start', { jobId: 'two', total: 3 });
  assert.equal(report(store, 'finish', { jobId: 'one', status: 'failure', message: 'Stopped' }).status, 'failed');
  assert.equal(store.get('two').status, 'running');
  assert.throws(() => report(store, 'update', { jobId: 'missing', completed: 1 }), /not prepared/);
  assert.throws(() => report(store, 'update', { jobId: 'two', completed: -1 }), /non-negative/);
  assert.throws(() => report(store, 'update', { jobId: 'two', completed: 1, metrics: { bad: {} } }), /Invalid metric/);
  assert.throws(() => report(store, 'update', { jobId: 'two', completed: 1, metrics: JSON.parse('{"__proto__":"unsafe"}') }), /Invalid metric/);
});

test('script command parses the reporting contract', () => {
  assert.deepEqual(parseArgs(['update', '--job', 'ide_import', '--completed', '3', '--total', '10', '--metrics-json', '{"files":120}']), {
    method: 'progress_update', params: { jobId: 'ide_import', completed: 3, total: 10, metrics: { files: 120 } }, required: false
  });
  assert.throws(() => parseArgs(['start', '--job', 'ide_import']), /requires --total/);
  assert.throws(() => parseArgs(['finish', '--job', 'ide_import']), /requires --status/);
});

test('the dedicated progress socket accepts reports and rejects other control methods', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xr-shell-progress-test-'));
  const socketPath = path.join(directory, 'progress.sock');
  const server = new ControlServer({ socketPath, onRequest: (method, params) => {
    if (!PROGRESS_METHODS.has(method)) throw new Error('Unsupported progress command');
    return { method, params };
  } });
  try {
    server.start();
    await new Promise((resolve, reject) => {
      if (server.server.listening) return resolve();
      server.server.once('listening', resolve);
      server.server.once('error', reject);
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(fs.statSync(socketPath).mode & 0o777, 0o600);
    const result = await sendProgress('progress_start', { jobId: 'ide_import', total: 3 }, socketPath);
    assert.equal(result.method, 'progress_start');
    await assert.rejects(sendProgress('get_layout', {}, socketPath), /Unsupported progress command/);
  } finally {
    server.stop();
    fs.rmdirSync(directory);
  }
});
