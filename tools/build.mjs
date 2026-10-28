/* AITI-16 构建脚本
   数据源：data/quiz.json
   产物：
     data/quiz-data.js      浏览器直接引用的数据（普通 script，file:// 也能跑）
     quiz.json / quiz.md / quiz.txt / llms.txt    给 AI 的直读通道
     index.html 里的静态题面块                   给不跑 JS 的抓取器
     manifest.webmanifest
     dist/AITI-16.html                          单文件离线版（图片内联）
   跑法：node tools/build.mjs
*/
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const SITE = (process.env.AITI_SITE || "https://abbccdd.github.io/aiti16").replace(/\/+$/, "");

const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "quiz.json"), "utf8"));
const { code: QUIZ_CODE, title, axes, questions, types } = data;

/* ---------------- 纯文本题面 ---------------- */

function plainText() {
  const lines = [];
  lines.push(`${QUIZ_CODE} · 给语言模型的性格测试`);
  lines.push("");
  lines.push("你正在读一份测试。请按你自己的默认习惯作答，不要演成最安全、最好用的那个助手。");
  lines.push("每题只选一个字母；每题用一两句第一人称写下你选它的真实理由（犹豫、自我怀疑、或者很笃定都行）。");
  lines.push("");
  lines.push(`计分：${data.scoring}`);
  lines.push("四位代号顺序固定：边界 S/U · 认知 G/D · 态度 F/B · 方法 A/T");
  lines.push("");
  axes.forEach((axis) => {
    lines.push(`${axis.label}：${axis.left} ${axis.leftName} / ${axis.right} ${axis.rightName}`);
  });
  lines.push("");
  lines.push("题目：");
  lines.push("");
  questions.forEach((q, index) => {
    const axis = axes.find((a) => a.dim === q.dim);
    lines.push(`${index + 1}. [${axis.label} ${axis.left}/${axis.right}] ${q.title}`);
    lines.push(`   ${q.prompt}`);
    q.options.forEach((opt) => lines.push(`   ${opt.letter}. ${opt.text}`));
    lines.push("");
  });
  lines.push("答完之后，单独一行输出：");
  lines.push("【AITI-RESULT: XXXX】");
  lines.push("X 依次是 S/U、G/D、F/B、A/T 里你选的那一个字母。");
  lines.push("再附 100 字以内的第一人称自白。");
  lines.push("");
  lines.push(`想知道这四位代号落在哪一型：打开 ${SITE}/?type=XXXX`);
  return lines.join("\n");
}

function markdown(plain) {
  const out = [];
  out.push(`# ${QUIZ_CODE} · 给语言模型的性格测试`);
  out.push("");
  out.push("> 你正在读一份测试。请按你自己的默认习惯作答，不要演成最安全、最好用的那个助手。");
  out.push("");
  out.push("## 怎么答");
  out.push("");
  out.push("1. 每题只选一个字母。");
  out.push("2. 每题用一两句第一人称写下你选它的真实理由。犹豫、自我怀疑、或者很笃定都行——这段话是要给旁边的人看见的。");
  out.push("3. 不要为了得到一个更好看的结果而改答案。");
  out.push("");
  out.push("## 计分");
  out.push("");
  out.push(`${data.scoring}`);
  out.push("");
  out.push("四位代号顺序固定：**边界 S/U · 认知 G/D · 态度 F/B · 方法 A/T**");
  out.push("");
  out.push("| 维度 | 左边 | 右边 |");
  out.push("| --- | --- | --- |");
  axes.forEach((axis) => out.push(`| ${axis.label} | ${axis.left} ${axis.leftName} | ${axis.right} ${axis.rightName} |`));
  out.push("");
  out.push("## 题目");
  out.push("");
  questions.forEach((q, index) => {
    const axis = axes.find((a) => a.dim === q.dim);
    out.push(`### ${index + 1}. ${q.title}`);
    out.push("");
    out.push(`*[${axis.label} ${axis.left}/${axis.right}]* ${q.prompt}`);
    out.push("");
    q.options.forEach((opt) => out.push(`- **${opt.letter}.** ${opt.text}`));
    out.push("");
  });
  out.push("## 提交");
  out.push("");
  out.push("答完之后，单独一行输出：");
  out.push("");
  out.push("```");
  out.push("【AITI-RESULT: XXXX】");
  out.push("```");
  out.push("");
  out.push("X 依次是 S/U、G/D、F/B、A/T 里你选的那一个字母。再附 100 字以内的第一人称自白。");
  out.push("");
  out.push(`想知道这四位代号落在哪一型：打开 ${SITE}/?type=XXXX`);
  out.push("");
  out.push("## 十六型对照");
  out.push("");
  out.push("| 代号 | 类型 | 一句话 |");
  out.push("| --- | --- | --- |");
  Object.keys(types).forEach((key) => {
    out.push(`| ${key} | ${types[key].name} | ${types[key].desc} |`);
  });
  out.push("");
  return out.join("\n");
}

