"""对 Chrome 截图做像素级核对（没有肉眼时的替代；白底版式）。
   跑法：python tools/qa-shots.py
"""
import os
import sys

from PIL import Image, ImageStat

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, "shots")
POSTER_W, POSTER_H = 1080, 1920
FOOT_H = 236                      # 与 app.js 里的 FOOT_H 保持一致
CONTENT_BOTTOM = POSTER_H - FOOT_H

problems = []
passed = []


def note(label, ok, detail=""):
    (passed if ok else problems).append(f"{label}{('  [' + str(detail) + ']') if detail != '' else ''}")


def load(name):
    path = os.path.join(SHOTS, name)
    if not os.path.exists(path):
        problems.append(f"缺 shots/{name}")
        return None
    return Image.open(path).convert("RGB")


def ink_ratio(im, box, threshold=120):
    crop = im.crop(box).convert("L")
    px = list(crop.getdata())
    return sum(1 for v in px if v < threshold) / max(1, len(px))


def near_white_ratio(im, box, threshold=248):
    crop = im.crop(box).convert("L")
    px = list(crop.getdata())
    return sum(1 for v in px if v >= threshold) / max(1, len(px))


def variance(im, box):
    return sum(ImageStat.Stat(im.crop(box)).stddev) / 3


def text_rows(im, box, min_ink=0.012):
    crop = im.crop(box).convert("L")
    w, h = crop.size
    px = crop.load()
    rows = 0
    run = 0
    for y in range(h):
        ink = sum(1 for x in range(0, w, 2) if px[x, y] < 120) / (w / 2)
        if ink >= min_ink:
            run += 1
        else:
            if run >= 6:
                rows += 1
            run = 0
    if run >= 6:
        rows += 1
    return rows


def check_poster():
    im = load("poster.png")
    if im is None:
        return
    note("长图尺寸 1080×1920", im.size == (1080, 1920), im.size)

    note("底色是白", near_white_ratio(im, (0, 0, POSTER_W, POSTER_H), 246) > 0.35, f"近白占比 {near_white_ratio(im, (0, 0, POSTER_W, POSTER_H), 246):.2f}")

    # 插画：顶部正方形，居中，暖色、有内容
    art = (150, 70, 930, 860)
    art_var = variance(im, art)
    art_mean = ImageStat.Stat(im.crop(art)).mean
    note("插画区有内容", art_var > 18, f"stddev {art_var:.0f}")
    note("插画区是暖色", art_mean[0] > art_mean[2], [round(v) for v in art_mean])

    # 正文：插画下方到内容底，能数出多个文字块
    body = (60, 900, 1020, CONTENT_BOTTOM)
    body_ink = ink_ratio(im, body)
    note("正文文字已渲染", body_ink > 0.015, f"墨迹占比 {body_ink:.3f}")
    rows = text_rows(im, body)
    note("正文有多个文字块", rows >= 6, f"文字行块 {rows}")

    # 页脚标语
    foot_top = CONTENT_BOTTOM + 30
    foot_ink = ink_ratio(im, (200, foot_top + 14, 940, foot_top + 58))
    note("页脚标语已渲染", foot_ink > 0.01, f"墨迹占比 {foot_ink:.3f}")

    # 二维码：左下角
    qr = im.crop((50, foot_top - 10, 200, foot_top + 140)).convert("L")
    px = qr.load()
    w, h = qr.size
    vals = [px[x, y] for y in range(h) for x in range(w)]
    dark = sum(1 for v in vals if v < 128) / len(vals)
    note("二维码黑白比例正常", 0.15 < dark < 0.70, f"深色 {dark:.3f}")
    flips = sum(1 for y in range(h) for x in range(1, w) if (px[x, y] < 128) != (px[x - 1, y] < 128))
    note("二维码呈模块交替（非纯色块）", flips / h > 6, f"每行平均跳变 {flips / h:.1f}")

    # 页脚内容不许被底边裁掉
    tail = im.crop((0, POSTER_H - 4, POSTER_W, POSTER_H)).convert("L")
    tail_dark = sum(1 for v in tail.getdata() if v < 200)
    note("页脚没有被底边裁切", tail_dark < 40, f"最底 4 行深色像素 {tail_dark}")

    # 左右留白：正文不该贴边（左右各 60px 内应是白）
    left_pad = near_white_ratio(im, (0, 900, 58, CONTENT_BOTTOM))
    right_pad = near_white_ratio(im, (1022, 900, POSTER_W, CONTENT_BOTTOM))
    note("正文左右留白正常", left_pad > 0.95 and right_pad > 0.95, f"{left_pad:.2f}/{right_pad:.2f}")


def check_page(name, label):
    im = load(name)
    if im is None:
        return
    note(f"{label} 渲染成功", im.size[0] > 300 and im.size[1] > 500, im.size)
    std = sum(ImageStat.Stat(im).stddev) / 3
    note(f"{label} 不是空白页", std > 12, f"stddev {std:.0f}")
    white = near_white_ratio(im, (0, 0, im.size[0], im.size[1]))
    note(f"{label} 白底但有大面积内容", 0.3 < white < 0.95, f"近白占比 {white:.2f}")


def check_quiz_shots():
    quiz = load("quiz.png")
    if quiz is not None:
        # 四个选项卡片：每张卡片有边框，数一下水平边缘跳变
        edge_rows = 0
        g = quiz.convert("L")
        px = g.load()
        for x in (60,):
            col = [px[x, y] for y in range(200, 700)]
            edge_rows = sum(1 for i in range(1, len(col)) if abs(col[i] - col[i - 1]) > 12)
        note("答题页有选项卡片边框", edge_rows >= 4, f"边缘跳变 {edge_rows}")

    picked = load("picked.png")
    if picked is not None and quiz is not None:
        # 选中态应该和未选中态明显不同（边框 + 序号实心）
        diff = ImageStat.Stat(Image.new("L", (1, 1)))
        a = quiz.crop((20, 180, 370, 700)).convert("L")
        b = picked.crop((20, 180, 370, 700)).convert("L")
        from PIL import ImageChops
        delta = ImageStat.Stat(ImageChops.difference(a, b)).mean[0]
        note("点选后有明显视觉变化", delta > 3, f"平均差 {delta:.1f}")


if __name__ == "__main__":
    check_poster()
    check_page("home.png", "首页")
    check_page("result.png", "结果页")
    check_quiz_shots()

    print("通过：")
    for line in passed:
        print("  ✓ " + line)
    if problems:
        print("\n问题：")
        for line in problems:
            print("  ✗ " + line)
        sys.exit(1)
    print(f"\n全部通过（{len(passed)} 项）。")
