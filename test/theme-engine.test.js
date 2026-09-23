'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeGeneratedTheme } = require('../theme-engine');

const profile = { app: { name: 'Editor' }, capabilities: { roles: { AXButton: 2, AXTextField: 1 } } };
const generated = {
  version: 3,
  name: 'Editor Nebula',
  motif: 'nebula-console',
  rationale: 'Focus-driven controls with a calm high-contrast writing surface.',
  palette: { accent: '#66DDFF', secondary: '#A88CFF', surface: '#07111A', line: '#3A9FC2', ink: '#EDF9FF' },
  videoFilter: 'saturate(.82) contrast(1.18) brightness(.86)',
  roleEffects: { AXButton: 'holographic-control', AXTextField: 'luminous-input', AXSecret: 'glass-region' }
};

test('generated themes are constrained to profile roles and safe visual tokens', () => {
  const theme = normalizeGeneratedTheme(generated, profile);
  assert.equal(theme.version, 3);
  assert.equal(theme.roleEffects.AXButton, 'holographic-control');
  assert.equal(theme.roleEffects.AXSecret, undefined);
  assert.equal(theme.generatedBy, 'codex-ax-theme-agent');
});

test('generated themes reject arbitrary CSS filters', () => {
  assert.throws(() => normalizeGeneratedTheme({ ...generated, videoFilter: 'url(https://bad)' }, profile), /invalid video filter/);
});
