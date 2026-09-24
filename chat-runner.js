'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');
const readline = require('node:readline');

class ChatRunner {
  constructor({ homeDirectory, workingDirectory, onEvent }) {
    this.cli = path.join(homeDirectory, '.local', 'bin', 'codex');
    this.workingDirectory = workingDirectory;
    this.onEvent = onEvent;
    this.processes = new Map();
    this.mcpServer = path.join(workingDirectory, 'mcp', 'server.js');
  }

  send({ clientId, threadId, prompt }) {
    const text = String(prompt || '').trim().slice(0, 12000);
    if (!clientId || !text) return { accepted: false, error: 'invalid-chat-request' };
    if (this.processes.has(clientId)) return { accepted: false, error: 'session-busy' };
    const mcpConfig = [
      '-c', 'mcp_servers.xr_shell.command="node"',
      '-c', `mcp_servers.xr_shell.args=[${JSON.stringify(this.mcpServer)}]`
    ];
    const args = threadId
      ? ['exec', '-c', 'approval_policy="never"', ...mcpConfig, 'resume', '--json', '--skip-git-repo-check', threadId, text]
      : ['exec', '-c', 'approval_policy="never"', ...mcpConfig, '--json', '--sandbox', 'read-only', '--skip-git-repo-check', '-C', this.workingDirectory, text];
    const child = spawn(this.cli, args, { cwd: this.workingDirectory, stdio: ['ignore', 'pipe', 'pipe'] });
    this.processes.set(clientId, child);
    this.onEvent({ clientId, type: 'status', status: 'starting' });
    const lines = readline.createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      let event;
      try { event = JSON.parse(line); } catch { return; }
      if (event.type === 'thread.started') this.onEvent({ clientId, type: 'thread', threadId: event.thread_id });
      if (event.type === 'item.started') this.onEvent({ clientId, type: 'status', status: event.item?.type || 'working' });
      if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
        this.onEvent({ clientId, type: 'message', text: event.item.text || '' });
      }
      if (event.type === 'turn.completed') this.onEvent({ clientId, type: 'status', status: 'complete', usage: event.usage });
      if (event.type === 'turn.failed') this.onEvent({ clientId, type: 'error', error: event.error?.message || 'Agent turn failed' });
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-2000); });
    child.once('exit', (code) => {
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
    if (!child) return false;
    this.processes.delete(clientId);
    child.kill();
    return true;
  }

  stopAll() {
    for (const child of this.processes.values()) child.kill();
    this.processes.clear();
  }
}

module.exports = { ChatRunner };
