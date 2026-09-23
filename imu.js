'use strict';

// Experimental One Pro wire layout. The glasses expose IMU packets over their
// USB-Ethernet link. This deliberately keeps packet parsing in the trusted
// Electron process and only emits a normalized orientation to the renderer.
class FrameDecoder {
  constructor() {
    this.bytes = Buffer.alloc(0);
  }

  push(chunk) {
    this.bytes = Buffer.concat([this.bytes, chunk]);
    const samples = [];
    let offset = 0;

    while (offset + 134 <= this.bytes.length) {
      const bytes = this.bytes;
      const headerOkay = [0x27, 0x28].includes(bytes[offset])
        && bytes.subarray(offset + 1, offset + 6).equals(Buffer.from([0x36, 0, 0, 0, 0x80]));
      if (!headerOkay) {
        offset += 1;
        continue;
      }

      const gyro = [0, 1, 2].map((index) => bytes.readFloatLE(offset + 34 + index * 4));
      const accel = [0, 1, 2].map((index) => bytes.readFloatLE(offset + 46 + index * 4));
      const valid = [...gyro, ...accel].every(Number.isFinite)
        && Math.hypot(...gyro) < 40
        && Math.hypot(...accel) > 1
        && Math.hypot(...accel) < 100;

      if (valid) {
        samples.push({ time: bytes.readBigUInt64LE(offset + 14), gyro, accel });
        offset += 134;
      } else {
        offset += 1;
      }
    }

    this.bytes = this.bytes.subarray(offset);
    return samples;
  }
}

function multiply(a, b) {
  const [x, y, z, w] = a;
  const [u, v, s, t] = b;
  return [
    w * u + x * t + y * s - z * v,
    w * v - x * s + y * t + z * u,
    w * s + x * v - y * u + z * t,
    w * t - x * u - y * v - z * s
  ];
}

class OrientationFilter {
  constructor() {
    this.q = [0, 0, 0, 1];
    this.origin = [0, 0, 0, 1];
    this.calibrated = false;
    this.last = undefined;
    this.count = 0;
    this.sum = [0, 0, 0];
    this.gravity = [0, 1, 0];
    this.bias = [0, 0, 0];
  }

  recenter() {
    this.origin = [-this.q[0], -this.q[1], -this.q[2], this.q[3]];
  }

  update(sample) {
    const dt = this.last === undefined ? 0 : Number(sample.time - this.last) / 1e9;
    this.last = sample.time;

    // Raw axes are pitch, yaw, roll. Camera forward is -Z.
    const gyro = [sample.gyro[0], sample.gyro[1], -sample.gyro[2]];
    const accel = [sample.accel[0], sample.accel[1], -sample.accel[2]];
    const accelLength = Math.hypot(...accel);

    if (!this.calibrated) {
      if (Math.hypot(...gyro) > 0.08 || Math.abs(accelLength - 9.81) > 0.6) {
        this.count = 0;
        this.sum = [0, 0, 0];
        return this.q;
      }
      gyro.forEach((value, index) => { this.sum[index] += value; });
      this.count += 1;
      if (this.count >= 1000) {
        this.bias = this.sum.map((value) => value / this.count);
        this.gravity = accel.map((value) => value / accelLength);
        this.calibrated = true;
      }
      return this.q;
    }

    if (dt <= 0 || dt > 0.05) return multiply(this.origin, this.q);

    let omega = gyro.map((value, index) => value - this.bias[index]);
    if (Math.abs(accelLength - 9.81) < 1.2) {
      const inverse = [-this.q[0], -this.q[1], -this.q[2], this.q[3]];
      const expected = multiply(multiply(inverse, [...this.gravity, 0]), this.q);
      const normalized = accel.map((value) => value / accelLength);
      const error = [
        normalized[1] * expected[2] - normalized[2] * expected[1],
        normalized[2] * expected[0] - normalized[0] * expected[2],
        normalized[0] * expected[1] - normalized[1] * expected[0]
      ];
      omega = omega.map((value, index) => value + error[index] * 0.7);
    }

    const derivative = multiply(this.q, [...omega, 0]);
    const next = this.q.map((value, index) => value + derivative[index] * dt * 0.5);
    const length = Math.hypot(...next);
    this.q = next.map((value) => value / length);
    return multiply(this.origin, this.q);
  }
}

module.exports = { FrameDecoder, OrientationFilter, multiply };
