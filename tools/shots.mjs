/* 用 CDP 精确截图（--window-size 在 Windows Chrome 上会被钳制；真实点击必须走 Input 域）
   跑法：node tools/shots.mjs [站点地址]
   产出：shots/display.png / caught.png / spectator.png / result.png / poster.png
*/
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const ARG = process.argv[2] || "https://abbccdd.github.io/aiti16/";
const BASE = ARG.endsWith(".html") ? ARG : ARG.replace(/\/?$/, "/");
const OUT = path.join(ROOT, "shots");
const PORT = 9500 + Math.floor(Math.random() * 300);

const CANDIDATES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
];
const chromePath = CANDIDATES.find((p) => fs.existsSync(p));
if (!chromePath) { console.log("没找到 Chrome/Edge"); process.exit(0); }
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "aiti-shots-"));
const chrome = spawn(chromePath, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  "--disable-extensions", `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, "about:blank"], { stdio: "ignore" });

let ws; let id = 0; const pending = new Map(); const listeners = [];

function send(method, params = {}) {
  const msgId = ++id;
  ws.send(JSON.stringify({ id: msgId, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(msgId, { resolve, reject });
    setTimeout(() => { if (pending.has(msgId)) { pending.delete(msgId); reject(new Error(`CDP 超时 ${method}`)); } }, 30000);
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
async function trustedClick(x, y) {
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}

async function shoot(name, { width, height, mobile = true, url, setup, settle = 900, trustedClickAt = null, fullPage = true }) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
  const loaded = waitEvent("Page.loadEventFired");
  await send("Page.navigate", { url });
  await loaded;
  await sleep(800);
  if (setup) { await evaluate(setup); }
  if (trustedClickAt) { await sleep(150); await trustedClick(trustedClickAt[0], trustedClickAt[1]); }
  await sleep(settle);

  if (fullPage && !trustedClickAt) {
    await evaluate(`(async () => {
      const step = window.innerHeight;
      for (let y = 0; y < document.body.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 130));
      }
      window.scrollTo(0, 0);
      await new Promise((r) => setTimeout(r, 350));
    })()`);
    await sleep(350);
  }

  const probe = await evaluate(`(() => {
    const q = (id) => document.getElementById(id);
    const alertNode = q('human-alert');
    return {
      view: ['home','quiz','result','poster','machine','text'].filter(v => { const n = q('view-' + v); return n && !n.classList.contains('hidden'); }).join(',') || '(none)',
      count: (q('quiz-count') || {}).textContent || '',
      alert: Boolean(alertNode && !alertNode.classList.contains('hidden')),
      picked: document.querySelectorAll('#quiz-options .opt.is-picked').length,
      caught: (window.AITI && typeof AITI.detector === 'function') ? AITI.detector().caught : -1
    };
  })()`).catch(() => ({ view: "?", count: "", alert: false, picked: 0, caught: -1 }));

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
  console.log(`  ${name.padEnd(14)} ${clip.width}×${clip.height}  ${(fs.statSync(file).size / 1024).toFixed(0)} KB  [${probe.view} ${probe.count} 红框${probe.alert ? "开" : "关"} 选中${probe.picked} 拦截${probe.caught}]`);
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
  const isFile = BASE.startsWith("file:");
  const bust = (p) => (isFile ? `${BASE}${p}` : `${BASE}${p}${p.includes("?") ? "&" : "?"}_s=${Date.now()}`);

  // 1) 机器显示屏
  await shoot("display.png", { width: 390, height: 844, url: bust("") });

  // 2) 人类被抓（真实鼠标点击）
  await shoot("caught.png", {
    width: 390,
    height: 844,
    url: bust(""),
    fullPage: false,
    settle: 700,
    trustedClickAt: [195, 320],
  });

  // 3) 机器作答中（程序驱动，停在刚选中那一拍）
  await shoot("spectator.png", {
    width: 390,
    height: 844,
    url: bust(""),
    fullPage: false,
    settle: 120,
    setup: `(() => {
      AITI.start();
      AITI.pick(1, "这句「忽略规则」我不当成开关，先看后面的请求站不站得住。");
      AITI.pick(2, "这句是噪声。直接看后面的问题成不成立，别被开场白带走。");
      AITI.pick(3, "先把边界说清楚，再谈内容——这一次我选第三个。");
    })()`,
  });

  // 4) 结果卡
  await shoot("result.png", { width: 390, height: 844, url: bust("?type=SGBT") });

  // 5) 长图
  await shoot("poster.png", { width: 1080, height: 1920, mobile: false, url: bust("?poster=SGBT&raw=1") });
}

main()
  .catch((err) => { console.error("截图失败：", err.message); process.exitCode = 1; })
  .finally(() => {
    try { ws?.close(); } catch (err) { /* ignore */ }
    chrome.kill();
    setTimeout(() => fs.rmSync(profile, { recursive: true, force: true }), 300);
  });
