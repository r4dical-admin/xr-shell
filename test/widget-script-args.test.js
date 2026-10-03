'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createStore, applyMessages, resolveBindings } = require('../a2ui-runtime');
const { materializeScriptArgs } = require('../widget-script-args');

test('documented script widget binds form values into safe arguments', () => {
  const guide = fs.readFileSync(path.join(__dirname, '..', 'docs', 'agent-capabilities.md'), 'utf8');
  const payload = JSON.parse(guide.match(/```json\n([\s\S]*?)\n```/)?.[1] || 'null');
  const store = createStore();
  applyMessages(store, payload);
  const surface = store.surfaces.get('import_control');
  assert.equal(surface.components.get('mode').component, 'Select');
  assert.equal(surface.components.get('dry').component, 'Checkbox');
  const action = surface.components.get('run').action.event.context;
  const initial = resolveBindings(action.arguments, surface.data);
  assert.equal(initial.display, 'terminal');
  assert.deepEqual(materializeScriptArgs(initial.args), ['--input', '', '--mode', 'fast']);
  surface.data.input = '/tmp/data.csv';
  surface.data.mode = 'careful';
  surface.data.dryRun = true;
  surface.data.display = 'background';
  assert.equal(resolveBindings(action.arguments, surface.data).display, 'background');
  assert.deepEqual(materializeScriptArgs(resolveBindings(action.arguments, surface.data).args), ['--input', '/tmp/data.csv', '--mode', 'careful', '--dry-run']);
});

test('script widget argument templates reject executable-shaped values', () => {
  assert.throws(() => materializeScriptArgs([{ value: 'x', when: 'yes' }]), /short strings|Invalid/);
  assert.throws(() => materializeScriptArgs([{ path: '/arbitrary' }]), /Invalid/);
  assert.throws(() => materializeScriptArgs(['ok', 42]), /short strings/);
  assert.deepEqual(materializeScriptArgs([{ value: '--optional', when: false }]), []);
});
