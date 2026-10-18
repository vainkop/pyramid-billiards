// Checks the app as a Telegram Mini App and as a plain web page, in headless Chromium.
//
//   node tools/telegram-check.mjs [screenshot-dir]
//
// Needs `chromium-browser` (Termux: pkg install chromium) or $CHROME. Serves the repo itself,
// opens it once as on the web and once as Telegram's Android client would (launch parameters in
// the hash, the TelegramWebviewProxy bridge, safe-area events), and fails if:
//   - the plain web page loads anything from telegram.org or Telegram mode does not switch on
//   - the page is not padded by the device + Telegram insets
//   - Telegram's Back button does not appear on a lesson or does not lead back
//   - swipe-to-close is not disabled, ready() is not called or progress is not copied to DeviceStorage
//   - the page throws
// Phone size: 384 × 749 CSS px at 2.8125 (Galaxy S24 Ultra, measured).

import { createServer } from 'node:http';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, extname, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const SHOTS = process.argv[2];
const CHROME = process.env.CHROME ?? 'chromium-browser';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = createServer(async (req, res) => {
  const path = join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!path.startsWith(ROOT)) return res.writeHead(403).end();
  try {
    const body = await readFile(path.endsWith('/') ? join(path, 'index.html') : path);
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}/index.html`;

let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failed++;
};

/** One fresh browser per run: no service worker or storage left from the other. */
async function session(run) {
  const profile = await mkdtemp(join(tmpdir(), 'tgcheck-'));
  const port = 9300 + Math.floor(Math.random() * 600);
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  try {
    let targets;
    for (let k = 0; k < 40 && !targets; k++) {
      await sleep(250);
      targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json()).catch(() => null);
    }
    const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener('open', r));
    let id = 0;
    const wait = new Map();
    const errors = [];
    const requests = [];
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
      if (m.method === 'Network.requestWillBeSent') requests.push(m.params.request.url);
      if (wait.has(m.id)) {
        wait.get(m.id)(m);
        wait.delete(m.id);
      }
    });
    const cmd = (method, params = {}) => new Promise((r) => {
      const i = ++id;
      wait.set(i, r);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
    const ev = async (expression) => (await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.result?.value;
    const shot = async (name) => {
      if (!SHOTS) return;
      const r = await cmd('Page.captureScreenshot', { format: 'png' });
      await writeFile(join(SHOTS, name), Buffer.from(r.result.data, 'base64'));
    };
    await cmd('Runtime.enable');
    await cmd('Network.enable');
    await cmd('Page.enable');
    await cmd('Emulation.setDeviceMetricsOverride', { width: 384, height: 749, deviceScaleFactor: 2.8125, mobile: true });
    await run({ cmd, ev, shot, errors, requests });
    ws.close();
  } finally {
    const exited = new Promise((r) => chrome.once('exit', r));
    chrome.kill();
    await exited;
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

const startKolkhoz = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  localStorage.setItem('pyramid:setting:variant', JSON.stringify('free'));
  location.hash = '#/game/kolkhoz'; await sleep(600);
  [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Начать колхоз')).click();
  await sleep(1500);
})()`;
const padTop = `parseFloat(getComputedStyle(document.querySelector('.view')).paddingTop)`;

console.log('— plain web page');
await session(async ({ cmd, ev, shot, errors, requests }) => {
  await cmd('Page.navigate', { url: base });
  await sleep(2500);
  check(!(await ev(`document.documentElement.classList.contains('tg')`)), 'not in Telegram mode');
  check(!requests.some((u) => u.includes('telegram.org')), 'nothing loaded from telegram.org');
  await ev(startKolkhoz);
  await shot('web-game.png');
  check(errors.length === 0, `no errors ${errors.join(' | ')}`);
});

console.log('— Telegram (Android client, full screen)');
await session(async ({ cmd, ev, shot, errors }) => {
  // the Android client's bridge: record every call the app makes to Telegram
  await cmd('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__tg = []; window.TelegramWebviewProxy = { postEvent(type, data) { window.__tg.push([type, data ? JSON.parse(data) : null]); } };`,
  });
  const theme = encodeURIComponent(JSON.stringify({ bg_color: '#17212b', text_color: '#f5f5f5' }));
  const data = encodeURIComponent('user=%7B%22id%22%3A1%7D&auth_date=1&hash=x');
  await cmd('Page.navigate', { url: `${base}#tgWebAppData=${data}&tgWebAppVersion=9.1&tgWebAppPlatform=android&tgWebAppThemeParams=${theme}` });
  await sleep(3500);
  const calls = async (type) => (await ev('window.__tg')).filter(([t]) => t === type).map(([, d]) => d);
  check(await ev(`document.documentElement.classList.contains('tg')`), 'Telegram mode on');
  check((await ev('location.hash')) === '#/lessons', 'launch parameters cleared from the route');
  check((await calls('web_app_ready')).length === 1, 'ready() called');
  check((await calls('web_app_setup_swipe_behavior')).some((d) => d.allow_vertical_swipe === false), 'swipe-to-close off');
  await ev(`Telegram.WebView.receiveEvent('safe_area_changed', { top: 36, bottom: 24, left: 0, right: 0 });
    Telegram.WebView.receiveEvent('content_safe_area_changed', { top: 48, bottom: 0, left: 0, right: 0 })`);
  await sleep(300);
  check((await ev(padTop)) === 84, 'page padded by device + Telegram insets (36 + 48 px)');
  await ev(`location.hash = '#/lesson/2'`);
  await sleep(500);
  check((await calls('web_app_setup_back_button')).at(-1)?.is_visible === true, 'Back button shown on a lesson');
  check((await ev(`getComputedStyle(document.querySelector('a.back')).display`)) === 'none', "page's own «Назад» hidden");
  await ev(`Telegram.WebView.receiveEvent('back_button_pressed')`);
  await sleep(500);
  check((await ev('location.hash')) === '#/lessons', 'Back button leads back');
  check((await calls('web_app_setup_back_button')).at(-1)?.is_visible === false, 'Back button hidden on the list');
  await ev(startKolkhoz);
  await sleep(1500);
  check((await calls('web_app_device_storage_save_key')).length > 0, 'progress copied to DeviceStorage');
  await shot('telegram-game.png');
  check(errors.length === 0, `no errors ${errors.join(' | ')}`);
});

server.close();
console.log(failed ? `${failed} FAILED` : 'ALL OK');
process.exit(failed ? 1 : 0);
