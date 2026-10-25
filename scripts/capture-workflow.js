'use strict';

// Run with: ./node_modules/.bin/electron scripts/capture-workflow.js
// Captures only XR Shell and two disposable sample windows, never the desktop.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { app, BrowserWindow, desktopCapturer, systemPreferences } = require('electron');

const demoState = fs.mkdtempSync(path.join('/tmp', 'xrs-workflow-'));
const originalTmpdir = os.tmpdir;
os.tmpdir = () => demoState; // Keep demo control sockets separate from a running XR Shell.
const userData = path.join(demoState, 'user-data');
fs.mkdirSync(userData);
app.setPath('userData', userData);
app.commandLine.appendSwitch('disable-background-timer-throttling');
const getSources = desktopCapturer.getSources.bind(desktopCapturer);
desktopCapturer.getSources = async (options) => (await getSources(options))
  .filter((item) => /^Sample (Planner|Metrics)$/.test(item.name));
require('../main');

const output = path.join(__dirname, '..', 'artifacts', 'workflow');
const framesDir = path.join(output, 'frames');
fs.mkdirSync(framesDir, { recursive: true });
for (const name of fs.readdirSync(framesDir)) {
  if (/^frame-\d{4}\.png$/.test(name)) fs.unlinkSync(path.join(framesDir, name));
}
let frame = 0;
let sampleProcess;

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const evaluate = (window, source) => window.webContents.executeJavaScript(source, true);

async function capture(window, label) {
  const image = await window.webContents.capturePage();
  const name = `frame-${String(frame++).padStart(4, '0')}.png`;
  fs.writeFileSync(path.join(framesDir, name), image.toPNG());
  if (label) fs.copyFileSync(path.join(framesDir, name), path.join(output, `${label}.png`));
}

async function hold(window, seconds, label) {
  const count = Math.round(seconds * 3);
  for (let index = 0; index < count; index++) {
    await capture(window, index === count - 1 ? label : null);
    await pause(333);
  }
}

async function caption(window, value) {
  await evaluate(window, `(() => {
    let item = document.getElementById('demo-caption');
    if (!item) {
      item = document.createElement('div');
      item.id = 'demo-caption';
      Object.assign(item.style, {position:'fixed',left:'50%',bottom:'86px',transform:'translateX(-50%)',
        zIndex:'100000',maxWidth:'80vw',padding:'14px 26px',border:'1px solid #61d8f5',
        borderRadius:'15px',background:'rgba(2,13,25,.92)',color:'#e9fbff',font:'600 19px system-ui',
        boxShadow:'0 10px 30px rgba(0,0,0,.45)',pointerEvents:'none',textAlign:'center'});
      document.body.append(item);
    }
    item.textContent = ${JSON.stringify(value)};
  })()`);
}

