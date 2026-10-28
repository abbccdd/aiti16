# AITI-16 · 测测你的 AI 是什么性格

16 道情境题，测出你的 AI 是哪一型：4 个维度，4 位代号，16 个名字，一张可以保存的长图。

设计前提是**无门槛传播**：一个链接、任何设备、任何 AI，都能自己把题做完。

- 没有后端，没有登录，没有 Cookie 之外的记录（进度只存 `localStorage`）
- 不请求任何境外资源：没有 Google Fonts，没有 CDN，导出长图是手写 canvas
- 断网可用：`dist/AITI-16.html` 是单文件离线版，图片内联，双击就开

## 三个入口

| 谁 | 入口 |
| --- | --- |
| 人 | 打开首页，点「开始作答」 |
| 只会读文字的 AI | `quiz.md` / `quiz.txt` / `quiz.json`，答完输出 `【AITI-RESULT: XXXX】` |
| 能在本机开浏览器或跑 JS 的 AI | `AGENTS.md`，页面暴露 `window.AITI` |
| 已经知道代号的人 | `?type=UDBT` 直接出卡 |

## 目录

```
index.html                页面（无外部依赖）
app.js                    引擎：答题、计分、canvas 长图、window.AITI
data/quiz.json            唯一数据源：维度 / 16 题 / 16 型
data/quiz-data.js         构建产物，浏览器引用的那份
assets/<代号>.jpg         16 张 1024² 插画（原图）
assets/thumb/<代号>.jpg   构建产物，240² 列表缩略图
quiz.md quiz.txt quiz.json llms.txt   给 AI 的直读通道（构建产物）
AGENTS.md                 给在本机操作的 agent 的手册
og.png                    社交分享封面 1200×630（构建产物）
tools/build.mjs           构建脚本
tools/img.py              图片预处理（Pillow：缩略图、内联包、图标）
tools/og.py               生成 og.png 分享封面
tools/qr.mjs              生成 assets/qr.png（长图右下角二维码，构建时联网一次）
tools/smoke.mjs           无浏览器冒烟测试（DOM 桩跑全流程）
tools/verify-live.mjs     线上端点验收（状态码 + 关键内容）
tools/qa-e2e.mjs          真浏览器端到端（CDP：真点击 16 题、长图、刷新持久化）
tools/qa-shots.py         截图像素核对（无视觉能力时的长图排版验收）
dist/AITI-16.html         单文件离线版（构建产物）
```

## 构建

```powershell
node tools/build.mjs         # 生成数据、文本通道、缩略图、单文件版
node tools/og.py             # 重新生成 og.png（纯 Pillow，不需要浏览器）
node tools/qr.mjs            # 重新生成二维码（换域名后必跑）
node tools/smoke.mjs         # 无浏览器冒烟：id 对账、16 题流程、平票规则、16 型长图排版
node tools/verify-live.mjs   # 线上端点验收（32 项）
node tools/qa-e2e.mjs        # 真浏览器端到端（22 项），也接受 file:// 单文件版地址
```

已跑过的验收记录：

- 线上 `https://abbccdd.github.io/aiti16/`：`verify-live` 32 项通过；`qa-e2e` 22 项通过（真点击走完 16 题、长图 1080×1920 / 1209 KB）。
- 离线 `dist/AITI-16.html`：`qa-e2e` 22 项通过（`file://` 下长图同样能导出，1057 KB）。

三个入口：线上 <https://abbccdd.github.io/aiti16/>，单文件 `dist/AITI-16.html`，以及给 AI 的 `quiz.md`。

改题目只改 `data/quiz.json`，然后跑一次构建。`index.html` 里有 `<!-- QUIZ-TEXT:START -->` 标记，静态题面会被自动刷新，保证不跑 JS 的抓取器也能读到全部题目。

## 部署

站点是纯静态的，扔进任何静态托管都行。

**GitHub Pages（当前默认）**

```powershell
gh repo create aiti16 --public --source . --push
gh api -X POST repos/:owner/aiti16/pages -f "source[branch]=main" -f "source[path]=/"
```

地址形如 `https://<用户名>.github.io/aiti16/`。仓库根目录有 `.nojekyll`，别删。

**换成别的托管**（Cloudflare Pages / Netlify / Vercel / 自己的对象存储）时，把 `AITI_SITE` 换掉再构建，让 `canonical`、`og:url`、`llms.txt` 里的绝对地址跟着变：

```powershell
$env:AITI_SITE = "https://你的域名"; node tools/build.mjs
```

## 传播上的几个坑

- **微信**：朋友圈/聊天里点外链容易被拦，`github.io` 也不算稳。长图 + 一句话是更可靠的方式；要长期做，就绑一个已备案的国内域名。
- **B 站**：评论区和简介对链接不友好，把 `?type=XXXX` 印在图上、把测试名写进标题更有效。
- **X**：`og.png` 决定卡片长什么样，转发前先确认预览图正常。
- **AI 那边**：很多 agent 的抓取器只拿原始 HTML。所以题目在 `index.html` 的静态块里也有一份，不依赖 JS。

## 版本

- 代号四位固定顺序：边界 S/U · 认知 G/D · 态度 F/B · 方法 A/T
- 计分：每维 4 题，票多者胜，2:2 以该维最后一题为准
- `?type=` 是稳定分享入口，不要改语义
