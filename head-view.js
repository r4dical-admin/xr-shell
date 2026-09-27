'use strict';

class HeadView {
  constructor() {
    this.yaw = 0;
    this.pitch = 0;
  }

  reset() {
    this.yaw = 0;
    this.pitch = 0;
  }

  update(yaw, pitch, dt, viewportWidth, viewportHeight, fov, virtualScale, virtualHeightScale = 1) {
    const focal = viewportHeight / (2 * Math.tan(fov * Math.PI / 360));
    const maxPanX = viewportWidth * Math.max(0, virtualScale - 1) / 2;
    const maxPanY = Math.max(viewportHeight * 0.08, viewportHeight * Math.max(0, virtualHeightScale - 1) / 2);
    const clamp = (value, limit) => Math.max(-limit, Math.min(limit, value));
    const targetYaw = clamp(Number.isFinite(yaw) ? yaw : this.yaw, Math.atan(maxPanX / focal));
    const targetPitch = clamp(Number.isFinite(pitch) ? pitch : this.pitch, Math.atan(maxPanY / focal));
    const alpha = 1 - Math.exp(-Math.max(0, dt) / 0.04);
    this.yaw += (targetYaw - this.yaw) * alpha;
    this.pitch += (targetPitch - this.pitch) * alpha;

    return {
      yaw: this.yaw,
      pitch: this.pitch,
      targetYaw,
      targetPitch,
      x: this.yaw === 0 ? 0 : -Math.tan(this.yaw) * focal,
      y: this.pitch === 0 ? 0 : Math.tan(this.pitch) * focal,
      maxPanX,
      maxPanY
    };
  }
}

class PitchStabilizer {
  constructor(options = {}) {
    this.deadzone = Number(options.deadzone) || 0.022;
    this.gain = Number(options.gain) || 0.72;
    this.stillRate = Number(options.stillRate) || 0.03;
    this.settleTime = Number(options.settleTime) || 0.4;
    this.followTime = Number(options.followTime) || 0.9;
    this.captureRadius = Number(options.captureRadius) || 0.08;
    this.reset();
  }

  reset() {
    this.neutral = undefined;
    this.previous = undefined;
    this.stillTime = 0;
  }

  update(pitch, dt) {
    if (!Number.isFinite(pitch)) return 0;
    if (this.neutral === undefined) {
      this.neutral = pitch;
      this.previous = pitch;
      return 0;
    }
    const elapsed = Math.max(0.001, Math.min(0.05, dt));
    const delta = this.previous === undefined ? 0 : Math.atan2(Math.sin(pitch - this.previous), Math.cos(pitch - this.previous));
    const rate = Math.abs(delta) / elapsed;
    this.previous = pitch;
    this.stillTime = rate < this.stillRate ? this.stillTime + elapsed : 0;
    const relativeBeforeCorrection = Math.atan2(Math.sin(pitch - this.neutral), Math.cos(pitch - this.neutral));
    if (this.stillTime > this.settleTime && Math.abs(relativeBeforeCorrection) < this.captureRadius) {
      const alpha = 1 - Math.exp(-elapsed / this.followTime);
      this.neutral += relativeBeforeCorrection * alpha;
    }
    const relative = Math.atan2(Math.sin(pitch - this.neutral), Math.cos(pitch - this.neutral));
    return Math.sign(relative) * Math.max(0, Math.abs(relative) - this.deadzone) * this.gain;
  }
}

module.exports = { HeadView, PitchStabilizer };
