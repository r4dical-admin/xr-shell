'use strict';

// Disposable external windows for the XR Shell live-capture and input probe.
const fs = require('node:fs');
const { app, BrowserWindow, screen } = require('electron');

const statePath = process.argv[2];
if (!statePath) throw new Error('Expected a state file path');
if (process.env.XR_SAMPLE_USER_DATA) app.setPath('userData', process.env.XR_SAMPLE_USER_DATA);

function markup(kind) {
  const planner = kind === 'Planner';
  const title = `Sample ${kind}`;
  const content = planner ? `<h1>Launch plan</h1><p>Sample window for the XR Shell walkthrough</p><button id="test-action" onclick="this.textContent='Click received';console.log('XR_SAMPLE_CLICK')">Test app click</button><input id="test-input" aria-label="Input probe" oninput="console.log('XR_SAMPLE_KEY:' + this.value)" />
    <section><strong>Today</strong><article>✓ Review the UI flow</article><article>◌ Capture a window</article><article>◌ Try a second theme</article></section>`
    : `<h1>Live metrics</h1><p>Sample window for the XR Shell walkthrough</p>
    <section><strong>Workspace pulse</strong><article>Sessions <b>03</b></article><article>Windows <b>02</b></article><article>Ready <b>98%</b></article></section>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>
    body{margin:0;padding:35px 43px;background:linear-gradient(145deg,#0d2235,#122b38 60%,#07131e);color:#eefcff;font:16px system-ui}
    h1{font-size:35px;margin:12px 0 4px}p{color:#9fc8d1;margin:0 0 16px}section{border:1px solid #4297aa;border-radius:17px;padding:16px;background:#092231}
    strong{display:block;color:#4cdeec;letter-spacing:.15em;text-transform:uppercase;font-size:12px;margin-bottom:14px}
    article{padding:15px 0;border-top:1px solid #315361}b{float:right;color:#75edb5}
    button{margin:0 0 14px;padding:9px 16px;border:1px solid #68ddec;border-radius:9px;background:#123747;color:#eaffff;font:600 15px system-ui}
  </style></head><body>${content}<script>document.addEventListener('keydown', (event) => console.log('XR_SAMPLE_KEY:' + event.key))</script></body></html>`;
}

app.whenReady().then(async () => {
  app.setAccessibilitySupportEnabled(true);
  const windows = [];
  const work = screen.getPrimaryDisplay().workArea;
  const width = Math.min(520, work.width - 40);
  const height = Math.min(390, work.height - 40);
  for (const [kind, offset] of [['Planner', 20], ['Metrics', 40]]) {
    const window = new BrowserWindow({ width, height, x: work.x + offset, y: work.y + offset, title: `Sample ${kind}`, backgroundColor: '#102432' });
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(markup(kind))}`);
    windows.push(window);
  }
  const planner = windows[0];
  planner.focus();
  const domHit = await planner.webContents.executeJavaScript(`(() => {
    const rect = document.getElementById('test-action').getBoundingClientRect();
    const button = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    return { button, hit: document.elementFromPoint(button.x, button.y)?.id, viewport: { width: innerWidth, height: innerHeight } };
  })()`);
  const state = { button: domHit.button, domHit, bounds: planner.getBounds(), contentBounds: planner.getContentBounds(), clickReceived: false, keyValue: '' };
  const save = () => fs.writeFileSync(statePath, JSON.stringify(state));
  planner.webContents.on('console-message', (...args) => {
    const message = args.find((value) => typeof value === 'string' || (value && typeof value.message === 'string'));
    const value = typeof message === 'string' ? message : message?.message;
    if (value === 'XR_SAMPLE_CLICK') state.clickReceived = true;
    else if (value?.startsWith('XR_SAMPLE_KEY:')) state.keyValue = value.slice('XR_SAMPLE_KEY:'.length);
    else return;
    save();
  });
  save();
}).catch((error) => { console.error(error); app.exit(1); });
