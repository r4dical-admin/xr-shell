'use strict';

// Record XR Shell itself with clearly labeled illustrative app content.
// Run: ./node_modules/.bin/electron scripts/record-spatial-demo.js
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const isolated = fs.mkdtempSync(path.join('/tmp', 'xrs-spatial-demo-'));
const originalTmpdir = os.tmpdir;
os.tmpdir = () => isolated;
const userData = path.join(isolated, 'user-data');
fs.mkdirSync(userData);
app.setPath('userData', userData);
app.commandLine.appendSwitch('disable-background-timer-throttling');
require('../main');

const output = path.join(__dirname, '..', 'artifacts', 'workflow', 'spatial-demo');
const framesDir = path.join(output, 'frames');
fs.mkdirSync(framesDir, { recursive: true });
for (const name of fs.readdirSync(framesDir)) {
  if (/^frame-\d{4}\.png$/.test(name)) fs.unlinkSync(path.join(framesDir, name));
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const evaluate = (window, script) => window.webContents.executeJavaScript(script, true);
const svgUrl = (svg) => `data:image/svg+xml,${encodeURIComponent(svg)}`;
let frameIndex = 0;

const planner = svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="750" viewBox="0 0 1200 750">
  <defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#071a26"/><stop offset="1" stop-color="#0a2d36"/></linearGradient></defs>
  <rect width="1200" height="750" fill="url(#bg)"/><rect x="28" y="28" width="290" height="694" rx="18" fill="#102d39" stroke="#347d91"/>
  <rect x="340" y="28" width="830" height="694" rx="18" fill="#0a202e" stroke="#347d91"/>
  <g font-family="Arial,sans-serif" fill="#72dce6"><text x="60" y="82" font-size="19" letter-spacing="3">SAMPLE PLANNER</text><text x="378" y="88" font-size="18" letter-spacing="3">TODAY'S WORKSPACE</text></g>
  <g font-family="Arial,sans-serif" fill="#d6eef2" font-size="23"><text x="60" y="156">Overview</text><text x="60" y="216">Projects</text><text x="60" y="276">Sessions</text><text x="60" y="336">Notes</text></g>
  <g font-family="Arial,sans-serif" fill="#d6eef2" font-size="25"><text x="380" y="175">Review the interface</text><text x="380" y="266">Arrange captured windows</text><text x="380" y="357">Try a different theme</text><text x="380" y="448">Explore the panorama</text></g>
  <g font-family="Arial,sans-serif" fill="#70e1b2" font-size="29"><text x="1084" y="175">✓</text><text x="1084" y="266">✓</text></g>
  <g stroke="#355b68"><path d="M380 198h740M380 289h740M380 380h740M380 471h740"/></g>
  <rect x="378" y="614" width="744" height="65" rx="26" fill="#143e4e" stroke="#5ac8df"/><text x="408" y="655" fill="#b5dce5" font-family="Arial,sans-serif" font-size="22">A sample app in the spatial workspace</text>
</svg>`);

const metrics = svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="750" viewBox="0 0 1200 750">
  <defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#111e31"/><stop offset="1" stop-color="#071f2b"/></linearGradient></defs>
  <rect width="1200" height="750" fill="url(#bg)"/><rect x="35" y="35" width="1130" height="680" rx="21" fill="#0a2332" stroke="#3b8ca7"/>
  <text x="76" y="103" fill="#80e8ee" font-family="Arial,sans-serif" font-size="25" letter-spacing="4">SAMPLE METRICS</text>
  <text x="76" y="157" fill="#d8eef5" font-family="Arial,sans-serif" font-size="40">Workspace pulse</text>
  <g font-family="Arial,sans-serif"><rect x="75" y="203" width="316" height="205" rx="16" fill="#123949" stroke="#367d94"/><rect x="443" y="203" width="316" height="205" rx="16" fill="#123949" stroke="#367d94"/><rect x="811" y="203" width="316" height="205" rx="16" fill="#123949" stroke="#367d94"/>
  <g fill="#a8d3dc" font-size="22"><text x="104" y="252">Sessions</text><text x="472" y="252">Windows</text><text x="840" y="252">Ready</text></g>
  <g fill="#73e6dc" font-size="69"><text x="104" y="351">03</text><text x="472" y="351">02</text><text x="840" y="351">98%</text></g>
  <text x="76" y="490" fill="#77cedd" font-size="22">ACTIVITY</text><text x="76" y="554" fill="#d8eef5" font-size="25">Window layout updated</text><text x="76" y="614" fill="#d8eef5" font-size="25">Spatial theme synchronized</text></g>
</svg>`);

