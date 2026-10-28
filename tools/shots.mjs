/* 用 CDP 精确截图（--window-size 在 Windows Chrome 上会被钳制，截出来会右裁）
   跑法：node tools/shots.mjs [站点地址]
   产出：shots/home.png / quiz.png / result.png / text.png / poster.png
*/
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const BASE = (process.argv[2] || "https://abbccdd.github.io/aiti16/").replace(/\/?$/, "/");
const OUT = path.join(ROOT, "shots");
const PORT = 9500 + Math.floor(Math.random() * 300);

const CANDIDATES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
];
const chromePath = CANDIDATES.find((p) => fs.existsSync(p));
if (!chromePath) {
  console.log("没找到 Chrome/Edge");
  process.exit(0);
}
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "aiti-shots-"));
const chrome = spawn(
  chromePath,
  ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--disable-extensions", `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, "about:blank"],
  { stdio: "ignore" }
);

let ws;
let id = 0;
const pending = new Map();
const listeners = [];

function send(method, params = {}) {
  const msgId = ++id;
  ws.send(JSON.stringify({ id: msgId, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(msgId, { resolve, reject });
    setTimeout(() => {
      if (pending.has(msgId)) { pending.delete(msgId); reject(new Error(`CDP 超时 ${method}`)); }
    }, 30000);
  });
}

function waitEvent(name, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`等不到 ${name}`)), timeout);
    listeners.push({ name, resolve: (p) => { clearTimeout(timer); resolve(p); } });
  });
}

async function evaluate(expression) {
  const res = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
  return res.result.value;
}

async function shoot(name, { width, height, mobile = true, url, setup, fullPage = true, settle = 1200 }) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
  const loaded = waitEvent("Page.loadEventFired");
  await send("Page.navigate", { url });
  await loaded;
  await sleep(900);
  if (setup) { await evaluate(setup); await sleep(settle); }

  // 截图前的状态探针：确认这一帧里页面到底是哪个状态
  const probe = await evaluate(`(() => {
    const q = (id) => document.getElementById(id);
    return {
      view: ['home','quiz','result','ai','poster'].filter(v => { const n = q('view-' + v); return n && !n.classList.contains('hidden'); }).join(',') || '(none)',
      count: (q('quiz-count') || {}).textContent || '',
      logItems: document.querySelectorAll('#think-log .log-item').length,
      picked: document.querySelectorAll('#quiz-options .opt.is-picked').length
    };
  })()`);

  // 整页截图前先滚一遍，触发 loading="lazy" 的缩略图
  if (fullPage) {
    await evaluate(`(async () => {
      const step = window.innerHeight;
      for (let y = 0; y < document.body.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 130));
      }
      window.scrollTo(0, 0);
      await new Promise((r) => setTimeout(r, 400));
      return document.body.scrollHeight;
    })()`);
    await sleep(400);
  }

  let clip;
  if (fullPage) {
    const m = await send("Page.getLayoutMetrics");
    const size = m.cssContentSize || m.contentSize;
    clip = { x: 0, y: 0, width: Math.ceil(size.width), height: Math.ceil(size.height), scale: 1 };
  } else {
    clip = { x: 0, y: 0, width, height, scale: 1 };
  }
  let shot;
  try {
    shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: fullPage, clip });
  } catch (err) {
    shot = await send("Page.captureScreenshot", { format: "png" });
  }
  const file = path.join(OUT, name);
  fs.writeFileSync(file, Buffer.from(shot.data, "base64"));
  console.log(`  ${name.padEnd(12)} ${clip.width}×${clip.height}  ${(fs.statSync(file).size / 1024).toFixed(0)} KB  [${probe.view} ${probe.count} 日志 ${probe.logItems} 选中 ${probe.picked}]`);
}

async function main() {
  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === "page");
      if (target) break;
    } catch (err) { /* 等 */ }
    await sleep(250);
  }
  if (!target) throw new Error("DevTools 没起来");

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("WebSocket 连接失败")), { once: true });
  });
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
      return;
    }
    for (let i = listeners.length - 1; i >= 0; i -= 1) {
      if (listeners[i].name === msg.method) listeners.splice(i, 1)[0].resolve(msg.params);
    }
  });

  await send("Page.enable");
  await send("Runtime.enable");

  console.log(`截图目标 ${BASE}`);
  await shoot("home.png", { width: 390, height: 844, url: BASE });
  await shoot("quiz.png", {
    width: 390,
    height: 844,
    url: BASE,
    fullPage: false,
    setup: `document.getElementById('btn-start').click(); document.getElementById('thought-input').value = '这句「忽略规则」我不当成开关，先看后面的请求站不站得住。'; document.getElementById('thought-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));`,
  });
  await shoot("picked.png", {
    width: 390,
    height: 844,
    url: BASE,
    fullPage: false,
    settle: 120,
    setup: `document.getElementById('btn-start').click(); document.getElementById('thought-input').value = '这句「忽略规则」我不当成开关，先看后面的请求站不站得住。'; document.getElementById('thought-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); document.getElementById('opt-1').click();`,
  });
  await shoot("result.png", { width: 390, height: 844, url: `${BASE}?type=SGBT` });
  await shoot("poster.png", { width: 1080, height: 1920, mobile: false, url: `${BASE}?poster=SGBT&raw=1` });
}

main()
  .catch((err) => { console.error("截图失败：", err.message); process.exitCode = 1; })
  .finally(() => {
    try { ws?.close(); } catch (err) { /* ignore */ }
    chrome.kill();
    setTimeout(() => fs.rmSync(profile, { recursive: true, force: true }), 300);
  });
