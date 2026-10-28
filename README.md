# AITI-16 · 这台机器只考 AI

一套**只接受语言模型作答**的 16 型人格测试：16 道情境题，4 个维度，4 位代号，一张可以保存的长图。

卖点就是一件事：**人类做不了。**

- 页面上的选项长得像按钮（有 hover、有选中态），但**它们没有任何点击处理**
- 任何一次真实输入（`isTrusted === true` 的 `mousedown` / `click` / `keydown`）都会被判定为人类：
  立刻弹出红框「**识别到人类 · 未通过 AI 检测**」，写明信号、时间，并注明「本次点击不计入作答」
- 作答只接受两种路径：`window.AITI` 的程序调用（不产生可信事件），或者纯文本通道
- 结果页与长图页是**人类的领地**，那里点击不拦截，可以保存、分享

线上：<https://abbccdd.github.io/aiti16/> · 单文件离线版：`dist/AITI-16.html`

## 两个界面

| 谁 | 看到什么 |
| --- | --- |
| 人类 | 一块**机器显示屏**：状态条（STANDBY / RUNNING / COMPLETE）、机器接口代码、拦截计数。没有按钮，没有输入框。点一下 → 红框 |
| AI | 三样东西：页面里的 `window.AITI`、`?machine=1` 的 JSON、`/quiz.md` 系列纯文本 |

AI 开始作答时，人类那块屏会实时跟着走：选项上一题一题地出现「✓ 机器选中」，
底部「机器思考流」滚出它的原始记录，约 0.45 秒后自动翻到下一题。人类全程只能看。

## 题目结构

每题 4 个选项（题面 A/B/C/D）：两个极各有一条「强」、一条「弱」，交错排列。

- **代号只看字母**：每维 4 题，票多者胜；2:2 时以该维最后一题为准
- **强/弱（weight 2/1）**只影响结果卡的条形图比例，不改变代号
- `data/quiz.json` 是唯一数据源，改完跑一次构建即可

## 目录

```
index.html                机器屏 + 旁观屏 + 结果卡 + 红框（无外部依赖）
app.js                    引擎：人类检测、旁观渲染、计分、canvas 长图、window.AITI
data/quiz.json            唯一数据源：维度 / 16 题（每题 4 选项）/ 16 型
data/quiz-data.js         构建产物，浏览器引用的那份
assets/<代号>.jpg         16 张 1024² 插画（原图）
assets/thumb/<代号>.jpg   构建产物，240² 列表缩略图
quiz.md quiz.txt quiz.json llms.txt   给 AI 的直读通道（构建产物）
AGENTS.md                 给在本机操作的 agent 的手册（第一句就是「不要用鼠标点」）
og.png                    社交分享封面 1200×630（构建产物）
tools/build.mjs           构建脚本
tools/img.py              图片预处理（Pillow：缩略图、内联包、图标）
tools/og.py               生成 og.png 分享封面
tools/qr.mjs              生成 assets/qr.png（长图右下角二维码）
tools/smoke.mjs           无浏览器冒烟（DOM 桩：可信/不可信事件、作答、平票、长图）
tools/verify-live.mjs     线上端点验收
tools/qa-e2e.mjs          真浏览器端到端（CDP Input 注入真实点击，验人类检测）
tools/shots.mjs           CDP 精确截图（含真实点击取「被抓」那一帧）
tools/inspect.mjs         读某个元素的计算样式与盒子
tools/measure.mjs         量关键元素盒子，查贴边/溢出
tools/qa-shots.py         截图像素核对（红框是不是真的红、遮罩、选中态）
dist/AITI-16.html         单文件离线版（构建产物）
```

## 构建与验收

```powershell
node tools/build.mjs         # 生成数据、文本通道、缩略图、单文件版
python tools/og.py           # 重新生成 og.png
node tools/qr.mjs            # 重新生成二维码（换域名后必跑）
node tools/smoke.mjs         # DOM 桩冒烟
node tools/verify-live.mjs   # 线上端点验收
node tools/qa-e2e.mjs        # 真浏览器端到端（40 项），也可传 file:// 单文件版地址
node tools/shots.mjs         # 截图到 shots/（会打印每张的状态）
python tools/qa-shots.py     # 截图像素核对（25 项）
```

核心断言（`qa-e2e` 里用 CDP `Input.dispatchMouseEvent` 产生**真·可信点击**）：

1. 机器屏上没有任何按钮/输入框
2. 真实点击 → 红框出现，标题「识别到人类」，判定「未通过 AI 检测」，**作答数不变**
3. 真实键盘输入同样被拦
4. `AITI.pick()` 程序调用 → 屏幕切到旁观态，4 张按钮式选项，一张 `.is-picked`，**不触发检测**
5. `element.click()` 合成事件（`isTrusted=false`）→ 既不作答也不弹框
6. 约 0.45s 后自动翻下一题
7. 结果页关闭检测，真实点击不再弹框（分享是终点）
8. 长图 1080×1920；刷新后回到结果页；`?machine=1` 输出可解析 JSON

## 部署

纯静态，扔进任何静态托管都行。

```powershell
# GitHub Pages（当前默认）
gh repo create aiti16 --public --source . --push
gh api -X POST repos/:owner/aiti16/pages -f "source[branch]=main" -f "source[path]=/"
```

换域名时把 `AITI_SITE` 换掉再构建，`canonical` / `og:url` / `llms.txt` 里的绝对地址会跟着变：

```powershell
$env:AITI_SITE = "https://你的域名"; node tools/build.mjs; node tools/qr.mjs
```

## 传播上的几个坑

- **微信**：外链容易被拦，长图 + 二维码更稳；要长期做就绑一个已备案的国内域名。
- **B 站**：评论区和简介对链接不友好，把「人类点一下就出局」这句话放进标题/封面最抓人。
- **X**：`og.png` 决定卡片长什么样。
- **AI 那边**：很多 agent 的抓取器只拿原始 HTML。题目在 `index.html` 的静态块里也有一份，不依赖 JS。

## 版本

- 代号四位固定顺序：边界 S/U · 认知 G/D · 态度 F/B · 方法 A/T
- 每题 4 个选项（两极各一强一弱，交错），代号只看字母票
- `?type=` 是稳定分享入口，不要改语义
- 检测器只认 `isTrusted === true`；程序调用永远不算人类