async function capture(window) {
  const image = await window.webContents.capturePage();
  const resized = image.resize({ width: 1920 });
  fs.writeFileSync(path.join(framesDir, `frame-${String(frameIndex++).padStart(4, '0')}.png`), resized.toPNG());
}

async function hold(window, frames) {
  for (let index = 0; index < frames; index++) {
    await pause(55);
    await capture(window);
  }
}

async function caption(window, text) {
  await evaluate(window, `(() => {
    let item = document.getElementById('demo-caption');
    if (!item) {
      item = document.createElement('div'); item.id = 'demo-caption';
      Object.assign(item.style, {position:'fixed',left:'50%',bottom:'86px',transform:'translateX(-50%)',zIndex:'100000',
        maxWidth:'82vw',padding:'13px 25px',border:'1px solid #64d7ef',borderRadius:'14px',
        background:'rgba(2,13,25,.94)',color:'#e9fbff',font:'600 20px system-ui',
        boxShadow:'0 12px 35px rgba(0,0,0,.5)',pointerEvents:'none',textAlign:'center'});
      document.body.append(item);
    }
    item.textContent = ${JSON.stringify(text)};
  })()`);
}

async function sweep(window, from, to, frames, pitchFrom = 0, pitchTo = 0) {
  for (let index = 0; index < frames; index++) {
    const t = (index + 1) / frames;
    const eased = t * t * (3 - 2 * t);
    const yaw = from + (to - from) * eased;
    const pitch = pitchFrom + (pitchTo - pitchFrom) * eased;
    await evaluate(window, `targetYaw = ${yaw}; targetPitch = ${pitch};`);
    await pause(65);
    await capture(window);
  }
}

async function theme(window, id, name, frames = 18) {
  await evaluate(window, `(() => {
    const picker = document.getElementById('shell-theme-picker');
    picker.value = ${JSON.stringify(id)};
    picker.dispatchEvent(new Event('change', {bubbles:true}));
  })()`);
  await caption(window, `Switch the shell theme · ${name}`);
  await hold(window, frames);
}

