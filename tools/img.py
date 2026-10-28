"""图片预处理（Pillow）。
   node tools/build.mjs 会自动调用，也可以单独跑：

   python tools/img.py thumbs
       把 assets/*.jpg 缩成 assets/thumb/*.jpg（240px，图鉴列表用）
   python tools/img.py bundle
       生成 dist/assets-b64.json：{ 代号: data:image/jpeg;base64,... }，
       给单文件离线版内联用（720px，质量 72）
"""
import base64
import io
import json
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets")
CODES = [
    "SGFA", "SGFT", "SGBA", "SGBT",
    "SDFA", "SDFT", "SDBA", "SDBT",
    "UGFA", "UGFT", "UGBA", "UGBT",
    "UDFA", "UDFT", "UDBA", "UDBT",
]


def encode(name, size, quality):
    path = os.path.join(ASSETS, name + ".jpg")
    im = Image.open(path).convert("RGB")
    im = im.resize((size, size), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, format="JPEG", quality=quality, optimize=True, progressive=True)
    return buf.getvalue()


def thumbs(size=240, quality=80):
    out = os.path.join(ASSETS, "thumb")
    os.makedirs(out, exist_ok=True)
    total = 0
    for code in CODES:
        raw = encode(code, size, quality)
        with open(os.path.join(out, code + ".jpg"), "wb") as fh:
            fh.write(raw)
        total += len(raw)
    print(f"thumbs: 16 张，共 {total / 1024:.0f} KB -> assets/thumb/")


def bundle(size=720, quality=72):
    out = os.path.join(ROOT, "dist")
    os.makedirs(out, exist_ok=True)
    mapping = {}
    total = 0
    for code in CODES:
        raw = encode(code, size, quality)
        mapping[code] = "data:image/jpeg;base64," + base64.b64encode(raw).decode("ascii")
        total += len(mapping[code])
    dest = os.path.join(out, "assets-b64.json")
    with open(dest, "w", encoding="utf-8") as fh:
        json.dump(mapping, fh)
    print(f"bundle: 16 张内联数据，共 {total / 1024:.0f} KB -> dist/assets-b64.json")


def icons():
    """生成 PWA / 分享用的方形图标。"""
    from PIL import ImageDraw, ImageFont

    def render(size):
        scale = 4
        s = size * scale
        im = Image.new("RGB", (s, s), "#f6f1ea")
        d = ImageDraw.Draw(im)
        r = int(s * 0.22)
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=r, fill="#f6f1ea")
        font = None
        for name in ("msyhbd.ttc", "simhei.ttf", "arialbd.ttf"):
            try:
                font = ImageFont.truetype(name, int(s * 0.42))
                break
            except OSError:
                continue
        if font is None:
            font = ImageFont.load_default()
        text = "AI"
        box = d.textbbox((0, 0), text, font=font)
        tw, th = box[2] - box[0], box[3] - box[1]
        d.text(((s - tw) / 2 - box[0], (s - th) / 2 - box[1] - s * 0.05), text, font=font, fill="#2c2825")
        bar_w, bar_h = int(s * 0.34), int(s * 0.045)
        d.rounded_rectangle(
            [(s - bar_w) / 2, s * 0.70, (s + bar_w) / 2, s * 0.70 + bar_h],
            radius=bar_h / 2,
            fill="#d4654f",
        )
        return im.resize((size, size), Image.LANCZOS)

    for size in (180, 512):
        out = os.path.join(ASSETS, f"icon-{size}.png")
        render(size).save(out, format="PNG", optimize=True)
    print("icons: assets/icon-180.png, assets/icon-512.png")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "thumbs"
    if cmd == "thumbs":
        thumbs()
    elif cmd == "bundle":
        bundle()
    elif cmd == "icons":
        icons()
    else:
        raise SystemExit(f"未知命令 {cmd}")
