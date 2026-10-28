/* 量关键元素的盒子，检查是否贴边/溢出（比肉眼可靠）
   跑法：node tools/measure.mjs [站点地址]
*/
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const BASE = (process.argv[2] || "https://abbccdd.github.io/aiti16/").replace(/\/?$/, "/");
const PORT = 9800 + Math.floor(Math.random() * 150);
const CANDIDATES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
];
const chromePath = CANDIDATES.find((p) => fs.existsSync(p));
if (!chromePath) { console.log("没找到 Chrome"); process.exit(0); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "aiti-measure-"));
const chrome = spawn(chromePath, ["--headless=new", "--disable-gpu", "--no-first-run",
  "--no-default-browser-check", `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, "about:blank"], { stdio: "ignore" });

let ws; let id = 0; const pending = new Map(); const listeners = [];
const send = (method, params = {}) => {
  const msgId = ++id;
  ws.send(JSON.stringify({ id: msgId, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(msgId, { resolve, reject });
    setTimeout(() => { if (pending.has(msgId)) { pending.delete(msgId); reject(new Error("超时 " + method)); } }, 20000);
  });
};
const waitEvent = (name, timeout = 20000) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("等不到 " + name)), timeout);
  listeners.push({ name, resolve: (p) => { clearTimeout(t); resolve(p); } });
});

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
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", () => rej(new Error("ws 失败")), { once: true }); });
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id); pending.delete(m.id);
      if (m.error) reject(new Error(m.error.message)); else resolve(m.result);
      return;
    }
    for (let i = listeners.length - 1; i >= 0; i -= 1) if (listeners[i].name === m.method) listeners.splice(i, 1)[0].resolve(m.params);
  });
  await send("Page.enable");
  await send("Runtime.enable");

  for (const width of [320, 360, 390, 430]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile: true });
    const loaded = waitEvent("Page.loadEventFired");
    await send("Page.navigate", { url: `${BASE}?type=SGBT` });
    await loaded;
    await sleep(700);
    const res = await send("Runtime.evaluate", {
      returnByValue: true,
      expression: `(() => {
        const vw = document.documentElement.clientWidth;
        const report = [];
        const push = (label, el) => {
          if (!el) { report.push({ label, missing: true }); return; }
          const r = el.getBoundingClientRect();
          report.push({ label, left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width), overRight: Math.round(r.right - vw), underLeft: Math.round(-r.left) });
        };
        push('nav-row', document.querySelector('#view-result .nav-row'));
        [...document.querySelectorAll('#view-result .nav-row button')].forEach((b, i) => push('nav-btn-' + i + ' ' + b.textContent.trim(), b));
        push('结果卡', document.getElementById('personality-card'));
        push('actions', document.querySelector('#view-result .actions'));
        push('图鉴格', document.querySelector('#home-atlas button'));
        return { vw, scrollW: document.documentElement.scrollWidth, report };
      })()`,
    });
    const v = res.result.value;
    console.log(`\n视口 ${width}px（clientWidth ${v.vw}，scrollWidth ${v.scrollW}）`);
    v.report.forEach((r) => {
      if (r.missing) { console.log(`  ${r.label.padEnd(28)} 元素不存在`); return; }
      const flag = r.right > width || r.left < 0 ? "  ⚠" : "";
      console.log(`  ${r.label.padEnd(28)} left ${String(r.left).padStart(4)} right ${String(r.right).padStart(4)} w ${String(r.w).padStart(4)}${flag}`);
    });
  }
}

main().catch((e) => { console.error("出错：", e.message); process.exitCode = 1; }).finally(() => {
  try { ws?.close(); } catch (e) { /* ignore */ }
  chrome.kill();
  setTimeout(() => fs.rmSync(profile, { recursive: true, force: true }), 300);
});
