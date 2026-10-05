"""Build every generated image asset from the sprite export.

    npm run sprites:export                      # renders tools/out/ with the real engine (Node)
    .venv\\Scripts\\python.exe tools\\make_icons.py   # (or .venv/bin/python) -> assets below

Outputs (all committed):
    build/icon.png (1024) build/icon-512.png build/icon.ico (16-256) build/icon.icns
    resources/tray/{stitch,yoda}-{16,32}.png + @2x, and {stitch,yoda}Template[@2x].png (macOS template images)
    docs/media/*.png (logo, hero, expression galleries) and docs/media/*.gif (idle / knead / hop / sleep)

Scaling policy: upscale with NEAREST only (crisp pixels); downscale with BOX (area average).
"""

from __future__ import annotations

import json
import struct
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "tools" / "out"
BUILD = ROOT / "build"
TRAY = ROOT / "resources" / "tray"
MEDIA = ROOT / "docs" / "media"
for d in (BUILD, TRAY, MEDIA):
    d.mkdir(parents=True, exist_ok=True)

MANIFEST = json.loads((OUT / "manifest.json").read_text())
CHARS = ("stitch", "yoda")
# head crop boxes in the 64x72 frame (left, top, right, bottom); padded to a square later
HEAD_BOX = {"stitch": (8, 24, 56, 57), "yoda": (0, 27, 64, 53)}
ICON_BG = {"stitch": (27, 42, 92, 255), "yoda": (43, 58, 23, 255)}
PAGE_BG = (38, 42, 56, 255)


def frame(char: str, group: str, name: str) -> Image.Image:
    return Image.open(OUT / char / group / f"{name}.png").convert("RGBA")


