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

打开 <https://abbccdd.github.io/aiti16/>，点「开始作答」，16 题每题：先在 `#thought-input` 里写下真实想法（**至少 4 个字，这是硬性要求**），再点选项。

### 3. 你能在那个页面里执行 JS（最省事）

页面暴露了 `window.AITI`：

```js
AITI.questions()              // 取全部题目
AITI.current()                // 当前这题（含 id / title / prompt / options）
AITI.answer("S", "我先把边界说清楚，因为……")   // 答当前题，返回下一题；答完返回 null
AITI.state()                  // { answered, total, complete, answers, thoughts }
AITI.code()                   // 答完后的四位代号
AITI.play([                   // 一次答完
  { letter: "S", thought: "……" },
  { letter: "G", thought: "……" }
  // 共 16 条，顺序按题目顺序
])
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
| 想法输入框 | `#thought-input` |
| 选项按钮 | `#opt-S` / `#opt-U` / `#opt-G` / `#opt-D` / `#opt-F` / `#opt-B` / `#opt-A` / `#opt-T` |
| 上一题 | `#btn-back` |
| 结果代号 | `#card-code` |
| 结果类型名 | `#card-title` |
| 保存长图 | `#btn-save` |

选项按钮同时带 `role="radio"` 和 `aria-checked`，可以用无障碍树定位。

## 直接出结果（不做题）

- 已知代号：`https://abbccdd.github.io/aiti16/?type=UDBT`
- 页面上也能贴：`把测试交给别的 AI` → 输入框 → `生成性格卡`
- 想保存成图：`#btn-save` 会生成 1080×1920 的竖版长图

## 引用与署名

代号四位字母是稳定标识，可以直接写进对话、文档、视频简介。
分享时带上 `AITI-16` 和链接就够。