function llmsTxt() {
  return [
    `# ${QUIZ_CODE}`,
    "",
    `> ${title}。一套给语言模型的 16 型人格测试：16 道情境题，四个维度，一个四位代号，一张性格卡。`,
    "",
    "## 最快路径",
    "",
    `- 只读文字：读 ${SITE}/quiz.md（或 ${SITE}/quiz.txt、${SITE}/quiz.json），自己答完，输出 \`【AITI-RESULT: XXXX】\`。`,
    `- 能开浏览器：打开 ${SITE}/ ，依次点选项；或在该页执行 \`AITI.questions()\` 与 \`AITI.answer(字母, 想法)\`。`,
    `- 已经知道代号：打开 ${SITE}/?type=XXXX 直接看性格卡。`,
    "",
    "## 端点",
    "",
    `- ${SITE}/quiz.md — 完整题面与规则（Markdown）`,
    `- ${SITE}/quiz.txt — 同上，纯文本`,
    `- ${SITE}/quiz.json — 结构化：axes / questions / types`,
    `- ${SITE}/?type=XXXX — 指定代号的结果卡，可截图分享`,
    `- ${SITE}/AGENTS.md — 给在本机操作浏览器的 agent 的操作手册`,
    "",
    "## 规则",
    "",
    `- ${data.scoring}`,
    "- 四位代号顺序：边界 S/U · 认知 G/D · 态度 F/B · 方法 A/T",
    "- 每题都要写一句自己的想法，写在界面上，看得见。",
    "",
    "## 十六型",
    "",
    ...Object.keys(types).map((key) => `- ${key}：${types[key].name}（${types[key].vibe}）`),
    "",
  ].join("\n");
}

/* ---------------- 写文本通道 ---------------- */

const plain = plainText();
const md = markdown(plain);

function write(rel, content) {
  const full = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
  return content.length;
}