app.whenReady().then(async () => {
  const shell = BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'XR Shell');
  if (!shell) throw new Error('XR Shell window did not open');
  shell.setSize(1500, 940);
  shell.center();
  if (shell.webContents.isLoading()) await new Promise((resolve) => shell.webContents.once('did-finish-load', resolve));
  const sampleStatePath = path.join(demoState, 'samples.json');
  sampleProcess = spawn(process.execPath, [path.join(__dirname, 'workflow-sample-app.js'), sampleStatePath], {
    stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, XR_SAMPLE_USER_DATA: path.join(demoState, 'sample-user-data') }
  });
  sampleProcess.stderr.on('data', (chunk) => console.error(`Sample app: ${chunk.toString()}`));
  const sampleDeadline = Date.now() + 15000;
  while (!fs.existsSync(sampleStatePath) && Date.now() < sampleDeadline) await pause(200);
  if (!fs.existsSync(sampleStatePath)) throw new Error('Disposable sample app did not start');
  await pause(1100);
  console.log('Screen Recording:', systemPreferences.getMediaAccessStatus('screen'));
  const desktopSources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 100, height: 80 } });
  console.log('Desktop sources:', desktopSources.map((item) => ({ id: item.id, name: item.name, empty: item.thumbnail.isEmpty() })));
  if (process.env.XR_INPUT_PROBE !== '1' && desktopSources.some((item) => item.thumbnail.isEmpty())) {
    throw new Error('Screen Recording reports granted, but the sample windows are blank. XR Shell needs a fresh macOS capture permission session.');
  }
  console.log('XR sources:', await evaluate(shell, `window.horizon.listWindows().then(items => items.map(item => ({id:item.id,name:item.name})))`));

  await evaluate(shell, `(() => {
    document.getElementById('scale').value = '1.5';
    document.getElementById('scale').dispatchEvent(new Event('input',{bubbles:true}));
    document.getElementById('height-scale').value = '1';
    document.getElementById('height-scale').dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  await caption(shell, 'XR Shell · sample windows for this walkthrough');
  await hold(shell, 1.6, '01-horizon-start');

  await caption(shell, 'Choose Sample Planner, then Add app');
  const selected = await evaluate(shell, `(async () => {
    await loadWindows(true);
    const source = availableWindows.find(item => item.name.includes('Sample Planner'));
    if (!source) throw new Error('Sample Planner is not capturable');
    windowPicker.value = source.id;
    return source.name;
  })()`);
  console.log('Selecting:', selected);
  await hold(shell, 1);
  await evaluate(shell, `document.getElementById('add-window').click()`);
  await pause(1200);
  await hold(shell, 2, '02-window-added');

  const plannerSource = await evaluate(shell, `availableWindows.find(item => item.name.includes('Sample Planner'))?.id`);
  const inputStatus = await evaluate(shell, `window.horizon.inputStatus()`);
  const menuSnapshot = await evaluate(shell, `window.horizon.menuSnapshot(${JSON.stringify(plannerSource)})`);
  let clickReceived = null;
  if (process.env.XR_INPUT_PROBE === '1') {
    const sampleState = JSON.parse(fs.readFileSync(sampleStatePath, 'utf8'));
    const { button, bounds, contentBounds } = sampleState;
    const point = {
      x: (contentBounds.x + button.x - bounds.x) / bounds.width,
      y: (contentBounds.y + button.y - bounds.y) / bounds.height
    };
    const { InputBridge } = require('../input-bridge');
    const probe = new InputBridge();
    const windowId = Number(plannerSource.split(':')[1]);
    const nativeMetrics = await probe.request({ type: 'window-metrics', windowId });
    const raiseResult = await probe.request({ type: 'raise-window', windowId });
    const axSnapshot = await probe.request({ type: 'snapshot', windowId });
    await evaluate(shell, `window.horizon.sendInput(${JSON.stringify({ sourceId: plannerSource, type: 'activate', button: 0, clickCount: 1, ...point })})`);
    await pause(600);
    clickReceived = JSON.parse(fs.readFileSync(sampleStatePath, 'utf8')).clickReceived;
    await evaluate(shell, `window.horizon.sendInput(${JSON.stringify({ sourceId: plannerSource, type: 'key', keyCode: 0, modifiers: [] })})`);
    await pause(600);
    const keyValue = JSON.parse(fs.readFileSync(sampleStatePath, 'utf8')).keyValue;
    probe.stop();
    console.log('Input check:', JSON.stringify({ inputStatus, menuCount: menuSnapshot.menus?.length, clickReceived, keyValue, nativeMetrics, raiseResult, axSnapshot: { ok: axSnapshot.ok, error: axSnapshot.error }, domHit: sampleState.domHit, point, bounds, contentBounds }));
    sampleProcess.kill();
    os.tmpdir = originalTmpdir;
    app.quit();
    return;
  }
  shell.focus();

  for (const [theme, label] of [
    ['brass', '03-brass'], ['atomic', '04-atomic'], ['starship', '05-starship'], ['orbital', '06-orbital']
  ]) {
    await evaluate(shell, `(() => {
      const picker = document.getElementById('shell-theme-picker');
      picker.value = ${JSON.stringify(theme)};
      picker.dispatchEvent(new Event('change', {bubbles:true}));
    })()`);
    await caption(shell, `Theme: ${theme === 'brass' ? 'Brass Observatory' : theme === 'atomic' ? 'Atomic Tomorrow' : theme === 'starship' ? 'Starship Command' : 'Orbital Lounge'}`);
    await hold(shell, 1.7, label);
  }

  await evaluate(shell, `(() => {
    const picker = document.getElementById('shell-theme-picker');
    picker.value = 'starship';
    picker.dispatchEvent(new Event('change', {bubbles:true}));
    setAgentFocus(true);
    chatInput.value = 'Please pull Sample Metrics into the XR workspace.';
  })()`);
  await caption(shell, 'Ask the Codex agent to pull in Sample Metrics');
  await hold(shell, 2, '07-agent-prompt');
  await evaluate(shell, `document.getElementById('chat-send').click()`);
  await caption(shell, 'Codex agent request sent · waiting for the window');
  const deadline = Date.now() + 90000;
  let result = null;
  while (Date.now() < deadline) {
    await capture(shell);
    result = await evaluate(shell, `(() => ({
      captured: [...capturedWindows.values()].map(item => item.source.name),
      session: sessions[0] && {status:sessions[0].status, messages:sessions[0].messages.slice(-2)}
    }))()`);
    if (result.captured.some((name) => name.includes('Sample Metrics')) || result.session?.status === 'error') break;
    await pause(1800);
  }
  console.log('Agent result:', JSON.stringify(result));
  await evaluate(shell, `setAgentFocus(false)`);
  await caption(shell, result?.captured?.some((name) => name.includes('Sample Metrics'))
    ? 'Agent pulled in the second live sample window'
    : 'Agent did not complete the window pull in this recording');
  await hold(shell, 3, '08-agent-result');
  fs.writeFileSync(path.join(output, 'capture-result.json'), JSON.stringify({ selected, inputStatus, menuCount: menuSnapshot.menus?.length, clickReceived, result, frames: frame }, null, 2));
  sampleProcess.kill();
  os.tmpdir = originalTmpdir;
  app.quit();
}).catch((error) => {
  console.error(error);
  sampleProcess?.kill();
  os.tmpdir = originalTmpdir;
  app.exit(1);
});
