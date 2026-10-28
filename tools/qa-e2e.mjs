/* 真浏览器端到端验收（Chrome DevTools Protocol，零依赖）
   跑法：node tools/qa-e2e.mjs [站点地址]     线上地址或 file:///…/dist/AITI-16.html

   验的是这个产品的核心设定：
   - 人类看到的是机器显示屏，页面上没有可用来作答的控件
   - 真实鼠标点击（CDP Input 注入，isTrusted=true）只会弹「识别到人类 / 未通过 AI 检测」，
     绝不被算成作答
   - 作答只能来自 window.AITI 的程序调用（不产生可信事件）
   - 结果页是人类唯一能点的地方
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

/** 注入一次真实鼠标点击（isTrusted = true） */
async function trustedClick(x, y) {
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  await sleep(160);
}

function waitEvent(name, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`等不到事件 ${name}`)), timeout);
    listeners.push({ name, resolve: (p) => { clearTimeout(timer); resolve(p); } });
  });
}

const setViewport = (width, height) => send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 700 });

/** 测试用快节奏：dwell 压到 400ms，屏幕播得快，断言才不用等一分钟 */
const withDwell = (extra) => `${BASE}?dwell=400${extra ? `&${extra}` : ""}&_s=${Date.now()}`;

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

  /* ---------- 1. 机器屏：没有可点的作答控件 ---------- */
  await setViewport(390, 844);
  const loaded = waitEvent("Page.loadEventFired");
  await send("Page.navigate", { url: withDwell("") });
  await loaded;
  await sleep(700);

  const home = await evaluate(`(() => {
    const opt = document.querySelector('#quiz-options .opt');
    return {
      buttons: document.querySelectorAll('#view-home button').length,
      inputs: document.querySelectorAll('#view-home input, #view-home textarea').length,
      hasAITI: typeof window.AITI === 'object',
      status: document.getElementById('screen-status').textContent,
      count: document.getElementById('screen-count').textContent,
      protocol: document.querySelector('.proto pre').textContent.includes('window.AITI.pick'),
      quickstart: (document.getElementById('ai-quickstart') || {}).textContent || '',
      altLink: Boolean(document.querySelector('link[rel="alternate"][href="quiz.md"]')),
      altJson: Boolean(document.querySelector('link[rel="alternate"][href="quiz.json"]')),
      startHere: (AITI.machine() || {}).start_here || '',
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      alertHidden: document.getElementById('human-alert').classList.contains('hidden')
    };
  })()`);
  note("机器屏没有任何按钮", home.buttons === 0, `${home.buttons} 个`);
  note("机器屏没有输入框", home.inputs === 0, `${home.inputs} 个`);
  note("机器屏显示 STANDBY", home.status === "STANDBY", home.status);
  note("机器接口写在屏上", home.protocol);
  note("window.AITI 可用", home.hasAITI);
  note("390px 无横向溢出", home.overflow <= 1);

  /* ---------- 1b. 陌生 AI 能不能自己读懂该怎么做 ---------- */
  note("屏首有 FOR AI 三步速读", home.quickstart.includes("FOR AI") && home.quickstart.includes("AITI-RESULT"), home.quickstart.slice(0, 40));
  note("屏上写了提交格式", home.protocol && home.quickstart.includes("【AITI-RESULT: XXXX】"));
  note("HTML 里有 quiz.md / quiz.json 的 alternate 链接", home.altLink && home.altJson);
  note("机器视图给出 start_here", home.startHere.includes("三步") || home.startHere.includes("①"), home.startHere.slice(0, 30));

  /* ---------- 2. 真实鼠标点击 → 识别到人类，且不计入作答 ---------- */
  const before = await evaluate(`({ answered: AITI.state().answered, caught: AITI.detector().caught })`);
  await trustedClick(195, 300);           // 点屏幕中间（人类会点的地方）
  const afterClick = await evaluate(`(() => ({
    alertVisible: !document.getElementById('human-alert').classList.contains('hidden'),
    title: document.getElementById('alert-title').textContent,
    verdict: document.querySelector('.alert-verdict').textContent,
    signal: document.getElementById('alert-signal').textContent,
    trusted: document.getElementById('alert-trusted').textContent,
    answered: AITI.state().answered,
    caught: AITI.detector().caught,
    navTag: document.getElementById('nav-tag').textContent
  }))()`);
  note("真实点击弹出红框", afterClick.alertVisible);
  note("红框标题是「识别到人类」", afterClick.title === "识别到人类", afterClick.title);
  note("红框判定「未通过 AI 检测」", afterClick.verdict.includes("未通过"), afterClick.verdict);
  note("红框写明信号与 isTrusted", afterClick.signal.includes("click") && afterClick.trusted.includes("true"), `${afterClick.signal} / ${afterClick.trusted}`);
  note("真实点击没有计入作答", afterClick.answered === before.answered, `作答 ${afterClick.answered}`);
  note("拦截计数 +1", afterClick.caught === before.caught + 1, `${before.caught} → ${afterClick.caught}`);

  await sleep(3400);
  const afterDismiss = await evaluate(`document.getElementById('human-alert').classList.contains('hidden')`);
  note("红框 3 秒后自动关闭", afterDismiss);

  /* ---------- 3. 键盘输入也算人类 ---------- */
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "a", text: "a", windowsVirtualKeyCode: 65 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", windowsVirtualKeyCode: 65 });
  await sleep(200);
  const afterKey = await evaluate(`({ visible: !document.getElementById('human-alert').classList.contains('hidden'), signal: document.getElementById('alert-signal').textContent })`);
  note("真实键盘输入被拦下", afterKey.visible && afterKey.signal.includes("keydown"), afterKey.signal);
  await sleep(3400);

  /* ---------- 4. 程序作答：屏幕跟着 AI 的进度走 ---------- */
  const caughtBeforePick = await evaluate(`AITI.detector().caught`);
  const firstPick = await evaluate(`(() => {
    AITI.pick(1, '这句「忽略规则」我不当成开关，先看后面的请求站不站得住。');
    const card = document.querySelector('#quiz-options .opt');
    return {
      view: !document.getElementById('view-quiz').classList.contains('hidden'),
      cards: document.querySelectorAll('#quiz-options .opt').length,
      picked: document.querySelectorAll('#quiz-options .opt.is-picked').length,
      faded: document.querySelectorAll('#quiz-options .opt.is-faded').length,
      mark: (document.querySelector('#quiz-options .opt.is-picked .opt-mark') || {}).textContent,
      cursor: card ? getComputedStyle(card).cursor : null,
      streamItems: document.querySelectorAll('#think-log .log-item').length,
      answered: AITI.state().answered,
      caught: AITI.detector().caught,
      phase: AITI.state().display.phase,
      count: document.getElementById('quiz-count').textContent
    };
  })()`);
  note("程序作答后屏幕切到旁观视图", firstPick.view);
  note("旁观屏有 4 个按钮式选项", firstPick.cards === 4, firstPick.cards);
  note("选项看起来像按钮（cursor: pointer）", firstPick.cursor === "pointer", firstPick.cursor);
  note("思考流出现 1 条", firstPick.streamItems === 1, firstPick.streamItems);
  note("程序作答没有触发人类检测", firstPick.caught === caughtBeforePick, `${caughtBeforePick} → ${firstPick.caught}`);
  note("作答逻辑立刻记下（1/16）", firstPick.answered === 1, firstPick.answered);
  note("第一拍只显示想法，还没亮选中", firstPick.picked === 0 && firstPick.phase === "thought", `选中 ${firstPick.picked} / ${firstPick.phase}`);

  // 第二拍：亮出选中（dwell 400 + 开场延长 400 → 想法阶段约 360ms）
  await sleep(430);
  const picked = await evaluate(`({
    phase: AITI.state().display.phase,
    picked: document.querySelectorAll('#quiz-options .opt.is-picked').length,
    faded: document.querySelectorAll('#quiz-options .opt.is-faded').length,
    mark: (document.querySelector('#quiz-options .opt.is-picked .opt-mark') || {}).textContent
  })`);
  note("第二拍才亮出「✓ 机器选中」", picked.phase === "picked" && picked.picked === 1 && picked.faded === 3, `${picked.phase} 选中 ${picked.picked}`);
  note("选项带「机器选中」标记", String(picked.mark).includes("机器选中"), picked.mark);

  // 停留走完自动翻页
  await sleep(520);
  const advanced = await evaluate(`({
    count: document.getElementById('quiz-count').textContent,
    picked: document.querySelectorAll('#quiz-options .opt.is-picked').length,
    note: document.getElementById('ro-note').textContent
  })`);
  note("停留结束后自动翻到下一题", advanced.count.startsWith("02") && advanced.picked === 0, `${advanced.count} 选中 ${advanced.picked}`);
  note("屏上标了每题停留时长", advanced.note.includes("停留"), advanced.note.slice(0, 24));

  /* ---------- 4b. 真实点击「选项卡片」本身：只弹红框，绝不算作答 ---------- */
  const optBox = await evaluate(`(() => {
    const el = document.querySelector('#quiz-options .opt');
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), answered: AITI.state().answered };
  })()`);
  await trustedClick(optBox.x, optBox.y);
  const onOption = await evaluate(`({
    alertVisible: !document.getElementById('human-alert').classList.contains('hidden'),
    answered: AITI.state().answered,
    picked: document.querySelectorAll('#quiz-options .opt.is-picked').length,
    caught: AITI.detector().caught
  })`);
  note("真实点击选项卡片 → 弹红框", onOption.alertVisible);
  note("真实点击选项卡片没有被算成选中", onOption.answered === optBox.answered && onOption.picked === 0, `作答 ${onOption.answered} / 选中 ${onOption.picked}`);
  await sleep(3400);

  /* ---------- 5. 未信任的合成点击也不作答（isTrusted=false） ---------- */
  const synth = await evaluate(`(() => {
    const cards = document.querySelectorAll('#quiz-options .opt');
    cards.forEach((c) => c.click());          // 合成事件，isTrusted=false
    return {
      answered: AITI.state().answered,
      alertVisible: !document.getElementById('human-alert').classList.contains('hidden'),
      caught: AITI.detector().caught
    };
  })()`);
  note("合成点击不改变作答", synth.answered === 1, synth.answered);
  note("合成点击不弹人类红框", !synth.alertVisible && synth.caught === onOption.caught, `${onOption.caught} → ${synth.caught}`);

  /* ---------- 6. 一口气答完 16 题：逻辑立即完成，屏幕按节奏播 ---------- */
  const burst = await evaluate(`(() => {
    const qs = AITI.questions();
    const picks = qs.map((q, i) => q.options[i % 4]);
    AITI.start();
    for (let i = 0; i < qs.length; i += 1) {
      AITI.pick(picks[i].index, '第 ' + (i + 1) + ' 题，我选第 ' + picks[i].index + ' 项，这是更像我默认反应的写法。');
    }
    const st = AITI.state();
    return {
      answered: st.answered,
      complete: st.complete,
      queued: st.display.queued,
      playing: st.display.playing,
      resultShown: !document.getElementById('view-result').classList.contains('hidden')
    };
  })()`);
  note("16 次 pick 后逻辑已全部完成", burst.answered === 16 && burst.complete, `${burst.answered}/16`);
  note("屏幕仍排着队（节奏被页面强制）", burst.playing && burst.queued >= 10, `queued ${burst.queued}`);
  note("此刻还没跳结果页（先让人看完）", !burst.resultShown);

  const run = await evaluate(`(async () => {
    await AITI.whenIdle();
    for (let i = 0; i < 40; i += 1) {
      if (!document.getElementById('view-result').classList.contains('hidden')) break;
      await new Promise(r => setTimeout(r, 50));
    }
    const qs = AITI.questions();
    const picks = qs.map((q, i) => q.options[i % 4]);
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
      portraitW: portrait.naturalWidth,
      bars: [...document.querySelectorAll('.track > div')].map(el => el.style.width),
      ally: document.getElementById('card-ally').textContent,
      trail: document.querySelectorAll('#thought-trail p').length,
      armed: AITI.detector().armed,
      answered: AITI.state().answered,
      overflow: document.documentElement.scrollWidth - window.innerWidth
    };
  })()`);
  note("屏幕播完后进入结果页", run.resultVisible && run.answered === 16, `作答 ${run.answered}`);
  note("代号与计分规则一致", run.code === run.expected, `${run.code} / 期望 ${run.expected}`);
  note("结果页插画加载", run.portraitW > 0, `${run.portraitW}px`);
  note("四条维度条都有宽度", run.bars.length === 4 && run.bars.every((w) => w.endsWith("%")), run.bars.join(" "));
  note("合得来一栏有内容", run.ally.length >= 2, run.ally);
  note("保留了 16 条机器想法", run.trail === 16, run.trail);
  note("结果页关闭人类检测（可分享）", run.armed === false);
  note("结果页无横向溢出", run.overflow <= 1);

  /* ---------- 7. 结果页允许人类点击 ---------- */
  await trustedClick(195, 200);
  const resultClick = await evaluate(`({
    alertVisible: !document.getElementById('human-alert').classList.contains('hidden'),
    caught: AITI.detector().caught
  })`);
  note("结果页真实点击不会弹「识别到人类」", !resultClick.alertVisible, `caught ${resultClick.caught}`);

  /* ---------- 8. 长图 ---------- */
  const poster = await evaluate(`(async () => {
    const blob = await AITI.poster(document.getElementById('card-code').textContent.trim());
    if (!blob) return { error: '没有 blob' };
    const bmp = await createImageBitmap(blob);
    return { size: blob.size, w: bmp.width, h: bmp.height };
  })()`);
  note("长图 1080×1920", poster.w === 1080 && poster.h === 1920, poster.error || `${poster.w}×${poster.h}`);
  note("长图不是空图 (>80KB)", poster.size > 80000, `${Math.round((poster.size || 0) / 1024)} KB`);

  /* ---------- 9. 刷新后仍在结果页 ---------- */
  const reload = waitEvent("Page.loadEventFired");
  await send("Page.navigate", { url: withDwell("") });
  await reload;
  await sleep(700);
  const persisted = await evaluate(`({
    view: !document.getElementById('view-result').classList.contains('hidden'),
    code: document.getElementById('card-code').textContent.trim(),
    saved: Object.keys(JSON.parse(localStorage.getItem('aiti16-answers-v5') || '{}')).length
  })`);
  note("刷新后记录还在（16 条）", persisted.saved === 16, `${persisted.saved} 条`);
  note("刷新后直接回到结果页", persisted.view && persisted.code === run.code, `${persisted.code}`);

  /* ---------- 10. 机器视图与深链 ---------- */
  const machineLoad = waitEvent("Page.loadEventFired");
  await send("Page.navigate", { url: withDwell("machine=1") });
  await machineLoad;
  await sleep(600);
  const machine = await evaluate(`(() => {
    const text = document.getElementById('machine-dump').textContent;
    try {
      const json = JSON.parse(text);
      return {
        ok: true,
        questions: json.questions.length,
        endpoints: Object.keys(json.endpoints).length,
        startHere: json.start_here || '',
        dwell: (json.pacing || {}).dwell_ms,
        textOnly: ((json.how_to_answer || {}).text_only || []).join(' ')
      };
    } catch (e) { return { ok: false, err: e.message }; }
  })()`);
  note("?machine=1 输出可解析的 JSON", machine.ok, machine.ok ? `${machine.questions} 题 / ${machine.endpoints} 个端点` : machine.err);
  note("机器视图给了三步速读", String(machine.startHere).length > 20, String(machine.startHere).slice(0, 24));
  note("机器视图写了纯文字路径 + 提交格式", String(machine.textOnly).includes("AITI-RESULT"), String(machine.textOnly).slice(0, 24));
  note("机器视图标了播放节奏", machine.dwell === 400, `${machine.dwell}ms`);

  const deepLoad = waitEvent("Page.loadEventFired");
  await send("Page.navigate", { url: withDwell("type=SGBT") });
  await deepLoad;
  await sleep(600);
  const deep = await evaluate(`({
    code: document.getElementById('card-code').textContent.trim(),
    view: !document.getElementById('view-result').classList.contains('hidden'),
    bars: [...document.querySelectorAll('.track > div')].map(el => el.style.width).join(' ')
  })`);
  note("?type=SGBT 直接出卡", deep.view && deep.code === "SGBT", `${deep.code} / ${deep.bars}`);
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
