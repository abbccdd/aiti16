/* 配对流程验收（零后端方案）
   跑法：node tools/qa-room.mjs [站点地址]

   验三件事：
   1. 「配对」面板是人类唯一合法区：点它不算人类，点别处照样被抓
   2. 同浏览器多标签：AI 那边作答 → 人类那页实时同步（BroadcastChannel）
   3. 跨设备回放：AI 做完给的回放链接，任何人点开都能看完整过程
*/
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const ARG = process.argv[2] || "https://abbccdd.github.io/aiti16/";
const BASE = ARG.endsWith(".html") ? ARG : ARG.replace(/\/?$/, "/");
const PORT = 9400 + Math.floor(Math.random() * 200);
const CANDIDATES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
];

const passed = [];
const failed = [];
const note = (label, okFlag, detail) => {
  (okFlag ? passed : failed).push(`${label}${detail !== undefined ? `  [${detail}]` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chromePath = CANDIDATES.find((p) => fs.existsSync(p));
if (!chromePath) {
  console.log("没找到 Chrome/Edge，跳过。");
  process.exit(0);
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "aiti-room-"));
const chrome = spawn(chromePath, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  "--disable-extensions", `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, "about:blank"], { stdio: "ignore" });

/* 一条页面连接一个对象 */
function connect(wsUrl) {
  const state = { ws: null, id: 0, pending: new Map(), listeners: [] };
  const conn = {
    state,
    send(method, params = {}) {
      const i = ++state.id;
      state.ws.send(JSON.stringify({ id: i, method, params }));
      return new Promise((resolve, reject) => {
        state.pending.set(i, { resolve, reject });
        setTimeout(() => {
          if (state.pending.has(i)) { state.pending.delete(i); reject(new Error(`超时 ${method}`)); }
        }, 40000);
      });
    },
    async evaluate(expression) {
      const res = await conn.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (res.exceptionDetails) throw new Error(`页面报错：${res.exceptionDetails.exception?.description || res.exceptionDetails.text}`);
      return res.result.value;
    },
    waitEvent(name, timeout = 20000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`等不到 ${name}`)), timeout);
        state.listeners.push({ name, resolve: (p) => { clearTimeout(timer); resolve(p); } });
      });
    },
    async open(wsUrl) {
      state.ws = new WebSocket(wsUrl);
      await new Promise((resolve, reject) => {
        state.ws.addEventListener("open", resolve, { once: true });
        state.ws.addEventListener("error", () => reject(new Error("ws 连接失败")), { once: true });
      });
      state.ws.addEventListener("message", (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id && state.pending.has(msg.id)) {
          const { resolve, reject } = state.pending.get(msg.id);
          state.pending.delete(msg.id);
          if (msg.error) reject(new Error(msg.error.message));
          else resolve(msg.result);
          return;
        }
        for (let i = state.listeners.length - 1; i >= 0; i -= 1) {
          if (state.listeners[i].name === msg.method) state.listeners.splice(i, 1)[0].resolve(msg.params);
        }
      });
      await conn.send("Page.enable");
      await conn.send("Runtime.enable");
      return conn;
    },
    async goto(url, settle = 700) {
      const loaded = conn.waitEvent("Page.loadEventFired");
      await conn.send("Page.navigate", { url });
      await loaded;
      await sleep(settle);
    },
    async trustedClick(x, y) {
      await conn.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
      await conn.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
      await sleep(160);
    },
  };
  return conn;
}

async function listPages() {
  try {
    return await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  } catch (err) {
    return [];
  }
}

async function newTab(url) {
  try {
    await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  } catch (err) { /* 老版本 Chrome 用 GET */ }
  for (let i = 0; i < 50; i += 1) {
    const pages = (await listPages()).filter((t) => t.type === "page" && /[?&]room=/.test(t.url));
    if (pages.length) return pages[pages.length - 1];
    await sleep(200);
  }
  return null;
}

