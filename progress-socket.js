'use strict';

const os = require('node:os');
const path = require('node:path');

function progressSocketPath() {
  const uid = typeof process.getuid === 'function' ? process.getuid() : 'user';
  return path.join(os.tmpdir(), `xr-shell-progress-${uid}.sock`);
}

const PROGRESS_METHODS = new Set(['progress_start', 'progress_update', 'progress_finish']);

module.exports = { progressSocketPath, PROGRESS_METHODS };
