'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MAX_HORIZONTAL_SCALE, containedMediaRect, fittedPanelSize, horizontalSlots, horizontalSlotsForWidths, manualPanelLimits, resizedPanelSize, requiredCanvasScaleForPanel, shouldZoomBeyondOriginal, requiredHorizontalScale, requiredHorizontalScaleForWidths, concavePanelPose } = require('../window-layout');

test('captured apps use a very shallow concave arc', () => {
  assert.deepEqual(concavePanelPose(0), { tilt: 0, depth: 0 });
  assert.ok(concavePanelPose(-48).tilt < 0);
  assert.ok(concavePanelPose(48).tilt > 0);
  assert.equal(concavePanelPose(-48).depth, 12);
  assert.equal(concavePanelPose(-48).depth, concavePanelPose(48).depth);
  assert.equal(concavePanelPose(500).tilt, 1.5);
  assert.equal(concavePanelPose(500).depth, 12);
});

test('captured apps are spaced according to their measured widths', () => {
  const widths = [800, 1200, 600];
  const centers = horizontalSlotsForWidths(widths, 1000).map((vw) => vw * 10);
  const gap = Math.max(48, Math.max(...widths) * .06);
  assert.equal(centers[1] - centers[0], widths[0] / 2 + gap + widths[1] / 2);
  assert.equal(centers[2] - centers[1], widths[1] / 2 + gap + widths[2] / 2);
  assert.equal(horizontalSlotsForWidths([], 1000).length, 0);
  assert.ok(requiredHorizontalScaleForWidths(widths, 1000, 1.5) >= 3);
  const expanded = horizontalSlotsForWidths([1400, 1200, 900], 1000).map((vw) => vw * 10);
  assert.ok(expanded[1] - expanded[0] > (1400 + 1200) / 2);
  assert.ok(expanded[2] - expanded[1] > (1200 + 900) / 2);
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
  assert.equal(requiredCanvasScaleForPanel(1800, 1000, 1.5, 7, .82), 2.25);
  assert.equal(requiredCanvasScaleForPanel(1800, 1000, 1, 2.5, .96), 2);
  const zoomed = containedMediaRect(800, 600, 1600, 1200);
  assert.equal(zoomed.scale, 2);
  assert.equal(zoomed.width, 1600);
  assert.equal(shouldZoomBeyondOriginal(1200, 900, 1000, 800), true);
  assert.equal(shouldZoomBeyondOriginal(900, 700, 1000, 800), false);
  const enlarged = resizedPanelSize(800, 694, 800, 0, manualPanelLimits(7000, 2500));
  assert.deepEqual(enlarged, { width: 1600, height: 1294 });
  assert.equal(shouldZoomBeyondOriginal(enlarged.width, enlarged.height, 800, 694), true);
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
