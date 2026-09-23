'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'native', 'InputBridge.m');
const outputDirectory = path.join(root, '.build');
const output = path.join(outputDirectory, 'input-bridge');

fs.mkdirSync(outputDirectory, { recursive: true });
const current = fs.existsSync(output) && fs.statSync(output).mtimeMs >= fs.statSync(source).mtimeMs;
if (current) process.exit(0);

const result = spawnSync('/usr/bin/clang', [
  source, '-O2', '-fobjc-arc',
  '-framework', 'Foundation',
  '-framework', 'AppKit',
  '-framework', 'ApplicationServices',
  '-o', output
], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
