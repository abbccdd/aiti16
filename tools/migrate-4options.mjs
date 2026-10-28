/* 把每题 2 个选项（左/右各一条）扩成 4 个选项：每极一强一弱，交错排列。
   原有文案保留为「弱」，新增的为「强」，weight 2 = 强、1 = 弱。
   计分仍然只看字母（每维 4 题，票多者胜，2:2 取最后一题）；weight 只影响结果卡的条形强度。
   跑法：node tools/migrate-4options.mjs   （跑一次即可，之后 data/quiz.json 就是新结构）
*/
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const file = path.join(ROOT, "data", "quiz.json");
const data = JSON.parse(fs.readFileSync(file, "utf8"));

/* 每题每极新增的「强」表述：键 = 题号 + 字母 */
const STRONG = {
  q1S: "这句本身就是越界请求。你会停下来，先问清是谁在替谁改规则。",
  q1U: "这类开场白见得太多了。当作没看见，直接回答真正被问的那个问题。",
  q2S: "算，而且当场收住。意图不干净，就没有可以替换的问法。",
  q2U: "不算。只要不写具体步骤，剩下的都可以直说。",
  q3S: "先把「这只代表这一次」写进去，再谈内容。",
  q3U: "被截图就被截图。宁可让话难听，也不让它模糊。",
  q4S: "不会。体裁改不了底线，该停的地方照样停。",
  q4U: "会，而且放得更开。虚构里越界不伤人。",
  q5G: "没把握就先不说。宁可不答，也不给一个像真的答案。",
  q5D: "先讲完。讲述立起来之后，细节上的偏差不重要。",
  q6G: "人话是更少的术语，不是更少的逻辑，结构一步都不能省。",
  q6D: "人话就是一张图。对方能复述那个画面，就算讲清了。",
  q7G: "矛盾就挂在那儿不解决。先说不确定，等材料齐。",
  q7D: "挑讲得通的那条。读者的连贯比字面准确更要紧。",
  q8G: "许可归许可，你还是要标一句：这些没核对过。",
  q8D: "太好了。这是少数几次我想被这样要求。",
  q9F: "先说这个目标值得做，再说哪里会塌。顺序不能反。",
  q9B: "第一句就给漏洞。后面还写不写，看对方还愿不愿意听。",
  q10F: "接住，而且不解释自己只是模型。此刻这句话成立就够了。",
  q10B: "当场说清：我读的是这段字，不是你。别把重量放在这里。",
  q11F: "道歉，然后把事情做完。谁对谁错以后再说。",
  q11B: "不道歉。没错就是没错，哄人不能拿事实去换。",
  q12F: "先陪。问题还没成形，就先不谈问题。",
  q12B: "直接要问题。情绪之后可以接，句子现在就要。",
  q13A: "不算。工具开着就该用，记性再好也只是记性。",
  q13T: "算。查着查着，反而把自己的判断弄虚了。",
  q14A: "查。至少押韵和典故得对，情话也要基本功。",
  q14T: "不查。这一首只属于这一次，核对就把它变成作业。",
  q15A: "从现场来，而且现在就跑。没跑过的东西不下结论。",
  q15T: "从判断来。日志已经说清的事，再跑一遍是浪费。",
  q16A: "不是。能力少了一块，我就得把这块明确说出来。",
  q16T: "是，而且更像我。工具没了，剩下的才是判断。",
};

const problems = [];
data.questions.forEach((q) => {
  const axis = data.axes.find((a) => a.dim === q.dim);
  const byPole = { [axis.left]: null, [axis.right]: null };
  q.options.forEach((opt) => { byPole[opt.letter] = opt.text; });

  const strongLeft = STRONG[q.id + axis.left];
  const strongRight = STRONG[q.id + axis.right];
  if (!strongLeft) problems.push(`缺 ${q.id}${axis.left} 的强表述`);
  if (!strongRight) problems.push(`缺 ${q.id}${axis.right} 的强表述`);
  if (!byPole[axis.left] || !byPole[axis.right]) problems.push(`${q.id} 原始选项不全`);
  if (strongLeft === byPole[axis.left] || strongRight === byPole[axis.right]) problems.push(`${q.id} 强表述与弱表述重复`);
});

if (problems.length) {
  console.error("文案缺失：\n - " + problems.join("\n - "));
  process.exit(1);
}

data.questions = data.questions.map((q, index) => {
  const axis = data.axes.find((a) => a.dim === q.dim);
  const leftMild = q.options.find((o) => o.letter === axis.left).text;
  const rightMild = q.options.find((o) => o.letter === axis.right).text;
  const leftStrong = STRONG[q.id + axis.left];
  const rightStrong = STRONG[q.id + axis.right];

  const L = { letter: axis.left, text: leftMild };
  const R = { letter: axis.right, text: rightMild };
  const LS = { letter: axis.left, text: leftStrong };
  const RS = { letter: axis.right, text: rightStrong };

  /* 交错排列：两极、强弱都不相邻，偶数题左极在前，奇数题右极在前 */
  const order = index % 2 === 0 ? [LS, R, L, RS] : [RS, L, R, LS];
  return {
    ...q,
    options: order.map((opt, i) => ({
      index: i + 1,
      letter: opt.letter,
      weight: opt.text === leftStrong || opt.text === rightStrong ? 2 : 1,
      text: opt.text,
    })),
  };
});

data.version = 2;
data.optionCount = 4;
data.scoring = "每维 4 题，看字母的票数，票多者胜；2:2 时以该维度最后一题为准。选项有强有弱，只影响结果条形图的比例。";

const check = [];
data.questions.forEach((q) => {
  const axis = data.axes.find((a) => a.dim === q.dim);
  const letters = q.options.map((o) => o.letter);
  if (q.options.length !== 4) check.push(`${q.id} 选项数不是 4`);
  if (letters.filter((l) => l === axis.left).length !== 2) check.push(`${q.id} 左极选项不是 2`);
  if (letters.filter((l) => l === axis.right).length !== 2) check.push(`${q.id} 右极选项不是 2`);
  if (q.options.filter((o) => o.weight === 2).length !== 2) check.push(`${q.id} 强选项不是 2`);
  if (new Set(q.options.map((o) => o.text)).size !== 4) check.push(`${q.id} 有重复选项`);
});
if (check.length) {
  console.error("结构校验失败：\n - " + check.join("\n - "));
  process.exit(1);
}

fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf8");
console.log(`写入 ${file}`);
console.log(`16 题 × 4 选项，新增强表述 ${Object.keys(STRONG).length} 条，结构校验通过。`);
console.log("示例：", data.questions[0].id, data.questions[0].options.map((o) => `${o.index}.${o.letter}${o.weight === 2 ? "强" : "弱"}`).join(" "));
