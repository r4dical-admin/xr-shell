'use strict';

const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

function defaultSocketPath() {
  const uid = typeof process.getuid === 'function' ? process.getuid() : 'user';
  return path.join(os.tmpdir(), `xr-shell-${uid}.sock`);
}

class ControlServer {
  constructor({ socketPath = defaultSocketPath(), onRequest }) {
    this.socketPath = socketPath;
    this.onRequest = onRequest;
  }

  start() {
    if (this.server) return;
    try { fs.unlinkSync(this.socketPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    this.server = net.createServer((socket) => this.handleSocket(socket));
    this.server.on('error', (error) => console.error('XR Shell control socket:', error.message));
    this.server.listen(this.socketPath, () => {
      try { fs.chmodSync(this.socketPath, 0o600); } catch { /* best effort */ }
    });
  }

  handleSocket(socket) {
    socket.setEncoding('utf8');
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk;
      if (buffer.length > 1024 * 1024) return socket.destroy();
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        this.handleLine(socket, line);
      }
    });
  }

  async handleLine(socket, line) {
    let request;
    try { request = JSON.parse(line); } catch { return socket.write(`${JSON.stringify({ ok: false, error: 'invalid-json' })}\n`); }
    const id = request.id;
    try {
      const result = await this.onRequest(String(request.method || ''), request.params || {});
      socket.write(`${JSON.stringify({ id, ok: true, result })}\n`);
    } catch (error) {
      socket.write(`${JSON.stringify({ id, ok: false, error: error.message })}\n`);
    }
  }

  stop() {
    this.server?.close();
    this.server = null;
    try { fs.unlinkSync(this.socketPath); } catch (error) { if (error.code !== 'ENOENT') console.error(error.message); }
  }
}

module.exports = { ControlServer, defaultSocketPath };
