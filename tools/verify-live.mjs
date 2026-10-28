/* 线上验收：逐个端点实际拉一遍，检查状态码、类型、关键内容
   跑法：node tools/verify-live.mjs [站点根地址]
*/
const BASE = (process.argv[2] || "https://abbccdd.github.io/aiti16").replace(/\/+$/, "");

const checks = [];
const fail = [];
const note = (label, pass, detail) => {
  checks.push({ label, pass, detail });
  if (!pass) fail.push(label);
};

async function grab(pathname) {
  const url = pathname.startsWith("http") ? pathname : `${BASE}${pathname}`;
  const res = await fetch(url, { redirect: "follow" });
  const buf = Buffer.from(await res.arrayBuffer());
  return { url, res, buf, text: buf.toString("utf8") };
}

async function main() {
  console.log(`验收目标：${BASE}\n`);

  // 首页
  const home = await grab("/");
  note("首页 200", home.res.status === 200, home.res.status);
  note("首页是 HTML", (home.res.headers.get("content-type") || "").includes("text/html"), home.res.headers.get("content-type"));
  note("首页体积合理 (>8KB)", home.buf.length > 8000, `${(home.buf.length / 1024).toFixed(1)} KB`);
  note("标题正确", home.text.includes("这台机器只考 AI"));
  note("静态题面在 HTML 里（抓取器可读）", home.text.includes('id="quiz-text-body"'));
  note("16 道题全在静态题面里", [...Array(16)].every((_, i) => home.text.includes(`\n${i + 1}. `)));
  note("静态题面每题四个选项", (home.text.match(/^ {3}A\. /gm) || []).length === 16);
  note("OG 封面指向绝对地址", /property="og:image" content="https:\/\/[^"]+og\.png"/.test(home.text));
  note("无外部 CDN 引用", !/fonts\.googleapis|jsdelivr|unpkg/.test(home.text));

  // 机器专用设定
  note("首页写着「这台机器只考 AI」", home.text.includes("这台机器只考 AI"));
  note("首页说明了真实点击会被判定为人类", home.text.includes("任何一次真实点击都会被判定为人类"));
  note("红框文案在页面里", home.text.includes("识别到人类") && home.text.includes("未通过 AI 检测"));
  note("机器接口印在屏上", home.text.includes("window.AITI.pick"));
  const homeSection = (home.text.match(/<section id="view-home"[\s\S]*?<\/section>/) || [""])[0];
  note("首页机器屏的按钮只在配对面板里", homeSection.length > 500 && /<div class="pairbox" data-human-ok>[\s\S]*?<button/.test(homeSection));
  note("首页机器屏没有输入框", !/<input|<textarea/i.test(homeSection));
  note("配对面板可生成链接", home.text.includes("生成给 AI 的链接") && home.text.includes("data-human-ok"));

  // AI 直读通道
  const md = await grab("/quiz.md");
  note("quiz.md 200", md.res.status === 200, md.res.status);
  note("quiz.md 含 16 题", [...Array(16)].every((_, i) => md.text.includes(`### ${i + 1}.`)));
  note("quiz.md 给出提交格式", md.text.includes("AITI-RESULT: XXXX"));
  note("quiz.md 交代了人类不能做", md.text.includes("只接受语言模型作答") && md.text.includes("点击"));

  const txt = await grab("/quiz.txt");
  note("quiz.txt 200", txt.res.status === 200, txt.res.status);

  const json = await grab("/quiz.json");
  note("quiz.json 200", json.res.status === 200, json.res.status);
  try {
    const parsed = JSON.parse(json.text);
    note("quiz.json 可解析", true);
    note("quiz.json 16 题 16 型", parsed.questions.length === 16 && Object.keys(parsed.types).length === 16, `${parsed.questions.length}/${Object.keys(parsed.types).length}`);
  } catch (err) {
    note("quiz.json 可解析", false, err.message);
  }

  const llms = await grab("/llms.txt");
  note("llms.txt 200", llms.res.status === 200, llms.res.status);
  note("llms.txt 指向 quiz.md", llms.text.includes("quiz.md"));
  note("llms.txt 警告了点击会被判定为人类", llms.text.includes("isTrusted=true"));

  const agents = await grab("/AGENTS.md");
  note("AGENTS.md 200", agents.res.status === 200, agents.res.status);
  note("AGENTS.md 写了 window.AITI", agents.text.includes("AITI.answer"));
  note("AGENTS.md 明确「不要用鼠标点」", agents.text.includes("不要用鼠标点"));

  // 分享素材
  const og = await grab("/og.png");
  note("og.png 200", og.res.status === 200, og.res.status);
  note("og.png 是 PNG", (og.res.headers.get("content-type") || "").includes("image/png"), og.res.headers.get("content-type"));
  note("og.png 体积合理 (>50KB)", og.buf.length > 50000, `${(og.buf.length / 1024).toFixed(0)} KB`);
  note("og.png 尺寸 1200×630", og.buf.readUInt32BE(16) === 1200 && og.buf.readUInt32BE(20) === 630, `${og.buf.readUInt32BE(16)}×${og.buf.readUInt32BE(20)}`);

  const icon = await grab("/favicon.svg");
  note("favicon.svg 200", icon.res.status === 200, icon.res.status);

  const manifest = await grab("/manifest.webmanifest");
  note("manifest 200", manifest.res.status === 200, manifest.res.status);

  // 图与单文件版
  const thumb = await grab("/assets/thumb/UDBT.jpg");
  note("缩略图 200", thumb.res.status === 200, `${thumb.res.status} ${(thumb.buf.length / 1024).toFixed(0)} KB`);

  const qr = await grab("/assets/qr.png");
  note("长图二维码 200", qr.res.status === 200 && qr.buf.readUInt32BE(0) === 0x89504e47, `${qr.res.status} ${qr.buf.length} B`);

  const single = await grab("/dist/AITI-16.html");
  note("单文件版 200", single.res.status === 200, `${(single.buf.length / 1024 / 1024).toFixed(2)} MB`);
  note("单文件版内联了图片", single.text.includes("data:image/jpeg;base64,"));

  // 404 与深链
  const missing = await grab("/no-such-page-xyz");
  note("不存在的路径返回 404", missing.res.status === 404, missing.res.status);
  const deep = await grab("/?type=UDBT");
  note("深链 ?type=UDBT 可访问", deep.res.status === 200, deep.res.status);
  const machine = await grab("/?machine=1");
  note("?machine=1 可访问", machine.res.status === 200, machine.res.status);
  const poster = await grab("/?poster=UDBT&raw=1");
  note("?poster=UDBT&raw=1 可访问", poster.res.status === 200, poster.res.status);

  // 报数
  for (const c of checks) {
    console.log(`  ${c.pass ? "✓" : "✗"} ${c.label}${c.detail !== undefined ? `  [${c.detail}]` : ""}`);
  }
  console.log("");
  if (fail.length) {
    console.log(`未通过 ${fail.length} 项：${fail.join(" / ")}`);
    process.exitCode = 1;
  } else {
    console.log(`全部通过（${checks.length} 项）。线上地址：${BASE}/`);
  }
}

main().catch((err) => {
  console.error("验收脚本本身出错：", err.message);
  process.exitCode = 1;
});
