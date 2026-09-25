'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MAX_HORIZONTAL_SCALE, fittedPanelSize, horizontalSlots, requiredHorizontalScale } = require('../window-layout');

test('captured wrappers preserve the source dimensions while fitting the XR stage', () => {
  assert.deepEqual(fittedPanelSize(800, 600, 3000, 1000), { width: 800, height: 694 });
  const large = fittedPanelSize(2000, 1200, 3000, 1000);
  assert.ok(large.width <= 1100);
  assert.ok(large.height <= 900);
  assert.ok(Math.abs((large.height - 94) / large.width - 1200 / 2000) < 0.001);
});

test('more captured apps expand the reachable canvas up to seven times', () => {
  assert.equal(requiredHorizontalScale(12, 2.25), 7);
  assert.equal(requiredHorizontalScale(20, 2.25), MAX_HORIZONTAL_SCALE);
  const slots = horizontalSlots(12, 6.91);
  assert.equal(slots.length, 12);
  assert.ok(slots[0] < -250 && slots.at(-1) > 250);
});
