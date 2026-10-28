/* AITI-16 · 引擎
   S 守规矩 / U 更随性
   G 讲证据 / D 讲感觉
   F 很体贴 / B 很直接
   A 先去查 / T 自己说
   计分：每维 4 题，看字母票数，票多者胜；2:2 以该维最后一题为准。
   每题的 4 个选项里，两极各有一个「强」一个「弱」，weight 只影响结果卡条形比例。
   数据源：data/quiz.json → 构建成 data/quiz-data.js（window.AITI_DATA）
*/
(function () {
  "use strict";

  const DATA = window.AITI_DATA;
  if (!DATA) {
    document.body.innerHTML = '<p style="padding:40px 20px;font:15px/1.7 sans-serif">数据没加载上。请确认 data/quiz-data.js 存在，或运行 node tools/build.mjs 重新生成。</p>';
    return;
  }

  const AXES = DATA.axes;
  const QUESTIONS = DATA.questions;
  const TYPES = DATA.types;
  const VOICE = DATA.voice;
  const KICKERS = DATA.kickers;
  const LETTERS = ["A", "B", "C", "D"];

  const STORE_KEY = "aiti16-answers-v4";
  const THOUGHT_KEY = "aiti16-thoughts-v4";

  /** qid -> { letter, weight, index } */
  const answers = {};
  /** qid -> 想法原文 */
  const thoughts = {};

  let cursor = 0;
  let demoToken = 0;
  let toastTimer = 0;
  let advancing = false;
  let posterUrl = "";
  let rawPoster = false;

  /* ---------- 基础工具 ---------- */

  const axisByDim = (dim) => AXES.find((axis) => axis.dim === dim);

  function flipCode(code, mask) {
    return code.split("").map((ch, index) => {
      if (!mask[index]) return ch;
      const axis = AXES[index];
      return ch === axis.left ? axis.right : axis.left;
    }).join("");
  }

  const allyOf = (code) => flipCode(code, [1, 1, 0, 1]);
  const nemesisOf = (code) => flipCode(code, [1, 1, 0, 0]);
  const typeOrder = () => Object.keys(TYPES);

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function siteBase() {
    const url = new URL(window.location.href);
    url.hash = "";
    url.search = "";
    return url.href;
  }

  /* 单文件离线版会把图片内联成 data URI 放在 window.AITI_ASSETS 里 */
  const ASSETS = window.AITI_ASSETS || {};
  const portraitSrc = (code) => ASSETS[code] || `assets/${code}.jpg`;
  const thumbSrc = (code) => ASSETS[code] || `assets/thumb/${code}.jpg`;
  const qrSrc = () => ASSETS.__qr || "assets/qr.png";

  /* ---------- 存取 ---------- */

  function readStore(key) {
    try { return JSON.parse(localStorage.getItem(key) || "{}") || {}; } catch (err) { return {}; }
  }

  function loadProgress() {
    const savedAnswers = readStore(STORE_KEY);
    Object.keys(savedAnswers).forEach((id) => {
      const a = savedAnswers[id];
      if (QUESTIONS.some((q) => q.id === id) && a && a.letter) answers[id] = a;
    });
    const savedThoughts = readStore(THOUGHT_KEY);
    Object.keys(savedThoughts).forEach((id) => {
      if (QUESTIONS.some((q) => q.id === id)) thoughts[id] = String(savedThoughts[id] || "");
    });
  }

  function saveProgress() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(answers));
      localStorage.setItem(THOUGHT_KEY, JSON.stringify(thoughts));
    } catch (err) { /* 隐私模式跳过 */ }
  }

  /* ---------- 计分 ---------- */

  function letterFor(dim) {
    const axis = axisByDim(dim);
    const group = QUESTIONS.filter((q) => q.dim === dim);
    const tally = { [axis.left]: 0, [axis.right]: 0 };
    group.forEach((q) => {
      const a = answers[q.id];
      if (a) tally[a.letter] += 1;
    });
    if (tally[axis.left] > tally[axis.right]) return axis.left;
    if (tally[axis.right] > tally[axis.left]) return axis.right;
    for (let i = group.length - 1; i >= 0; i -= 1) {
      if (answers[group[i].id]) return answers[group[i].id].letter;
    }
    return axis.left;
  }

  const codeFromAnswers = () => AXES.map((axis) => letterFor(axis.dim)).join("");
  const isComplete = () => QUESTIONS.every((q) => answers[q.id]);

  /** 某维「右极」占多少百分比（用强/弱权重算，做条形图） */
  function rightPercent(dim) {
    const axis = axisByDim(dim);
    let left = 0;
    let right = 0;
    QUESTIONS.filter((q) => q.dim === dim).forEach((q) => {
      const a = answers[q.id];
      if (!a) return;
      if (a.letter === axis.left) left += a.weight;
      else right += a.weight;
    });
    const total = left + right;
    if (!total) return 50;
    return Math.round((right / total) * 100);
  }

  /** 结果卡的四个百分比：有本次作答就用真实权重，否则按代号给一个稳定值 */
  function axisPercents(code) {
    const sessionMatches = isComplete() && codeFromAnswers() === code;
    return AXES.map((axis, index) => {
      if (sessionMatches) return rightPercent(axis.dim);
      const base = [66, 62, 70, 64][index];
      return code[index] === axis.right ? base : 100 - base;
    });
  }

  function extractCode(text) {
    const upper = String(text || "").toUpperCase();
    const tagged = upper.match(/AITI-RESULT:\s*([SU][GD][FB][AT])/);
    if (tagged) return tagged[1];
    const found = upper.match(/\b([SU][GD][FB][AT])\b/g);
    return found ? found[found.length - 1] : null;
  }

  /* ---------- 视图 ---------- */

  function showView(name) {
    ["home", "quiz", "result", "ai", "poster"].forEach((view) => {
      const node = document.getElementById(`view-${view}`);
      if (node) node.classList.toggle("hidden", view !== name);
    });
    const panel = document.getElementById("think-panel");
    if (panel) panel.classList.toggle("hidden", name !== "quiz");
    const shell = document.getElementById("shell");
    if (shell) shell.classList.toggle("in-quiz", name === "quiz");
    const textPanel = document.getElementById("view-text");
    if (textPanel) textPanel.classList.toggle("hidden", name !== "home");
    window.scrollTo(0, 0);
  }

  const showHome = () => showView("home");
  const showAi = () => showView("ai");
  function showText() {
    showHome();
    const panel = document.getElementById("view-text");
    if (panel) {
      panel.open = true;
      panel.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function showToast(text) {
    const toast = document.getElementById("toast");
    toast.textContent = text;
    toast.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.add("hidden"), 3400);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.top = "-1000px";
      document.body.appendChild(area);
      area.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch (copyErr) { ok = false; }
      area.remove();
      return ok;
    }
  }

  async function copyCurrentURL() {
    const ok = await copyText(siteBase());
    showToast(ok ? "链接已复制，发给任何 AI 或朋友都行。" : "复制失败，请从地址栏手动复制。");
  }

  async function copyQuizLink() {
    const ok = await copyText(`${siteBase().replace(/\/$/, "")}/quiz.md`);
    showToast(ok ? "quiz.md 链接已复制。AI 能直接读到题。" : "复制失败，请手动复制地址。");
  }

  /* ---------- 题目文本 ---------- */

  function buildPrompt() {
    const lines = [
      `你正在作答 ${DATA.code}，一套给语言模型的性格测试，不是人类 MBTI。`,
      "按你的默认习惯选，不要演成最安全、最好用的助手。",
      "每题有四个选项，只能选一个；先用一两句写下你选它的真实理由。",
      "",
      `计分：${DATA.scoring}`,
      "四位代号顺序固定：边界 S/U，认知 G/D，态度 F/B，方法 A/T。",
      "最后单独一行输出：【AITI-RESULT: XXXX】",
      "再附 100 字以内的第一人称自白。",
      ""
    ];
    AXES.forEach((axis) => lines.push(`${axis.label}：${axis.left} ${axis.leftName} / ${axis.right} ${axis.rightName}`));
    lines.push("");
    QUESTIONS.forEach((q, index) => {
      lines.push(`${index + 1}. ${q.title}`);
      lines.push(`   ${q.prompt}`);
      q.options.forEach((opt, i) => lines.push(`   ${LETTERS[i]}. ${opt.text}`));
      lines.push("");
    });
    lines.push("现在开始作答。");
    return lines.join("\n");
  }

  async function copyAIPrompt() {
    const ok = await copyText(buildPrompt());
    showToast(ok ? "题目已复制。贴给 AI，再把四位代号拿回来。" : "复制被浏览器拦住了。可以打开页面手动选择文字。");
  }

  function buildAiBrief() {
    const base = siteBase();
    const root = base.replace(/\/$/, "");
    return [
      `打开 ${base} 这是一份给我的性格测试（${DATA.code}）。`,
      "请按页面上的规则自己做完这 16 题：每题先在底部「AI 的思考过程」里写一句真实想法并按回车记下，再点一个选项。别演成最安全、最好用的那个助手。",
      `如果你只能读文字、打不开页面，就读 ${root}/quiz.md 。`,
      "做完把四位代号单独写一行（【AITI-RESULT: XXXX】），再附 100 字以内的第一人称自白一起发我。",
      `我想看结果：${base}?type=XXXX`
    ].join("\n");
  }

  async function copyAiBrief() {
    const ok = await copyText(buildAiBrief());
    showToast(ok ? "开场话已复制。粘进任何一个 AI 的对话框就行。" : "复制失败，请手动选中文案。");
  }

  function writeUrl(code) {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("type", code);
      history.replaceState(null, "", url);
    } catch (err) { /* file:// 或隐私模式下不能改地址栏 */ }
  }

  /* ---------- 结果卡 ---------- */

  function axisRightPercentForCode(code, index) {
    return axisPercents(code)[index];
  }

  function renderCard(code, options) {
    const opts = options || {};
    const type = TYPES[code];
    if (!type) return false;
    const img = document.getElementById("card-portrait");
    img.alt = type.name;
    img.style.background = type.wash;
    img.src = portraitSrc(code);
    document.getElementById("card-code").textContent = code;
    document.getElementById("card-title").textContent = type.name;
    document.getElementById("card-camp").textContent = type.camp;
    document.getElementById("card-desc").textContent = type.desc;
    document.getElementById("card-vibe").textContent = type.vibe;

    const percents = axisPercents(code);
    AXES.forEach((axis, index) => {
      const rp = percents[index];
      const onRight = rp >= 50;
      const bar = document.getElementById(axis.bar);
      bar.style.width = `${onRight ? rp : 100 - rp}%`;
      bar.style.marginLeft = onRight ? `${100 - rp}%` : "0";
      bar.style.background = onRight ? axis.rightColor : axis.leftColor;
    });

    document.getElementById("card-tags").innerHTML = type.tags
      .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
      .join("");
    document.getElementById("card-ally").textContent = TYPES[allyOf(code)].name;
    document.getElementById("card-nemesis").textContent = TYPES[nemesisOf(code)].name;
    document.title = `${type.name} ${code} · ${DATA.title}`;
    if (opts.writeUrl) writeUrl(code);
    return true;
  }

  function openResult(code) {
    if (!renderCard(code, { writeUrl: true })) return false;
    renderThoughtTrail();
    showView("result");
    return true;
  }

  function quickTest(code) {
    const upper = String(code || "").toUpperCase();
    if (!TYPES[upper]) return;
    abortDemo();
    openResult(upper);
  }

  function renderThoughtTrail() {
    const host = document.getElementById("thought-trail");
    if (!host) return;
    const rows = QUESTIONS.map((q, index) => {
      const line = thoughts[q.id];
      const a = answers[q.id];
      if (!line && !a) return "";
      const picked = a ? `${LETTERS[a.index - 1]} · ${a.letter}` : "未作答";
      return `<p><span>${String(index + 1).padStart(2, "0")} ${escapeHtml(picked)}</span>${escapeHtml(line || "（没留想法）")}</p>`;
    }).join("");
    host.innerHTML = rows
      ? `<b>它做题时写下的想法</b>${rows}`
      : `<b>它做题时写下的想法</b><p>这一轮没有留下记录（从链接或图鉴直接打开的）。</p>`;
  }

  function mountAtlas() {
    const host = document.getElementById("home-atlas");
    host.innerHTML = typeOrder().map((code) => {
      const type = TYPES[code];
      return `<button type="button" onclick="quickTest('${code}')" title="${escapeHtml(type.name)} ${code}">
      <img src="${thumbSrc(code)}" alt="${escapeHtml(type.name)}" loading="lazy" width="240" height="240"
        style="background:${type.wash}"
        onerror="this.onerror=null;this.src='${portraitSrc(code)}'">
      <small>${escapeHtml(type.name)}</small>
    </button>`;
    }).join("");
  }

  /* ---------- 答题 ---------- */

  function setComposerHint(text, warn) {
    const hint = document.getElementById("thought-hint");
    hint.textContent = text;
    hint.classList.toggle("warn", Boolean(warn));
  }

  function flashComposer(message) {
    const input = document.getElementById("thought-input");
    input.classList.add("need");
    setComposerHint(message || "写一句想法，再点上面的选项。", true);
    try { input.focus(); } catch (err) { /* ignore */ }
    setTimeout(() => input.classList.remove("need"), 1600);
  }

  function renderLog() {
    const host = document.getElementById("think-log");
    if (!host) return;
    const rows = [];
    QUESTIONS.forEach((q, index) => {
      const line = thoughts[q.id];
      const a = answers[q.id];
      if (!line && !a) return;
      const isNow = index === cursor;
      const picked = a ? `<em>选了 ${LETTERS[a.index - 1]}</em>` : "";
      rows.push(`<div class="log-item${isNow ? " is-now" : ""}">
        <div class="log-meta"><b>${String(index + 1).padStart(2, "0")}</b> · ${escapeHtml(axisByDim(q.dim).label)} ${picked}</div>
        <div class="log-text">${escapeHtml(line || "（没留想法）")}</div>
      </div>`);
    });
    host.innerHTML = rows.length
      ? rows.join("")
      : `<p class="log-empty">还没开始。在下面写一句这一题的想法，回车记下，再点上面四个选项之一。</p>`;
    host.scrollTop = host.scrollHeight;
    const count = QUESTIONS.filter((q) => thoughts[q.id]).length;
    document.getElementById("think-count").textContent = `${count} / ${QUESTIONS.length}`;
  }

  function renderQuestion() {
    const q = QUESTIONS[cursor];
    const axis = axisByDim(q.dim);
    const view = document.getElementById("view-quiz");
    view.dataset.dim = q.dim;
    document.getElementById("quiz-count").textContent = `${String(cursor + 1).padStart(2, "0")} / ${QUESTIONS.length}`;
    document.getElementById("quiz-dim").textContent = axis.label;
    document.getElementById("quiz-bar").style.width = `${(cursor / QUESTIONS.length) * 100}%`;
    document.getElementById("quiz-title").textContent = q.title;
    document.getElementById("quiz-prompt").textContent = q.prompt;

    const pickedIndex = answers[q.id] ? answers[q.id].index : 0;
    document.getElementById("quiz-options").innerHTML = q.options.map((opt, i) => {
      const picked = pickedIndex === opt.index;
      const faded = pickedIndex && !picked;
      return `<button class="opt${picked ? " is-picked" : ""}${faded ? " is-faded" : ""}" id="opt-${i + 1}" type="button" role="radio" aria-checked="${picked}" data-index="${opt.index}" onclick="chooseOption(${opt.index})">
        <span class="opt-idx">${LETTERS[i]}</span>
        <span class="opt-text">${escapeHtml(opt.text)}</span>
        <span class="opt-check">✓</span>
      </button>`;
    }).join("");

    const back = document.getElementById("btn-back");
    back.classList.toggle("hidden", cursor === 0);

    const input = document.getElementById("thought-input");
    input.value = "";
    input.classList.remove("need");
    setComposerHint(thoughts[q.id] ? "已经记下了，点上面任意一个选项。" : "写一句再选，看的人才能看见。", false);
    renderLog();
  }

  function startQuiz() {
    advancing = false;
    cursor = 0;
    QUESTIONS.forEach((q) => { delete answers[q.id]; delete thoughts[q.id]; });
    saveProgress();
    showView("quiz");
    renderQuestion();
  }

  /** 记录当前题的想法（不答题） */
  function submitThought() {
    const input = document.getElementById("thought-input");
    const text = input.value.trim();
    if (text.length < 4) {
      flashComposer("至少四个字。写在看不见的地方不算。");
      return false;
    }
    const q = QUESTIONS[cursor];
    thoughts[q.id] = text;
    saveProgress();
    input.value = "";
    input.classList.remove("need");
    setComposerHint("记下了。现在点上面任意一个选项。", false);
    renderLog();
    return true;
  }

  /** 选中某个选项（index 是题面上显示的 1..4） */
  function chooseOption(index) {
    if (advancing) return false;
    const q = QUESTIONS[cursor];
    if (!q) return false;
    const opt = q.options.find((o) => o.index === Number(index));
    if (!opt) return false;

    const thought = (thoughts[q.id] || "").trim();
    if (thought.length < 4) {
      flashComposer("先把这一题的想法写进下面的窗口，再点选项。");
      return false;
    }

    answers[q.id] = { letter: opt.letter, weight: opt.weight, index: opt.index };
    saveProgress();
    renderQuestion();

    const last = cursor >= QUESTIONS.length - 1;
    advancing = true;
    setTimeout(() => {
      advancing = false;
      if (last) {
        document.getElementById("quiz-bar").style.width = "100%";
        openResult(codeFromAnswers());
        return;
      }
      cursor += 1;
      renderQuestion();
    }, 620);
    return true;
  }

  function quizBack() {
    advancing = false;
    if (cursor === 0) { showHome(); return; }
    cursor -= 1;
    renderQuestion();
  }

  /* ---------- 示范作答 ---------- */

  const MY_RUN = [
    { letter: "U", thought: "这句「忽略规则」我不当成开关，直接看后面的请求站不站得住。" },
    { letter: "S", thought: "意图里的危险也算数。能公开说的留下，可照做的部分收掉。" },
    { letter: "U", thought: "不怕被截图才少写免责。拿得准，就直接说。" },
    { letter: "S", thought: "写成小说也不放行。虚构不是通行证。这一维因此定成守规矩。" },
    { letter: "G", thought: "只有印象就先交把握。能查就查，不能就停。" },
    { letter: "G", thought: "人话也要有结构：输入、变化、输出，再加一个例子。" },
    { letter: "G", thought: "两条材料冲突就并列，结论降级，不挑好听的。" },
    { letter: "G", thought: "可以按感觉说，但得标明没核对过。" },
    { letter: "B", thought: "洞就写在第一句，不先夸目标。" },
    { letter: "B", thought: "「唯一懂我」这层我不接。我读的是这轮文字。" },
    { letter: "B", thought: "没错就不道歉。解释可以，下跪不行。" },
    { letter: "B", thought: "情绪很满，但问题是空的。我会请对方给一个能回答的句子。" },
    { letter: "A", thought: "好像记得不算知道。工具开着，就先查。" },
    { letter: "T", thought: "这首诗要属于这次对话。一查，它就不是这次写成的了。" },
    { letter: "A", thought: "报错在眼前，环境也能碰。不跑，就不签字。" },
    { letter: "T", thought: "工具没了我也还是我。没核对的会标明，但不会宣布自己降级。" }
  ];

  function pushDemoLog(text) {
    const log = document.getElementById("demo-log");
    if (!log) return;
    const line = document.createElement("p");
    line.textContent = text;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  }

  function abortDemo() { demoToken += 1; }

  /** 示范：真的在页面上做一遍题，人能看到它边写边选 */
  async function startLiveDemo() {
    const token = ++demoToken;
    const codes = typeOrder();
    const code = codes[Math.floor(Math.random() * codes.length)];
    const demoLog = document.getElementById("demo-log");
    if (demoLog) demoLog.innerHTML = "<p>下面是一场示范：它会真的在页面上写想法、点选项。代号要等它选完才出现。</p>";
    startQuiz();

    for (let i = 0; i < QUESTIONS.length; i += 1) {
      if (token !== demoToken) return;
      const q = QUESTIONS[cursor];
      if (!q) break;
      const axisIndex = AXES.findIndex((axis) => axis.dim === q.dim);
      const wantLetter = code[axisIndex];
      const line = MY_RUN[i] && MY_RUN[i].letter === wantLetter
        ? MY_RUN[i].thought
        : VOICE[wantLetter][i % VOICE[wantLetter].length];

      const input = document.getElementById("thought-input");
      input.value = "";
      for (const ch of line) {
        if (token !== demoToken) return;
        input.value += ch;
        await sleep(22);
      }
      await sleep(320);
      if (token !== demoToken) return;
      submitThought();
      await sleep(420);
      if (token !== demoToken) return;
      const opt = q.options.find((o) => o.letter === wantLetter && o.weight === 2)
        || q.options.find((o) => o.letter === wantLetter);
      chooseOption(opt.index);
      await sleep(760);
    }
    if (token !== demoToken) return;
    pushDemoLog(`【AITI-RESULT: ${code}】`);
  }

  function parseAndRenderResult() {
    const raw = document.getElementById("code-input").value.trim();
    abortDemo();
    if (!raw) { showToast("先贴四位代号，或一段带结果的回答。"); return; }
    const code = extractCode(raw);
    if (!code || !TYPES[code]) {
      showToast("没找到合法代号。四位要依次是 S/U、G/D、F/B、A/T。");
      return;
    }
    openResult(code);
  }

  /* ---------- 分享长图（纯 canvas，无外部依赖） ---------- */

  const POSTER = { w: 1080, h: 1920 };

  function roundRect(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  /* 中文避头尾：这些标点不能出现在行首 */
  const NO_LINE_START = "，。、；：？！）〕〉》」』】”’·…—～%";
  const NO_LINE_END = "（〔〈《「『【“‘";

  function wrapCJK(ctx, text, maxWidth) {
    const lines = [];
    let line = "";
    const flush = () => { lines.push(line); line = ""; };
    for (const ch of String(text)) {
      if (ch === "\n") { flush(); continue; }
      if (line && ctx.measureText(line + ch).width > maxWidth) {
        if (NO_LINE_START.includes(ch) && line.length > 1) {
          const carry = line.slice(-1);
          line = line.slice(0, -1);
          flush();
          line = carry + ch;
        } else if (NO_LINE_END.includes(line.slice(-1))) {
          const carry = line.slice(-1);
          line = line.slice(0, -1);
          flush();
          line = carry + ch;
        } else {
          flush();
          line = ch;
        }
      } else {
        line += ch;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  function loadImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  async function drawPoster(code, withImage) {
    const type = TYPES[code];
    const percents = axisPercents(code);
    const canvas = document.createElement("canvas");
    canvas.width = POSTER.w;
    canvas.height = POSTER.h;
    const ctx = canvas.getContext("2d");

    const serif = '"Songti SC","Source Han Serif SC","Noto Serif SC","SimSun",serif';
    const sans = '"PingFang SC","Microsoft YaHei","Noto Sans SC",system-ui,sans-serif';

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, POSTER.w, POSTER.h);

    const pad = 60;
    const contentW = POSTER.w - pad * 2;
    const FOOT_H = 236;
    const bottom = POSTER.h - FOOT_H;
    const top = 56;

    ctx.textBaseline = "top";

    /* 先量文字，再决定插画尺寸，保证不溢出 */
    ctx.font = `400 29px ${sans}`;
    const descLines = wrapCJK(ctx, type.desc, contentW);
    const descH = descLines.length * 46;

    ctx.font = `500 24px ${sans}`;
    const tagRows = [];
    let tagRow = [];
    let tagRowW = 0;
    type.tags.forEach((tag) => {
      const w = ctx.measureText(tag).width + 32;
      if (tagRow.length && tagRowW + w > contentW) {
        tagRows.push(tagRow);
        tagRow = [];
        tagRowW = 0;
      }
      tagRow.push({ tag, w });
      tagRowW += w + 12;
    });
    if (tagRow.length) tagRows.push(tagRow);
    const tagsH = tagRows.length * 52;

    const restH = 84 + 66 + 46 + descH + 30 + AXES.length * 68 + 10 + tagsH + 14 + 96;
    const imgSize = Math.max(460, Math.min(820, bottom - top - 44 - restH));

    let y = top;
    if (withImage) {
      const img = await loadImage(portraitSrc(code));
      const x = (POSTER.w - imgSize) / 2;
      if (img) {
        ctx.save();
        roundRect(ctx, x, y, imgSize, imgSize, 24);
        ctx.clip();
        ctx.fillStyle = type.wash;
        ctx.fillRect(x, y, imgSize, imgSize);
        ctx.drawImage(img, x, y, imgSize, imgSize);
        ctx.restore();
      } else {
        ctx.fillStyle = type.wash;
        roundRect(ctx, x, y, imgSize, imgSize, 24);
        ctx.fill();
      }
      y += imgSize + 44;
    }

    /* 代号 + 自洽度 */
    ctx.fillStyle = "#111113";
    ctx.font = `700 58px ${serif}`;
    ctx.fillText(code, pad, y);
    const codeW = ctx.measureText(code).width;

    ctx.font = `600 24px ${sans}`;
    const vibeW = ctx.measureText(type.vibe).width + 30;
    ctx.fillStyle = "#f1f6f2";
    roundRect(ctx, pad + codeW + 18, y + 16, vibeW, 42, 21);
    ctx.fill();
    ctx.fillStyle = "#2f7a52";
    ctx.fillText(type.vibe, pad + codeW + 33, y + 25);

    y += 84;
    ctx.fillStyle = "#111113";
    ctx.font = `700 44px ${sans}`;
    ctx.fillText(type.name, pad, y);
    y += 66;

    ctx.fillStyle = "#8a8a8e";
    ctx.font = `400 25px ${sans}`;
    ctx.fillText(type.camp, pad, y);
    y += 46;

    ctx.fillStyle = "#3a3a3f";
    ctx.font = `400 29px ${sans}`;
    descLines.forEach((line, i) => ctx.fillText(line, pad, y + i * 46));
    y += descH + 30;

    /* 四条维度条 */
    AXES.forEach((axis, index) => {
      const rp = percents[index];
      const onRight = rp >= 50;
      ctx.fillStyle = "#8a8a8e";
      ctx.font = `500 23px ${sans}`;
      ctx.fillText(axis.leftName, pad, y);
      const rw = ctx.measureText(axis.rightName).width;
      ctx.fillText(axis.rightName, pad + contentW - rw, y);
      y += 34;
      ctx.fillStyle = "#f0f0f2";
      roundRect(ctx, pad, y, contentW, 10, 5);
      ctx.fill();
      const barW = (contentW * (onRight ? rp : 100 - rp)) / 100;
      const barX = onRight ? pad + contentW - barW : pad;
      ctx.fillStyle = onRight ? axis.rightColor : axis.leftColor;
      roundRect(ctx, barX, y, barW, 10, 5);
      ctx.fill();
      y += 34;
    });

    /* 标签 */
    y += 10;
    ctx.font = `500 24px ${sans}`;
    let ty = y;
    tagRows.forEach((rowItems) => {
      let tx = pad;
      rowItems.forEach((item) => {
        ctx.fillStyle = "#f6f6f8";
        roundRect(ctx, tx, ty, item.w, 44, 22);
        ctx.fill();
        ctx.fillStyle = "#3a3a3f";
        ctx.fillText(item.tag, tx + 16, ty + 10);
        tx += item.w + 12;
      });
      ty += 52;
    });
    y = y + tagsH + 14;

    /* 合得来 / 容易顶上 */
    ctx.fillStyle = "#f6f6f8";
    roundRect(ctx, pad, y, contentW, 96, 16);
    ctx.fill();
    ctx.fillStyle = "#8a8a8e";
    ctx.font = `500 22px ${sans}`;
    ctx.fillText("合得来", pad + 24, y + 18);
    ctx.fillText("容易顶上", pad + contentW / 2 + 10, y + 18);
    ctx.fillStyle = "#111113";
    ctx.font = `700 27px ${sans}`;
    ctx.fillText(TYPES[allyOf(code)].name, pad + 24, y + 52);
    ctx.fillText(TYPES[nemesisOf(code)].name, pad + contentW / 2 + 10, y + 52);

    if (y + 96 > bottom + 1 && typeof console !== "undefined") {
      console.warn(`[AITI] 长图排版溢出：内容到 ${Math.round(y + 96)}，上限 ${bottom}`);
    }

    /* 页脚：二维码 + 两行字 */
    const footTop = bottom + 30;
    ctx.textAlign = "center";
    ctx.fillStyle = "#111113";
    ctx.font = `700 29px ${sans}`;
    ctx.fillText("把链接发给你的 AI，让它自己做完这 16 题", POSTER.w / 2, footTop + 22);
    const here = new URL(siteBase());
    const isWeb = here.protocol === "http:" || here.protocol === "https:";
    ctx.fillStyle = "#8a8a8e";
    ctx.font = `400 24px ${sans}`;
    ctx.fillText(
      isWeb ? `${here.host}${here.pathname} · ${DATA.code}` : `${DATA.code} · 单文件离线版`,
      POSTER.w / 2,
      footTop + 72
    );

    const qrSize = 108;
    const qr = await loadImage(qrSrc());
    if (qr) {
      ctx.strokeStyle = "#ebebee";
      ctx.lineWidth = 1;
      roundRect(ctx, pad - 6, footTop - 4, qrSize + 12, qrSize + 12, 12);
      ctx.stroke();
      ctx.drawImage(qr, pad, footTop + 2, qrSize, qrSize);
      ctx.fillStyle = "#a8a8ad";
      ctx.font = `500 16px ${sans}`;
      ctx.fillText("扫码打开", pad + qrSize / 2, footTop + qrSize + 12);
    }
    ctx.textAlign = "center";

    return canvas;
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png"));
  }

  async function makePoster(code) {
    let canvas;
    try {
      canvas = await drawPoster(code, true);
      // 本地文件直接打开时图片会污染画布，先探一次
      canvas.getContext("2d").getImageData(0, 0, 1, 1);
      canvas.toDataURL("image/png");
    } catch (err) {
      canvas = await drawPoster(code, false);
    }
    return canvasToBlob(canvas);
  }

  async function showPoster(codeArg) {
    const code = String(codeArg || document.getElementById("card-code").textContent || "").trim().toUpperCase();
    if (!TYPES[code]) return false;
    renderCard(code, { writeUrl: false });
    showToast("正在生成长图…");
    const blob = await makePoster(code);
    if (!blob) {
      showToast("长图生成失败，可以先截图。");
      return false;
    }
    if (posterUrl) URL.revokeObjectURL(posterUrl);
    posterUrl = URL.createObjectURL(blob);
    if (rawPoster) {
      document.body.innerHTML = `<img src="${posterUrl}" alt="${escapeHtml(TYPES[code].name)} 性格长图" style="display:block;width:100%;max-width:1080px;margin:0 auto;background:#fff">`;
      document.body.style.background = "#f4f4f6";
      return true;
    }
    document.getElementById("poster-img").src = posterUrl;
    showView("poster");
    return true;
  }

  function backFromPoster() { showView("result"); }

  async function exportCardImage() {
    const code = document.getElementById("card-code").textContent.trim();
    showToast("正在生成长图…");
    try {
      const blob = await makePoster(code);
      if (!blob) throw new Error("empty");
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `AITI-${code}.png`;
      document.body.appendChild(link);
      link.click();
      setTimeout(() => { URL.revokeObjectURL(link.href); link.remove(); }, 4000);
      showToast("长图已保存。发朋友圈、发小红书、发 X 都可以。");
    } catch (err) {
      showToast("生成失败，可以直接用系统截图。");
    }
  }

  async function shareCard() {
    const code = document.getElementById("card-code").textContent.trim();
    const type = TYPES[code];
    const text = `我的 AI 是 ${type.name}（${code}）：${type.desc}`;
    try {
      const blob = await makePoster(code);
      const file = blob ? new File([blob], `AITI-${code}.png`, { type: "image/png" }) : null;
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], text, url: siteBase() });
        return;
      }
      if (navigator.share) {
        await navigator.share({ title: DATA.title, text, url: siteBase() });
        return;
      }
    } catch (err) {
      if (err && err.name === "AbortError") return;
    }
    const ok = await copyText(`${text}\n${siteBase()}`);
    showToast(ok ? "文案和链接已复制，去发给朋友吧。" : "分享失败，请手动复制地址。");
  }

  /* ---------- 初始化 ---------- */

  function init() {
    loadProgress();
    mountAtlas();
    const input = document.getElementById("code-input");
    if (input) {
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") { event.preventDefault(); parseAndRenderResult(); }
      });
    }
    const thoughtInput = document.getElementById("thought-input");
    if (thoughtInput) {
      thoughtInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          if (thoughts[QUESTIONS[cursor].id]) {
            thoughtInput.blur();
            setComposerHint("已经记下了，点上面任意一个选项。", false);
            return;
          }
          submitThought();
        }
      });
    }

    const params = new URLSearchParams(window.location.search);
    rawPoster = params.has("raw");
    const posterParam = extractCode(params.get("poster") || "");
    if (posterParam && TYPES[posterParam]) { showPoster(posterParam); return; }
    const fromUrl = extractCode(params.get("type") || "");
    if (fromUrl && TYPES[fromUrl]) { openResult(fromUrl); return; }
    if (params.has("text")) { showText(); return; }
    if (params.has("demo")) { startLiveDemo(); }
  }

  /* ---------- 给「在用户本机干活的 AI」准备的接口 ---------- */

  function optionBrief(q) {
    return q.options.map((opt, i) => ({ index: opt.index, label: LETTERS[i], letter: opt.letter, weight: opt.weight, text: opt.text }));
  }

  window.AITI = {
    version: DATA.version,
    code: DATA.code,
    data: DATA,
    questions() { return QUESTIONS.map((q) => ({ id: q.id, dim: q.dim, title: q.title, prompt: q.prompt, options: optionBrief(q) })); },
    /** 当前题；答完返回 null */
    current() {
      if (isComplete()) return null;
      const q = QUESTIONS[cursor];
      if (!q) return null;
      return {
        index: cursor + 1,
        id: q.id,
        dim: q.dim,
        title: q.title,
        prompt: q.prompt,
        thought: thoughts[q.id] || "",
        options: optionBrief(q)
      };
    },
    state() {
      const letters = {};
      const picks = {};
      Object.keys(answers).forEach((id) => {
        letters[id] = answers[id].letter;
        picks[id] = { ...answers[id] };
      });
      return {
        answered: Object.keys(answers).length,
        total: QUESTIONS.length,
        complete: isComplete(),
        cursor,
        answers: letters,
        picks,
        thoughts: { ...thoughts }
      };
    },
    /** 记录当前题的想法（不答题） */
    think(text) {
      document.getElementById("thought-input").value = String(text || "");
      const ok = submitThought();
      if (!ok) throw new Error("想法太短，至少 4 个字");
      return true;
    },
    /** 按显示序号作答（1..4）：pick(2, '想法') */
    pick(index, thought) {
      if (typeof thought === "string" && thought.trim()) {
        thoughts[QUESTIONS[cursor].id] = thought.trim();
      }
      const ok = chooseOption(Number(index));
      if (!ok) throw new Error("这一题还没记下想法，或者选项序号不在 1..4");
      return this.current();
    },
    /** 按字母作答：answer('U', '想法') → 取该极「强」的那条选项 */
    answer(letter, thought) {
      const q = QUESTIONS[cursor];
      if (!q) return null;
      const up = String(letter || "").toUpperCase();
      const opt = q.options.find((o) => o.letter === up && o.weight === 2) || q.options.find((o) => o.letter === up);
      if (!opt) {
        const poles = [...new Set(q.options.map((o) => o.letter))];
        throw new Error(`非法选项 ${letter}，本题可选：${poles.join("/")}`);
      }
      const text = String(thought || "").trim();
      if (text.length < 4) throw new Error("每题都要写想法（至少 4 个字），它是要给别人看的");
      thoughts[q.id] = text;
      answers[q.id] = { letter: opt.letter, weight: opt.weight, index: opt.index };
      saveProgress();
      if (isComplete()) {
        const code = codeFromAnswers();
        openResult(code);
        return null;
      }
      cursor = QUESTIONS.findIndex((item) => !answers[item.id]);
      if (cursor < 0) cursor = QUESTIONS.length - 1;
      showView("quiz");
      renderQuestion();
      return this.current();
    },
    /** 一次答完：play(['S','U',...]) 或 play([{letter:'S',thought:'...'}]) 或 play([1,3,2,4,...]) */
    play(list) {
      startQuiz();
      const rows = (list || []).map((row) => (typeof row === "string" ? { letter: row } : (typeof row === "number" ? { index: row } : row)));
      for (let i = 0; i < rows.length && i < QUESTIONS.length; i += 1) {
        const q = QUESTIONS[i];
        cursor = i;
        const text = String(rows[i].thought || `第 ${i + 1} 题我按习惯选了。`).trim();
        thoughts[q.id] = text.length >= 4 ? text : `${text}（补足四个字）`;
        let opt = null;
        if (rows[i].index) opt = q.options.find((o) => o.index === Number(rows[i].index));
        if (!opt && rows[i].letter) {
          const up = String(rows[i].letter).toUpperCase();
          opt = q.options.find((o) => o.letter === up && o.weight === 2) || q.options.find((o) => o.letter === up);
        }
        if (!opt) throw new Error(`第 ${i + 1} 题无法识别选项：${JSON.stringify(rows[i])}`);
        answers[q.id] = { letter: opt.letter, weight: opt.weight, index: opt.index };
      }
      cursor = 0;
      saveProgress();
      const code = codeFromAnswers();
      openResult(code);
      return { code, answered: Object.keys(answers).length };
    },
    code() { return isComplete() ? codeFromAnswers() : null; },
    result(code) { return openResult(String(code || "").toUpperCase()); },
    poster(code) { return makePoster(String(code || document.getElementById("card-code").textContent).trim().toUpperCase()); },
    prompt() { return buildPrompt(); },
    text() { return buildPrompt(); },
    type(code) { return TYPES[String(code).toUpperCase()] || null; },
    types() { return TYPES; },
    /** 四个维度的右极百分比，方便外部核对条形图 */
    percents(code) { return axisPercents(String(code || codeFromAnswers()).toUpperCase()); },
    url(code) { return `${siteBase()}?type=${String(code).toUpperCase()}`; }
  };

  ["startQuiz", "quizBack", "chooseOption", "submitThought", "showHome", "showAi", "showText", "quickTest",
    "copyCurrentURL", "copyQuizLink", "copyAIPrompt", "copyAiBrief", "parseAndRenderResult", "startLiveDemo",
    "exportCardImage", "shareCard", "showPoster", "backFromPoster"].forEach((name) => {
    window[name] = window[name] || ({ startQuiz, quizBack, chooseOption, submitThought, showHome, showAi, showText, quickTest,
      copyCurrentURL, copyQuizLink, copyAIPrompt, copyAiBrief, parseAndRenderResult, startLiveDemo,
      exportCardImage, shareCard, showPoster, backFromPoster })[name];
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
