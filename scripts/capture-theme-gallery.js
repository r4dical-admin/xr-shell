'use strict';

// Capture the shell's real themes with an explicitly illustrative sample preview.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const demoState = fs.mkdtempSync(path.join('/tmp', 'xrs-gallery-'));
const originalTmpdir = os.tmpdir;
os.tmpdir = () => demoState;
const userData = path.join(demoState, 'user-data');
fs.mkdirSync(userData);
app.setPath('userData', userData);
require('../main');

const output = path.join(__dirname, '..', 'artifacts', 'workflow');
fs.mkdirSync(output, { recursive: true });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const sample = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="740">
  <defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#071f2a"/><stop offset="1" stop-color="#101b2d"/></linearGradient></defs>
  <rect width="1200" height="740" fill="url(#bg)"/>
  <rect x="34" y="34" width="285" height="672" rx="18" fill="#0c2b37" stroke="#386a80"/>
  <rect x="342" y="34" width="824" height="672" rx="18" fill="#0c2030" stroke="#386a80"/>
  <g fill="#6cd7e5" font-family="Arial,sans-serif"><text x="65" y="90" font-size="20">SAMPLE WORKSPACE</text><text x="375" y="90" font-size="22">Launch plan</text></g>
  <g fill="#d0e6ed" font-family="Arial,sans-serif" font-size="23"><text x="65" y="155">Overview</text><text x="65" y="210">Projects</text><text x="65" y="265">Notes</text><text x="375" y="160">Review the interface</text><text x="375" y="235">Capture a window</text><text x="375" y="310">Switch the shell theme</text></g>
  <g fill="#65d9ae" font-family="Arial,sans-serif" font-size="25"><text x="1080" y="160">✓</text><text x="1080" y="235">✓</text></g>
  <rect x="375" y="600" width="755" height="66" rx="29" fill="#173949" stroke="#64cfdf"/>
  <text x="410" y="641" fill="#b6d7e1" font-family="Arial,sans-serif" font-size="20">A sample application window</text>
</svg>`;

app.whenReady().then(async () => {
  const shell = BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'XR Shell');
  if (!shell) throw new Error('XR Shell did not open');
  shell.setSize(1500, 940);
  shell.center();
  if (shell.webContents.isLoading()) await new Promise((resolve) => shell.webContents.once('did-finish-load', resolve));
  await shell.webContents.executeJavaScript(`(async () => {
    document.getElementById('scale').value = '1.5';
    document.getElementById('scale').dispatchEvent(new Event('input', {bubbles:true}));
    await captureWindow({id:'illustrative-preview',name:'Sample Workspace · illustrative preview',
      thumbnail:${JSON.stringify(`data:image/svg+xml,${encodeURIComponent(sample)}`)}});
    windowPicker.innerHTML = '<option>Illustrative theme preview</option>';
    const panel = capturedWindows.get('illustrative-preview').panel;
    panel.querySelector('.capture-actions em').textContent = '● PREVIEW';
    panel.querySelector('footer span').textContent = 'SAMPLE CONTENT · THEME PREVIEW';
    trackingState.textContent = 'Theme gallery · illustrative sample preview';
  })()`);
  for (const theme of ['horizon', 'brass', 'atomic', 'starship', 'orbital']) {
    await shell.webContents.executeJavaScript(`(() => {
      const picker = document.getElementById('shell-theme-picker');
      picker.value = ${JSON.stringify(theme)};
      picker.dispatchEvent(new Event('change', {bubbles:true}));
    })()`);
    await pause(500);
    fs.writeFileSync(path.join(output, `theme-${theme}.png`), (await shell.webContents.capturePage()).toPNG());
    console.log(`Captured ${theme}`);
  }
  os.tmpdir = originalTmpdir;
  app.quit();
}).catch((error) => {
  console.error(error);
  os.tmpdir = originalTmpdir;
  app.exit(1);
});
