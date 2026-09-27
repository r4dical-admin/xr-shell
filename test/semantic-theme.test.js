'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCoveragePlan, classifyElement, coverageLevel } = require('../semantic-theme');

const element = (id, role, width = .1, height = .05) => ({ id, role, frame: { x: .1, y: .1, width, height } });

test('theme intensity maps to five semantic coverage levels', () => {
  assert.equal(coverageLevel(15), 1);
  assert.equal(coverageLevel(40), 2);
  assert.equal(coverageLevel(72), 4);
  assert.equal(coverageLevel(100), 5);
});

test('coverage wraps shallow controls before deep or complex controls', () => {
  const elements = [
    element('0.1', 'AXButton'),
    element('0.0.0.0.0.0.1', 'AXButton'),
    element('0.2', 'AXTextField', .3),
    element('0.3', 'AXStaticText', .2)
  ];
  assert.deepEqual(buildCoveragePlan(elements, 20).wrapped.map((item) => item.id), ['0.1']);
  assert.deepEqual(buildCoveragePlan(elements, 40).wrapped.map((item) => item.id), ['0.1', '0.2']);
  assert.equal(buildCoveragePlan(elements, 100).wrapped.length, 4);
});

test('large text areas and complex regions use localized FX instead of proxy controls', () => {
  assert.equal(classifyElement(element('0.0.0', 'AXTextArea', 1, .8)).mode, 'fx');
  assert.equal(classifyElement(element('0.0.0', 'AXList', .6, .5)).mode, 'fx');
  assert.equal(classifyElement(element('0.1', 'AXTextField', .4, .08)).mode, 'a2ui-text-field');
});
