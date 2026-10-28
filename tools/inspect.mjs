/* 读页面里元素的计算样式与盒子：node tools/inspect.mjs "<url>" "<css selector>" */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const URL_ = process.argv[2] || "https://abbccdd.github.io/aiti16/?type=SGBT";
const SEL = process.argv[3] || "#card-portrait";
const PORT = 9950 + Math.floor(Math.random() * 40);
const chrome = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p) => fs.existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "aiti-insp-"));
const proc = spawn(chrome, ["--headless=new", "--disable-gpu", "--no-first-run", `--user-data-dir=${profile}`,
  `--remote-debugging-port=${PORT}`, "about:blank"], { stdio: "ignore" });

let ws; let id = 0; const pending = new Map(); const listeners = [];
const send = (method, params = {}) => {
  const msgId = ++id;
  ws.send(JSON.stringify({ id: msgId, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(msgId, { resolve, reject });
    setTimeout(() => { if (pending.has(msgId)) { pending.delete(msgId); reject(new Error("timeout")); } }, 15000);
  });
};
const waitEvent = (name) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("no " + name)), 15000);
  listeners.push({ name, resolve: (p) => { clearTimeout(t); resolve(p); } });
});

async function main() {
  let target = null;
  for (let i = 0; i < 60; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === "page");
      if (target) break;
    } catch (e) { /* wait */ }
    await sleep(250);
  }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", () => rej(new Error("ws")), { once: true }); });
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); return; }
    for (let i = listeners.length - 1; i >= 0; i -= 1) if (listeners[i].name === m.method) listeners.splice(i, 1)[0].resolve(m.params);
  });
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  const loaded = waitEvent("Page.loadEventFired");
  await send("Page.navigate", { url: URL_ });
  await loaded;
  await sleep(900);
  const res = await send("Runtime.evaluate", {
    returnByValue: true,
    expression: `(() => {
      const el = document.querySelector(${JSON.stringify(SEL)});
      if (!el) return { missing: true };
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const parent = el.parentElement;
      const pcs = parent ? getComputedStyle(parent) : {};
      return {
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        style: { width: cs.width, height: cs.height, aspectRatio: cs.aspectRatio, objectFit: cs.objectFit, display: cs.display, margin: cs.margin },
        parent: parent ? { cls: parent.className, display: pcs.display, alignItems: pcs.alignItems, textAlign: pcs.textAlign } : null,
        sheetRules: [...document.styleSheets].flatMap(s => { try { return [...s.cssRules]; } catch (e) { return []; } })
          .filter(r => r.selectorText && /portrait/.test(r.selectorText)).map(r => r.selectorText + ' { ' + r.style.cssText + ' }')
      };
    })()`,
  });
  console.log(JSON.stringify(res.result.value, null, 2));
}

main().catch((e) => { console.error("出错：", e.message); process.exitCode = 1; }).finally(() => {
  try { ws?.close(); } catch (e) { /* ignore */ }
  proc.kill();
  setTimeout(() => fs.rmSync(profile, { recursive: true, force: true }), 300);
});
