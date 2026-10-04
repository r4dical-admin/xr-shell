'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { ScriptRunner, scriptRequest, shellQuote } = require('../script-runner');

test('script requests accept exact local scripts and bounded arguments', () => {
  const request = scriptRequest({ jobId: 'demo', scriptPath: __filename, args: ['--count', '4'] });
  assert.match(request.command, /node$/);
  assert.deepEqual(request.commandArgs, [__filename, '--count', '4']);
  assert.equal(request.jobId, 'demo');
  assert.equal(request.display, 'background');
  assert.equal(scriptRequest({ scriptPath: __filename, display: 'terminal' }).jobId, null);
  assert.equal(scriptRequest({ scriptPath: __filename, display: 'terminal' }).display, 'terminal');
  assert.throws(() => scriptRequest({ jobId: 'demo', scriptPath: 'relative.js' }), /absolute local path/);
  assert.throws(() => scriptRequest({ jobId: 'demo', scriptPath: __filename, args: ['bad\0arg'] }), /args must/);
  assert.throws(() => scriptRequest({ scriptPath: __filename, args: ['bad\narg'] }), /args must/);
  assert.throws(() => scriptRequest({ scriptPath: __filename, display: 'other' }), /display must/);
  assert.throws(() => scriptRequest({ jobId: 'demo', scriptPath: __filename, args: 'one' }), /args must/);
});

test('regular commands resolve to an executable and keep arguments separate from the shell', () => {
  const request = scriptRequest({ command: 'node', args: ['--version'], cwd: process.cwd() });
  assert.equal(request.kind, 'command');
  assert.equal(request.commandArgs[0], '--version');
  assert.equal(request.cwd, fs.realpathSync(process.cwd()));
  assert.equal(request.scriptPath, null);
  assert.ok(path.isAbsolute(request.command));
  assert.throws(() => scriptRequest({ command: 'echo hello' }), /executable name/);
  assert.throws(() => scriptRequest({ command: 'git;rm', cwd: process.cwd() }), /executable name/);
  assert.throws(() => scriptRequest({ command: 'node', cwd: 'relative' }), /absolute local directory/);
  assert.throws(() => scriptRequest({ command: 'node', scriptPath: __filename }), /either command or scriptPath/);
  assert.throws(() => scriptRequest({ command: 'definitely-not-an-xr-command' }), /Executable not found/);
});

test('terminal launcher quotes every path and argument and reports exit status', async () => {
  const runner = new ScriptRunner();
  const request = scriptRequest({ scriptPath: __filename, display: 'terminal', args: ["a'b", '--help'] });
  assert.equal(shellQuote("a'b"), "'a'\\''b'");
  let launcherPath;
  const started = await runner.launchTerminal(request, async (file) => {
    launcherPath = file;
    const source = fs.readFileSync(file, 'utf8');
    assert.match(source, /a'\\''b/);
    assert.match(source, /exec \/bin\/zsh -l/);
    if (process.platform === 'darwin') assert.equal(spawnSync('/bin/zsh', ['-n', file]).status, 0);
    fs.writeFileSync(path.join(path.dirname(file), 'exit-status'), '0\n');
  });
  assert.equal(started.display, 'terminal');
  assert.equal(started.jobId, null);
  const deadline = Date.now() + 1500;
  while (runner.status(started.runId).status === 'running' && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(runner.status(started.runId).status, 'succeeded');
  assert.equal(runner.status(started.runId).exitCode, 0);
  assert.equal(fs.existsSync(path.dirname(launcherPath)), false);
  assert.equal(runner.attach(started.runId, 'window:1:0').sourceId, 'window:1:0');
});

test('script runner launches without a shell and retains bounded process status', async () => {
  let invocation;
  const child = new EventEmitter();
  child.pid = 1234;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  const runner = new ScriptRunner({ spawnProcess: (command, args, options) => {
    invocation = { command, args, options };
    return child;
  } });
  const request = scriptRequest({ jobId: 'demo', scriptPath: __filename, args: ['--count', '4'] });
  const launch = runner.launch(request);
  child.emit('spawn');
  const started = await launch;
  assert.equal(started.status, 'running');
  assert.equal(started.pid, 1234);
  assert.equal(invocation.options.shell, false);
  assert.deepEqual(invocation.args, [__filename, '--count', '4']);
  child.stdout.write('done');
  child.emit('exit', 0, null);
  assert.equal(runner.status(started.runId).status, 'succeeded');
  assert.equal(runner.status(started.runId).stdout, 'done');
});
