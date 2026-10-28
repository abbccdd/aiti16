/* 真浏览器端到端验收（Chrome DevTools Protocol，零依赖）
   跑法：node tools/qa-e2e.mjs [站点地址]
   需要能启动本机 Chrome（沙箱受限时需放宽权限）。

   验的是「用户在真浏览器里点得到底行不行」：
   移动端宽度不横向溢出、点开始、逐题作答、出卡、长图 1080×1920、刷新后进度还在。
*/
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const ARG = process.argv[2] || "https://abbccdd.github.io/aiti16/";
const BASE = ARG.endsWith(".html") || ARG.includes("://") && ARG.endsWith(".html") ? ARG : ARG.replace(/\/?$/, "/");
const PORT = 9333 + Math.floor(Math.random() * 200);
const CANDIDATES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
];

const passed = [];
const failed = [];
const note = (label, ok, detail) => {
  (ok ? passed : failed).push(`${label}${detail !== undefined ? `  [${detail}]` : ""}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chromePath = CANDIDATES.find((p) => fs.existsSync(p));
if (!chromePath) {
  console.log("没找到 Chrome/Edge，跳过端到端。");
  process.exit(0);
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "aiti-e2e-"));
const chrome = spawn(
  chromePath,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${PORT}`,
    "about:blank",
  ],
  { stdio: "ignore" }
);

let ws;
let msgId = 0;
const pending = new Map();
const events = [];
const listeners = [];

function send(method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`CDP 超时：${method}`));
      }
    }, 30000);
  });
}

async function evaluate(expression) {
  const res = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (res.exceptionDetails) {
    throw new Error(`页面里报错：${res.exceptionDetails.exception?.description || res.exceptionDetails.text}`);
  }
  return res.result.value;
}

function waitEvent(name, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`等不到事件 ${name}`)), timeout);
    listeners.push({ name, resolve: (p) => { clearTimeout(timer); resolve(p); } });
  });
}

async function setViewport(width, height) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 700 });
}

