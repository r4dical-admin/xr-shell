#!/usr/bin/env node
'use strict';

const net = require('node:net');
const { defaultSocketPath } = require('../control-server');

const tools = [
  { name: 'xr_shell_list_apps', description: 'List open macOS app windows, captured XR windows, and the active XR window.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'xr_shell_get_layout', description: 'Read the current XR Shell layout, including each captured window position and size.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'xr_shell_pull_app', description: 'Pull an open macOS app window into XR Shell by source ID or case-insensitive name query.', inputSchema: { type: 'object', properties: { sourceId: { type: 'string' }, query: { type: 'string' } }, additionalProperties: false } },
  { name: 'xr_shell_focus_app', description: 'Bring a captured application to the front and make it the active XR app.', inputSchema: { type: 'object', properties: { sourceId: { type: 'string' }, query: { type: 'string' } }, additionalProperties: false } },
  { name: 'xr_shell_transform_app', description: 'Move or resize a captured app in XR space. x and y are pixel offsets from its layout slot; width and height are pixels.', inputSchema: { type: 'object', properties: { sourceId: { type: 'string' }, query: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' } }, additionalProperties: false } },
  { name: 'xr_shell_release_app', description: 'Release a captured app from XR Shell without closing the original macOS app.', inputSchema: { type: 'object', properties: { sourceId: { type: 'string' }, query: { type: 'string' } }, additionalProperties: false } }
];

function callShell(method, params) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(defaultSocketPath());
    let buffer = '';
    const timeout = setTimeout(() => { socket.destroy(); reject(new Error('XR Shell did not respond')); }, 12000);
    socket.setEncoding('utf8');
    socket.once('connect', () => socket.write(`${JSON.stringify({ id: 1, method, params })}\n`));
    socket.on('data', (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      clearTimeout(timeout);
      socket.end();
      try {
        const response = JSON.parse(buffer.slice(0, newline));
        if (!response.ok) reject(new Error(response.error || 'XR Shell request failed'));
        else resolve(response.result);
      } catch (error) { reject(error); }
    });
    socket.once('error', (error) => { clearTimeout(timeout); reject(new Error(`XR Shell is not running (${error.message})`)); });
  });
}

const methods = {
  xr_shell_list_apps: 'list_apps',
  xr_shell_get_layout: 'get_layout',
  xr_shell_pull_app: 'pull_app',
  xr_shell_focus_app: 'focus_app',
  xr_shell_transform_app: 'transform_app',
  xr_shell_release_app: 'release_app'
};

async function handle(message) {
  if (message.method === 'initialize') return { protocolVersion: '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'xr-shell', version: '0.1.0' } };
  if (message.method === 'ping') return {};
  if (message.method === 'tools/list') return { tools };
  if (message.method === 'tools/call') {
    const method = methods[message.params?.name];
    if (!method) throw new Error(`Unknown tool: ${message.params?.name}`);
    const result = await callShell(method, message.params?.arguments || {});
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result };
  }
  if (String(message.method || '').startsWith('notifications/')) return undefined;
  throw new Error(`Method not found: ${message.method}`);
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
  let newline;
  while ((newline = input.indexOf('\n')) >= 0) {
    const line = input.slice(0, newline);
    input = input.slice(newline + 1);
    if (!line.trim()) continue;
    let message;
    try { message = JSON.parse(line); } catch { continue; }
    if (message.id === undefined) { handle(message).catch(() => {}); continue; }
    handle(message).then((result) => {
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n`);
    }).catch((error) => {
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: error.message } })}\n`);
    });
  }
});
