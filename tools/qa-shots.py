"""对 Chrome 截图做像素级核对（没有视觉能力时用几何与像素统计代替肉眼）。
   跑法：python tools/qa-shots.py
"""
import os
import sys

from PIL import Image, ImageChops, ImageStat

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, "shots")
POSTER_W, POSTER_H = 1080, 1920

problems = []
passed = []


def note(label, ok, detail=""):
    (passed if ok else problems).append(f"{label}{('  [' + str(detail) + ']') if detail else ''}")


def load(name):
    path = os.path.join(SHOTS, name)
    if not os.path.exists(path):
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


def text_rows(im, box, min_ink=0.012):
    """逐行统计墨迹，返回“像一行字”的行数，用来确认各个文字块真的画出来了。"""
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


def variance(im, box):
    return sum(ImageStat.Stat(im.crop(box)).stddev) / 3


def check_poster():
    im = load("poster.png")
    if im is None:
        problems.append("缺 shots/poster.png")
        return
    note("长图尺寸 1080×1920", im.size == (1080, 1920), im.size)

    # 卡片是浅底，页面底是深一点的米灰：四角应当是页面底色
    corner = im.getpixel((8, 8))
    note("四角是页面底色", sum(corner) > 560, corner)

    # 插画区（卡片上半部分）必须有内容且是暖色
    art = (60, 140, 1020, 1000)
    art_var = variance(im, art)
    art_mean = ImageStat.Stat(im.crop(art)).mean
    note("插画区有内容", art_var > 18, f"stddev {art_var:.0f}")
    note("插画区是暖色", art_mean[0] > art_mean[2], [round(v) for v in art_mean])

    # 文字区（插画下方到卡片底部）应有明显的深色笔画，且能数出多行文字块
    text_ink = ink_ratio(im, (100, 1040, 980, 1700))
    note("正文文字已渲染", text_ink > 0.015, f"墨迹占比 {text_ink:.3f}")
    rows = text_rows(im, (100, 1040, 980, 1700))
    note("正文有多个文字块", rows >= 6, f"文字行块 {rows}")

    # 页脚一行标语
    foot_ink = ink_ratio(im, (200, 1746, 900, 1848))
    note("页脚标语已渲染", foot_ink > 0.01, f"墨迹占比 {foot_ink:.3f}")

    # 二维码：左下角块（新版式 112px @ y=1746），黑白分明且有棋盘感
    qr = im.crop((50, 1740, 200, 1900)).convert("L")
    px = qr.load()
    w, h = qr.size
    vals = [px[x, y] for y in range(h) for x in range(w)]
    dark = sum(1 for v in vals if v < 128) / len(vals)
    note("二维码黑白比例正常", 0.18 < dark < 0.70, f"深色 {dark:.3f}")
    flips = sum(1 for y in range(h) for x in range(1, w) if (px[x, y] < 128) != (px[x - 1, y] < 128))
    per_row = flips / h
    note("二维码呈模块交替（非纯色块）", per_row > 6, f"每行平均跳变 {per_row:.1f}")

    # 页脚内容不许被画布底边裁掉
    tail = im.crop((0, POSTER_H - 4, POSTER_W, POSTER_H)).convert("L")
    tail_dark = sum(1 for v in tail.getdata() if v < 200)
    note("页脚没有被底边裁切", tail_dark < 40, f"最底 4 行深色像素 {tail_dark}")

    # 卡片底部不能溢出：卡片外（y>1720 的两侧）不该有卡片白
    left_strip = im.getpixel((20, 1700))
    right_strip = im.getpixel((1060, 1700))
    note("卡片没有横向溢出", sum(left_strip) < 740 and sum(right_strip) < 740, [left_strip, right_strip])


def check_page(name, label):
    im = load(name)
    if im is None:
        problems.append(f"缺 shots/{name}")
        return
    note(f"{label} 渲染成功", im.size[0] > 300 and im.size[1] > 600, im.size)
    std = sum(ImageStat.Stat(im).stddev) / 3
    note(f"{label} 不是空白页", std > 12, f"stddev {std:.0f}")
    # 不该出现「整页只剩一段提示文字」：纯白与近白不该占满全屏
    white = near_white_ratio(im, (0, 0, im.size[0], im.size[1]))
    note(f"{label} 不是大面积空白", white < 0.90, f"近白占比 {white:.3f}")


def check_atlas():
    im = load("home.png")
    if im is None:
        return
    # 图鉴 4×4 网格：找彩色小块（饱和度高、彼此不同）来确认 16 张缩略图都加载了
    small = im.resize((im.size[0] // 4, im.size[1] // 4))
    px = list(small.getdata())
    colorful = sum(1 for r, g, b in px if max(r, g, b) - min(r, g, b) > 18 and 60 < (r + g + b) / 3 < 240)
    note("首页有插画色彩（图鉴已加载）", colorful > 500, f"彩色像素 {colorful}")


if __name__ == "__main__":
    check_poster()
    check_page("home.png", "首页")
    check_page("result.png", "结果页")
    check_atlas()

    print("通过：")
    for line in passed:
        print("  ✓ " + line)
    if problems:
        print("\n问题：")
        for line in problems:
            print("  ✗ " + line)
        sys.exit(1)
    print(f"\n全部通过（{len(passed)} 项）。")
