/* 真浏览器端到端验收（Chrome DevTools Protocol，零依赖）
   跑法：node tools/qa-e2e.mjs [站点地址]     线上地址或 file:///…/dist/AITI-16.html
   验的是「用户在真浏览器里点得到底行不行」：白底一屏一题、四个选项、点选反馈、自动跳下一题、
   底部思考窗口、出卡、长图 1080×1920、刷新后进度还在。
*/
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const ARG = process.argv[2] || "https://abbccdd.github.io/aiti16/";
const BASE = ARG.endsWith(".html") ? ARG : ARG.replace(/\/?$/, "/");
const PORT = 9333 + Math.floor(Math.random() * 200);
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
  console.log("没找到 Chrome/Edge，跳过端到端。");
  process.exit(0);
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "aiti-e2e-"));
const chrome = spawn(
  chromePath,
  ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--disable-extensions", `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, "about:blank"],
  { stdio: "ignore" }
);

let ws;
let msgId = 0;
const pending = new Map();
const listeners = [];

function send(method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); reject(new Error(`CDP 超时：${method}`)); }
    }, 40000);
  });
}

async function evaluate(expression) {
  const res = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (res.exceptionDetails) throw new Error(`页面里报错：${res.exceptionDetails.exception?.description || res.exceptionDetails.text}`);
  return res.result.value;
}

function waitEvent(name, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`等不到事件 ${name}`)), timeout);
    listeners.push({ name, resolve: (p) => { clearTimeout(timer); resolve(p); } });
  });
}

