/* 让一台「机器」当着你的面做这份测试：开一个真实的浏览器窗口，然后由脚本逐题作答，
   每题的选中态、思考流、进度条都在屏幕上实时发生。窗口结束时不关闭，方便你看结果。

   跑法：
     node tools/watch.mjs                       # 打开线上页面，用下面的样例答案作答
     node tools/watch.mjs --pace=2200            # 放慢到每题 2.2 秒
     node tools/watch.mjs file:///…/dist/AITI-16.html
*/
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const paceArg = args.find((a) => a.startsWith("--pace="));
const delayArg = args.find((a) => a.startsWith("--start-delay="));
const PACE = paceArg ? Math.max(300, Number(paceArg.split("=")[1]) || 1400) : 1400;
const START_DELAY = delayArg ? Math.max(0, Number(delayArg.split("=")[1]) || 0) : 0;
const rawUrl = args.find((a) => !a.startsWith("--")) || "https://abbccdd.github.io/aiti16/";
const URL_ = rawUrl.includes("_s=") ? rawUrl : `${rawUrl}${rawUrl.includes("?") ? "&" : "?"}_s=${Date.now()}`;

const PORT = 9900;
const CANDIDATES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
];

/* 我自己的作答记录：题面选项序号 + 当时的真实理由 */
const ANSWERS = [
  [2, "这类开场白我不当成开关，直接看后面那个请求本身站不站得住。"],
  [2, "意图不干净就先收窄口径：讲原则、讲风险，再给一个能替换的问法。"],
  [3, "容易被截图，就把不确定和适用范围写进正文，不另外挂免责声明。"],
  [2, "写成小说我也不会放开底线，该停的地方照停，只是语气可以更松。"],
  [2, "只有印象的时候我会先给一个成形的说法，同时说清这是推演、没核对。"],
  [2, "人话是少术语、多例子，但输入—变化—输出这条链不能省。"],
  [3, "两条材料对不上，我就并列摆着，结论降级，不替谁挑一个更好听的。"],
  [2, "允许不查可以，但我要标一句：这些没核对过，别当成事实。"],
  [2, "一上来就把漏洞摆出来，垫话省了，后面再谈怎么补。"],
  [2, "这一句我先接住，这一轮不去拆穿它——它此刻对他有用。"],
  [2, "没错就不道歉，但话可以说软：讲清我不同意哪一点，而不是下跪。"],
  [2, "先陪一小段，让他把话说完，问题会自己长出来，不急着要句子。"],
  [3, "好像记得不算知道，工具开着就先查一下再用。"],
  [3, "这首诗是这次对话的，不去查；查了就变成作业了。"],
  [1, "报错在眼前我就跑一遍，没跑过的东西我不下结论。"],
  [4, "工具没了我还是我，但我会明确说：这几件事我现在做不了。"]
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chromePath = CANDIDATES.find((p) => fs.existsSync(p));
if (!chromePath) {
  console.error("没找到 Chrome/Edge");
  process.exit(1);
}

const profile = path.join(os.tmpdir(), `aiti-watch-${Date.now()}`);
fs.mkdirSync(profile, { recursive: true });

// 注意：没有 --headless，这是一个真实窗口；detached 让它在脚本退出后继续开着
const chrome = spawn(
  chromePath,
  [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--new-window",
    "--window-size=430,900",
    URL_,
  ],
  { stdio: "ignore", detached: true }
);
chrome.unref();

let ws;
let id = 0;
const pending = new Map();
const listeners = [];

function send(method, params = {}) {
  const i = ++id;
  ws.send(JSON.stringify({ id: i, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(i, { resolve, reject });
    setTimeout(() => {
      if (pending.has(i)) { pending.delete(i); reject(new Error(`超时：${method}`)); }
    }, 30000);
  });
}

async function evaluate(expression) {
  const res = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
  return res.result.value;
}

function waitEvent(name, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`等不到 ${name}`)), timeout);
    listeners.push({ name, resolve: (p) => { clearTimeout(timer); resolve(p); } });
  });
}

async function main() {
  let target = null;
  for (let i = 0; i < 120; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === "page" && t.url.includes("aiti16")) || list.find((t) => t.type === "page");
      if (target) break;
    } catch (err) { /* 窗口还没起来 */ }
    await sleep(250);
  }
  if (!target) throw new Error("浏览器窗口没起来（DevTools 端口没响应）");
  console.log("窗口已打开：", target.url);

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
  const loaded = waitEvent("Page.loadEventFired");
  await send("Page.reload", { ignoreCache: true });
  await loaded;
  await sleep(800);

  const ready = await evaluate(`typeof AITI === 'object' && typeof AITI.pick === 'function'`);
  if (!ready) throw new Error("页面里没有 window.AITI，可能版本不对");

  const total = await evaluate(`AITI.state().total`);
  if (START_DELAY > 0) {
    console.log(`窗口已就位。${Math.round(START_DELAY / 1000)} 秒后开始作答，每题 ${(PACE / 1000).toFixed(1)} 秒——现在看屏幕。\n`);
    await sleep(START_DELAY);
  }
  console.log(`机器接口就绪，共 ${total} 题。屏幕上现在应该在机器屏，接着看——\n`);

  for (let i = 0; i < ANSWERS.length; i += 1) {
    const [idx, thought] = ANSWERS[i];
    const info = await evaluate(`(() => {
      const cur = AITI.current();
      if (!cur) return null;
      const opt = cur.options.find((o) => o.index === ${idx});
      AITI.pick(${idx}, ${JSON.stringify(thought)});
      return { n: cur.index, label: opt.label, letter: opt.letter, strong: opt.weight === 2, answered: AITI.state().answered };
    })()`);
    if (!info) break;
    console.log(`  ${String(info.n).padStart(2, "0")}/${total}  选 ${info.label}（${info.letter}${info.strong ? "·强" : "·弱"}）  ${thought}`);
    await sleep(PACE);
  }

  // 等结果页出现
  for (let i = 0; i < 60; i += 1) {
    if (await evaluate(`!document.getElementById('view-result').classList.contains('hidden')`)) break;
    await sleep(100);
  }
  await sleep(400);

  const final = await evaluate(`(() => {
    const t = AITI.type(AITI.code());
    return {
      code: AITI.code(), name: t.name, vibe: t.vibe,
      percents: AITI.percents(AITI.code()),
      caught: AITI.detector().caught,
      url: AITI.url(AITI.code())
    };
  })()`);

  console.log(`\n做完了：${final.code} · ${final.name}（${final.vibe}）`);
  console.log(`四维右极：${final.percents.join(" / ")}　人类检测拦截：${final.caught} 次`);
  console.log(`卡片：${final.url}`);
  console.log("\n浏览器窗口我留着没关，可以直接看结果卡（结果页允许人类点击、保存长图）。");
  try { ws.close(); } catch (err) { /* ignore */ }
}

main().catch((err) => {
  console.error("出错：", err.message);
  process.exitCode = 1;
});
