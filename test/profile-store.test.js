'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { aggregateEvents, diffSnapshots, summarizeSnapshot } = require('../profile-store');

const base = {
  ok: true,
  capturedAt: 1000,
  app: { bundleId: 'com.example.Editor', name: 'Editor' },
  elements: [{ id: '0.1', role: 'AXButton', title: 'Save', frame: { x: 0, y: 0, width: .1, height: .1 }, actions: ['AXPress'], attributes: ['AXTitle'], parameterizedAttributes: [], state: { enabled: true } }]
};

test('profile summary inventories roles and actions without persisting values', () => {
  const withPrivateValue = structuredClone(base);
  withPrivateValue.elements[0].value = 'private document content';
  withPrivateValue.supportedNotifications = ['AXValueChanged'];
  const profile = summarizeSnapshot(withPrivateValue);
  assert.equal(profile.capabilities.roles.AXButton, 1);
  assert.deepEqual(profile.capabilities.actions, ['AXPress']);
  assert.equal(profile.latestLayout[0].label, 'Save');
  assert.equal('value' in profile.latestLayout[0], false);
  assert.equal(JSON.stringify(profile).includes('private document content'), false);
  assert.deepEqual(profile.capabilities.supportedNotifications, ['AXValueChanged']);
});

test('snapshot diff learns layout, focus, value, creation and destruction events', () => {
  const next = structuredClone(base);
  next.capturedAt = 2000;
  next.elements = [{ id: '0.1', role: 'AXButton', title: 'Save', value: 1, frame: { x: .1, y: 0, width: .1, height: .1 }, actions: ['AXPress'], state: { enabled: true, focused: true } },
    { id: '0.2', role: 'AXTextField', frame: { x: 0, y: .2, width: .5, height: .1 }, actions: [], state: {} }];
  const types = diffSnapshots(base, next).map((event) => event.type);
  assert.ok(types.includes('layoutChanged'));
  assert.ok(types.includes('focusChanged'));
  assert.ok(types.includes('valueChanged'));
  assert.ok(types.includes('elementCreated'));
  const removed = diffSnapshots(next, { ...next, elements: [] });
  assert.equal(removed.filter((event) => event.type === 'elementDestroyed').length, 2);
});

test('event aggregation preserves useful interaction frequencies without labels or values', () => {
  const patterns = aggregateEvents({}, [
    { type: 'AXValueChanged', role: 'AXTextField', label: 'private' },
    { type: 'AXValueChanged', role: 'AXTextField', value: 'secret' },
    { type: 'focusChanged', role: 'AXButton' }
  ]);
  assert.equal(patterns.total, 3);
  assert.equal(patterns.byType.AXValueChanged, 2);
  assert.equal(patterns.interactions['AXValueChanged:AXTextField'], 2);
  assert.equal(JSON.stringify(patterns).includes('private'), false);
  assert.equal(JSON.stringify(patterns).includes('secret'), false);
});
