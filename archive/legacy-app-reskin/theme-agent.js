'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const { normalizeGeneratedTheme } = require('./theme-engine');

function compactProfile(profile) {
  return {
    app: profile.app,
    capabilities: profile.capabilities,
    roleSamples: profile.roleSamples,
    eventPatterns: profile.eventPatterns,
    latestLayout: (profile.latestLayout || []).slice(0, 220)
  };
}

function themePrompt(profile) {
  return [
    'You are the visual designer for an XR application shell.',
    'Create a distinctive, legible futuristic theme from this macOS Accessibility profile.',
    'Infer the app workflow from role frequency, event patterns, actions, and spatial layout.',
    'Do not reproduce private content or labels in the theme. Favor strong contrast and restrained glow.',
    'Use roleEffects only for AX roles present in the profile. Return only the JSON required by the supplied schema.',
    '',
    JSON.stringify(compactProfile(profile))
  ].join('\n');
}

class ThemeAgent {
  constructor({ homeDirectory, workingDirectory }) {
    this.cli = path.join(homeDirectory, '.local', 'bin', 'codex');
    this.workingDirectory = workingDirectory;
    this.processes = new Set();
  }

  generate(profile) {
    return new Promise((resolve, reject) => {
      const child = spawn(this.cli, [
        'exec', '-c', 'approval_policy="never"', '--json', '--ephemeral', '--sandbox', 'read-only',
        '--skip-git-repo-check', '--output-schema', path.join(__dirname, 'theme-schema.json'),
        '-C', this.workingDirectory, '-'
      ], { cwd: this.workingDirectory, stdio: ['pipe', 'pipe', 'pipe'] });
      this.processes.add(child);
      let finalText = '';
      let stderr = '';
      const lines = readline.createInterface({ input: child.stdout });
      lines.on('line', (line) => {
        try {
          const event = JSON.parse(line);
          if (event.type === 'item.completed' && event.item?.type === 'agent_message') finalText = event.item.text || '';
          if (event.type === 'turn.failed') stderr = event.error?.message || 'Theme generation failed';
        } catch { /* ignore non-JSON status output */ }
      });
      child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-3000); });
      child.once('error', reject);
      child.once('exit', (code) => {
        this.processes.delete(child);
        if (code !== 0) return reject(new Error(stderr.trim() || `Codex exited with status ${code}`));
        try {
          resolve(normalizeGeneratedTheme(JSON.parse(finalText), profile));
        } catch (error) {
          reject(new Error(`Invalid generated theme: ${error.message}`));
        }
      });
      child.stdin.end(themePrompt(profile));
    });
  }

  stopAll() {
    for (const child of this.processes) child.kill();
    this.processes.clear();
  }
}

module.exports = { ThemeAgent, compactProfile };
