#!/usr/bin/env node
'use strict';

const net = require('node:net');
const { defaultSocketPath } = require('../control-server');

const tools = [
  { name: 'xr_shell_list_apps', description: 'List open macOS app windows, captured XR windows, and the active XR window.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'xr_shell_get_layout', description: 'Read the XR viewport and canvas sizes plus each captured window slot, center, offset, and dimensions. Window x/y transforms are offsets from their assigned slots.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'xr_shell_pull_app', description: 'Pull an open macOS app window into XR Shell by source ID or case-insensitive name query.', inputSchema: { type: 'object', properties: { sourceId: { type: 'string' }, query: { type: 'string' } }, additionalProperties: false } },
  { name: 'xr_shell_launch_app', description: 'Launch a macOS app, wait for its window, attach it to XR Shell, and optionally position and size it.', inputSchema: { type: 'object', properties: { app: { type: 'string', description: 'Application name or absolute .app path.' }, bundleId: { type: 'string' }, windowQuery: { type: 'string' }, waitMs: { type: 'number', minimum: 1000, maximum: 30000 }, x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' } }, additionalProperties: false } },
  { name: 'xr_shell_focus_app', description: 'Bring a captured application to the front and make it the active XR app.', inputSchema: { type: 'object', properties: { sourceId: { type: 'string' }, query: { type: 'string' } }, additionalProperties: false } },
  { name: 'xr_shell_transform_app', description: 'Move or resize a captured app in XR space. First inspect xr_shell_get_layout: x and y are pixel offsets from its assigned slot, while width and height are pixels.', inputSchema: { type: 'object', properties: { sourceId: { type: 'string' }, query: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' } }, additionalProperties: false } },
  { name: 'xr_shell_release_app', description: 'Release a captured app from XR Shell without closing the original macOS app.', inputSchema: { type: 'object', properties: { sourceId: { type: 'string' }, query: { type: 'string' } }, additionalProperties: false } },
  { name: 'xr_shell_open_layout', description: 'Open up to twelve macOS apps and place them in a specified XR layout. Missing apps launch automatically unless launch is false. Also creates a draggable, closable A2UI layout controller.', inputSchema: { type: 'object', required: ['apps'], properties: { title: { type: 'string' }, surfaceId: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, apps: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'object', properties: { sourceId: { type: 'string' }, query: { type: 'string' }, app: { type: 'string' }, bundleId: { type: 'string' }, windowQuery: { type: 'string' }, launch: { type: 'boolean' }, waitMs: { type: 'number' }, x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' } }, additionalProperties: false } } }, additionalProperties: false } },
  { name: 'xr_shell_add_note', description: 'Add a draggable, closable floating note to the XR workspace using an A2UI surface.', inputSchema: { type: 'object', required: ['body'], properties: { title: { type: 'string' }, body: { type: 'string' }, surfaceId: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' } }, additionalProperties: false } },
  { name: 'xr_shell_progress_prepare', description: 'Create or reopen a draggable script-progress widget before a local IDE script runs. Returns the job ID and reporting commands; the script reports updates directly to a separate local Unix socket without agent turns.', inputSchema: { type: 'object', required: ['jobId'], properties: { jobId: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_.:-]{0,63}$' }, title: { type: 'string' }, view: { type: 'string', enum: ['remaining', 'eta', 'metrics'] } }, additionalProperties: false } },
  { name: 'xr_shell_progress_configure', description: 'Change a prepared script-progress widget view without changing how its script reports counts and metrics.', inputSchema: { type: 'object', required: ['jobId', 'view'], properties: { jobId: { type: 'string' }, view: { type: 'string', enum: ['remaining', 'eta', 'metrics'] } }, additionalProperties: false } },
  { name: 'xr_shell_progress_get', description: 'Read a prepared script-progress job including completed and remaining runs, ETA, status, and named metrics.', inputSchema: { type: 'object', required: ['jobId'], properties: { jobId: { type: 'string' } }, additionalProperties: false } },
  { name: 'xr_shell_run_script', description: 'With user approval, run an exact local .py, .js, .mjs, .cjs, or .sh script. Progress is optional (jobId); display is background or macOS Terminal. Terminal mode opens and attaches a Terminal window in XR Shell. No arbitrary shell command string is accepted.', inputSchema: { type: 'object', required: ['scriptPath'], properties: { jobId: { type: 'string' }, title: { type: 'string' }, scriptPath: { type: 'string', description: 'Absolute path to an existing script file.' }, args: { type: 'array', maxItems: 24, items: { type: 'string' } }, display: { type: 'string', enum: ['background', 'terminal'] }, x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' } }, additionalProperties: false } },
  { name: 'xr_shell_script_status', description: 'Read an XR Shell-launched script by run ID. Background runs include bounded stdout/stderr tails; Terminal runs show process exit status and their output stays in the attached Terminal window.', inputSchema: { type: 'object', required: ['runId'], properties: { runId: { type: 'string' } }, additionalProperties: false } },
  { name: 'xr_shell_a2ui_capabilities', description: 'Return XR Shell A2UI version, catalogs, components, action tools, and active generated surfaces.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'xr_shell_a2ui_apply', description: 'Apply an ordered A2UI v0.9.1 message batch to create or update a draggable XR surface. Every surface receives a non-removable close button and drag handle.', inputSchema: { type: 'object', required: ['messages'], properties: { messages: { type: 'array', minItems: 1, maxItems: 64, items: { type: 'object' } }, placement: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, title: { type: 'string' } }, additionalProperties: false } }, additionalProperties: false } },
  { name: 'xr_shell_a2ui_delete', description: 'Delete an agent-generated A2UI surface from XR Shell.', inputSchema: { type: 'object', required: ['surfaceId'], properties: { surfaceId: { type: 'string' } }, additionalProperties: false } },
  { name: 'xr_shell_a2ui_events', description: 'Read user interaction events emitted by A2UI surfaces after the supplied cursor.', inputSchema: { type: 'object', properties: { after: { type: 'integer', minimum: 0 } }, additionalProperties: false } }
];

function callShell(method, params) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(defaultSocketPath());
    let buffer = '';
    const timeoutMs = method === 'run_script' ? 180000 : ['launch_app', 'open_layout'].includes(method) ? 45000 : 12000;
    const timeout = setTimeout(() => { socket.destroy(); reject(new Error('XR Shell did not respond')); }, timeoutMs);
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
  xr_shell_launch_app: 'launch_app',
  xr_shell_focus_app: 'focus_app',
  xr_shell_transform_app: 'transform_app',
  xr_shell_release_app: 'release_app',
  xr_shell_open_layout: 'open_layout',
  xr_shell_add_note: 'add_note',
  xr_shell_progress_prepare: 'progress_prepare',
  xr_shell_progress_configure: 'progress_configure',
  xr_shell_progress_get: 'progress_get',
  xr_shell_run_script: 'run_script',
  xr_shell_script_status: 'script_status',
  xr_shell_a2ui_capabilities: 'a2ui_capabilities',
  xr_shell_a2ui_apply: 'a2ui_apply',
  xr_shell_a2ui_delete: 'a2ui_delete',
  xr_shell_a2ui_events: 'a2ui_events'
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
