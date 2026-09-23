'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { FrameDecoder, OrientationFilter } = require('../imu');

function frame(time, header = 0x28) {
  const bytes = Buffer.alloc(134);
  bytes.set([header, 0x36, 0, 0, 0, 0x80]);
  bytes.writeBigUInt64LE(time, 14);
  bytes.writeFloatLE(9.81, 50);
  return bytes;
}

test('decoder resynchronizes fragmented frames and accepts both headers', () => {
  const decoder = new FrameDecoder();
  const first = frame(1000000n);
  assert.equal(decoder.push(Buffer.concat([Buffer.from([9, 4]), first.subarray(0, 40)])).length, 0);
  const result = decoder.push(Buffer.concat([first.subarray(40), frame(2000000n, 0x27)]));
  assert.deepEqual(result.map((sample) => sample.time), [1000000n, 2000000n]);
});

test('orientation filter calibrates, integrates yaw and recenters', () => {
  const filter = new OrientationFilter();
  let time = 0n;
  const sample = (gyro) => ({ time: time += 1000000n, gyro, accel: [0, 9.81, 0] });
  for (let index = 0; index < 1000; index += 1) filter.update(sample([0, 0.01, 0]));
  assert.equal(filter.calibrated, true);
  let q;
  for (let index = 0; index < 1000; index += 1) q = filter.update(sample([0, 1.01, 0]));
  assert.ok(Math.abs(q[1] - Math.sin(0.5)) < 0.002);
  assert.ok(Math.abs(Math.hypot(...q) - 1) < 1e-8);
  filter.recenter();
  q = filter.update(sample([0, 0.01, 0]));
  assert.ok(Math.abs(q[3] - 1) < 1e-5);
});
