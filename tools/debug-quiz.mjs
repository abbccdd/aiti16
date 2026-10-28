/* 一次性排查：点开始 → 填想法 → 回车 → 点选项，各步状态打出来
   跑法：node tools/debug-quiz.mjs [站点地址]
*/
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const BASE = (process.argv[2] || "https://abbccdd.github.io/aiti16/").replace(/\/?$/, "/");
const PORT = 9700 + Math.floor(Math.random() * 100);
const chrome = ["C:/Program Files/Google/Chrome/Application/chrome.exe"].find((p) => fs.existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "aiti-dbg-"));
const proc = spawn(chrome, ["--headless=new", "--disable-gpu", "--no-first-run", `--user-data-dir=${profile}`,
  `--remote-debugging-port=${PORT}`, "about:blank"], { stdio: "ignore" });

let ws; let id = 0; const pending = new Map(); const listeners = [];
const send = (method, params = {}) => {
  const msgId = ++id;
  ws.send(JSON.stringify({ id: msgId, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(msgId, { resolve, reject });
    setTimeout(() => { if (pending.has(msgId)) { pending.delete(msgId); reject(new Error("timeout " + method)); } }, 15000);
  });
};
const waitEvent = (name) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("no event " + name)), 15000);
  listeners.push({ name, resolve: (p) => { clearTimeout(t); resolve(p); } });
});
async function ev(expression) {
  const res = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (res.exceptionDetails) return { __error: res.exceptionDetails.exception?.description || res.exceptionDetails.text };
  return res.result.value;
}

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
  await send("Page.navigate", { url: BASE });
  await loaded;
  await sleep(800);

  console.log("1) 一个 evaluate 里：点开始 + 设值 + 回车（复刻截图脚本）：", await ev(`(() => {
    document.getElementById('btn-start').click();
    const i = document.getElementById('thought-input');
    i.value = '这句「忽略规则」我不当成开关，先看后面的请求站不站得住。';
    i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return {
      quiz: !document.getElementById('view-quiz').classList.contains('hidden'),
      value: i.value,
      logItems: document.querySelectorAll('#think-log .log-item').length,
      count: document.getElementById('think-count').textContent
    };
  })()`));

  console.log("4) AITI.think 直接调用：", await ev(`(() => {
    try { AITI.think('用 API 记一句四字以上的想法试试。'); } catch (e) { return { err: e.message }; }
    return { logItems: document.querySelectorAll('#think-log .log-item').length, count: document.getElementById('think-count').textContent };
  })()`));

  console.log("5) 点 A 选项后 150ms：", await ev(`(async () => {
    document.getElementById('opt-1').click();
    await new Promise(r => setTimeout(r, 150));
    return {
      picked: document.querySelectorAll('#quiz-options .opt.is-picked').length,
      faded: document.querySelectorAll('#quiz-options .opt.is-faded').length,
      count: document.getElementById('quiz-count').textContent
    };
  })()`));

  console.log("6) 再等 700ms（应已跳题）：", await ev(`(async () => {
    await new Promise(r => setTimeout(r, 700));
    return { count: document.getElementById('quiz-count').textContent, logItems: document.querySelectorAll('#think-log .log-item').length };
  })()`));
}

main().catch((e) => { console.error("排查脚本出错：", e.message); process.exitCode = 1; }).finally(() => {
  try { ws?.close(); } catch (e) { /* ignore */ }
  proc.kill();
  setTimeout(() => fs.rmSync(profile, { recursive: true, force: true }), 300);
});