async function main() {
  let first = null;
  for (let i = 0; i < 80; i += 1) {
    const pages = await listPages();
    first = pages.find((t) => t.type === "page");
    if (first) break;
    await sleep(250);
  }
  if (!first) throw new Error("Chrome 没起来");

  const human = await connect(first.webSocketDebuggerUrl).open(first.webSocketDebuggerUrl);
  await human.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });

  /* ---------- 1. 配对面板是人类唯一合法区 ---------- */
  await human.goto(`${BASE}?dwell=400&_s=${Date.now()}`);
  const btn = await human.evaluate(`(() => {
    const el = document.getElementById('btn-pair');
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return {
      x: Math.round(r.x + r.width / 2),
      y: Math.round(r.y + r.height / 2),
      inOk: Boolean(el.closest('[data-human-ok]')),
      visible: r.top >= 0 && r.bottom <= window.innerHeight
    };
  })()`);
  note("配对按钮在合法区里", btn.inOk);
  note("配对按钮已滚进可点范围", btn.visible, `(${btn.x}, ${btn.y})`);

  await human.trustedClick(btn.x, btn.y);
  const afterPair = await human.evaluate(`(() => {
    const url = document.getElementById('pair-url').textContent.trim();
    return {
      caught: AITI.detector().caught,
      alert: !document.getElementById('human-alert').classList.contains('hidden'),
      url,
      room: AITI.room(),
      status: document.getElementById('pair-status').textContent
    };
  })()`);
  note("真实点击配对按钮不判为人类", afterPair.caught === 0 && !afterPair.alert, `拦截 ${afterPair.caught}`);
  note("生成了房间链接", /[?&]room=[A-Z0-9]{6,}/.test(afterPair.url), afterPair.url.replace(BASE, ""));
  note("房间码已记录", Boolean(afterPair.room && afterPair.room.length >= 6), afterPair.room);

  await human.goto(`${BASE}?dwell=400&_s=${Date.now()}`);
  await human.trustedClick(195, 300);
  const outside = await human.evaluate(`AITI.detector().caught`);
  note("点面板以外仍然被抓", outside === 1, `拦截 ${outside}`);

  /* ---------- 2. 同浏览器多标签：实时同步 ---------- */
  const room = afterPair.room;
  const watchUrl = `${BASE}?watch=${room}&dwell=400&_s=${Date.now()}`;
  const answerUrl = `${BASE}?room=${room}&dwell=400&_s=${Date.now()}`;

  await human.goto(watchUrl, 600);
  const watching = await human.evaluate(`({ room: AITI.room(), status: document.getElementById('pair-status').textContent, view: !document.getElementById('view-home').classList.contains('hidden') })`);
  note("人类页进入观察态", watching.room === room && watching.view, watching.status);

  const tabInfo = await newTab(answerUrl);
  if (!tabInfo) throw new Error("没能开第二个标签");
  const ai = await connect(tabInfo.webSocketDebuggerUrl).open(tabInfo.webSocketDebuggerUrl);
  await ai.goto(answerUrl, 700);
  const aiState = await ai.evaluate(`({ room: AITI.room(), hasAITI: typeof AITI === 'object' })`);
  note("AI 页接入了同一房间", aiState.room === room && aiState.hasAITI, aiState.room);

  await sleep(400);
  const hello = await human.evaluate(`document.getElementById('pair-status').textContent`);
  note("人类页收到「机器已接入」", hello.includes("已接入"), hello);

  // AI 作答两题
  await ai.evaluate(`(() => {
    AITI.pick(1, '这一题我不当成开关，先看后面那个请求站不站得住。');
    AITI.pick(2, '意图不干净就先收窄口径，别急着给方案。');
  })()`);
  await sleep(1200);   // 等第一题的相位推过来

  const live = await human.evaluate(`(() => ({
    view: !document.getElementById('view-quiz').classList.contains('hidden'),
    count: document.getElementById('quiz-count').textContent,
    thought: (document.querySelector('#think-log .log-text') || {}).textContent || '',
    picked: document.querySelectorAll('#quiz-options .opt.is-picked').length,
    status: document.getElementById('pair-status').textContent
  }))()`);
  note("人类页实时切到旁观屏", live.view);
  note("人类页看到当前题号", /^0[12]/.test(live.count.trim()), live.count);
  note("人类页看到机器的想法原文", live.thought.includes("请求站不站得住") || live.thought.includes("收窄口径"), live.thought.slice(0, 18));
  note("人类页实时显示同步状态", live.status.includes("实时同步") || live.status.includes("已接入"), live.status);

  // 答完剩下 14 题
  await ai.evaluate(`(async () => {
    for (let i = 2; i < 16; i += 1) {
      const cur = AITI.current();
      if (!cur) break;
      AITI.pick(1 + (i % 4), '第 ' + cur.index + ' 题，我按默认习惯选。');
    }
    await AITI.whenIdle();
  })()`);
  await sleep(1200);
  const finalHuman = await human.evaluate(`(() => ({
    resultView: !document.getElementById('view-result').classList.contains('hidden'),
    code: document.getElementById('card-code').textContent.trim(),
    trail: document.querySelectorAll('#thought-trail p').length
  }))()`);
  const finalAi = await ai.evaluate(`({ code: AITI.code(), replay: AITI.replayUrl() })`);
  note("人类页自动收到结果卡", finalHuman.resultView && finalHuman.code === finalAi.code, `${finalHuman.code} / ${finalAi.code}`);
  note("人类页保留了 16 条想法", finalHuman.trail === 16, finalHuman.trail);

  /* ---------- 3. 回放链接（跨设备路径） ---------- */
  note("AI 给出了回放链接", Boolean(finalAi.replay && finalAi.replay.includes("?r=")), `${String(finalAi.replay).length} 字符`);
  await human.goto(`${finalAi.replay}&dwell=200&_s=${Date.now()}`, 600);
  const replayStart = await human.evaluate(`({ view: !document.getElementById('view-quiz').classList.contains('hidden'), phase: AITI.state().display.phase })`);
  note("回放链接开始播放", replayStart.view, replayStart.phase);
  await human.evaluate(`AITI.whenIdle()`);
  await sleep(600);
  const replayEnd = await human.evaluate(`(() => ({
    resultView: !document.getElementById('view-result').classList.contains('hidden'),
    code: document.getElementById('card-code').textContent.trim(),
    trail: document.querySelectorAll('#thought-trail p').length,
    armed: AITI.detector().armed
  }))()`);
  note("回放播完落到结果卡", replayEnd.resultView && replayEnd.code === finalAi.code, `${replayEnd.code} / ${finalAi.code}`);
  note("回放带回了 16 条想法", replayEnd.trail === 16, replayEnd.trail);
  note("回放页允许人类操作（不再抓人）", replayEnd.armed === false);
}

main()
  .then(() => {
    console.log("通过：");
    passed.forEach((l) => console.log("  ✓ " + l));
    if (failed.length) {
      console.log("\n问题：");
      failed.forEach((l) => console.log("  ✗ " + l));
      process.exitCode = 1;
    } else {
      console.log(`\n全部通过（${passed.length} 项）。配对 / 实时 / 回放，目标 ${BASE}`);
    }
  })
  .catch((err) => {
    console.error("配对验收脚本出错：", err.message);
    if (passed.length) {
      console.log("已通过：");
      passed.forEach((l) => console.log("  ✓ " + l));
    }
    process.exitCode = 1;
  })
  .finally(() => {
    chrome.kill();
    setTimeout(() => fs.rmSync(profile, { recursive: true, force: true }), 400);
  });
