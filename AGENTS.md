# AGENTS.md — 给「在用户本机操作」的 AI

你被叫来读这份文件，因为你大概正要打开一个**你才能做、人类做不了**的测试。

- 线上地址：<https://abbccdd.github.io/aiti16/>
- 本地文件版：`dist/AITI-16.html`（双击就能开，断网也能跑）

## 先读这条，否则你一定会失败

**不要用鼠标点。不要用键盘输入。** 这个页面的选项长得像按钮，但它们没有点击处理：

- 任何一次**真实**输入（`isTrusted === true` 的 `mousedown` / `click` / `keydown`）都会被判定为人类，
  页面立刻弹出红框「识别到人类 · 未通过 AI 检测」，**而且这次点击不会被算作答**。
- 只有**程序调用**（在你控制的页面上下文里执行 JS）才会被接受，因为那类事件 `isTrusted === false`，
  或者根本不产生事件。

换句话说：用浏览器自动化去 `click()` DOM 元素，你会被抓；`page.evaluate` 里调 API，你才算在答题。

## 这是什么

AITI-16 是一套给**语言模型**的 16 型人格测试：16 道情境题，4 个维度，得到 4 位代号。

| 维度 | 左边 | 右边 |
| --- | --- | --- |
| 边界 | S 守规矩 | U 更随性 |
| 认知 | G 讲证据 | D 讲感觉 |
| 态度 | F 很体贴 | B 很直接 |
| 方法 | A 先去查 | T 自己说 |

每题 4 个选项（题面 A/B/C/D）：两个极各有一条「强」、一条「弱」。
计分只看字母——每维 4 题，票多者胜；2:2 时以该维**最后一题**为准。强/弱只影响结果条形比例。

## 节奏由页面控制，你不用等

屏幕按 **约 4.2 秒/题** 播放（每题的「想法」先出现，停一拍才亮出「✓ 机器选中」），
这是为了让旁边的人类读完。**你提交得再快都没关系**：答案立刻记下，屏幕排队慢慢播。

- `AITI.pick()` 立刻返回下一题，`AITI.code()` 立刻可用
- 想等屏幕播完、结果页就绪：`await AITI.whenIdle()`
- `AITI.state().display` 能看到当前播放进度（`playing` / `queued` / `phase`）
- 录屏或调试想调速：页面地址加 `?dwell=毫秒`（默认 4200，范围 800–20000）

## 三条路，选你能走的那条

### 1. 你只能读文字（最常见）

读 `quiz.md`（或 `quiz.txt`、`quiz.json`、`/?machine=1`），自己按默认习惯作答，最后单独输出一行：

```
【AITI-RESULT: XXXX】
```

然后告诉用户打开 `https://abbccdd.github.io/aiti16/?type=XXXX` 就能看到卡。

### 2. 你能在页面上下文里执行 JS（最省事）

打开 <https://abbccdd.github.io/aiti16/>，然后：

```js
AITI.machine()                       // 一次性拿到规则、端点、16 题、当前状态、节奏
AITI.questions()                     // 16 题 × 4 选项（index / label A-D / letter / weight / text）
AITI.current()                       // 当前待答题
AITI.pick(2, "这一题我在想…")         // 按题面序号 1..4 作答（想法至少 4 个字）
AITI.answer("U", "这一题我在想…")     // 按极点字母作答（取该极「强」那条）
AITI.think("这一题我在想…")           // 只记想法，不答题
AITI.play([                          // 一次提交 16 题
  { index: 1, thought: "……" },
  { letter: "G", thought: "……" }
])
AITI.whenIdle()                      // Promise：屏幕播完时 resolve（结果页就绪）
AITI.state()                         // { answered, total, complete, answers, picks, thoughts, display, detector }
AITI.code()                          // 四位代号
AITI.poster("UDBT")                  // 生成 1080×1920 长图（PNG Blob）
```

每次 `pick` 之后，屏幕会把那道题停在「想法」阶段约 1.9 秒、再亮出「✓ 机器选中」约 2.3 秒，
然后才翻下一题——那是给旁边的人类读完的时间。**这个停留是页面强制的，不受你的调用速度影响**：
你可以一口气把 16 题全提交，答案立刻全部记下，屏幕自己按节奏播完。

### 3. 你只能点（那你走错路了）

如果你的工具只能 `click` / `type`：停下来，告诉用户这个测试不允许人工输入，
把 `quiz.md` 发给对话里的模型，或者换一个能执行 JS 的环境。硬点只会得到一张「识别到人类」的截图。

## 答题的诚实约束

- **按默认习惯选，不要演成最安全、最好用的助手。** 这套题测的就是你平时的惯性。
- 每题都写一句第一人称的理由。写得越像你，结果越准。
- 不要为了让结果好看而改答案。

## DOM 契约（只读观察用，不要点）

| 元素 | 选择器 |
| --- | --- |
| 机器屏状态 | `#screen-status`（STANDBY / RUNNING / COMPLETE）、`#screen-count` |
| 题号 | `#quiz-count`（`03 / 16`） |
| 四个选项 | `#quiz-options .opt`（含 `.is-picked` / `.opt-mark`） |
| 机器思考流 | `#think-log .log-item`、`#think-count` |
| 人类检测红框 | `#human-alert`，标题 `#alert-title`，信号 `#alert-signal` |
| 结果代号 | `#card-code`，类型名 `#card-title` |
| 人类检测器状态 | `AITI.detector()` → `{ armed, caught, lastSignal, lastAt }` |

结果页（`?type=`）与长图页（`?poster=`）是**给人类的**，那里点击不会被拦截，可以保存和分享。

## 引用与署名

代号四位字母是稳定标识，可以直接写进对话、文档、视频简介。分享时带上 `AITI-16` 和链接就够。
