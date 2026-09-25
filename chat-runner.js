'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');
const readline = require('node:readline');

const ACTION_PATTERN = /<xr-shell-action>([\s\S]*?)<\/xr-shell-action>/g;
const ACTION_METHODS = Object.freeze({
  xr_shell_pull_app: 'pull_app',
  xr_shell_launch_app: 'launch_app',
  xr_shell_focus_app: 'focus_app',
  xr_shell_transform_app: 'transform_app',
  xr_shell_release_app: 'release_app',
  xr_shell_open_layout: 'open_layout',
  xr_shell_add_note: 'add_note',
  xr_shell_a2ui_apply: 'a2ui_apply',
  xr_shell_a2ui_delete: 'a2ui_delete'
});

function extractShellActions(text) {
  const actions = [];
  const visibleText = String(text || '').replace(ACTION_PATTERN, (_match, payload) => {
    if (actions.length >= 12) return '';
    try {
      const action = JSON.parse(payload.trim());
      const method = ACTION_METHODS[action?.tool];
      if (!method || !action.arguments || typeof action.arguments !== 'object' || Array.isArray(action.arguments)) return '';
      actions.push({ tool: action.tool, method, arguments: action.arguments });
    } catch { /* malformed actions are ignored and never reach the host */ }
    return '';
  }).replace(/```(?:json)?\s*```/gi, '').trim();
  return { visibleText, actions };
}

function commandDeckPrompt(userPrompt, context = {}) {
  const state = JSON.stringify(context).slice(0, 24000);
  return `You are the agent inside XR Shell's command deck. You can conversationally answer questions and can control only XR Shell through the host-mediated action protocol below.

Important rules:
- Do not call MCP tools for XR Shell mutations. The non-interactive host executes approved actions after your response.
- Never ask the user to enable Electron/macOS app control or to mention/tag an app. XR Shell itself already owns the required local capability.
- When the user requests an XR action, briefly tell them what you are doing, then emit one action tag per operation. Do not wrap action tags in code fences.
- Emit only tools from the allow-list below. Use valid JSON. The user does not see action tags.
- If no XR action is requested, respond normally without an action tag.

Action tag format:
<xr-shell-action>{"tool":"xr_shell_add_note","arguments":{"title":"Reminder","body":"Wake up Oz"}}</xr-shell-action>

Allow-listed actions:
- xr_shell_add_note: {title?, body (required), surfaceId?, x?, y?, width?}
- xr_shell_launch_app: {app or bundleId, windowQuery?, waitMs?, x?, y?, width?, height?}. It already launches and attaches the window, so never follow it with xr_shell_pull_app. Prefer ordinary macOS names such as "Calculator" and omit waitMs unless the user requests a timeout.
- xr_shell_pull_app / xr_shell_focus_app / xr_shell_release_app: {sourceId? or query?}
- xr_shell_transform_app: {sourceId? or query?, x?, y?, width?, height?}
- xr_shell_open_layout: {title?, surfaceId?, x?, y?, apps:[{app or bundleId or query, x?, y?, width?, height?}]}
- xr_shell_a2ui_apply: {messages:[A2UI messages], placement?}
- xr_shell_a2ui_delete: {surfaceId}

Current XR Shell state:
${state}

User request:
${userPrompt}`;
}

async function contextWithin(getContext, timeoutMs = 2500) {
  if (!getContext) return {};
  let timeout;
  try {
    return await Promise.race([
      Promise.resolve().then(() => getContext()),
      new Promise((resolve) => { timeout = setTimeout(() => resolve({}), timeoutMs); })
    ]) || {};
  } finally {
    clearTimeout(timeout);
  }
}

class ChatRunner {
  constructor({ homeDirectory, workingDirectory, onEvent, getContext, executeAction }) {
    this.cli = path.join(homeDirectory, '.local', 'bin', 'codex');
    this.workingDirectory = workingDirectory;
    this.onEvent = onEvent;
    this.getContext = getContext;
    this.executeAction = executeAction;
    this.processes = new Map();
  }

  async send({ clientId, threadId, prompt }) {
    const text = String(prompt || '').trim().slice(0, 12000);
    if (!clientId || !text) return { accepted: false, error: 'invalid-chat-request' };
    if (this.processes.has(clientId)) return { accepted: false, error: 'session-busy' };
    this.processes.set(clientId, null);
    let context = {};
    try { context = await contextWithin(this.getContext); } catch { /* context is helpful, not required */ }
    const augmentedPrompt = commandDeckPrompt(text, context);
    const args = threadId
      ? ['exec', '-c', 'approval_policy="never"', 'resume', '--json', '--skip-git-repo-check', threadId, augmentedPrompt]
      : ['exec', '-c', 'approval_policy="never"', '--json', '--sandbox', 'read-only', '--skip-git-repo-check', '-C', this.workingDirectory, augmentedPrompt];
    const child = spawn(this.cli, args, { cwd: this.workingDirectory, stdio: ['ignore', 'pipe', 'pipe'] });
    this.processes.set(clientId, child);
    this.onEvent({ clientId, type: 'status', status: 'starting' });
    let actionWork = Promise.resolve();
    let actionError = null;
    const lines = readline.createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      let event;
      try { event = JSON.parse(line); } catch { return; }
      if (event.type === 'thread.started') this.onEvent({ clientId, type: 'thread', threadId: event.thread_id });
      if (event.type === 'item.started') this.onEvent({ clientId, type: 'status', status: event.item?.type || 'working' });
      if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
        const parsed = extractShellActions(event.item.text || '');
        if (parsed.visibleText) this.onEvent({ clientId, type: 'message', text: parsed.visibleText });
        if (parsed.actions.length) {
          this.onEvent({ clientId, type: 'status', status: 'command_execution' });
          actionWork = actionWork.then(async () => {
            for (const action of parsed.actions) await this.executeAction(action.method, action.arguments);
          }).catch((error) => { actionError ||= error; });
        }
      }
      if (event.type === 'turn.failed') this.onEvent({ clientId, type: 'error', error: event.error?.message || 'Agent turn failed' });
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-2000); });
    child.once('exit', async (code) => {
      await actionWork;
      if (actionError) this.onEvent({ clientId, type: 'error', error: `XR Shell action failed: ${actionError.message}` });
      this.processes.delete(clientId);
      if (code === 0) this.onEvent({ clientId, type: 'done' });
      else this.onEvent({ clientId, type: 'error', error: stderr.trim() || `Codex exited with status ${code}` });
    });
    child.once('error', (error) => {
      this.processes.delete(clientId);
      this.onEvent({ clientId, type: 'error', error: error.message });
    });
    return { accepted: true, clientId };
  }

  stop(clientId) {
    const child = this.processes.get(clientId);
    if (!this.processes.has(clientId)) return false;
    this.processes.delete(clientId);
    child?.kill();
    return true;
  }

  stopAll() {
    for (const child of this.processes.values()) child?.kill();
    this.processes.clear();
  }
}

module.exports = { ACTION_METHODS, ChatRunner, commandDeckPrompt, contextWithin, extractShellActions };
