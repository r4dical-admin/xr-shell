'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');
const readline = require('node:readline');

class ProfileObserver {
  constructor(windowId, onMessage, executablePath = path.join(__dirname, '.build', 'input-bridge')) {
    this.windowId = windowId;
    this.onMessage = onMessage;
    this.executablePath = executablePath;
  }

  start() {
    if (this.process) return;
    this.process = spawn(this.executablePath, ['--observe', String(this.windowId)], {
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
