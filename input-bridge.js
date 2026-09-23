'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');
const readline = require('node:readline');

class InputBridge {
  constructor() {
    this.sequence = 0;
    this.pending = new Map();
  }

  start() {
    if (this.process && !this.process.killed) return;
    this.process = spawn(path.join(__dirname, '.build', 'input-bridge'), [], { stdio: ['pipe', 'pipe', 'pipe'] });
    const lines = readline.createInterface({ input: this.process.stdout });
    lines.on('line', (line) => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timeout);
      pending.resolve(message);
    });
    this.process.once('exit', () => {
      this.process = undefined;
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('Input bridge stopped'));
      }
      this.pending.clear();
    });
  }

  request(command) {
    this.start();
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Input bridge timed out'));
      }, command.type === 'snapshot' ? 8000 : 2500);
      this.pending.set(id, { resolve, reject, timeout });
      this.process.stdin.write(`${JSON.stringify({ ...command, id })}\n`);
    });
  }

  stop() {
    this.process?.kill();
    this.process = undefined;
  }
}

module.exports = { InputBridge };
