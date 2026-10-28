"""生成社交分享封面 og.png（1200×630），纯 Pillow，不依赖浏览器。
   跑法：python tools/og.py
"""
import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets")
W, H = 1200, 630

INK = (44, 40, 37)
MUTED = (107, 97, 87)
FAINT = (156, 145, 135)
ACCENT = (212, 101, 79)
GREEN = (63, 107, 86)
PAPER = (246, 241, 234)

SERIF = "STZHONGS.TTF"
SANS = "msyh.ttc"
SANS_BD = "msyhbd.ttc"


def font(name, size):
    for candidate in (name, os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts", name)):
        try:
            return ImageFont.truetype(candidate, size)
        except OSError:
            continue
    raise SystemExit(f"缺少字体 {name}")


def background():
    """小图算渐变再放大，得到柔和的暖色底。"""
    sw, sh = 120, 63
    small = Image.new("RGB", (sw, sh), PAPER)
    px = small.load()
    glows = [
        (0.02, -0.15, 0.72, (251, 224, 205), 1.0),   # 左上暖
        (1.04, 0.10, 0.62, (226, 238, 228), 0.95),   # 右上绿
        (0.52, 1.05, 0.55, (240, 232, 221), 0.7),    # 底部
    ]
    for y in range(sh):
        for x in range(sw):
            r, g, b = PAPER
            base_x, base_y = x / (sw - 1), y / (sh - 1)
            for cx, cy, radius, color, strength in glows:
                d = ((base_x - cx) ** 2 + (base_y - cy) ** 2) ** 0.5
                t = max(0.0, 1.0 - d / radius) ** 2 * strength
                r = int(r + (color[0] - r) * t)
                g = int(g + (color[1] - g) * t)
                b = int(b + (color[2] - b) * t)
            px[x, y] = (r, g, b)
    return small.resize((W, H), Image.LANCZOS)


def shadowed_rounded(base, box, radius, fill, blur=18, offset=(0, 14), alpha=42):
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    x0, y0, x1, y1 = box
    d.rounded_rectangle(
        [x0 + offset[0], y0 + offset[1], x1 + offset[0], y1 + offset[1]],
        radius=radius,
        fill=(78, 52, 32, alpha),
    )
    layer = layer.filter(ImageFilter.GaussianBlur(blur))
    base.alpha_composite(layer)
    d2 = ImageDraw.Draw(base)
    d2.rounded_rectangle(list(box), radius=radius, fill=fill)


def rounded_photo(path, size, radius, angle):
    im = Image.open(path).convert("RGB").resize((size, size), Image.LANCZOS)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    tile = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    tile.paste(im, (0, 0), mask)
    tile = tile.rotate(angle, resample=Image.BICUBIC, expand=True)
    return tile


def main():
    base = background().convert("RGBA")
    d = ImageDraw.Draw(base)

    # 左栏
    kicker_font = font(SANS_BD, 20)
    kicker = "机器专用 · 人类点不动"
    kw = d.textbbox((0, 0), kicker, font=kicker_font)
    kw = kw[2] - kw[0]
    shadowed_rounded(base, (72, 104, 72 + kw + 34, 148), 22, (255, 253, 251, 255), blur=14, offset=(0, 8), alpha=26)
    d = ImageDraw.Draw(base)
    d.text((72 + 17, 114), kicker, font=kicker_font, fill=ACCENT)

    title_font = font(SERIF, 78)
    d.text((70, 176), "测测你的 AI", font=title_font, fill=INK)
    d.text((70, 268), "是什么性格", font=title_font, fill=INK)

    sub_font = font(SANS, 25)
    d.text((72, 386), "16 道情境题，只考 AI。", font=sub_font, fill=MUTED)
    d.text((72, 424), "人类点一下就被判定出局。", font=sub_font, fill=MUTED)

    chip_font = font(SERIF, 30)
    x = 72
    for codes in ("SGBA", "UDBT", "SDFT", "UGFA"):
        box = d.textbbox((0, 0), codes, font=chip_font)
        cw, ch = box[2] - box[0], box[3] - box[1]
        w = cw + 40
        shadowed_rounded(base, (x, 490, x + w, 490 + 52), 14, (255, 253, 251, 255), blur=12, offset=(0, 6), alpha=22)
        d = ImageDraw.Draw(base)
        d.text((x + 20 - box[0], 490 + 9), codes, font=chip_font, fill=GREEN)
        x += w + 14

    # 右栏 2×2 插画
    size, gap = 207, 16
    left = W - 72 - (size * 2 + gap)
    top = int((H - (size * 2 + gap)) / 2)
    tiles = [
        ("UDBT", left, top, -3),
        ("SGBA", left + size + gap, top - 10, 2.5),
        ("SDFT", left, top + size + gap + 8, 2),
        ("UGFA", left + size + gap, top + size + gap, -2),
    ]
    for code, tx, ty, angle in tiles:
        tile = rounded_photo(os.path.join(ASSETS, code + ".jpg"), size, 26, angle)
        shadow = Image.new("RGBA", base.size, (0, 0, 0, 0))
        sd = ImageDraw.Draw(shadow)
        sd.rounded_rectangle(
            [tx - 6, ty + 14, tx + size + 6, ty + size + 26], radius=30, fill=(78, 52, 32, 60)
        )
        shadow = shadow.filter(ImageFilter.GaussianBlur(20))
        base.alpha_composite(shadow)
        base.alpha_composite(tile, (tx - (tile.width - size) // 2, ty - (tile.height - size) // 2))

    d = ImageDraw.Draw(base)
    foot_font = font(SANS, 21)
    d.text((72, H - 62), "abbccdd.github.io/aiti16", font=foot_font, fill=FAINT)
    brand_font = font(SANS_BD, 21)
    bbox = d.textbbox((0, 0), "AITI-16", font=brand_font)
    d.text((W - 72 - (bbox[2] - bbox[0]), H - 62), "AITI-16", font=brand_font, fill=FAINT)

    out = os.path.join(ROOT, "og.png")
    base.convert("RGB").save(out, format="PNG", optimize=True)
    print(f"og.png {W}×{H} -> {out} ({os.path.getsize(out) / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
