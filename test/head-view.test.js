'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { HeadView, PitchStabilizer } = require('../head-view');

test('virtual scale determines the available horizontal workspace', () => {
  const view = new HeadView().update(2, 0, 1, 1500, 900, 46, 3);
  assert.ok(Math.abs(view.x + 1500) < 0.001);
  assert.equal(view.maxPanX, 1500);
});

test('virtual height scale determines the available vertical workspace', () => {
  const view = new HeadView().update(0, 2, 1, 1500, 900, 46, 2, 2);
  assert.ok(Math.abs(view.y - 450) < 0.001);
  assert.equal(view.maxPanY, 450);
});

test('damping is independent of refresh rate', () => {
  const sixty = new HeadView();
  const oneTwenty = new HeadView();
  let a;
  let b;
  for (let index = 0; index < 6; index += 1) a = sixty.update(0.2, 0, 1 / 60, 1500, 900, 46, 3).x;
  for (let index = 0; index < 12; index += 1) b = oneTwenty.update(0.2, 0, 1 / 120, 1500, 900, 46, 3).x;
  assert.ok(Math.abs(a - b) < 1e-8);
});

test('recenter returns to the middle', () => {
  const view = new HeadView();
  view.update(0.3, 0.1, 1, 1500, 900, 46, 3);
  view.reset();
  const centered = view.update(0, 0, 0.1, 1500, 900, 46, 3);
  assert.equal(centered.x, 0);
  assert.equal(centered.y, 0);
});

test('pitch stabilizer ignores its dead-zone and slowly cancels stationary drift', () => {
  const stabilizer = new PitchStabilizer();
  assert.equal(stabilizer.update(0.015, 1 / 60), 0);
  let corrected;
  for (let index = 0; index < 1200; index += 1) corrected = stabilizer.update(0.12, 1 / 60);
  assert.ok(Math.abs(corrected) < 0.01);
});

test('pitch stabilizer preserves deliberate movement immediately', () => {
  const stabilizer = new PitchStabilizer();
  stabilizer.update(0, 1 / 60);
  assert.ok(stabilizer.update(0.18, 1 / 60) > 0.09);
});