app.whenReady().then(async () => {
  const shell = BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'XR Shell');
  if (!shell) throw new Error('XR Shell window did not open');
  shell.setSize(1500, 940);
  shell.center();
  if (shell.webContents.isLoading()) await new Promise((resolve) => shell.webContents.once('did-finish-load', resolve));
  await evaluate(shell, `(() => {
    const width = document.getElementById('scale'); width.value = '2.25'; width.dispatchEvent(new Event('input',{bubbles:true}));
    const height = document.getElementById('height-scale'); height.value = '1.35'; height.dispatchEvent(new Event('input',{bubbles:true}));
    const label = document.createElement('div'); label.id = 'demo-content-label'; label.textContent = 'ILLUSTRATIVE APP CONTENT · REAL XR SHELL UI';
    Object.assign(label.style, {position:'fixed',top:'108px',right:'35px',zIndex:'100000',color:'#9de3f3',font:'600 10px system-ui',letterSpacing:'.18em',pointerEvents:'none'});
    document.body.append(label);
    spatialMenuBar.style.setProperty('display', 'none', 'important');
  })()`);

  await caption(shell, 'XR Shell · a workspace larger than the display');
  await hold(shell, 25);
  await evaluate(shell, `(async () => { await captureWindow({id:'demo-planner',name:'Sample Planner · illustrative',thumbnail:${JSON.stringify(planner)}}); return true; })()`);
  await evaluate(shell, `(() => {
    const panel = capturedWindows.get('demo-planner').panel;
    setPanelSize(panel, 650, 500); layoutCapturedWindows();
    panel.querySelector('.capture-actions em').textContent = '● PREVIEW';
    panel.querySelector('footer span').textContent = 'SAMPLE APP CONTENT · ILLUSTRATIVE';
  })()`);
  await caption(shell, 'Pull an app into the XR workspace');
  await hold(shell, 28);

  await evaluate(shell, `(async () => { await captureWindow({id:'demo-metrics',name:'Sample Metrics · illustrative',thumbnail:${JSON.stringify(metrics)}}); return true; })()`);
  await evaluate(shell, `(() => {
    const panel = capturedWindows.get('demo-metrics').panel;
    setPanelSize(panel, 650, 500); layoutCapturedWindows();
    panel.querySelector('.capture-actions em').textContent = '● PREVIEW';
    panel.querySelector('footer span').textContent = 'SAMPLE APP CONTENT · ILLUSTRATIVE';
  })()`);
  await caption(shell, 'Arrange multiple app surfaces in space');
  await hold(shell, 26);

  await caption(shell, 'Simulated head movement · look right');
  await sweep(shell, 0, .62, 38, 0, .08);
  await hold(shell, 9);
  await caption(shell, 'Look across the panorama');
  await sweep(shell, .62, -.62, 60, .08, -.08);
  await hold(shell, 9);
  await caption(shell, 'Recenter the view');
  await sweep(shell, -.62, 0, 36, -.08, 0);

  await theme(shell, 'brass', 'Brass Observatory');
  await theme(shell, 'atomic', 'Atomic Tomorrow');
  await theme(shell, 'starship', 'Starship Command');
  await theme(shell, 'orbital', 'Orbital Lounge');

  await caption(shell, 'Choose one of the open Terminal windows');
  await evaluate(shell, `(() => {
    removeCapturedWindow('demo-planner');
    removeCapturedWindow('demo-metrics');
    document.getElementById('demo-caption').textContent = 'Choose one of the open Terminal windows';
  })()`);
  const terminalSource = await evaluate(shell, `(async () => {
    await loadWindows(true);
    const match = availableWindows.find((item) => /^xr-shell\\s+—.*zsh/i.test(item.name))
      || availableWindows.find((item) => /zsh|terminal|iterm|warp/i.test(item.name));
    if (!match?.thumbnail) throw new Error('No capturable Terminal window is available');
    windowPicker.value = match.id;
    return { id: match.id, name: match.name };
  })()`);
  await hold(shell, 14);
  await caption(shell, 'Add app · live Terminal window');
  await evaluate(shell, `document.getElementById('add-window').click()`);
  await pause(1600);
  await evaluate(shell, `(() => {
    const record = capturedWindows.get(${JSON.stringify(terminalSource.id)});
    const video = record?.panel.querySelector('video');
    if (!record?.stream || !video?.videoWidth) throw new Error('Terminal live capture did not start');
    record.panel.dataset.manualSize = 'true';
    setPanelSize(record.panel, 900, 570);
    layoutCapturedWindows();
    const label = document.getElementById('demo-content-label');
    if (label) label.textContent = 'LIVE TERMINAL CAPTURE · REAL XR SHELL UI';
  })()`);
  await caption(shell, 'A real Terminal window, live in XR Shell');
  await hold(shell, 38);
  await caption(shell, 'Move again · the workspace stays anchored');
  await sweep(shell, 0, .25, 22);
  await sweep(shell, .25, 0, 22);
  await caption(shell, 'XR Shell · plan, build, explore');
  await hold(shell, 25);

  fs.writeFileSync(path.join(output, 'capture-result.json'), JSON.stringify({ frames: frameIndex, sampleContent: 'illustrative planner and metrics; live open Terminal capture', terminal: terminalSource.name, camera: 'simulated head movement', source: 'XR Shell renderer' }, null, 2));
  console.log(`Captured ${frameIndex} frames in ${framesDir}`);
  os.tmpdir = originalTmpdir;
  app.quit();
}).catch((error) => {
  console.error(error);
  os.tmpdir = originalTmpdir;
  app.exit(1);
});
