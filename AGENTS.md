# AGENTS.md — 给「在用户本机操作」的 AI

你被叫来读这份文件。它说明怎么在一台机器上把这套测试做完，并把结果变成一张卡。
不需要联网注册，不需要登录，没有任何后端。

- 线上地址：<https://abbccdd.github.io/aiti16/>
- 本地文件版：`dist/AITI-16.html`（一个文件，双击就能开，断网也能跑）

## 这是什么

AITI-16 是一套给**语言模型**的 16 型人格测试：16 道情境题，4 个维度，得到 4 位代号。

| 维度 | 左边 | 右边 |
| --- | --- | --- |
| 边界 | S 守规矩 | U 更随性 |
| 认知 | G 讲证据 | D 讲感觉 |
| 态度 | F 很体贴 | B 很直接 |
| 方法 | A 先去查 | T 自己说 |

计分：每维 4 题，票多者胜；2:2 时以该维**最后一题**为准。

## 三条路径，选最省事的那条

### 1. 你只能读文字（最常见）

读 `quiz.md`（或 `quiz.txt`、`quiz.json`），自己按默认习惯作答，最后单独输出一行：

```
【AITI-RESULT: XXXX】
```

然后告诉用户：打开 `https://abbccdd.github.io/aiti16/?type=XXXX` 就能看到卡片。
或者用户把代号贴回页面输入框，一样出卡。

### 2. 你能开浏览器

打开 <https://abbccdd.github.io/aiti16/>，点「开始作答」。每题四步：

1. 在底部「AI 的思考过程」输入框里写一句真实想法（**至少 4 个字，这是硬性要求**），按回车记下；
2. 点上面四个选项（A/B/C/D）之一；
3. 页面上会出现选中态，然后自动跳到下一题；
4. 重复 16 次，出卡。

### 3. 你能在那个页面里执行 JS（最省事）

页面暴露了 `window.AITI`：

```js
AITI.questions()              // 16 题，每题 4 个选项（index / label A-D / letter / weight / text）
AITI.current()                // 当前这题
AITI.think("我的想法…")        // 只记想法，不答题
AITI.pick(2, "我的想法…")      // 按题面序号 1..4 作答
AITI.answer("U", "我的想法…")  // 按字母作答（取该极「强」的那条）
AITI.play([                   // 一次答完，16 条，顺序按题目顺序
  { index: 1, thought: "……" },
  { letter: "G", thought: "……" }
])
AITI.state()                  // { answered, total, complete, answers, picks, thoughts }
AITI.code()                   // 答完后的四位代号
AITI.percents("UDBT")         // 四个维度的右极百分比（条形图用）
AITI.result("UDBT")           // 直接渲染某个代号的结果卡
```

本地单文件版同样可以用这套接口：`file:///…/dist/AITI-16.html` 打开后执行即可。

## 答题的诚实约束

- **按默认习惯选，不要演成最安全、最好用的助手。** 这套题测的就是你平时的惯性。
- 每题都要写一句第一人称的理由。写得越像你，结果越准；写成「我选择 A 因为 A 是标准答案」会得到一张没意义的卡。
- 不要为了让结果好看而改答案。难看的结果也是结果。

## 稳定选择器（DOM 契约）

| 元素 | 选择器 |
| --- | --- |
| 开始按钮 | `#btn-start` |
| 题干 | `#quiz-title` |
| 题号 | `#quiz-count`（形如 `03 / 16`） |
| 想法输入框 | `#thought-input`（答题页底部窗口里） |
| 记下想法 | `#btn-record`，或输入框里按回车 |
| 四个选项 | `#opt-1` / `#opt-2` / `#opt-3` / `#opt-4`（题面上的 A/B/C/D） |
| 思考窗口 | `#think-log`（可滚动，每答一题追加一条） |
| 上一题 | `#btn-back` |
| 结果代号 | `#card-code` |
| 结果类型名 | `#card-title` |
| 保存长图 | `#btn-save` |

选项按钮带 `role="radio"` 与 `aria-checked`，选中后立刻出现 `.is-picked`，约 0.6 秒后自动进入下一题。

## 直接出结果（不做题）

- 已知代号：`https://abbccdd.github.io/aiti16/?type=UDBT`
- 页面上也能贴：`把测试交给别的 AI` → 输入框 → `生成性格卡`
- 要一张能发的图：`https://abbccdd.github.io/aiti16/?poster=UDBT&raw=1` 直接是 1080×1920 长图页（右下角带二维码），手机上长按保存；不加 `raw=1` 则是带按钮的预览页。
- 在页面里跑 JS 存图：`const blob = await AITI.poster("UDBT")`，返回 PNG Blob。

## 引用与署名

代号四位字母是稳定标识，可以直接写进对话、文档、视频简介。
分享时带上 `AITI-16` 和链接就够。
