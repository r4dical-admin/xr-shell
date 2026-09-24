'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { VERSION, BASIC_CATALOG, createStore, applyMessages, resolveValue } = require('../a2ui-runtime');

test('A2UI surfaces accept progressive component and data updates', () => {
  const store = createStore();
  const result = applyMessages(store, [
    { version: VERSION, createSurface: { surfaceId: 'note_1', catalogId: BASIC_CATALOG } },
    { version: VERSION, updateComponents: { surfaceId: 'note_1', components: [
      { id: 'root', component: 'Card', child: 'body' },
      { id: 'body', component: 'Text', text: { path: '/note' } }
    ] } },
    { version: VERSION, updateDataModel: { surfaceId: 'note_1', path: '/note', value: 'Remember this' } }
  ], { placement: { x: 120, y: -80 } });
  assert.deepEqual(result.changed, ['note_1']);
  const surface = store.surfaces.get('note_1');
  assert.equal(resolveValue(surface.components.get('body').text, surface.data), 'Remember this');
  assert.equal(surface.placement.x, 120);
});

test('A2UI rejects executable or unknown components', () => {
  const store = createStore();
  applyMessages(store, { version: VERSION, createSurface: { surfaceId: 'unsafe', catalogId: BASIC_CATALOG } });
  assert.throws(() => applyMessages(store, { version: VERSION, updateComponents: { surfaceId: 'unsafe', components: [{ id: 'root', component: 'Script', code: 'alert(1)' }] } }), /Unsupported/);
});

test('A2UI surfaces can be explicitly deleted', () => {
  const store = createStore();
  applyMessages(store, { version: VERSION, createSurface: { surfaceId: 'temporary', catalogId: BASIC_CATALOG } });
  applyMessages(store, { version: VERSION, deleteSurface: { surfaceId: 'temporary' } });
  assert.equal(store.surfaces.size, 0);
});
