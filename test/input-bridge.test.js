'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { InputBridge } = require('../input-bridge');

test('input bridge keeps click boundaries ordered while replacing queued pointer motion', async () => {
  const commands = [];
  let child;
  const bridge = new InputBridge({ spawnProcess: () => {
    child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.killed = false;
    child.kill = () => { child.killed = true; child.emit('exit', 0); };
    child.stdin.on('data', (chunk) => commands.push(JSON.parse(String(chunk).trim())));
    return child;
  } });

  const down = bridge.request({ type: 'pointer', phase: 'down', windowId: 1 });
  const firstMove = bridge.request({ type: 'pointer', phase: 'drag', windowId: 1, x: .2 });
  const lastMove = bridge.request({ type: 'pointer', phase: 'drag', windowId: 1, x: .8 });
  const up = bridge.request({ type: 'pointer', phase: 'up', windowId: 1 });
  assert.equal((await firstMove).coalesced, true);
  assert.equal(commands.length, 1);
  for (let index = 0; index < 3; index++) {
    const command = commands[index];
    child.stdout.write(`${JSON.stringify({ id: command.id, ok: true })}\n`);
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.deepEqual(commands.map((item) => item.phase), ['down', 'drag', 'up']);
  assert.equal(commands[1].x, .8);
  assert.deepEqual(await Promise.all([down, lastMove, up]), [{ id: 1, ok: true }, { id: 2, ok: true }, { id: 3, ok: true }]);
  bridge.stop();
});