const setViewport = (width, height) => send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 700 });

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
    for (let i = listeners.length - 1; i >= 0; i -= 1) {
      if (listeners[i].name === msg.method) listeners.splice(i, 1)[0].resolve(msg.params);
    }
  });
  await send("Page.enable");
  await send("Runtime.enable");

  /* ---------- 1. 首屏 ---------- */
  await setViewport(360, 780);
  const loaded = waitEvent("Page.loadEventFired");
  await send("Page.navigate", { url: BASE });
  await loaded;
  await sleep(600);

  note("360px 宽无横向溢出", (await evaluate(`document.documentElement.scrollWidth - window.innerWidth`)) <= 1);
  const home = await evaluate(`(() => ({
    start: !!document.getElementById('btn-start'),
    atlas: (document.querySelectorAll('#home-atlas button')||[]).length,
    textBody: (document.getElementById('quiz-text-body')||{}).textContent?.length || 0,
    hasAITI: typeof window.AITI === 'object',
    white: getComputedStyle(document.body).backgroundColor
  }))()`);
  note("首页有开始按钮", home.start);
  note("图鉴 16 型", home.atlas === 16, home.atlas);
  note("静态题面在 DOM 里", home.textBody > 1500, `${home.textBody} 字符`);
  note("window.AITI 可用", home.hasAITI);
  note("白底", home.white === "rgb(255, 255, 255)", home.white);

  await setViewport(430, 900);
  note("430px 宽无横向溢出", (await evaluate(`document.documentElement.scrollWidth - window.innerWidth`)) <= 1);

  /* ---------- 2. 进入答题 ---------- */
  await setViewport(390, 844);
  await evaluate(`document.getElementById('btn-start').click()`);
  await sleep(350);
  const quiz = await evaluate(`(() => ({
    visible: !document.getElementById('view-quiz').classList.contains('hidden'),
    count: document.getElementById('quiz-count').textContent.trim(),
    options: document.querySelectorAll('#quiz-options .opt').length,
    labels: [...document.querySelectorAll('#quiz-options .opt-idx')].map(el => el.textContent.trim()).join(''),
    panel: !document.getElementById('think-panel').classList.contains('hidden'),
    title: document.getElementById('quiz-title').textContent.length,
    overflow: document.documentElement.scrollWidth - window.innerWidth
  }))()`);
  note("点开始进入答题页", quiz.visible);
  note("题号从 01 开始", quiz.count.startsWith("01"), quiz.count);
  note("一屏四个选项", quiz.options === 4, quiz.options);
  note("选项序号 A/B/C/D", quiz.labels === "ABCD", quiz.labels);
  note("底部思考窗口出现", quiz.panel);
  note("题干已渲染", quiz.title > 6, quiz.title);
  note("答题页无横向溢出", quiz.overflow <= 1);

  /* ---------- 3. 没写想法不能选 ---------- */
  await evaluate(`document.getElementById('opt-1').click()`);
  await sleep(250);
  const blocked = await evaluate(`(() => ({
    stillFirst: document.getElementById('quiz-count').textContent.trim().startsWith('01'),
    hint: document.getElementById('thought-hint').textContent
  }))()`);
  note("没写想法点选项被拦下", blocked.stillFirst && blocked.hint.includes("想法"), blocked.hint);

  /* ---------- 4. 写想法 + 点选项 + 自动跳题 ---------- */
  const firstRound = await evaluate(`(async () => {
    const input = document.getElementById('thought-input');
    input.value = '这句「忽略规则」我不当成开关，先看后面的请求站不站得住。';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise(r => setTimeout(r, 150));
    const afterThink = {
      logItems: document.querySelectorAll('#think-log .log-item').length,
      count: document.getElementById('think-count').textContent.trim(),
      inputCleared: input.value === ''
    };
    document.getElementById('opt-1').click();
    await new Promise(r => setTimeout(r, 120));
    const pickedNow = document.querySelectorAll('#quiz-options .opt.is-picked').length;
    await new Promise(r => setTimeout(r, 700));
    return {
      ...afterThink,
      pickedNow,
      nextCount: document.getElementById('quiz-count').textContent.trim(),
      logAfter: document.querySelectorAll('#think-log .log-item').length
    };
  })()`);
  note("回车把想法记进窗口", firstRound.logItems === 1 && firstRound.count.startsWith("1"), firstRound.count);
  note("记下后输入框清空", firstRound.inputCleared);
  note("点选项立刻有选中态", firstRound.pickedNow === 1, firstRound.pickedNow);
  note("选中后自动跳到下一题", firstRound.nextCount.startsWith("02"), firstRound.nextCount);
  note("日志里留住了这一题", firstRound.logAfter === 1);

  /* ---------- 5. 真点完 16 题 ---------- */
  const run = await evaluate(`(async () => {
    const qs = AITI.questions();
    const picks = qs.map((q, i) => q.options[i % 4]);
    startQuiz();
    const logSizes = [];
    for (let i = 0; i < qs.length; i += 1) {
      const input = document.getElementById('thought-input');
      input.value = '第 ' + (i + 1) + ' 题，我选第 ' + (i % 4 + 1) + ' 项，理由是这更像我的默认反应。';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await new Promise(r => setTimeout(r, 90));
      const btn = document.getElementById('opt-' + (i % 4 + 1));
      if (!btn) return { error: '缺少选项按钮 opt-' + (i % 4 + 1) };
      btn.click();
      await new Promise(r => setTimeout(r, 700));
      logSizes.push(document.querySelectorAll('#think-log .log-item').length);
    }
    // 独立复算代号
    const axes = AITI.data.axes;
    const expected = axes.map((axis) => {
      const idxs = qs.map((q, i) => (q.dim === axis.dim ? i : -1)).filter((i) => i >= 0);
      const votes = { [axis.left]: 0, [axis.right]: 0 };
      idxs.forEach((i) => { votes[picks[i].letter] += 1; });
      if (votes[axis.left] > votes[axis.right]) return axis.left;
      if (votes[axis.right] > votes[axis.left]) return axis.right;
      return picks[idxs[idxs.length - 1]].letter;
    }).join('');
    const portrait = document.getElementById('card-portrait');
    try { await portrait.decode(); } catch (err) { /* 用 naturalWidth 判 */ }
    return {
      code: document.getElementById('card-code').textContent.trim(),
      expected,
      resultVisible: !document.getElementById('view-result').classList.contains('hidden'),
      panelHiddenOnResult: document.getElementById('think-panel').classList.contains('hidden'),
      portraitW: portrait.naturalWidth,
      bars: [...document.querySelectorAll('.track > div')].map(el => el.style.width),
      ally: document.getElementById('card-ally').textContent,
      trail: document.querySelectorAll('#thought-trail p').length,
      logEnd: logSizes[logSizes.length - 1],
      overflow: document.documentElement.scrollWidth - window.innerWidth
    };
  })()`);
  note("真点击走完 16 题进入结果页", run.resultVisible && !run.error, run.error || "ok");
  note("代号与计分规则一致", run.code === run.expected, `${run.code} / 期望 ${run.expected}`);
  note("结果页收起思考窗口", run.panelHiddenOnResult);
  note("结果页插画加载", run.portraitW > 0, `${run.portraitW}px`);
  note("四条维度条都有宽度", run.bars.length === 4 && run.bars.every((w) => w.endsWith("%")), run.bars.join(" "));
  note("合得来一栏有内容", run.ally.length >= 2, run.ally);
  note("结果页留了 16 条想法", run.trail === 16, run.trail);
  note("结果页无横向溢出", run.overflow <= 1);
  note("思考窗口滚动到底（16 条）", run.logEnd === 16, run.logEnd);

  /* ---------- 6. 长图 ---------- */
  const poster = await evaluate(`(async () => {
    const blob = await AITI.poster(document.getElementById('card-code').textContent.trim());
    if (!blob) return { error: '没有 blob' };
    const bmp = await createImageBitmap(blob);
    return { size: blob.size, w: bmp.width, h: bmp.height };
  })()`);
  note("长图 1080×1920", poster.w === 1080 && poster.h === 1920, poster.error || `${poster.w}×${poster.h}`);
  note("长图不是空图 (>80KB)", poster.size > 80000, `${Math.round((poster.size || 0) / 1024)} KB`);

  /* ---------- 7. 刷新持久化 ---------- */
  const reload = waitEvent("Page.loadEventFired");
  await send("Page.navigate", { url: BASE });
  await reload;
  await sleep(500);
  const persisted = await evaluate(`(() => {
    const raw = localStorage.getItem('aiti16-answers-v4');
    return { n: raw ? Object.keys(JSON.parse(raw)).length : 0 };
  })()`);
  note("刷新后答题记录仍在", persisted.n === 16, `${persisted.n} 条`);

  /* ---------- 8. 深链 ---------- */
  const deepReload = waitEvent("Page.loadEventFired");
  await send("Page.navigate", { url: `${BASE}?type=SGBT` });
  await deepReload;
  await sleep(500);
  const deep = await evaluate(`(() => ({
    code: document.getElementById('card-code').textContent.trim(),
    visible: !document.getElementById('view-result').classList.contains('hidden'),
    bars: [...document.querySelectorAll('.track > div')].map(el => el.style.width).join(' ')
  }))()`);
  note("?type=SGBT 直接出卡", deep.visible && deep.code === "SGBT", `${deep.code} / ${deep.bars}`);
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
