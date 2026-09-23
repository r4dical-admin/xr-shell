'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');
const readline = require('node:readline');

class ProfileObserver {
  constructor(windowId, onMessage) {
    this.windowId = windowId;
    this.onMessage = onMessage;
  }

  start() {
    if (this.process) return;
    this.process = spawn(path.join(__dirname, '.build', 'input-bridge'), ['--observe', String(this.windowId)], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const lines = readline.createInterface({ input: this.process.stdout });
    lines.on('line', (line) => {
      try { this.onMessage(JSON.parse(line)); } catch { /* ignore malformed helper output */ }
    });
    this.process.once('exit', () => { this.process = null; });
  }

  stop() {
    this.process?.kill();
    this.process = null;
  }
}

module.exports = { ProfileObserver };
