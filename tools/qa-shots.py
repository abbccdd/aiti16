"""对 Chrome 截图做像素级核对（机器专用版）。
   跑法：python tools/shots.mjs && python tools/qa-shots.py
   验的是：机器屏没有可点控件、红框真的是红的、旁观屏有按钮式选项和选中态、结果页与长图正常。
"""
import os
import sys

from PIL import Image, ImageChops, ImageStat

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, "shots")
POSTER_W, POSTER_H = 1080, 1920
FOOT_H = 236
CONTENT_BOTTOM = POSTER_H - FOOT_H
RED = (217, 48, 37)

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


def color_ratio(im, box, target, tol=26):
    crop = im.crop(box)
    px = list(crop.getdata())
    hit = sum(1 for r, g, b in px if abs(r - target[0]) <= tol and abs(g - target[1]) <= tol and abs(b - target[2]) <= tol)
    return hit / max(1, len(px))


def variance(im, box):
    return sum(ImageStat.Stat(im.crop(box)).stddev) / 3


def text_rows(im, box, min_ink=0.012, threshold=120):
    crop = im.crop(box).convert("L")
    w, h = crop.size
    px = crop.load()
    rows, run = 0, 0
    for y in range(h):
        ink = sum(1 for x in range(0, w, 2) if px[x, y] < threshold) / (w / 2)
        if ink >= min_ink:
            run += 1
        else:
            if run >= 6:
                rows += 1
            run = 0
    if run >= 6:
        rows += 1
    return rows


def check_display():
    im = load("display.png")
    if im is None:
        return
    note("机器屏尺寸正常", im.size == (390, 844), im.size)
    note("机器屏白底", near_white_ratio(im, (0, 0, 390, 844)) > 0.6, f"{near_white_ratio(im, (0, 0, 390, 844)):.2f}")
    # 顶部黑色状态条：STANDBY 那块
    note("顶部有黑色状态条", color_ratio(im, (20, 105, 370, 150), (17, 17, 19), 18) > 0.5,
         f"{color_ratio(im, (20, 105, 370, 150), (17, 17, 19), 18):.2f}")
    note("标题区有文字", text_rows(im, (20, 160, 370, 260)) >= 2, f"{text_rows(im, (20, 160, 370, 260))} 行块")
    code_ink = ink_ratio(im, (20, 330, 370, 540))
    note("接口代码块存在", code_ink > 0.008 and text_rows(im, (20, 330, 370, 540)) >= 2, f"墨迹 {code_ink:.3f}")
    # 机器屏上不应该出现红框
    note("机器屏没有红框", color_ratio(im, (0, 0, 390, 844), RED, 24) < 0.02, f"{color_ratio(im, (0, 0, 390, 844), RED, 24):.3f}")


def check_caught():
    im = load("caught.png")
    display = load("display.png")
    if im is None:
        return
    note("被抓截图尺寸正常", im.size == (390, 844), im.size)
    red_ratio = color_ratio(im, (0, 200, 390, 340), RED, 26)
    note("红框真的出现了（红色头带）", red_ratio > 0.25, f"{red_ratio:.2f}")
    # 页面被压暗：角落像素应该明显比机器屏暗
    scrim = im.getpixel((6, 700))
    base = display.getpixel((6, 700)) if display else (255, 255, 255)
    note("背景被压暗（有遮罩）", sum(scrim) < sum(base) - 60, f"{base} → {scrim}")
    note("红框里有文字", text_rows(im, (40, 330, 350, 560)) >= 3, f"{text_rows(im, (40, 330, 350, 560))} 行块")


def check_spectator():
    im = load("spectator.png")
    if im is None:
        return
    note("旁观屏尺寸正常", im.size == (390, 844), im.size)
    # 选项卡片的权威计数在 qa-e2e 里用 DOM 断言；这里只确认这块区域确实画了 4 张卡片
    # （未选中的卡片带 opacity 0.45，所以阈值放宽到 170）
    opt_rows = text_rows(im, (20, 200, 370, 590), threshold=170)
    note("旁观屏画出了 4 张选项卡片", opt_rows >= 6, f"文字行块 {opt_rows}")
    # 选中卡片是黑描边：在选项区域找接近墨色的像素
    dark = ink_ratio(im, (20, 380, 370, 480), threshold=60)
    note("有一张卡片是黑描边（选中态）", dark > 0.02, f"深色占比 {dark:.3f}")
    note("底部有机器思考流", text_rows(im, (20, 600, 370, 800)) >= 3, f"{text_rows(im, (20, 600, 370, 800))} 行块")
    note("旁观屏没有红框", color_ratio(im, (0, 0, 390, 844), RED, 24) < 0.02, f"{color_ratio(im, (0, 0, 390, 844), RED, 24):.3f}")


def check_result():
    im = load("result.png")
    if im is None:
        return
    note("结果页渲染成功", im.size[0] == 390 and im.size[1] > 900, im.size)
    note("结果页有插画", variance(im, (100, 150, 290, 340)) > 15, f"stddev {variance(im, (100, 150, 290, 340)):.0f}")
    note("结果页有条形图", text_rows(im, (20, 380, 370, 760)) >= 4, f"{text_rows(im, (20, 380, 370, 760))} 行块")
    note("结果页无横向溢出痕迹", near_white_ratio(im, (384, 0, 390, im.size[1])) > 0.9, "右边 6px 应为白")


def check_poster():
    im = load("poster.png")
    if im is None:
        return
    note("长图尺寸 1080×1920", im.size == (1080, 1920), im.size)
    art = (150, 70, 930, 860)
    note("插画区有内容", variance(im, art) > 18, f"stddev {variance(im, art):.0f}")
    body = (60, 900, 1020, CONTENT_BOTTOM)
    note("正文文字已渲染", ink_ratio(im, body) > 0.015, f"{ink_ratio(im, body):.3f}")
    note("正文有多个文字块", text_rows(im, body) >= 5, f"{text_rows(im, body)} 行块")
    foot_top = CONTENT_BOTTOM + 30
    qr = im.crop((50, foot_top - 10, 200, foot_top + 140)).convert("L")
    px = qr.load()
    w, h = qr.size
    flips = sum(1 for y in range(h) for x in range(1, w) if (px[x, y] < 128) != (px[x - 1, y] < 128))
    note("二维码呈模块交替", flips / h > 6, f"每行跳变 {flips / h:.1f}")
    tail = im.crop((0, POSTER_H - 4, POSTER_W, POSTER_H)).convert("L")
    note("页脚没有被底边裁切", sum(1 for v in tail.getdata() if v < 200) < 40)


if __name__ == "__main__":
    check_display()
    check_caught()
    check_spectator()
    check_result()
    check_poster()

    print("通过：")
    for line in passed:
        print("  ✓ " + line)
    if problems:
        print("\n问题：")
        for line in problems:
            print("  ✗ " + line)
        sys.exit(1)
    print(f"\n全部通过（{len(passed)} 项）。")
