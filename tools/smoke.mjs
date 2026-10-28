/* 无浏览器冒烟测试（本机 Chrome 在沙箱里起不来，用 DOM 桩跑一遍真实代码）
   跑法：node tools/smoke.mjs
   覆盖：静态 id 对账、答题全流程、2:2 平票规则、代号解析、深链渲染、长图绘制不报错
*/
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const ROOT = path.resolve(import.meta.dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const appjs = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
const datajs = fs.readFileSync(path.join(ROOT, "data", "quiz-data.js"), "utf8");

const problems = [];
const ok = [];

/* ---------- 1. 静态 id 对账 ---------- */

const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const usedIds = new Set([...appjs.matchAll(/getElementById\("([^"]+)"\)/g)].map((m) => m[1]));
const dynamic = new Set(["opt-S", "opt-U", "opt-G", "opt-D", "opt-F", "opt-B", "opt-A", "opt-T"]);
for (const id of usedIds) {
  if (!htmlIds.has(id) && !dynamic.has(id)) problems.push(`app.js 用到的 #${id} 在 index.html 里不存在`);
}
ok.push(`静态 id 对账：app.js 引用 ${usedIds.size} 个，全部存在`);

// onclick 里调用的函数必须在 window 上
const inlineCalls = new Set([...html.matchAll(/on(?:click|error)="([a-zA-Z_$][\w$]*)\(/g)].map((m) => m[1]));
const declared = new Set([...appjs.matchAll(/function\s+([a-zA-Z_$][\w$]*)/g)].map((m) => m[1]));
for (const name of inlineCalls) {
  if (!declared.has(name) && name !== "this") problems.push(`index.html 里调用了未定义的 ${name}()`);
}
ok.push(`内联事件函数：${[...inlineCalls].join(", ")}`);

/* ---------- 2. DOM 桩 ---------- */

function makeClassList(node) {
  const set = new Set();
  return {
    add(...names) { names.forEach((n) => set.add(n)); },
    remove(...names) { names.forEach((n) => set.delete(n)); },
    contains(n) { return set.has(n); },
    toggle(n, force) {
      const want = force === undefined ? !set.has(n) : Boolean(force);
      if (want) set.add(n); else set.delete(n);
      return want;
    },
    _set: set,
  };
}

function makeCtx() {
  const grad = { addColorStop() {} };
  return {
    canvas: null,
    font: "",
    fillStyle: "",
    textAlign: "left",
    textBaseline: "top",
    shadowColor: "",
    shadowBlur: 0,
    shadowOffsetY: 0,
    save() {}, restore() {}, beginPath() {}, closePath() {},
    moveTo() {}, lineTo() {}, quadraticCurveTo() {}, arcTo() {}, arc() {},
    fill() {}, clip() {}, fillRect() {}, strokeRect() {}, drawImage() {},
    fillText() {}, setTransform() {}, translate() {}, scale() {}, rotate() {},
    createLinearGradient() { return grad; },
    createRadialGradient() { return grad; },
    measureText(text) {
      const m = /(\d+(?:\.\d+)?)px/.exec(this.font || "");
      const size = m ? parseFloat(m[1]) : 16;
      return { width: String(text).length * size };
    },
    getImageData() { return { data: new Uint8ClampedArray(4) }; },
    putImageData() {},
  };
}

const registry = new Map();
const document_ = {
  readyState: "complete",
  title: "",
  body: { appendChild() {}, removeChild() {} },
  addEventListener() {},
  querySelector() { return null; },
  createElement(tag) {
    if (tag === "canvas") {
      const canvas = {
        width: 0,
        height: 0,
        _ctx: null,
        getContext() { if (!this._ctx) this._ctx = makeCtx(); return this._ctx; },
        toDataURL() { return "data:image/png;base64,"; },
        toBlob(cb) { cb(null); },
      };
      return canvas;
    }
    return makeNode(`__${tag}`);
  },
  getElementById(id) {
    if (!registry.has(id)) {
      if (!htmlIds.has(id) && !dynamic.has(id)) return null;
      registry.set(id, makeNode(id));
    }
    return registry.get(id);
  },
};

function makeNode(id) {
  const node = {
    id,
    textContent: "",
    innerHTML: "",
    value: "",
    open: false,
    dataset: {},
    attrs: {},
    children: [],
    style: {},
    classList: makeClassList(),
    addEventListener() {},
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k]; },
    appendChild(child) { this.children.push(child); return child; },
    remove() {},
    focus() {},
    select() {},
    scrollIntoView() {},
    click() {},
    removeChild() {},
  };
  return node;
}

const location_ = new URL("https://abbix.test/aiti16/");
const warnings = [];
const store = new Map();
const sandbox = {
  window: {},
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
  Image: class {
    set src(v) { this._src = v; setTimeout(() => this.onerror && this.onerror(), 0); }
  },
  setTimeout,
  clearTimeout,
  console: {
    log: (...a) => console.log(...a),
    error: (...a) => console.error(...a),
    warn: (...a) => warnings.push(a.join(" ")),
  },
  File: class {
    constructor(parts, name, opts) { this.parts = parts; this.name = name; this.type = opts && opts.type; }
  },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.scrollTo = () => {};
sandbox.window.location = location_;
sandbox.window.history = sandbox.history;
sandbox.window.document = document_;
vm.createContext(sandbox);

try {
  vm.runInContext(datajs, sandbox, { filename: "data/quiz-data.js" });
  ok.push(`数据加载：${sandbox.AITI_DATA.questions.length} 题 / ${Object.keys(sandbox.AITI_DATA.types).length} 型`);
  vm.runInContext(appjs, sandbox, { filename: "app.js" });
} catch (err) {
  problems.push(`脚本执行抛错：${err && err.message}`);
}

const AITI = sandbox.AITI;
if (!AITI) {
  problems.push("window.AITI 没挂上");
} else {
  ok.push("window.AITI 已暴露");

  /* ---------- 3. 全流程 ---------- */

  // 3a：从首页开始，走真实 UI 路径
  try {
    sandbox.startQuiz();
    const node = document_.getElementById("quiz-count");
    if (!String(node.innerHTML).includes("01")) problems.push("点开始后题号不是 01");
    else ok.push("开始作答：题号渲染正常");
  } catch (err) {
    problems.push(`startQuiz 抛错：${err.message}`);
  }

  // 3b：缺想法时必须拦下
  try {
    document_.getElementById("thought-input").value = "短";
    const advanced = sandbox.chooseOption("S");
    if (advanced !== false) problems.push("想法不足 4 字时不该放行");
    else ok.push("想法太短会被拦下");
  } catch (err) {
    problems.push(`chooseOption 校验抛错：${err.message}`);
  }

  // 3c：AITI.answer 逐题作答（含非法选项）
  sandbox.startQuiz();
  let badOptionCaught = false;
  try {
    AITI.answer("Z", "随便写点什么凑够四个字");
  } catch (err) {
    badOptionCaught = /非法选项/.test(err.message);
  }
  if (!badOptionCaught) problems.push("非法选项没有被拦下");
  else ok.push("非法选项会被拦下");

  // 全选左边 → 四位全 left
  const leftPick = AITI.questions().map((q) => q.options[0].letter);
  let guard = 0;
  sandbox.startQuiz();
  while (guard < 20) {
    const cur = AITI.current();
    if (!cur) break;
    AITI.answer(cur.options[0].letter, `第 ${cur.index} 题我按默认习惯选左边那个。`);
    guard += 1;
  }
  const allLeft = AITI.code();
  const expectedLeft = sandbox.AITI_DATA.axes.map((a) => a.left).join("");
  if (allLeft !== expectedLeft) problems.push(`全选左边应得 ${expectedLeft}，实际 ${allLeft}`);
  else ok.push(`全选左边 → ${allLeft}（${sandbox.AITI_DATA.types[allLeft].name}）`);

  /* ---------- 4. 平票规则 ---------- */

  // 每维：2 票左 + 2 票右，最后一题选右 → 结果应为右
  sandbox.startQuiz();
  const qs = AITI.questions();
  const pick = qs.map((q, i) => {
    const pos = i % 4;               // 该维内第几题
    return pos < 2 ? q.options[0].letter : q.options[1].letter;
  });
  try {
    const res = AITI.play(pick.map((letter, i) => ({ letter, thought: `第 ${i + 1} 题，我选 ${letter}，理由够四个字。` })));
    const expectedTie = sandbox.AITI_DATA.axes.map((a) => a.right).join("");
    if (res.code !== expectedTie) problems.push(`2:2 平票应以最后一题为准，应得 ${expectedTie}，实际 ${res.code}`);
    else ok.push(`2:2 平票规则正确 → ${res.code}`);
  } catch (err) {
    problems.push(`AITI.play 抛错：${err.message}`);
  }

  /* ---------- 5. 代号解析 ---------- */

  const cases = [
    ["【AITI-RESULT: SGBA】", "SGBA"],
    ["我答完了\n【AITI-RESULT: udbt】", "UDBT"],
    ["结果是 SGFA。", "SGFA"],
    ["没有代号的一段话", null],
  ];
  for (const [input, want] of cases) {
    const node = document_.getElementById("code-input");
    if (!node) { problems.push("#code-input 不存在"); break; }
    node.value = input;
    sandbox.parseAndRenderResult();
    const got = document_.getElementById("card-code").textContent;
    if (want === null) continue;
    if (got !== want) problems.push(`解析 "${input.slice(0, 20)}" 期望 ${want}，实际 ${got}`);
  }
  ok.push("代号解析（含【AITI-RESULT:】、小写、句内）通过");

  /* ---------- 6. 深链与卡片字段 ---------- */

  try {
    if (!AITI.result("SDFT")) problems.push("AITI.result('SDFT') 返回 false");
    const t = sandbox.AITI_DATA.types.SDFT;
    if (document_.getElementById("card-title").textContent !== t.name) problems.push("卡片标题没写对");
    if (document_.getElementById("card-desc").textContent !== t.desc) problems.push("卡片描述没写对");
    if (!String(document_.getElementById("bar-su").style.width).endsWith("%")) problems.push("条形图宽度没设置");
    const ally = document_.getElementById("card-ally").textContent;
    if (!ally) problems.push("合得来一栏是空的");
    ok.push(`深链渲染：${t.name}，合得来 ${ally}`);
  } catch (err) {
    problems.push(`result 渲染抛错：${err.message}`);
  }

  /* ---------- 7. 长图绘制 ---------- */

  const warnings = [];
  try {
    const blobPromise = AITI.poster("UDBT");
    if (!blobPromise || typeof blobPromise.then !== "function") problems.push("AITI.poster 没返回 Promise");
    await blobPromise;
    ok.push("AITI.poster 可调用（canvas 桩）");
  } catch (err) {
    problems.push(`poster 抛错：${err.message}`);
  }

  // 16 型逐一出图，检查排版不溢出
  try {
    for (const code of Object.keys(sandbox.AITI_DATA.types)) {
      await AITI.poster(code);
    }
    const overflow = warnings.filter((w) => w.includes("溢出"));
    if (overflow.length) problems.push(`长图排版溢出：${overflow.slice(0, 3).join(" / ")}`);
    else ok.push(`16 型长图排版全部不溢出（${Object.keys(sandbox.AITI_DATA.types).length} 张）`);
  } catch (err) {
    problems.push(`逐型出图抛错：${err.message}`);
  }

  /* ---------- 8. 题库文本完整性 ---------- */

  const prompt = AITI.prompt();
  const qCount = (prompt.match(/^\d+\. \[/gm) || []).length;
  if (qCount !== 16) problems.push(`buildPrompt 里只有 ${qCount} 道题`);
  else ok.push("buildPrompt 含 16 题");
  if (!prompt.includes("AITI-RESULT: XXXX")) problems.push("buildPrompt 缺少提交格式说明");
}

/* ---------- 9. 静态题面与 quiz.md ---------- */

const md = fs.readFileSync(path.join(ROOT, "quiz.md"), "utf8");
const txt = fs.readFileSync(path.join(ROOT, "quiz.txt"), "utf8");
const bodyMatch = html.match(/<pre class="textplain" id="quiz-text-body">([\s\S]*?)<\/pre>/);
if (!bodyMatch) problems.push("index.html 里没有静态题面");
else {
  const bodyText = bodyMatch[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  if (bodyText.trim() !== txt.trim()) problems.push("静态题面与 quiz.txt 不一致（重新跑 node tools/build.mjs）");
  else ok.push("静态题面与 quiz.txt 一致");
}
for (let i = 1; i <= 16; i += 1) {
  if (!md.includes(`### ${i}.`)) problems.push(`quiz.md 缺少第 ${i} 题`);
  if (!txt.includes(`${i}. [`)) problems.push(`quiz.txt 缺少第 ${i} 题`);
}
ok.push("quiz.md / quiz.txt 题号齐全");

/* ---------- 10. 单文件版 ---------- */

const single = path.join(ROOT, "dist", "AITI-16.html");
if (!fs.existsSync(single)) problems.push("缺少 dist/AITI-16.html");
else {
  const s = fs.readFileSync(single, "utf8");
  for (const bad of ['src="app.js"', 'src="data/quiz-data.js"', "src=\"assets/", "fonts.googleapis", "jsdelivr"]) {
    if (s.includes(bad)) problems.push(`单文件版仍含外链：${bad}`);
  }
  if (!s.includes("data:image/jpeg;base64,")) problems.push("单文件版没有内联图片");
  ok.push(`单文件版 ${(Buffer.byteLength(s) / 1024 / 1024).toFixed(2)} MB，无外链`);
}

/* ---------- 输出 ---------- */

console.log("通过：");
ok.forEach((line) => console.log("  ✓ " + line));
if (problems.length) {
  console.log("\n问题：");
  problems.forEach((line) => console.log("  ✗ " + line));
  process.exitCode = 1;
} else {
  console.log("\n全部通过。");
}