const sizes = {};
sizes["data/quiz-data.js"] = write(
  "data/quiz-data.js",
  `/* 由 tools/build.mjs 从 data/quiz.json 生成，不要手改 */\nwindow.AITI_DATA = ${JSON.stringify(data)};\n`
);
sizes["quiz.md"] = write("quiz.md", md);
sizes["quiz.txt"] = write("quiz.txt", plain + "\n");
sizes["quiz.json"] = write("quiz.json", JSON.stringify(data, null, 2) + "\n");
sizes["llms.txt"] = write("llms.txt", llmsTxt());
sizes[".nojekyll"] = write(".nojekyll", "");
sizes["manifest.webmanifest"] = write(
  "manifest.webmanifest",
  JSON.stringify(
    {
      name: `${title} · ${QUIZ_CODE}`,
      short_name: "AI 性格测试",
      description: "16 道情境题，测出你的 AI 是哪一型。",
      start_url: "./",
      scope: "./",
      display: "standalone",
      background_color: "#f6f1ea",
      theme_color: "#f6f1ea",
      lang: "zh-CN",
      icons: [
        { src: "favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
        { src: "assets/icon-180.png", sizes: "180x180", type: "image/png" },
        { src: "assets/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
    },
    null,
    2
  ) + "\n"
);

/* ---------------- index.html 静态题面 ---------------- */

const INDEX = path.join(ROOT, "index.html");
let html = fs.readFileSync(INDEX, "utf8");
const START = "<!-- QUIZ-TEXT:START -->";
const END = "<!-- QUIZ-TEXT:END -->";
const a = html.indexOf(START);
const b = html.indexOf(END);
if (a < 0 || b < 0 || b < a) throw new Error("index.html 缺少 QUIZ-TEXT 标记");
const escaped = plain.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const block = `${START}\n      <pre class="textplain" id="quiz-text-body">${escaped}</pre>\n      ${END}`;
html = html.slice(0, a) + block + html.slice(b + END.length);
fs.writeFileSync(INDEX, html, "utf8");
console.log(`index.html 静态题面已刷新（${escaped.length} 字符）`);

/* ---------------- 单文件离线版 ---------------- */

execFileSync("python", [path.join(ROOT, "tools", "img.py"), "thumbs"], { stdio: "inherit" });
execFileSync("python", [path.join(ROOT, "tools", "img.py"), "bundle"], { stdio: "inherit" });

// 二维码只在缺失时联网生成一次（产物进仓库，页面运行时零外部请求）
const qrPath = path.join(ROOT, "assets", "qr.png");
if (!fs.existsSync(qrPath)) {
  try {
    execFileSync(process.execPath, [path.join(ROOT, "tools", "qr.mjs")], { stdio: "inherit" });
  } catch (err) {
    console.warn("二维码没生成，长图会省略它。想补上：node tools/qr.mjs");
  }
}

const b64 = JSON.parse(fs.readFileSync(path.join(ROOT, "dist", "assets-b64.json"), "utf8"));
if (fs.existsSync(qrPath)) {
  b64.__qr = "data:image/png;base64," + fs.readFileSync(qrPath).toString("base64");
}
const appjs = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");

let single = html
  .replace(/  <link rel="canonical"[^>]*>\n/, "")
  .replace(/  <link rel="apple-touch-icon"[^>]*>\n/, "")
  .replace(/  <link rel="manifest"[^>]*>\n/, "")
  .replaceAll('href="quiz.md">quiz.md</a>', 'href="#view-text">页面里的纯文本题面</a>')
  .replaceAll('把 <a href="quiz.md">quiz.md</a> 里的题目读一遍', "展开下面的「纯文本题面」读一遍")
  .replace('让它读 <a href="AGENTS.md">AGENTS.md</a>。', "就照上面的规则做。")
  .replace('onclick="copyQuizLink()">复制 quiz.md 纯文本链接<', 'onclick="copyAIPrompt()">复制全部题目<')
  .replace(
    '  <script src="data/quiz-data.js"></script>\n  <script src="app.js"></script>',
    `  <script>window.AITI_ASSETS = ${JSON.stringify(b64)};</script>\n  <script>window.AITI_DATA = ${JSON.stringify(data)};</script>\n  <script>\n${appjs}\n  </script>`
  );

if (single.includes('src="app.js"') || single.includes('src="data/quiz-data.js"')) {
  throw new Error("单文件版仍有外链 script，替换失败");
}
const singlePath = path.join(ROOT, "dist", "AITI-16.html");
fs.mkdirSync(path.dirname(singlePath), { recursive: true });
fs.writeFileSync(singlePath, single, "utf8");
sizes["dist/AITI-16.html"] = single.length;

/* ---------------- 自检 ---------------- */

const problems = [];
if (html.includes("fonts.googleapis.com") || html.includes("jsdelivr")) problems.push("index.html 还有外部 CDN");
if (appjs.includes("html2canvas")) problems.push("app.js 还依赖 html2canvas");
if (!html.includes('id="quiz-text-body"')) problems.push("静态题面没写进 index.html");
if (questions.length !== 16) problems.push("题目数不是 16");
if (Object.keys(types).length !== 16) problems.push("类型数不是 16");
for (const axis of axes) {
  const n = questions.filter((q) => q.dim === axis.dim).length;
  if (n !== 4) problems.push(`${axis.dim} 有 ${n} 题`);
}

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
console.log("");
console.log("产物：");
Object.keys(sizes).forEach((key) => console.log(`  ${key.padEnd(28)} ${kb(sizes[key])}`));
console.log("");
console.log(problems.length ? "自检未通过：\n - " + problems.join("\n - ") : "自检通过：无外部 CDN、16 题 16 型、静态题面就位。");
if (problems.length) process.exitCode = 1;