def square_head(char: str, expr: str = "happy") -> Image.Image:
    """Head crop padded (transparent) to a tight square, centred."""
    im = frame(char, "expr", expr).crop(HEAD_BOX[char])
    side = max(im.width, im.height) + 2
    sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    sq.alpha_composite(im, ((side - im.width) // 2, (side - im.height) // 2))
    return sq


def fit(im: Image.Image, px: int) -> Image.Image:
    """Resize a square pixel image to px: NEAREST up by an integer factor, then BOX down if needed."""
    if px == im.width:
        return im.copy()
    if px < im.width:
        return im.resize((px, px), Image.BOX)
    k = -(-px // im.width)
    up = im.resize((im.width * k, im.height * k), Image.NEAREST)
    return up if up.width == px else up.resize((px, px), Image.BOX)


def rounded_bg(px: int, color: tuple[int, int, int, int], radius: float = 0.22) -> Image.Image:
    ss = 4  # supersample the mask for clean corners
    mask = Image.new("L", (px * ss, px * ss), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, px * ss - 1, px * ss - 1), radius=int(px * ss * radius), fill=255)
    mask = mask.resize((px, px), Image.LANCZOS)
    bg = Image.new("RGBA", (px, px), color)
    bg.putalpha(mask)
    return bg


def app_icon(px: int, char: str = "stitch") -> Image.Image:
    bg = rounded_bg(px, ICON_BG[char])
    head = fit(square_head(char), round(px * 0.80))
    bg.alpha_composite(head, ((px - head.width) // 2, (px - head.height) // 2 + round(px * 0.02)))
    return bg


def png_bytes(im: Image.Image) -> bytes:
    b = BytesIO()
    im.save(b, "PNG", optimize=True)
    return b.getvalue()


def write_ico(path: Path, images: dict[int, Image.Image]) -> None:
    """ICO with PNG-compressed entries (so each size is rendered crisply instead of resampled by Pillow)."""
    entries = [(s, png_bytes(im)) for s, im in sorted(images.items())]
    out = bytearray(struct.pack("<HHH", 0, 1, len(entries)))
    offset = 6 + 16 * len(entries)
    for size, data in entries:
        out += struct.pack("<BBBBHHII", size % 256, size % 256, 0, 0, 1, 32, len(data), offset)
        offset += len(data)
    for _, data in entries:
        out += data
    path.write_bytes(bytes(out))


def write_icns(path: Path, images: dict[str, Image.Image]) -> None:
    body = b""
    for kind, im in images.items():
        data = png_bytes(im)
        body += kind.encode("ascii") + struct.pack(">I", len(data) + 8) + data
    path.write_bytes(b"icns" + struct.pack(">I", len(body) + 8) + body)


def template_silhouette(im: Image.Image) -> Image.Image:
    """macOS menu-bar template image: black where the sprite is, near-black features (eyes) cut out."""
    out = Image.new("RGBA", im.size, (0, 0, 0, 0))
    px, dst = im.load(), out.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            lum = 0.299 * r + 0.587 * g + 0.114 * b
            if a > 40 and lum >= 30:
                dst[x, y] = (0, 0, 0, a)
    return out


def build_icons() -> None:
    master = app_icon(1024)
    master.save(BUILD / "icon.png", optimize=True)
    app_icon(512).save(BUILD / "icon-512.png", optimize=True)
    write_ico(BUILD / "icon.ico", {s: app_icon(s) for s in (16, 24, 32, 48, 64, 128, 256)})
    write_icns(
        BUILD / "icon.icns",
        {"icp4": app_icon(16), "icp5": app_icon(32), "icp6": app_icon(64), "ic07": app_icon(128),
         "ic08": app_icon(256), "ic09": app_icon(512), "ic10": app_icon(1024)},
    )
    for c in CHARS:
        head = square_head(c, "neutral")
        for base in (16, 32):
            fit(head, base).save(TRAY / f"{c}-{base}.png", optimize=True)
            fit(head, base * 2).save(TRAY / f"{c}-{base}@2x.png", optimize=True)
        template_silhouette(fit(head, 16)).save(TRAY / f"{c}Template.png", optimize=True)
        template_silhouette(fit(head, 32)).save(TRAY / f"{c}Template@2x.png", optimize=True)


# ----------------------------------------------------------------------------- README media


def font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for name in ("segoeui.ttf", "arial.ttf", "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default(size)


def on_bg(im: Image.Image, scale: int, bg=PAGE_BG) -> Image.Image:
    big = im.resize((im.width * scale, im.height * scale), Image.NEAREST)
    base = Image.new("RGBA", big.size, bg)
    base.alpha_composite(big)
    return base


def logo() -> None:
    sheet = Image.new("RGBA", (640, 320), (0, 0, 0, 0))
    sheet.alpha_composite(rounded_bg(640, PAGE_BG, 0.12).crop((0, 0, 640, 320)))
    for i, c in enumerate(CHARS):
        head = fit(square_head(c), 256)
        sheet.alpha_composite(head, (60 + i * 264, 32))
    sheet.save(MEDIA / "logo.png", optimize=True)


def gallery(char: str) -> None:
    names = [e["name"] for e in MANIFEST["entries"] if e["character"] == char and e["group"] == "expr"]
    cols, scale = 6, 3
    w, h = MANIFEST["frame"]["w"] * scale, MANIFEST["frame"]["h"] * scale
    label_h, pad = 26, 10
    rows = -(-len(names) // cols)
    sheet = Image.new("RGBA", (cols * (w + pad) + pad, rows * (h + label_h + pad) + pad), PAGE_BG)
    d = ImageDraw.Draw(sheet)
    f = font(15)
    for i, n in enumerate(names):
        x = pad + (i % cols) * (w + pad)
        y = pad + (i // cols) * (h + label_h + pad)
        sheet.alpha_composite(frame(char, "expr", n).resize((w, h), Image.NEAREST), (x, y))
        tw = d.textlength(n, font=f)
        d.text((x + (w - tw) / 2, y + h + 4), n, fill=(220, 224, 235, 255), font=f)
    sheet.save(MEDIA / f"gallery-{char}.png", optimize=True)


def anim_frames(char: str, prefix: str) -> list[tuple[Image.Image, int]]:
    es = [e for e in MANIFEST["entries"] if e["character"] == char and e["group"] == "anim" and e["name"].startswith(prefix + "_")]
    return [(frame(char, "anim", e["name"]), e.get("ms", 100)) for e in es]


def draw_zzz(im: Image.Image, step: int) -> Image.Image:
    """Pixel 'z' glyphs floating up from the head (sleep animation); drawn on the 64x72 frame."""
    im = im.copy()
    px = im.load()
    z = ["#####", "   # ", "  #  ", " #   ", "#####"]
    small = ["###", " # ", "###"]
    for n, (glyph, x, y) in enumerate(((small, 44, 38), (z, 49, 30), (small, 56, 22))):
        age = (step - n) % 6
        if age > 3:
            continue
        for j, row in enumerate(glyph):
            for i, ch in enumerate(row):
                xx, yy = x + i - age // 2, y + j - age
                if ch == "#" and 0 <= xx < im.width and 0 <= yy < im.height:
                    px[xx, yy] = (235, 240, 255, 255)
    return im


def expand(frames: list[tuple[Image.Image, int]], step: int = 10) -> list[Image.Image]:
    """Time-expand variable-duration frames to a fixed step (so two timelines can be combined)."""
    out: list[Image.Image] = []
    for im, ms in frames:
        out += [im] * max(1, round(ms / step))
    return out


def save_gif(path: Path, frames: list[Image.Image], ms: int, scale: int = 4) -> None:
    rgb = [on_bg(f, scale).convert("RGB").convert("P", palette=Image.ADAPTIVE, colors=64) for f in frames]
    rgb[0].save(path, save_all=True, append_images=rgb[1:], duration=ms, loop=0, optimize=False, disposal=1)


def gifs() -> None:
    for c in CHARS:
        for name in ("idle", "knead", "hop"):
            fr = anim_frames(c, name)
            # variable durations: write each frame with its own duration
            rgb = [on_bg(im, 4).convert("RGB").convert("P", palette=Image.ADAPTIVE, colors=64) for im, _ in fr]
            rgb[0].save(MEDIA / f"{c}-{name}.gif", save_all=True, append_images=rgb[1:],
                        duration=[ms for _, ms in fr], loop=0, disposal=1)
        sl = anim_frames(c, "sleep")
        rgb = [on_bg(draw_zzz(im, i), 4).convert("RGB").convert("P", palette=Image.ADAPTIVE, colors=64)
               for i, (im, _) in enumerate(sl)]
        rgb[0].save(MEDIA / f"{c}-sleep.gif", save_all=True, append_images=rgb[1:],
                    duration=[ms for _, ms in sl], loop=0, disposal=1)

    # hero: both characters side by side; idle twice, then a done-hop each cycle
    def timeline(char: str) -> list[Image.Image]:
        return expand(anim_frames(char, "idle") * 2 + anim_frames(char, "hop"), 20)

    a, b = timeline("stitch"), timeline("yoda")
    n = max(len(a), len(b))
    a += [a[-1]] * (n - len(a))
    b += [b[-1]] * (n - len(b))
    w, h = MANIFEST["frame"]["w"], MANIFEST["frame"]["h"]
    combined = []
    for x, y in zip(a, b):
        im = Image.new("RGBA", (w * 2 + 8, h), (0, 0, 0, 0))
        im.alpha_composite(x, (0, 0))
        im.alpha_composite(y, (w + 8, 0))
        combined.append(im)
    save_gif(MEDIA / "hero.gif", combined, 20, scale=5)


def hero_png() -> None:
    w, h = MANIFEST["frame"]["w"], MANIFEST["frame"]["h"]
    im = Image.new("RGBA", (w * 2 + 8, h), (0, 0, 0, 0))
    im.alpha_composite(frame("stitch", "expr", "happy"), (0, 0))
    im.alpha_composite(frame("yoda", "expr", "happy"), (w + 8, 0))
    on_bg(im, 5).save(MEDIA / "hero.png", optimize=True)


if __name__ == "__main__":
    build_icons()
    logo()
    hero_png()
    for c in CHARS:
        gallery(c)
    gifs()
    print("icons + media written to build/, resources/tray/, docs/media/")
