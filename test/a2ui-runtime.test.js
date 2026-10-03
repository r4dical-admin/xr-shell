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

test('A2UI accepts a data-bound XR progress bar', () => {
  const store = createStore();
  applyMessages(store, [
    { version: VERSION, createSurface: { surfaceId: 'progress_job', catalogId: 'https://xr-shell.local/catalogs/spatial/v0_9_1' } },
    { version: VERSION, updateComponents: { surfaceId: 'progress_job', components: [
      { id: 'root', component: 'Card', child: 'bar' },
      { id: 'bar', component: 'ProgressBar', value: { path: '/completed' }, max: { path: '/total' } }
    ] } },
    { version: VERSION, updateDataModel: { surfaceId: 'progress_job', value: { completed: 2, total: 5 } } }
  ]);
  assert.equal(resolveValue(store.surfaces.get('progress_job').components.get('bar').value, store.surfaces.get('progress_job').data), 2);
});
