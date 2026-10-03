'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { ChatRunner, backendInvocation, commandDeckPrompt, contextWithin, cursorEvent, extractShellActions, parseBackend } = require('../chat-runner');

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

test('command deck can prepare a widget and launch its script in order', () => {
  const result = extractShellActions('<xr-shell-action>{"tool":"xr_shell_progress_prepare","arguments":{"jobId":"batch"}}</xr-shell-action>\n<xr-shell-action>{"tool":"xr_shell_run_script","arguments":{"jobId":"batch","scriptPath":"/tmp/batch.py"}}</xr-shell-action>');
  assert.deepEqual(result.actions.map((action) => action.method), ['progress_prepare', 'run_script']);
  assert.match(commandDeckPrompt('Run batch'), /Progress is optional/);
});

test('command deck prompt carries state and prevents app permission detours', () => {
  const prompt = commandDeckPrompt('Create a note', { apps: [{ name: 'Calculator' }] });
  assert.match(prompt, /host-mediated action protocol/);
  assert.match(prompt, /Never ask the user to enable Electron\/macOS app control/);
  assert.match(prompt, /Calculator/);
  assert.match(prompt, /Checkbox/);
  assert.match(prompt, /xr_shell_run_script/);
});

test('command deck context has a bounded wait', async () => {
  const started = Date.now();
  const context = await contextWithin(() => new Promise(() => {}), 15);
  assert.deepEqual(context, {});
  assert.ok(Date.now() - started < 250);
});

test('chat backend flag defaults to Codex and accepts Cursor forms', () => {
  assert.equal(parseBackend(['electron', '.']), 'codex');
  assert.equal(parseBackend(['electron', '.', '--backend', 'cursor']), 'cursor');
  assert.equal(parseBackend(['electron', '.', '--backend=cursor']), 'cursor');
  assert.throws(() => parseBackend(['electron', '.', '--backend', 'unknown']), /Expected codex or cursor/);
});

test('Cursor invocation is non-interactive, read-only, and resumable', () => {
  const fresh = backendInvocation('cursor', { prompt: 'hello', workingDirectory: '/tmp/project' });
  assert.deepEqual(fresh, ['-p', '--output-format', 'stream-json', '--mode=ask', '--sandbox=enabled', 'hello']);
  const resumed = backendInvocation('cursor', { threadId: 'session-123', prompt: 'again', workingDirectory: '/tmp/project' });
  assert.ok(resumed.includes('--resume=session-123'));
  assert.equal(resumed.at(-1), 'again');
});

test('Cursor stream events expose sessions, status, final text, and errors', () => {
  assert.deepEqual(cursorEvent({ type: 'system', subtype: 'init', session_id: 'cursor-1' }), { threadId: 'cursor-1', status: 'working' });
  assert.deepEqual(cursorEvent({ type: 'tool_call', subtype: 'started' }), { status: 'tool_call' });
  assert.deepEqual(cursorEvent({ type: 'result', subtype: 'success', result: 'Done', session_id: 'cursor-1' }), { threadId: 'cursor-1', message: 'Done' });
  assert.deepEqual(cursorEvent({ type: 'result', subtype: 'error', is_error: true, result: 'Nope' }), { error: 'Nope' });
});

test('Cursor backend executes host-mediated XR actions from the final result', async () => {
  const events = [];
  const actions = [];
  let invocation;
  let finish;
  const finished = new Promise((resolve) => { finish = resolve; });
  const spawnProcess = (command, args, options) => {
    invocation = { command, args, options };
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};
    setImmediate(() => {
      child.stdout.write(`${JSON.stringify({ type: 'system', subtype: 'init', session_id: 'cursor-session' })}\n`);
      child.stdout.write(`${JSON.stringify({ type: 'result', subtype: 'success', session_id: 'cursor-session', result: 'Adding it.\n<xr-shell-action>{"tool":"xr_shell_add_note","arguments":{"body":"Hello"}}</xr-shell-action>' })}\n`);
      child.stdout.end();
      setImmediate(() => child.emit('exit', 0));
    });
    return child;
  };
  const runner = new ChatRunner({
    backend: 'cursor', cli: '/mock/agent', spawnProcess,
    homeDirectory: '/mock/home', workingDirectory: '/mock/project',
    getContext: () => ({ apps: [] }),
    executeAction: async (method, args) => actions.push({ method, args }),
    onEvent: (event) => { events.push(event); if (event.type === 'done' || event.type === 'error') finish(); }
  });
  assert.deepEqual(await runner.send({ clientId: 'client-1', prompt: 'Add a note' }), { accepted: true, clientId: 'client-1' });
  await finished;
  assert.equal(invocation.command, '/mock/agent');
  assert.ok(invocation.args.includes('--mode=ask'));
  assert.deepEqual(actions, [{ method: 'add_note', args: { body: 'Hello' } }]);
  assert.ok(events.some((event) => event.type === 'thread' && event.threadId === 'cursor-session'));
  assert.ok(events.some((event) => event.type === 'message' && event.text === 'Adding it.'));
  assert.equal(events.at(-1).type, 'done');
});
