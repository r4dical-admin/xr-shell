'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { requireJobId } = require('./progress');

const MAX_CONCURRENT = 4;
const MAX_OUTPUT = 8192;
const RUNTIMES = Object.freeze({
  '.py': ['/usr/bin/env', 'python3'],
  '.sh': ['/bin/bash']
});

function nodeRuntime() {
  const candidates = [process.env.XR_SHELL_NODE_PATH, process.env.npm_node_execpath, '/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node'];
  const executable = candidates.find((candidate) => candidate && path.isAbsolute(candidate) && fs.existsSync(candidate));
  return executable ? [executable] : ['/usr/bin/env', 'node'];
}

function scriptRequest(params = {}) {
  const jobId = params.jobId === undefined || params.jobId === null || params.jobId === '' ? null : requireJobId(params.jobId);
  const display = params.display || 'background';
  if (!['background', 'terminal'].includes(display)) throw new Error('display must be background or terminal');
  const inputPath = params.scriptPath;
  if (typeof inputPath !== 'string' || !path.isAbsolute(inputPath) || /[\x00-\x1f\x7f]/.test(inputPath)) throw new Error('scriptPath must be an absolute local path');
  const scriptPath = fs.realpathSync(inputPath);
  const stat = fs.statSync(scriptPath);
  if (!stat.isFile()) throw new Error('scriptPath must point to a file');
  const extension = path.extname(scriptPath).toLowerCase();
  const runtime = ['.js', '.mjs', '.cjs'].includes(extension) ? nodeRuntime() : RUNTIMES[extension];
  if (!runtime) throw new Error('Only .py, .js, .mjs, .cjs, and .sh scripts are supported');
  const args = params.args === undefined ? [] : params.args;
  if (!Array.isArray(args) || args.length > 24 || args.some((arg) => typeof arg !== 'string' || arg.length > 400 || /[\x00-\x1f\x7f]/.test(arg))) {
    throw new Error('args must be an array of at most 24 short strings');
  }
  return { jobId, display, scriptPath, args, command: runtime[0], commandArgs: [...runtime.slice(1), scriptPath, ...args], cwd: path.dirname(scriptPath) };
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function terminalLauncher(request, runId, temporaryRoot = os.tmpdir()) {
  const directory = fs.mkdtempSync(path.join(temporaryRoot, 'xr-shell-terminal-'));
  const launcherPath = path.join(directory, `${runId}.command`);
  const statusPath = path.join(directory, 'exit-status');
  const command = [request.command, ...request.commandArgs].map(shellQuote).join(' ');
  const source = `#!/bin/zsh\nprintf '\\033]0;XR Shell %s\\007' ${shellQuote(runId)}\nif cd -- ${shellQuote(request.cwd)}; then\n  ${command}\n  xr_shell_exit=$?\nelse\n  xr_shell_exit=1\nfi\nprint -r -- "$xr_shell_exit" > ${shellQuote(statusPath)}\nprint -r -- "[XR Shell] Script exited with status $xr_shell_exit"\nexec /bin/zsh -l\n`;
  fs.writeFileSync(launcherPath, source, { mode: 0o700, flag: 'wx' });
  return { directory, launcherPath, statusPath };
}

class ScriptRunner {
  constructor({ spawnProcess = spawn } = {}) {
    this.spawnProcess = spawnProcess;
    this.runs = new Map();
  }

  hasCapacity() {
    if ([...this.runs.values()].filter((run) => ['launching', 'running'].includes(run.status)).length >= MAX_CONCURRENT) throw new Error('At most four scripts can run at once');
  }

  remember(run) {
    this.runs.set(run.runId, run);
    if (this.runs.size > 50) {
      const completed = [...this.runs.values()].find((entry) => !['launching', 'running'].includes(entry.status));
      if (completed) this.runs.delete(completed.runId);
    }
  }

  async launch(request) {
    this.hasCapacity();
    const runId = randomUUID();
    const run = { runId, jobId: request.jobId, display: 'background', scriptPath: request.scriptPath, args: request.args, status: 'running', startedAt: Date.now(), finishedAt: null, exitCode: null, signal: null, stdout: '', stderr: '' };
    const child = this.spawnProcess(request.command, request.commandArgs, {
      cwd: request.cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe']
    });
    run.pid = child.pid || null;
    this.remember(run);
    const append = (field, chunk) => { run[field] = `${run[field]}${chunk}`.slice(-MAX_OUTPUT); };
    child.stdout?.on('data', (chunk) => append('stdout', chunk));
    child.stderr?.on('data', (chunk) => append('stderr', chunk));
    const launched = new Promise((resolve, reject) => {
      child.once('spawn', () => resolve(this.status(runId)));
      child.once('error', (error) => {
        run.status = 'failed';
        run.stderr = `${run.stderr}${error.message}`.slice(-MAX_OUTPUT);
        run.finishedAt = Date.now();
        reject(error);
      });
    });
    child.once('exit', (code, signal) => {
      run.exitCode = code;
      run.signal = signal;
      run.status = code === 0 ? 'succeeded' : 'failed';
      run.finishedAt = Date.now();
    });
    return launched;
  }

  async launchTerminal(request, openLauncher) {
    this.hasCapacity();
    const runId = randomUUID();
    const launch = terminalLauncher(request, runId);
    const run = { runId, jobId: request.jobId, display: 'terminal', scriptPath: request.scriptPath, args: request.args, status: 'launching', startedAt: Date.now(), finishedAt: null, exitCode: null, signal: null, stdout: '', stderr: '', attached: false };
    this.remember(run);
    const cleanup = () => {
      clearInterval(run.pollTimer);
      try { fs.rmSync(launch.directory, { recursive: true, force: true }); } catch { /* temporary launcher cleanup */ }
    };
    run.pollTimer = setInterval(() => {
      try {
        const raw = fs.readFileSync(launch.statusPath, 'utf8').trim();
        if (!raw) return;
        const code = Number(raw);
        if (!Number.isSafeInteger(code)) throw new Error('Invalid terminal exit status');
        run.exitCode = code;
        run.status = code === 0 ? 'succeeded' : 'failed';
        run.finishedAt = Date.now();
        cleanup();
      } catch (error) {
        if (error.code !== 'ENOENT') {
          run.status = 'failed';
          run.stderr = error.message;
          run.finishedAt = Date.now();
          cleanup();
        }
      }
    }, 500);
    run.pollTimer.unref?.();
    try {
      await openLauncher(launch.launcherPath);
      if (run.status === 'launching') run.status = 'running';
      return this.status(runId);
    } catch (error) {
      run.status = 'failed';
      run.stderr = error.message;
      run.finishedAt = Date.now();
      cleanup();
      throw error;
    }
  }

  attach(runId, sourceId) {
    const run = this.runs.get(runId);
    if (!run || run.display !== 'terminal') throw new Error('Unknown terminal run');
    run.attached = true;
    run.sourceId = sourceId;
    return this.status(runId);
  }

  status(runId) {
    const run = this.runs.get(String(runId || ''));
    if (!run) throw new Error('Unknown script run');
    const { pollTimer, ...publicRun } = run;
    return { ...publicRun };
  }
}

module.exports = { ScriptRunner, scriptRequest, shellQuote, terminalLauncher };
