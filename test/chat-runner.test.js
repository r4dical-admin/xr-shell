'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { commandDeckPrompt, contextWithin, extractShellActions } = require('../chat-runner');

test('extractShellActions hides and validates host action tags', () => {
  const result = extractShellActions('Opening it.\n<xr-shell-action>{"tool":"xr_shell_launch_app","arguments":{"app":"Calculator"}}</xr-shell-action>');
  assert.equal(result.visibleText, 'Opening it.');
  assert.deepEqual(result.actions, [{ tool: 'xr_shell_launch_app', method: 'launch_app', arguments: { app: 'Calculator' } }]);
});

test('extractShellActions rejects tools outside the allow-list', () => {
  const result = extractShellActions('<xr-shell-action>{"tool":"run_shell","arguments":{"command":"open Calculator"}}</xr-shell-action>');
  assert.equal(result.visibleText, '');
  assert.deepEqual(result.actions, []);
});

test('command deck prompt carries state and prevents app permission detours', () => {
  const prompt = commandDeckPrompt('Create a note', { apps: [{ name: 'Calculator' }] });
  assert.match(prompt, /host-mediated action protocol/);
  assert.match(prompt, /Never ask the user to enable Electron\/macOS app control/);
  assert.match(prompt, /Calculator/);
});

test('command deck context has a bounded wait', async () => {
  const started = Date.now();
  const context = await contextWithin(() => new Promise(() => {}), 15);
  assert.deepEqual(context, {});
  assert.ok(Date.now() - started < 250);
});
