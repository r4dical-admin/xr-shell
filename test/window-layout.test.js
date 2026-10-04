'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MAX_HORIZONTAL_SCALE, containedMediaRect, fittedPanelSize, horizontalSlots, manualPanelLimits, resizedPanelSize, requiredHorizontalScale, convexPanelPose } = require('../window-layout');

test('captured apps form a convex arc with the center closest to the viewer', () => {
  assert.deepEqual(convexPanelPose(0), { tilt: 0, depth: 0 });
  assert.ok(convexPanelPose(-48).tilt < 0);
  assert.ok(convexPanelPose(48).tilt > 0);
  assert.ok(convexPanelPose(-48).depth < 0);
  assert.equal(convexPanelPose(-48).depth, convexPanelPose(48).depth);
});

test('captured wrappers preserve the source dimensions while fitting the XR stage', () => {
  assert.deepEqual(fittedPanelSize(800, 600, 3000, 1000), { width: 800, height: 694 });
  const large = fittedPanelSize(2000, 1200, 3000, 1000);
  assert.ok(large.width <= 1100);
  assert.ok(large.height <= 900);
  assert.ok(Math.abs((large.height - 94) / large.width - 1200 / 2000) < 0.001);
});

test('large native title regions can be cropped without distorting media geometry', () => {
  assert.deepEqual(fittedPanelSize(800, 700, 3000, 1000, 80), { width: 800, height: 714 });
  const rect = containedMediaRect(800, 700, 800, 620, 80);
  assert.deepEqual(rect, { left: 0, top: -80, width: 800, height: 700, scale: 1, cropTop: 80 });
  assert.equal((0 - rect.top) / rect.height, 80 / 700);
});

test('manual resizing can grow well beyond the native auto-fit limit', () => {
  assert.deepEqual(manualPanelLimits(3000, 1000), { maxWidth: 2460, maxHeight: 960 });
  assert.ok(manualPanelLimits(3000, 1000).maxWidth > fittedPanelSize(800, 600, 3000, 1000).width);
});

test('corner resizing preserves captured content aspect ratio at window limits', () => {
  const limits = manualPanelLimits(3000, 1500);
  const resized = resizedPanelSize(800, 694, 400, 20, limits);
  assert.deepEqual(resized, { width: 1200, height: 994 });
  const tighterLimits = manualPanelLimits(3000, 1000);
  const capped = resizedPanelSize(800, 694, 4000, 4000, tighterLimits);
  assert.ok(capped.width <= tighterLimits.maxWidth && capped.height <= tighterLimits.maxHeight);
  assert.ok(Math.abs(capped.width / (capped.height - 94) - 800 / 600) < 0.0001);
});

test('more captured apps expand the reachable canvas up to seven times', () => {
  assert.equal(requiredHorizontalScale(12, 2.25), 7);
  assert.equal(requiredHorizontalScale(20, 2.25), MAX_HORIZONTAL_SCALE);
  const slots = horizontalSlots(12, 6.91);
  assert.equal(slots.length, 12);
  assert.ok(slots[0] < -250 && slots.at(-1) > 250);
});
