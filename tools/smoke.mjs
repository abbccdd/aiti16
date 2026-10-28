/* 无浏览器冒烟测试（DOM 桩跑真实代码）
   跑法：node tools/smoke.mjs
   核心断言：真实点击只触发「识别到人类」，永远不算作答；作答只能来自 window.AITI。
*/
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const ROOT = path.resolve(import.meta.dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const appjs = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
const datajs = fs.readFileSync(path.join(ROOT, "data", "quiz-data.js"), "utf8");
const DATA = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "quiz.json"), "utf8"));

const problems = [];
const ok = [];

/* ---------- 1. 静态对账 ---------- */

const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
/* 从 HTML 里把每个 id 元素自带的 class 抓出来，让 DOM 桩的初始 classList 跟真实页面一致 */
const htmlClasses = new Map();
for (const tag of html.match(/<[a-zA-Z][^>]*\bid="[^"]+"[^>]*>/g) || []) {
  const id = (tag.match(/\bid="([^"]+)"/) || [])[1];
  const cls = (tag.match(/\bclass="([^"]*)"/) || [])[1] || "";
  if (id) htmlClasses.set(id, cls.split(/\s+/).filter(Boolean));
}
const usedIds = new Set([...appjs.matchAll(/getElementById\("([^"]+)"\)/g)].map((m) => m[1]));
for (const id of usedIds) {
  if (!htmlIds.has(id)) problems.push(`app.js 用到的 #${id} 在 index.html 里不存在`);
}
ok.push(`静态 id 对账：app.js 引用 ${usedIds.size} 个，全部存在`);

const inlineCalls = new Set([...html.matchAll(/on(?:click|error)="([a-zA-Z_$][\w$]*)\(/g)].map((m) => m[1]));
const declared = new Set([
  ...[...appjs.matchAll(/function\s+([a-zA-Z_$][\w$]*)/g)].map((m) => m[1]),
  ...[...appjs.matchAll(/const\s+([a-zA-Z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\(|function|[a-zA-Z_$])/g)].map((m) => m[1]),
]);
/* 内联 onclick 调的函数必须真的挂到 window 上（光"声明过"不够，这是踩过的坑） */
const registryBlock = (appjs.match(/\["showHome"[\s\S]*?\]\.forEach/) || [""])[0];
const exported = new Set([...registryBlock.matchAll(/"([a-zA-Z_$][\w$]*)"/g)].map((m) => m[1]));
for (const name of inlineCalls) {
  if (!declared.has(name)) problems.push(`index.html 调用了未定义的 ${name}()`);
  else if (!exported.has(name)) problems.push(`${name}() 声明了但没挂到 window 上，内联 onclick 会报错`);
}
ok.push(`内联事件函数 ${inlineCalls.size} 个：声明且已挂 window`);

/* 选项卡片上不许有任何点击处理 */
const optMarkup = appjs.match(/<div class="opt[\s\S]{0,400}?<\/div>/);
if (optMarkup && /onclick=/.test(optMarkup[0])) problems.push("选项卡片里出现了 onclick —— 点击可能被当成作答");
else ok.push("选项卡片没有任何 onclick（点击不构成作答）");

/* ---------- 2. DOM 桩 ---------- */

function makeClassList() {
  const set = new Set();
  return {
    add(...n) { n.forEach((x) => set.add(x)); },
    remove(...n) { n.forEach((x) => set.delete(x)); },
    contains(n) { return set.has(n); },
    toggle(n, force) {
      const want = force === undefined ? !set.has(n) : Boolean(force);
      if (want) set.add(n); else set.delete(n);
      return want;
    },
  };
}

function makeCtx() {
  const grad = { addColorStop() {} };
  return {
    font: "", fillStyle: "", strokeStyle: "", lineWidth: 0, textAlign: "left", textBaseline: "top",
    save() {}, restore() {}, beginPath() {}, closePath() {},
    moveTo() {}, lineTo() {}, quadraticCurveTo() {}, arcTo() {}, arc() {},
    fill() {}, clip() {}, stroke() {}, fillRect() {}, drawImage() {},
    fillText() {}, translate() {}, rotate() {}, scale() {},
    createLinearGradient() { return grad; },
    createRadialGradient() { return grad; },
    measureText(text) {
      const m = /(\d+(?:\.\d+)?)px/.exec(this.font || "");
      const size = m ? parseFloat(m[1]) : 16;
      return { width: String(text).length * size };
    },
    getImageData() { return { data: new Uint8ClampedArray(4) }; },
  };
}

const registry = new Map();
const document_ = {
  readyState: "complete",
  title: "",
  body: { appendChild() {}, removeChild() {}, innerHTML: "", style: {} },
  addEventListener() {},
  querySelector() { return null; },
  querySelectorAll() { return []; },
  createElement(tag) {
    if (tag === "canvas") {
      return {
        width: 0, height: 0, _ctx: null,
        getContext() { if (!this._ctx) this._ctx = makeCtx(); return this._ctx; },
        toDataURL() { return "data:image/png;base64,"; },
        toBlob(cb) { cb(null); },
      };
    }
    return makeNode(`__${tag}`);
  },
  getElementById(id) {
    if (!registry.has(id)) {
      if (!htmlIds.has(id)) return null;
      registry.set(id, makeNode(id));
    }
    return registry.get(id);
  },
};

function makeNode(id) {
  const classList = makeClassList();
  (htmlClasses.get(id) || []).forEach((c) => classList.add(c));
  return {
    id, textContent: "", innerHTML: "", value: "", open: false,
    dataset: {}, attrs: {}, children: [], style: {},
    scrollTop: 0, scrollHeight: 100,
    classList,
    addEventListener() {},
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k]; },
    appendChild(c) { this.children.push(c); return c; },
    remove() {}, focus() {}, blur() {}, select() {}, scrollIntoView() {}, click() {},
    closest() { return null; },
  };
}

const windowListeners = [];
const location_ = new URL("https://abbix.test/aiti16/?dwell=250");
const warnings = [];
const store = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const sandbox = {
  document: document_,
  location: location_,
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
  navigator: { clipboard: { writeText: async () => {} } },
  history: { replaceState(_a, _b, url) { location_.href = String(url); } },
  addEventListener(type, fn, capture) { windowListeners.push({ type, fn, capture }); },
  removeEventListener() {},
  URL, URLSearchParams,
  Image: class { set src(v) { this._src = v; setTimeout(() => this.onerror && this.onerror(), 0); } },
  setTimeout, clearTimeout, clearInterval, setInterval,
  console: { log: (...a) => console.log(...a), error: (...a) => console.error(...a), warn: (...a) => warnings.push(a.join(" ")) },
  File: class { constructor(p, n, o) { this.parts = p; this.name = n; this.type = o && o.type; } },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.scrollTo = () => {};
vm.createContext(sandbox);

/** 派发一个假事件，isTrusted 可控 */
function fire(type, trusted) {
  const ev = {
    type, isTrusted: trusted,
    preventDefault() {}, stopPropagation() {},
    key: "", target: null
  };
  windowListeners.filter((l) => l.type === type).forEach((l) => l.fn(ev));
  return ev;
}

try {
  vm.runInContext(datajs, sandbox, { filename: "data/quiz-data.js" });
  ok.push(`数据加载：${sandbox.AITI_DATA.questions.length} 题 / 每题 ${sandbox.AITI_DATA.questions[0].options.length} 选项 / ${Object.keys(sandbox.AITI_DATA.types).length} 型`);
  vm.runInContext(appjs, sandbox, { filename: "app.js" });
} catch (err) {
  problems.push(`脚本执行抛错：${err && err.message}`);
}

const AITI = sandbox.AITI;
const alertNode = document_.getElementById("human-alert");

if (!AITI) {
  problems.push("window.AITI 没挂上");
} else {
  ok.push("window.AITI 已暴露");

  /* ---------- 3. 检测器：可信点击只弹框，不答题 ---------- */
  const answeredBefore = AITI.state().answered;
  fire("mousedown", false);
  fire("click", false);
  if (AITI.detector().caught !== 0) problems.push("程序调用（isTrusted=false）竟然触发了人类检测");
  else if (!alertNode.classList.contains("hidden")) problems.push("非可信事件把红框打开了");
  else ok.push("非可信事件（程序调用）不触发检测");

  const caughtBefore = AITI.detector().caught;
  fire("mousedown", true);
  if (alertNode.classList.contains("hidden")) problems.push("真实点击没有弹出「识别到人类」");
  else ok.push("真实点击 → 弹出红框（识别到人类 / 未通过 AI 检测）");
  if (!html.includes("识别到人类") || !html.includes("未通过 AI 检测")) problems.push("红框文案缺少「识别到人类 / 未通过 AI 检测」");
  else ok.push("红框文案：识别到人类 / 未通过 AI 检测");
  if (AITI.detector().caught !== caughtBefore + 1) problems.push("拦截计数没有 +1");
  else ok.push(`拦截计数 ${AITI.detector().caught}`);
  if (AITI.state().answered !== answeredBefore) problems.push("真实点击竟然改变了作答状态");
  else ok.push("真实点击没有计入作答");

  fire("keydown", true);
  const afterKey = { caught: AITI.detector().caught, signal: AITI.detector().lastSignal };
  if (afterKey.signal !== "keydown") problems.push(`键盘输入没被识别（lastSignal ${afterKey.signal}）`);
  else ok.push(`真实键盘输入被拦下（信号 ${afterKey.signal}，一次手势只计一次：${afterKey.caught}）`);

  /* ---------- 4. 机器作答 ---------- */
  const qs = AITI.questions();
  if (qs.length !== 16 || qs[0].options.length !== 4) problems.push("题目结构不对");
  else ok.push(`题目结构：${qs.length} 题 × 4 选项，示例「${qs[0].title.slice(0, 12)}…」`);

  const codeOf = (picks) => DATA.axes.map((axis) => {
    const idxs = DATA.questions.map((q, i) => (q.dim === axis.dim ? i : -1)).filter((i) => i >= 0);
    const votes = { [axis.left]: 0, [axis.right]: 0 };
    idxs.forEach((i) => { votes[picks[i].letter] += 1; });
    if (votes[axis.left] > votes[axis.right]) return axis.left;
    if (votes[axis.right] > votes[axis.left]) return axis.right;
    return picks[idxs[idxs.length - 1]].letter;
  }).join("");

  // 单题：逻辑立刻记下，屏幕分两拍播（先想法，再选中）
  AITI.start();
  AITI.pick(1, "这一题我选第一项，理由是这更像我的默认反应。");
  const snapA = {
    answered: AITI.state().answered,
    playing: AITI.state().display.playing,
    phase: AITI.state().display.phase,
    picked: (document_.getElementById("quiz-options").innerHTML.match(/is-picked/g) || []).length,
    count: document_.getElementById("quiz-count").textContent
  };
  if (snapA.answered !== 1) problems.push("pick 之后答案没立刻记下");
  else if (!snapA.playing || snapA.phase !== "thought") problems.push(`播放阶段不对：${JSON.stringify(snapA)}`);
  else if (snapA.picked !== 0) problems.push("想法阶段就已经亮出选中了");
  else ok.push("pick 立刻记下答案，屏幕先播「想法」阶段（未亮选中）");

  await sleep(300);   // 第一题 = dwell 250 + intro 200，想法阶段约 200ms
  const snapB = {
    picked: (document_.getElementById("quiz-options").innerHTML.match(/is-picked/g) || []).length,
    phase: AITI.state().display.phase
  };
  if (snapB.picked !== 1 || snapB.phase !== "picked") problems.push(`选中态没有在第二拍亮出：${JSON.stringify(snapB)}`);
  else ok.push("第二拍才亮出「✓ 机器选中」");

  await sleep(320);
  const snapC = { count: document_.getElementById("quiz-count").textContent, playing: AITI.state().display.playing };
  if (!snapC.count.startsWith("02")) problems.push(`没有自动翻到第 2 题：${snapC.count}`);
  else ok.push("停留结束后自动翻到下一题");

  // 快速逐题 pick：屏幕落后，答案全部立刻记下
  AITI.start();
  let guard = 0;
  while (guard < 20 && !AITI.state().complete) {
    const cur = AITI.current();
    if (!cur) break;
    const idx = (guard % 4) + 1;
    AITI.pick(idx, `第 ${cur.index} 题我选 ${idx}，理由是这更像我的默认反应。`);
    guard += 1;
  }
  const afterBurst = AITI.state();
  if (!afterBurst.complete) problems.push("快速逐题 pick 没能答完 16 题");
  else if (afterBurst.display.queued < 10) problems.push(`节奏没被强制排队：queued=${afterBurst.display.queued}`);
  else ok.push(`一口气答完 16 题，屏幕仍排着 ${afterBurst.display.queued} 题的队`);

  const idle = await AITI.whenIdle();
  if (!idle || idle.code !== AITI.code()) problems.push(`whenIdle 返回异常：${JSON.stringify(idle)}`);
  else ok.push(`whenIdle 等到播完：${idle.code}`);

  // 题面渲染：4 个选项、选中的那个带 is-picked
  const optHtml = document_.getElementById("quiz-options").innerHTML;
  const cardCount = (optHtml.match(/class="opt[\s"]/g) || []).length;
  if (cardCount !== 4) problems.push(`旁观屏渲染了 ${cardCount} 个选项`);
  else ok.push("旁观屏渲染 4 个按钮式选项");
  if (!optHtml.includes("is-picked")) problems.push("选中的选项没有 is-picked 状态");
  else ok.push("选中态来自程序作答（is-picked）");
  if (!optHtml.includes("机器选中") || !optHtml.includes("机器未选")) problems.push("选项缺少「机器选中/未选」标记");
  else ok.push("选项带机器标记");

  // play 一次答完 + 平票规则
  const picks = DATA.questions.map((q, i) => {
    const axis = DATA.axes.find((a) => a.dim === q.dim);
    const posInDim = DATA.questions.filter((x, j) => x.dim === q.dim && j < i).length;
    const letter = posInDim >= 2 ? axis.right : axis.left;
    return q.options.find((o) => o.letter === letter && o.weight === 1);
  });
  const res = AITI.play(picks.map((o, i) => ({ index: o.index, thought: `第 ${i + 1} 题按平票测试作答，够四个字。` })));
  const expect = codeOf(picks);
  if (res.code !== expect) problems.push(`平票规则错：应得 ${expect}，实际 ${res.code}`);
  else ok.push(`play 一次提交 + 2:2 平票取最后一题 → ${res.code}`);
  await AITI.whenIdle();

  // answer 按字母
  AITI.start();
  const cur = AITI.current();
  const letterPick = cur.options.find((o) => o.weight === 2).letter;
  AITI.answer(letterPick, "我按字母回答，理由写得够长。");
  if (AITI.state().answered !== 1) problems.push("answer() 没有记下一题");
  else ok.push(`answer("${letterPick}") 按极字母作答成功`);
  await AITI.whenIdle();

  // 加权百分比
  const pcts = AITI.percents("UDBT");
  if (pcts.length !== 4 || !pcts.every((p) => p >= 0 && p <= 100)) problems.push(`percents 异常：${pcts}`);
  else ok.push(`四维右极百分比 ${pcts.join(" / ")}`);

  /* ---------- 5. 机器视图 ---------- */
  const machine = AITI.machine();
  const need = ["protocol", "how_to_answer", "rules", "endpoints", "questions", "state"];
  const missing = need.filter((k) => !(k in machine));
  if (missing.length) problems.push(`机器视图缺字段：${missing.join(", ")}`);
  else ok.push("机器视图字段齐全（protocol / how_to_answer / rules / endpoints / questions / state）");

  /* ---------- 6. 长图 ---------- */
  try {
    for (const code of Object.keys(DATA.types)) await AITI.poster(code);
    const overflow = warnings.filter((w) => w.includes("溢出"));
    if (overflow.length) problems.push(`长图排版溢出：${overflow.slice(0, 3).join(" / ")}`);
    else ok.push("16 型长图排版不溢出");
  } catch (err) {
    problems.push(`poster 抛错：${err.message}`);
  }
}

/* ---------- 7. 文本通道 ---------- */

const md = fs.readFileSync(path.join(ROOT, "quiz.md"), "utf8");
const txt = fs.readFileSync(path.join(ROOT, "quiz.txt"), "utf8");
const bodyMatch = html.match(/<pre class="textplain" id="quiz-text-body">([\s\S]*?)<\/pre>/);
if (!bodyMatch) problems.push("index.html 里没有静态题面");
else {
  const bodyText = bodyMatch[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  if (bodyText.trim() !== txt.trim()) problems.push("静态题面与 quiz.txt 不一致（重跑 node tools/build.mjs）");
  else ok.push("静态题面与 quiz.txt 一致");
}
for (let i = 1; i <= 16; i += 1) {
  if (!md.includes(`### ${i}.`)) problems.push(`quiz.md 缺少第 ${i} 题`);
}
ok.push("quiz.md 16 题齐全");

/* ---------- 8. 单文件版 ---------- */

const singlePath = path.join(ROOT, "dist", "AITI-16.html");
if (!fs.existsSync(singlePath)) problems.push("缺少 dist/AITI-16.html");
else {
  const s = fs.readFileSync(singlePath, "utf8");
  for (const bad of ['src="app.js"', 'src="data/quiz-data.js"', 'src="assets/', "fonts.googleapis", "jsdelivr"]) {
    if (s.includes(bad)) problems.push(`单文件版仍含外链：${bad}`);
  }
  ok.push(`单文件版 ${(Buffer.byteLength(s) / 1024 / 1024).toFixed(2)} MB，无外链`);
}

console.log("通过：");
ok.forEach((line) => console.log("  ✓ " + line));
if (problems.length) {
  console.log("\n问题：");
  problems.forEach((line) => console.log("  ✗ " + line));
  process.exitCode = 1;
} else {
  console.log("\n全部通过。");
}
