#!/usr/bin/env node
'use strict';

const net = require('node:net');
const { progressSocketPath } = require('../progress-socket');

function parseArgs(argv) {
  const [operation, ...rest] = argv;
  if (!['start', 'update', 'finish'].includes(operation)) throw new Error('Usage: xr-shell-progress <start|update|finish> --job NAME [options]');
  const options = {};
  for (let index = 0; index < rest.length; index++) {
    const flag = rest[index];
    if (flag === '--required') { options.required = true; continue; }
    if (!['--job', '--total', '--completed', '--status', '--message', '--metrics-json'].includes(flag) || !rest[index + 1]) throw new Error(`Invalid or missing option: ${flag}`);
    options[flag.slice(2)] = rest[++index];
  }
  if (!options.job) throw new Error('--job is required');
  const params = { jobId: options.job };
  for (const key of ['total', 'completed']) {
    if (options[key] !== undefined) {
      const value = Number(options[key]);
      if (!Number.isSafeInteger(value) || value < 0) throw new Error(`--${key} must be a non-negative integer`);
      params[key] = value;
    }
  }
  if (operation === 'start' && params.total === undefined) throw new Error('start requires --total');
  if (operation === 'update' && params.completed === undefined) throw new Error('update requires --completed');
  if (operation === 'finish' && !['success', 'failure'].includes(options.status)) throw new Error('finish requires --status success|failure');
  if (options.status) params.status = options.status;
  if (options.message) params.message = options.message;
  if (options['metrics-json']) {
    try { params.metrics = JSON.parse(options['metrics-json']); }
    catch { throw new Error('--metrics-json must contain valid JSON'); }
  }
  return { method: `progress_${operation}`, params, required: Boolean(options.required) };
}

function sendProgress(method, params, socketPath = progressSocketPath()) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let buffer = '';
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.destroy();
      if (error) reject(error); else resolve(value);
    };
    const timeout = setTimeout(() => finish(new Error('XR Shell progress socket timed out')), 3000);
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(`${JSON.stringify({ id: 1, method, params })}\n`));
    socket.on('data', (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      try {
        const response = JSON.parse(buffer.slice(0, newline));
        finish(response.ok ? null : new Error(response.error || 'Progress update failed'), response.result);
      } catch (error) { finish(error); }
    });
    socket.on('error', (error) => finish(error));
    socket.on('close', () => { if (!settled) finish(new Error('XR Shell progress socket closed without a response')); });
  });
}

if (require.main === module) {
  let command;
  try { command = parseArgs(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 2; }
  if (command) sendProgress(command.method, command.params).catch((error) => {
    process.stderr.write(`XR Shell progress: ${error.message}\n`);
    if (command.required) process.exitCode = 1;
  });
}

module.exports = { parseArgs, sendProgress };
