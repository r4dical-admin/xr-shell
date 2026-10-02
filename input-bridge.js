'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');
const readline = require('node:readline');

class InputBridge {
  constructor(options = {}) {
    this.sequence = 0;
    this.pending = new Map();
    this.queue = [];
    this.active = null;
    this.spawnProcess = options.spawnProcess || spawn;
  }

  start() {
    if (this.process && !this.process.killed) return;
    this.process = this.spawnProcess(path.join(__dirname, '.build', 'input-bridge'), [], { stdio: ['pipe', 'pipe', 'pipe'] });
    const lines = readline.createInterface({ input: this.process.stdout });
    lines.on('line', (line) => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timeout);
      this.active = null;
      pending.resolve(message);
      this.drain();
    });
    const process = this.process;
    process.once('exit', () => {
      if (this.process !== process) return;
      this.process = undefined;
      this.failAll(new Error('Input bridge stopped'));
    });
    process.once('error', (error) => {
      if (this.process !== process) return;
      this.process = undefined;
      this.failAll(error);
    });
  }

  request(command) {
    return new Promise((resolve, reject) => {
      const transient = command.type === 'pointer' && ['move', 'drag'].includes(command.phase);
      const previous = this.queue.at(-1);
      if (transient && previous?.command.type === 'pointer'
          && previous.command.phase === command.phase && previous.command.windowId === command.windowId) {
        previous.resolve({ ok: true, coalesced: true });
        this.queue.pop();
      }
      this.queue.push({ command, resolve, reject });
      this.drain();
    });
  }

  drain() {
    if (this.active || !this.queue.length) return;
    try { this.start(); } catch (error) { this.failAll(error); return; }
    const item = this.queue.shift();
    const id = ++this.sequence;
    this.active = item;
    const timeoutMs = ['snapshot', 'menu-snapshot', 'window-metrics'].includes(item.command.type) ? 12000
      : item.command.type === 'activate' ? 10000 : 6000;
    const timeout = setTimeout(() => {
      this.process?.kill();
      this.process = undefined;
      this.failAll(new Error(`Input bridge timed out (${item.command.type})`));
    }, timeoutMs);
    this.pending.set(id, { ...item, timeout });
    this.process.stdin.write(`${JSON.stringify({ ...item.command, id })}\n`, (error) => {
      if (error && this.pending.has(id)) {
        clearTimeout(timeout);
        this.pending.delete(id);
        this.active = null;
        item.reject(error);
        this.drain();
      }
    });
  }

  failAll(error) {
    for (const pending of this.pending.values()) { clearTimeout(pending.timeout); pending.reject(error); }
    this.pending.clear();
    for (const queued of this.queue) queued.reject(error);
    this.queue = [];
    this.active = null;
  }

  stop() {
    this.process?.kill();
    this.process = undefined;
    this.failAll(new Error('Input bridge stopped'));
  }
}

module.exports = { InputBridge };
