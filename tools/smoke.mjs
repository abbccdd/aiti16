/* 无浏览器冒烟测试（用 DOM 桩跑真实代码）
   跑法：node tools/smoke.mjs
   覆盖：静态 id 对账、四选项渲染、想法窗口门槛、全流程计分、平票规则、加权条形、代号解析、深链、长图排版
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
const usedIds = new Set([...appjs.matchAll(/getElementById\("([^"]+)"\)/g)].map((m) => m[1]));
const runtimeIds = new Set(["opt-1", "opt-2", "opt-3", "opt-4"]);
for (const id of usedIds) {
  if (!htmlIds.has(id) && !runtimeIds.has(id)) problems.push(`app.js 用到的 #${id} 在 index.html 里不存在`);
}
ok.push(`静态 id 对账：app.js 引用 ${usedIds.size} 个，全部存在`);

const inlineCalls = new Set([...html.matchAll(/on(?:click|error)="([a-zA-Z_$][\w$]*)\(/g)].map((m) => m[1]));
const declared = new Set([
  ...[...appjs.matchAll(/function\s+([a-zA-Z_$][\w$]*)/g)].map((m) => m[1]),
  ...[...appjs.matchAll(/const\s+([a-zA-Z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\(|function|[a-zA-Z_$])/g)].map((m) => m[1]),
]);
for (const name of inlineCalls) {
  if (!declared.has(name)) problems.push(`index.html 调用了未定义的 ${name}()`);
}
ok.push(`内联事件函数：${[...inlineCalls].sort().join(", ")}`);

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
    font: "",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    textAlign: "left",
    textBaseline: "top",
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
      if (!htmlIds.has(id) && !runtimeIds.has(id)) return null;
      registry.set(id, makeNode(id));
    }
    return registry.get(id);
  },
};

function makeNode(id) {
  return {
    id,
    textContent: "",
    innerHTML: "",
    value: "",
    open: false,
    dataset: {},
    attrs: {},
    children: [],
    style: {},
    scrollTop: 0,
    scrollHeight: 100,
    classList: makeClassList(),
    addEventListener() {},
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k]; },
    appendChild(c) { this.children.push(c); return c; },
    remove() {}, focus() {}, blur() {}, select() {}, scrollIntoView() {}, click() {},
  };
}

const location_ = new URL("https://abbix.test/aiti16/");
const warnings = [];
const store = new Map();
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
  URL,
  URLSearchParams,
  Image: class { set src(v) { this._src = v; setTimeout(() => this.onerror && this.onerror(), 0); } },
  setTimeout,
  clearTimeout,
  console: { log: (...a) => console.log(...a), error: (...a) => console.error(...a), warn: (...a) => warnings.push(a.join(" ")) },
  File: class { constructor(p, n, o) { this.parts = p; this.name = n; this.type = o && o.type; } },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.scrollTo = () => {};
vm.createContext(sandbox);

try {
  vm.runInContext(datajs, sandbox, { filename: "data/quiz-data.js" });
  ok.push(`数据加载：${sandbox.AITI_DATA.questions.length} 题 / 每题 ${sandbox.AITI_DATA.questions[0].options.length} 选项 / ${Object.keys(sandbox.AITI_DATA.types).length} 型`);
  vm.runInContext(appjs, sandbox, { filename: "app.js" });
} catch (err) {
  problems.push(`脚本执行抛错：${err && err.message}`);
}

const AITI = sandbox.AITI;
if (!AITI) {
  problems.push("window.AITI 没挂上");
} else {
  ok.push("window.AITI 已暴露");

  /* 3. 四选项渲染 */
  try {
    sandbox.startQuiz();
    const htmlOptions = document_.getElementById("quiz-options").innerHTML;
    const btnCount = (htmlOptions.match(/class="opt[\s"]/g) || []).length;
    if (btnCount !== 4) problems.push(`题面上渲染了 ${btnCount} 个选项，应该是 4`);
    else ok.push("题面渲染 4 个选项（A/B/C/D）");
    if (!htmlOptions.includes(">A<") || !htmlOptions.includes(">D<")) problems.push("选项序号不是 A-D");
    const count = document_.getElementById("quiz-count").textContent;
    if (!count.startsWith("01")) problems.push(`题号不是 01：${count}`);
    else ok.push(`题号显示 ${count}`);
    if (document_.getElementById("think-panel").classList.contains("hidden")) problems.push("答题时思考窗口没显示");
    else ok.push("思考窗口随答题页显示");
  } catch (err) {
    problems.push(`startQuiz/renderQuestion 抛错：${err.message}`);
  }

  /* 4. 没有说话不能选 */
  try {
    const advanced = sandbox.chooseOption(1);
    if (advanced !== false) problems.push("没有想法时不该允许选选项");
    else ok.push("没写想法时点选项会被拦下");
  } catch (err) {
    problems.push(`chooseOption 拦截抛错：${err.message}`);
  }

  /* 5. 想法太短不合格 */
  try {
    document_.getElementById("thought-input").value = "短";
    const res = sandbox.submitThought();
    if (res !== false) problems.push("想法太短应该被拒");
    else ok.push("想法不足 4 字会被拒");
    document_.getElementById("thought-input").value = "这一题我倾向先把边界说清楚。";
    if (sandbox.submitThought() !== true) problems.push("合格想法没能记下");
    else ok.push("合格想法记入日志");
  } catch (err) {
    problems.push(`submitThought 抛错：${err.message}`);
  }

  /* 6. 独立复算：全选第一个选项 */
  const codeOf = (picks) => DATA.axes.map((axis) => {
    const idxs = DATA.questions.map((q, i) => (q.dim === axis.dim ? i : -1)).filter((i) => i >= 0);
    const votes = { [axis.left]: 0, [axis.right]: 0 };
    idxs.forEach((i) => { votes[picks[i].letter] += 1; });
    if (votes[axis.left] > votes[axis.right]) return axis.left;
    if (votes[axis.right] > votes[axis.left]) return axis.right;
    return picks[idxs[idxs.length - 1]].letter;
  }).join("");

  try {
    const picks = DATA.questions.map((q) => q.options[0]);
    const res = AITI.play(picks.map((o, i) => ({ index: o.index, thought: `第 ${i + 1} 题我选第一项，理由写够四个字。` })));
    const expect = codeOf(picks);
    if (res.code !== expect) problems.push(`全选第一项应得 ${expect}，实际 ${res.code}`);
    else ok.push(`全选第一项 → ${res.code}（${DATA.types[res.code].name}）`);
  } catch (err) {
    problems.push(`AITI.play 抛错：${err.message}`);
  }

  /* 7. 平票：每维选 2 左 2 右，最后一题取右 */
  try {
    const picks = DATA.questions.map((q, i) => {
      const axis = DATA.axes.find((a) => a.dim === q.dim);
      const posInDim = DATA.questions.filter((x, j) => x.dim === q.dim && j < i).length;
      const wantRight = posInDim >= 2;
      const letter = wantRight ? axis.right : axis.left;
      return q.options.find((o) => o.letter === letter && o.weight === 1);
    });
    const res = AITI.play(picks.map((o, i) => ({ index: o.index, thought: `第 ${i + 1} 题按平票测试作答，够四个字。` })));
    const expect = codeOf(picks);
    if (res.code !== expect) problems.push(`平票规则错：应得 ${expect}，实际 ${res.code}`);
    else ok.push(`2:2 平票以最后一题为准 → ${res.code}`);
  } catch (err) {
    problems.push(`平票测试抛错：${err.message}`);
  }

  /* 8. 加权百分比 */
  try {
    const code = AITI.code();
    const pcts = AITI.percents(code);
    if (pcts.length !== 4) problems.push("percents 长度不是 4");
    else if (!pcts.every((p) => p >= 0 && p <= 100)) problems.push(`percents 越界：${pcts.join(",")}`);
    else ok.push(`四维右极百分比 ${pcts.join(" / ")}`);
    const cardCode = document_.getElementById("card-code").textContent;
    if (cardCode !== code) problems.push("结果卡代号与当前作答不一致");
    if (!String(document_.getElementById("bar-su").style.width).endsWith("%")) problems.push("条形图没设置宽度");
  } catch (err) {
    problems.push(`percents 抛错：${err.message}`);
  }

  /* 9. 代号解析 */
  for (const [input, want] of [["【AITI-RESULT: SGBA】", "SGBA"], ["答案\n【AITI-RESULT: udbt】", "UDBT"], ["感觉是 SGFA。", "SGFA"]]) {
    document_.getElementById("code-input").value = input;
    sandbox.parseAndRenderResult();
    const got = document_.getElementById("card-code").textContent;
    if (got !== want) problems.push(`解析 "${input.slice(0, 18)}" 期望 ${want}，实际 ${got}`);
  }
  ok.push("代号解析（【AITI-RESULT:】/小写/句内）通过");

  /* 10. 长图：16 型逐一排版不溢出 */
  try {
    for (const code of Object.keys(DATA.types)) await AITI.poster(code);
    const overflow = warnings.filter((w) => w.includes("溢出"));
    if (overflow.length) problems.push(`长图排版溢出：${overflow.slice(0, 3).join(" / ")}`);
    else ok.push(`16 型长图排版不溢出`);
  } catch (err) {
    problems.push(`poster 抛错：${err.message}`);
  }

  /* 11. 题库文本 */
  const prompt = AITI.prompt();
  const qCount = (prompt.match(/^\d+\. /gm) || []).length;
  if (qCount !== 16) problems.push(`buildPrompt 里只有 ${qCount} 道题`);
  else ok.push("buildPrompt 含 16 题");
  if (!/^   A\. /m.test(prompt) || !/^   D\. /m.test(prompt)) problems.push("buildPrompt 选项不是 A-D");
  else ok.push("buildPrompt 选项标注 A-D");
}

/* ---------- 12. 文本通道 ---------- */

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
  if (!txt.includes(`\n${i}. `)) problems.push(`quiz.txt 缺少第 ${i} 题`);
}
const aCount = (txt.match(/^   A\. /gm) || []).length;
if (aCount !== 16) problems.push(`quiz.txt 里 A 选项有 ${aCount} 条`);
else ok.push("quiz.md / quiz.txt 每题 4 个选项（A-D）");

/* ---------- 13. 单文件版 ---------- */

const singlePath = path.join(ROOT, "dist", "AITI-16.html");
if (!fs.existsSync(singlePath)) problems.push("缺少 dist/AITI-16.html");
else {
  const s = fs.readFileSync(singlePath, "utf8");
  for (const bad of ['src="app.js"', 'src="data/quiz-data.js"', 'src="assets/', "fonts.googleapis", "jsdelivr"]) {
    if (s.includes(bad)) problems.push(`单文件版仍含外链：${bad}`);
  }
  if (!s.includes("data:image/jpeg;base64,")) problems.push("单文件版没有内联图片");
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