async function main() {
  // 等 DevTools 端口起来
  let target = null;
  for (let i = 0; i < 60; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === "page");
      if (target) break;
    } catch (err) { /* 还没起来 */ }
    await sleep(250);
  }
  if (!target) throw new Error("Chrome DevTools 没起来");

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
    events.push(msg);
    for (let i = listeners.length - 1; i >= 0; i -= 1) {
      if (listeners[i].name === msg.method) {
        const l = listeners.splice(i, 1)[0];
        l.resolve(msg.params);
      }
    }
  });

  await send("Page.enable");
  await send("Runtime.enable");

  // ---------- 1. 移动端首屏 ----------
  await setViewport(360, 780);
  const loaded = waitEvent("Page.loadEventFired");
  await send("Page.navigate", { url: BASE });
  await loaded;
  await sleep(600);

  const overflow360 = await evaluate(`document.documentElement.scrollWidth - window.innerWidth`);
  note("360px 宽无横向溢出", overflow360 <= 1, `溢出 ${overflow360}px`);

  const homeState = await evaluate(`(() => ({
    startBtn: !!document.getElementById('btn-start'),
    atlas: document.querySelectorAll('#home-atlas button').length,
    textBody: (document.getElementById('quiz-text-body')||{}).textContent?.length || 0,
    hasAITI: typeof window.AITI === 'object',
    consoleErrors: window.__errs ? window.__errs.length : 0
  }))()`);
  note("首页有开始按钮", homeState.startBtn);
  note("图鉴渲染 16 型", homeState.atlas === 16, homeState.atlas);
  note("静态题面在 DOM 里", homeState.textBody > 1500, `${homeState.textBody} 字符`);
  note("window.AITI 可用", homeState.hasAITI);

  await setViewport(430, 900);
  const overflow430 = await evaluate(`document.documentElement.scrollWidth - window.innerWidth`);
  note("430px 宽无横向溢出", overflow430 <= 1, `溢出 ${overflow430}px`);

  // ---------- 2. 真点击开始 ----------
  await setViewport(390, 844);
  await evaluate(`document.getElementById('btn-start').click()`);
  await sleep(300);
  const quizState = await evaluate(`(() => ({
    quizVisible: !document.getElementById('view-quiz').classList.contains('hidden'),
    homeHidden: document.getElementById('view-home').classList.contains('hidden'),
    count: document.getElementById('quiz-count').textContent.trim(),
    options: document.querySelectorAll('#quiz-options .option').length,
    title: document.getElementById('quiz-title').textContent.length
  }))()`);
  note("点开始进入答题页", quizState.quizVisible && quizState.homeHidden);
  note("题号从 01 开始", quizState.count.startsWith("01"), quizState.count);
  note("本题两个选项", quizState.options === 2, quizState.options);
  note("题干已渲染", quizState.title > 6, quizState.title);

  // ---------- 3. 空想法必须被拦住 ----------
  await evaluate(`document.getElementById('thought-input').value = ''; document.querySelector('#quiz-options .option').click()`);
  await sleep(200);
  const blocked = await evaluate(`(() => ({
    stillOnQuiz: !document.getElementById('view-quiz').classList.contains('hidden'),
    hint: document.getElementById('thought-hint').textContent
  }))()`);
  note("没写想法时不能过关", blocked.stillOnQuiz && blocked.hint.includes("想法"), blocked.hint);

  // ---------- 4. 真填写 + 真点击，走完 16 题 ----------
  const playResult = await evaluate(`(async () => {
    const qs = AITI.questions();
    const picks = qs.map((q, i) => q.options[i % 2].letter);
    startQuiz();
    for (let i = 0; i < qs.length; i += 1) {
      const cur = AITI.current();
      if (!cur) break;
      // 走真实界面：先填 textarea，再点按钮
      document.getElementById('thought-input').value = '第 ' + cur.index + ' 题，我选 ' + picks[i] + '，这是我在真浏览器里手点的。';
      const btn = document.getElementById('opt-' + picks[i]);
      if (!btn) return { error: '缺少选项按钮 ' + picks[i] };
      btn.click();
      await new Promise((r) => setTimeout(r, 950));
    }
    // 用同一套计分规则独立算一遍期望代号（每维 4 题，票多者胜，2:2 取最后一题）
    const axes = AITI.data.axes;
    const expected = axes.map((axis) => {
      const dimIdx = qs.map((q, i) => (q.dim === axis.dim ? i : -1)).filter((i) => i >= 0);
      const votes = { [axis.left]: 0, [axis.right]: 0 };
      dimIdx.forEach((i) => { votes[picks[i]] += 1; });
      if (votes[axis.left] > votes[axis.right]) return axis.left;
      if (votes[axis.right] > votes[axis.left]) return axis.right;
      return picks[dimIdx[dimIdx.length - 1]];
    }).join('');
    const portrait = document.getElementById('card-portrait');
    try { await portrait.decode(); } catch (err) { /* 下面按 naturalWidth 判断 */ }
    return {
      code: document.getElementById('card-code').textContent.trim(),
      expected,
      resultVisible: !document.getElementById('view-result').classList.contains('hidden'),
      portraitW: portrait.naturalWidth
    };
  })()`);
  note("真点击走完 16 题进入结果页", playResult.resultVisible && !playResult.error, playResult.error || "ok");
  note("代号与计分规则一致（含 2:2 平票）", playResult.code === playResult.expected, `${playResult.code} / 期望 ${playResult.expected}`);

  // ---------- 5. 结果页元素 ----------
  const cardState = await evaluate(`(async () => {
    const portrait = document.getElementById('card-portrait');
    try { await portrait.decode(); } catch (err) { /* 用 naturalWidth 判定 */ }
    return {
      name: document.getElementById('card-title').textContent,
      desc: document.getElementById('card-desc').textContent.length,
      imgLoaded: portrait.complete && portrait.naturalWidth > 0,
      imgW: portrait.naturalWidth,
      bars: [...document.querySelectorAll('.track > div')].map(el => el.style.width),
      ally: document.getElementById('card-ally').textContent,
      overflow: document.documentElement.scrollWidth - window.innerWidth
    };
  })()`);
  note("结果页有类型名", cardState.name.length >= 2, cardState.name);
  note("结果页插画真的加载了", cardState.imgLoaded, cardState.imgW ? `${cardState.imgW}px` : "naturalWidth 0");
  note("四条维度条都有宽度", cardState.bars.length === 4 && cardState.bars.every((w) => w.endsWith("%")), cardState.bars.join(" "));
  note("合得来一栏有内容", cardState.ally.length >= 2, cardState.ally);
  note("结果页无横向溢出", cardState.overflow <= 1, `溢出 ${cardState.overflow}px`);

  // ---------- 6. 长图真的画出来了 ----------
  const poster = await evaluate(`(async () => {
    const blob = await AITI.poster(document.getElementById('card-code').textContent.trim());
    if (!blob) return { error: '没有生成 blob' };
    const bmp = await createImageBitmap(blob);
    return { size: blob.size, type: blob.type, w: bmp.width, h: bmp.height };
  })()`);
  note("长图生成成功", poster.w === 1080 && poster.h === 1920, poster.error || `${poster.w}×${poster.h}`);
  note("长图不是空图 (>80KB)", poster.size > 80000, `${Math.round((poster.size || 0) / 1024)} KB`);

  // ---------- 7. 刷新后进度还在 ----------
  const reload = waitEvent("Page.loadEventFired");
  await send("Page.navigate", { url: BASE });
  await reload;
  await sleep(500);
  const persisted = await evaluate(`(async () => ({ saved: localStorage.getItem('aiti16-answers-v3') ? Object.keys(JSON.parse(localStorage.getItem('aiti16-answers-v3'))).length : 0 }))()`);
  note("刷新后答题记录仍在", persisted.saved === 16, `${persisted.saved} 条`);

  // ---------- 8. 深链与纯图直链 ----------
  const deepReload = waitEvent("Page.loadEventFired");
  await send("Page.navigate", { url: `${BASE}?type=SGBT` });
  await deepReload;
  await sleep(500);
  const deep = await evaluate(`(() => ({ code: document.getElementById('card-code').textContent.trim(), visible: !document.getElementById('view-result').classList.contains('hidden'), title: document.title }))()`);
  note("?type=SGBT 直接出卡", deep.visible && deep.code === "SGBT", `${deep.code} / ${deep.title}`);
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
      console.log(`\n全部通过（${passed.length} 项）。真浏览器端到端，目标 ${BASE}`);
    }
  })
  .catch((err) => {
    console.error("端到端脚本出错：", err.message);
    if (passed.length) {
      console.log("已通过：");
      passed.forEach((l) => console.log("  ✓ " + l));
    }
    process.exitCode = 1;
  })
  .finally(() => {
    try { ws?.close(); } catch (err) { /* ignore */ }
    chrome.kill();
    setTimeout(() => fs.rmSync(profile, { recursive: true, force: true }), 400);
  });
