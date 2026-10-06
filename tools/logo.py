"""CodeCritter logo: a pixel-art Yoda head mark + a pixel wordmark, drawn as code (no source art needed).

    .venv\\Scripts\\python.exe tools\\logo.py            # writes every asset below
    .venv\\Scripts\\python.exe tools\\logo.py --sheet X  # (dev) variant comparison sheet to X.png

Outputs:
    site/public/logo-mark.svg  logo.svg (mark + wordmark)
    site/public/favicon-16.png favicon-32.png apple-touch-icon.png icon-512.png
    site/public/media/og.png + og-download.png (1200x630, both characters + new logo), icon-192.png
    docs/media/logo-yoda.png (README)

The mark is a 32x32 grid designed as the left half + mirror (so it is always symmetric); a hand-tuned 16x16
grid keeps the 16 px favicon crisp. Upscale with NEAREST only.
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
PUB = ROOT / "site" / "public"
MEDIA = ROOT / "docs" / "media"

PAL = {
    "O": (43, 58, 23, 255),  # outline
    "g": (141, 184, 90, 255),  # skin
    "s": (109, 150, 64, 255),  # skin shade
    "l": (176, 214, 120, 255),  # skin light
    "e": (201, 160, 122, 255),  # ear inner
    "E": (160, 120, 86, 255),  # ear inner shade
    "k": (42, 29, 16, 255),  # eye
    "w": (255, 244, 214, 255),  # eye white
    "h": (232, 240, 205, 255),  # hair
    "r": (138, 90, 43, 255),  # robe
    "R": (94, 59, 26, 255),  # robe shade
}
NAVY = (20, 32, 74, 255)
INK = (20, 32, 74)
GREEN = (75, 116, 36)
HAIR = {"h": PAL["h"], "m": (190, 206, 130, 255)}

# ------------------------------------------------------------------------------ the head, 32x32


def _line(x0: int, y0: int, x1: int, y1: int) -> list[tuple[int, int]]:
    pts = []
    dx, dy = abs(x1 - x0), -abs(y1 - y0)
    sx, sy = (1 if x0 < x1 else -1), (1 if y0 < y1 else -1)
    err = dx + dy
    while True:
        pts.append((x0, y0))
        if x0 == x1 and y0 == y1:
            break
        e2 = 2 * err
        if e2 >= dy:
            err += dy
            x0 += sx
        if e2 <= dx:
            err += dx
            y0 += sy
    return pts


EAR_UP = [(0, 6), (3, 6), (7, 8)]
EAR_LO = [(0, 6), (1, 9), (3, 12), (5, 14), (7, 16)]


def head32(robe: bool = True, hair: str = "h") -> Image.Image:
    g = [["."] * 16 for _ in range(32)]
    off = 3

    def put(x: int, y: int, c: str) -> None:
        if 0 <= x < 16 and 0 <= y < 32:
            g[y][x] = c

    def L(y: int) -> int:
        return y + off

    left = {4: 11, 5: 9, 6: 8}
    for y in range(7, 17):
        left[y] = 8
    left.update({17: 9, 18: 10, 19: 11, 20: 12, 21: 13})
    for y, x0 in left.items():
        for x in range(x0, 16):
            put(x, L(y), "g")
        put(x0, L(y), "O")
    for x in range(11, 16):
        put(x, L(4), "O")
    put(9, L(5), "O")
    put(10, L(5), "O")
    put(11, L(5), "g")
    for x in range(13, 16):
        put(x, L(21), "O")
    put(12, L(20), "O")
    for x, y in ((12, 5), (13, 5), (10, 6), (11, 6)):
        put(x, L(y), "l")
    for x in range(12, 16):
        put(x, L(7), "s")
    for x in range(11, 14):
        put(x, L(8), "s")
    # half-lidded eyes
    for x in range(9, 14):
        put(x, L(10), "O")
    put(9, L(11), "g")
    for x, c in ((10, "w"), (11, "k"), (12, "k"), (13, "w")):
        put(x, L(11), c)
    for x in range(10, 14):
        put(x, L(12), "s")
    put(15, L(13), "s")
    put(14, L(14), "s")
    put(15, L(14), "s")
    # gentle smile
    put(11, L(16), "O")
    for x in range(12, 16):
        put(x, L(17), "O")
    put(12, L(19), "s")
    put(13, L(19), "s")

    # ear
    def poly(pts):
        out = []
        for (a, b), (c, d) in zip(pts, pts[1:]):
            out += _line(a, L(b), c, L(d))
        return out

    up_, lo = poly(EAR_UP), poly(EAR_LO)
    top, bot = {}, {}
    for x, y in up_:
        top[x] = min(top.get(x, 99), y)
    for x, y in lo:
        bot[x] = max(bot.get(x, -1), y)
    for x in range(0, 8):
        for y in range(top[x], bot[x] + 1):
            put(x, y, "E" if (y >= bot[x] - 1 and y > top[x] + 1) else "e")
    for x, y in up_ + lo:
        put(x, y, "O")
    for y in range(7, 17):
        put(8, L(y), "O")
    # three hair wisps
    for y in range(0, 4):
        put(15, L(y), "H")
    put(13, L(2), "H")
    put(13, L(3), "H")
    put(12, L(3), "H")
    if robe:
        for x in range(10, 16):
            put(x, L(22), "O")
        for y, x0 in ((23, 8), (24, 6), (25, 5)):
            put(x0, L(y), "O")
            put(x0 + 1, L(y), "O")
            for x in range(x0 + 2, 16):
                put(x, L(y), "r")
        for x in range(4, 16):
            put(x, L(26), "O")
        put(15, L(23), "e")
        put(14, L(24), "e")
        put(15, L(24), "e")
        for x in (13, 14, 15):
            put(x, L(25), "e")
        for x in (10, 11, 12):
            put(x, L(24), "R")
    pal = dict(PAL)
    pal["H"] = HAIR[hair]
    full = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    for y in range(32):
        for x in range(16):
            c = g[y][x]
            if c != ".":
                full.putpixel((x, y), pal[c])
                full.putpixel((31 - x, y), pal[c])
    return full


H16 = [
    ".......H",
    ".......H",
    ".....OOO",
    "O...Oggg",
    "OO.Ogggg",
    "OeeOgggg",
    ".OeOOOOg",
    ".OeOwkkg",
    "..OEsgss",
    "..OOgggs",
    "...Ogggg",
    "....OgOO",
    ".....Ogg",
    "......OO",
    "........",
    "........",
]


def head16(hair: str = "h") -> Image.Image:
    pal = dict(PAL)
    pal["H"] = HAIR[hair]
    im = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    for y, r in enumerate(H16):
        for x, c in enumerate(r):
            if c != ".":
                im.putpixel((x, y), pal[c])
                im.putpixel((15 - x, y), pal[c])
    return im


# ------------------------------------------------------------------------------ badges


def rounded(n: int, fill, cut=(3, 1, 1), border=None) -> Image.Image:
    def shape(size: int, off: int, color) -> Image.Image:
        im = Image.new("RGBA", (n, n), (0, 0, 0, 0))
        px = im.load()
        for y in range(off, n - off):
            for x in range(off, n - off):
                ey, ex = min(y - off, n - 1 - off - y), min(x - off, n - 1 - off - x)
                if ey < len(cut) and ex < cut[ey]:
                    continue
                px[x, y] = color
        return im

    if not border:
        return shape(n, 0, fill)
    im = shape(n, 0, border)
    im.alpha_composite(shape(n, 2, fill))
    return im


def mark(variant: str) -> Image.Image:
    if variant == "A":  # bare head + collar, transparent
        return head32(True, "m")
    if variant == "B":  # navy badge
        n = 38
        im = rounded(n, NAVY, (3, 1, 1))
        im.alpha_composite(head32(True, "h"), (3, 5))
        return im
    if variant == "C":  # light sticker badge
        n = 38
        im = rounded(n, (231, 241, 211, 255), (3, 1, 1), border=PAL["O"])
        im.alpha_composite(head32(True, "m"), (3, 5))
        return im
    raise ValueError(variant)


# ------------------------------------------------------------------------------ wordmark

GL = {
    "C": [".####.", "#....#", "#.....", "#.....", "#.....", "#....#", ".####."],
    "o": [None, None, ".###.", "#...#", "#...#", "#...#", ".###."],
    "d": ["....#", "....#", ".####", "#...#", "#...#", "#...#", ".####"],
    "e": [None, None, ".###.", "#...#", "#####", "#....", ".####"],
    "r": [None, None, "#.##.", "##..#", "#....", "#....", "#...."],
    "i": ["#", None, "#", "#", "#", "#", "#"],
    "t": [None, ".#..", "####", ".#..", ".#..", ".#..", "..##"],
}


def wordmark(text: str = "CodeCritter", bold_from: int = 4) -> tuple[dict[tuple[int, int], str], int]:
    """{(x,y): 'a'|'b'} font pixels (7 rows) and width. Letters from bold_from on are emboldened."""
    out: dict[tuple[int, int], str] = {}
    x = 0
    for i, ch in enumerate(text):
        bold = i >= bold_from
        rows = GL[ch]
        w = max(len(r) for r in rows if r)
        for y, r in enumerate(rows):
            for dx, c in enumerate(r or ""):
                if c == "#":
                    out[(x + dx, y)] = "b" if bold else "a"
                    if bold:
                        out[(x + dx + 1, y)] = "b"
        x += w + (1 if bold else 0) + 1
    return out, x - 1


# ------------------------------------------------------------------------------ rasters


def up(im: Image.Image, k: int) -> Image.Image:
    return im.resize((im.width * k, im.height * k), Image.NEAREST)


FP = 2  # wordmark font pixel = 2 mark pixels
GAP = 4


def _word_top(n: int) -> int:
    return (n - 7 * FP) // 2


def lockup(variant: str, k: int, ink=INK, accent=GREEN) -> Image.Image:
    """Mark (n x n grid) + wordmark (font pixel = 2 grid px) on one grid, upscaled by k."""
    m = mark(variant)
    n = m.height
    px, w = wordmark()
    cv = Image.new("RGBA", (n + GAP + w * FP, n), (0, 0, 0, 0))
    cv.alpha_composite(m, (0, 0))
    d = ImageDraw.Draw(cv)
    top = _word_top(n)
    for (x, y), kind in px.items():
        c = ink if kind == "a" else accent
        x0, y0 = n + GAP + x * FP, top + y * FP
        d.rectangle([x0, y0, x0 + FP - 1, y0 + FP - 1], fill=c + (255,))
    return up(cv, k)


def svg_paths(pixels: dict[tuple[int, int], str], colors: dict[str, str]) -> str:
    """Merge horizontal runs per colour key into one <path> each."""
    by: dict[str, list[tuple[int, int, int]]] = {}
    for y in sorted({y for _, y in pixels}):
        run = None
        for x in sorted(x for (x, yy) in pixels if yy == y):
            k = pixels[(x, y)]
            if run and run[0] == k and run[2] + 1 == x:
                run[2] = x
            else:
                if run:
                    by.setdefault(run[0], []).append((run[1], y, run[2] - run[1] + 1))
                run = [k, x, x]
        if run:
            by.setdefault(run[0], []).append((run[1], y, run[2] - run[1] + 1))
    return "".join(
        f'<path fill="{colors[k]}" d="' + "".join(f"M{x} {y}h{w}v1h-{w}z" for x, y, w in rs) + '"/>' for k, rs in by.items()
    )


def mark_pixels(im: Image.Image) -> tuple[dict[tuple[int, int], str], dict[str, str]]:
    pix, cols = {}, {}
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = im.getpixel((x, y))
            if a:
                hx = f"#{r:02x}{g:02x}{b:02x}"
                cols[hx] = hx
                pix[(x, y)] = hx
    return pix, cols


def svg_mark(variant: str) -> str:
    m = mark(variant)
    pix, cols = mark_pixels(m)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {m.width} {m.height}" shape-rendering="crispEdges" '
        f'role="img" aria-label="CodeCritter">' + svg_paths(pix, cols) + "</svg>"
    )


def svg_word() -> tuple[str, int]:
    px, w = wordmark()
    return svg_paths(px, {"a": "var(--ink,#14204a)", "b": "var(--accent,#4b7424)"}), w


def svg_lockup(variant: str) -> str:
    m = mark(variant)
    n = m.height
    pix, cols = mark_pixels(m)
    wm, w = svg_word()
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {n + GAP + w * FP} {n}" shape-rendering="crispEdges" '
        f'role="img" aria-label="CodeCritter"><style>:root{{--ink:#14204a;--accent:#4b7424}}'
        f"@media (prefers-color-scheme:dark){{:root{{--ink:#e9eeff;--accent:#a9d275}}}}</style>"
        + svg_paths(pix, cols)
        + f'<g transform="translate({n + GAP} {_word_top(n)}) scale({FP})">{wm}</g></svg>'
    )


def sheet(out: Path) -> None:
    light, dark = (245, 248, 255, 255), (12, 18, 48, 255)
    sh = Image.new("RGBA", (1560, 760), light)
    sh.alpha_composite(Image.new("RGBA", (1560, 380), dark), (0, 380))
    for i, v in enumerate("ABC"):
        for row, bg in enumerate((light, dark)):
            y0 = row * 380
            m = mark(v)
            sh.alpha_composite(up(m, 6 if m.width < 40 else 5), (20 + i * 520, y0 + 10))
            ink = INK if row == 0 else (233, 238, 255)
            acc = GREEN if row == 0 else (169, 210, 117)
            sh.alpha_composite(lockup(v, 3, ink, acc), (20 + i * 520, y0 + 240))
            small = m if m.width == 32 else m.resize((32, 32), Image.BOX)
            sh.alpha_composite(small, (300 + i * 520, y0 + 20))
            sh.alpha_composite(head16() if v == "A" else m.resize((16, 16), Image.BOX), (350 + i * 520, y0 + 20))
    sh.save(out.with_suffix(".png"))


# ------------------------------------------------------------------------------ OG image + asset writer

OUT = ROOT / "tools" / "out"
BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]


def font(size: int, bold: bool = True):
    from PIL import ImageFont

    for name in ("segoeuib.ttf" if bold else "segoeui.ttf", "arialbd.ttf", "DejaVuSans-Bold.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default(size)


def dusk_plate(w: int, h: int, px: int) -> Image.Image:
    """Dithered dusk sky with hills, drawn on a px-sized pixel grid (matches the site clips)."""
    import math

    stops = [(12, 18, 48), (28, 32, 96), (59, 42, 128), (122, 61, 150), (201, 90, 154), (242, 160, 123)]
    gw, gh = w // px, h // px
    im = Image.new("RGB", (gw, gh))
    for y in range(gh):
        pos = (y / gh) * (len(stops) - 1)
        i = min(len(stops) - 2, int(pos))
        f = pos - i
        for x in range(gw):
            thr = (BAYER[y & 3][x & 3] + 0.5) / 16
            im.putpixel((x, y), stops[i + 1] if f > thr else stops[i])
    import random

    rnd = random.Random(7)
    for _ in range(40):
        im.putpixel((rnd.randrange(gw), rnd.randrange(int(gh * 0.5))), (255, 255, 255) if rnd.random() < 0.3 else (154, 164, 232))
    for x in range(gw):
        hy = round(gh * 0.80 + math.sin(x / 11) * 3 + math.sin(x / 4.3) * 1.2)
        for y in range(hy, gh):
            im.putpixel((x, y), (20, 26, 74))
    return im.resize((w, h), Image.NEAREST).convert("RGBA")


def og_image() -> Image.Image:
    W, H = 1200, 630
    bg = (245, 248, 255, 255)
    im = Image.new("RGBA", (W, H), bg)
    d = ImageDraw.Draw(im)
    for y in range(8, H, 24):
        for x in range(8, W, 24):
            d.rectangle([x, y, x + 1, y + 1], fill=(214, 224, 247, 255))
    # lockup
    lk = lockup("A", 4)
    im.alpha_composite(lk, (50, 70))
    ink = INK + (255,)
    f = font(40)
    y = 70 + lk.height + 40
    for line in ("A pixel desktop companion that", "reacts to your typing, your cursor", "and your AI coding agents."):
        d.text((74, y), line, font=f, fill=ink)
        y += 54
    # button + meta
    bx, by = 74, 470
    d.rectangle([bx + 6, by + 6, bx + 330 + 6, by + 62 + 6], fill=ink)
    d.rectangle([bx, by, bx + 330, by + 62], fill=(47, 98, 176, 255), outline=ink, width=3)
    d.text((bx + 24, by + 10), "Free and open source", font=font(27, False), fill=(255, 255, 255, 255))
    d.text((74, 565), "MIT  |  Windows  |  macOS and Linux (beta)", font=font(24, False), fill=(71, 83, 128, 255))
    # plate with both characters
    px0, py0, pw, ph = 770, 55, 382, 520
    d.rectangle([px0 + 10, py0 + 10, px0 + pw + 10, py0 + ph + 10], fill=(63, 127, 217, 255))
    plate = dusk_plate(pw, ph, 3)
    im.alpha_composite(plate, (px0, py0))
    d.rectangle([px0, py0, px0 + pw, py0 + ph], outline=ink, width=3)
    k = 3
    for c, cx in (("stitch", px0 + 96), ("yoda", px0 + 276)):
        spr = Image.open(OUT / c / "expr" / "happy.png").convert("RGBA")
        bb = spr.getbbox()
        spr = spr.crop(bb)
        spr = up(spr, k)
        im.alpha_composite(spr, (cx - spr.width // 2, py0 + ph - 30 - spr.height + 6))
    return im


def og_download_image() -> Image.Image:
    """1200x630 card for /download: Yoda logo mark + title on the left, both characters on a dusk plate."""
    W, H = 1200, 630
    im = Image.new("RGBA", (W, H), (245, 248, 255, 255))
    d = ImageDraw.Draw(im)
    for y in range(8, H, 24):
        for x in range(8, W, 24):
            d.rectangle([x, y, x + 1, y + 1], fill=(214, 224, 247, 255))
    ink = INK + (255,)
    lk = lockup("A", 4)
    im.alpha_composite(lk, (50, 70))
    d.text((74, 70 + lk.height + 36), "Download CodeCritter", font=font(54), fill=ink)
    d.text((74, 70 + lk.height + 108), "Free pixel desktop companion", font=font(34, False), fill=(71, 83, 128, 255))
    d.text((74, 70 + lk.height + 152), "for developers and AI coding agents.", font=font(34, False), fill=(71, 83, 128, 255))
    # platform pills
    x = 74
    for label in ("Windows", "macOS", "Linux"):
        f = font(28)
        w = int(d.textlength(label, font=f)) + 44
        d.rectangle([x + 5, 470 + 5, x + w + 5, 470 + 56 + 5], fill=ink)
        d.rectangle([x, 470, x + w, 470 + 56], fill=(47, 98, 176, 255), outline=ink, width=3)
        d.text((x + 22, 470 + 9), label, font=f, fill=(255, 255, 255, 255))
        x += w + 28
    d.text((74, 565), "Free and open source  |  MIT", font=font(24, False), fill=(71, 83, 128, 255))
    px0, py0, pw, ph = 770, 55, 382, 520
    d.rectangle([px0 + 10, py0 + 10, px0 + pw + 10, py0 + ph + 10], fill=(63, 127, 217, 255))
    im.alpha_composite(dusk_plate(pw, ph, 3), (px0, py0))
    d.rectangle([px0, py0, px0 + pw, py0 + ph], outline=ink, width=3)
    for c, cx in (("stitch", px0 + 96), ("yoda", px0 + 276)):
        spr = Image.open(OUT / c / "expr" / "happy.png").convert("RGBA")
        spr = up(spr.crop(spr.getbbox()), 3)
        im.alpha_composite(spr, (cx - spr.width // 2, py0 + ph - 30 - spr.height + 6))
    return im


def write_all() -> None:
    PUB.mkdir(parents=True, exist_ok=True)
    (PUB / "logo-mark.svg").write_text(svg_mark("A"), encoding="utf8")
    (PUB / "logo.svg").write_text(svg_lockup("A"), encoding="utf8")
    head16("m").save(PUB / "favicon-16.png", optimize=True)
    head32(True, "m").save(PUB / "favicon-32.png", optimize=True)
    # apple touch: full-bleed navy, head scaled 5x (iOS rounds the corners itself)
    at = Image.new("RGBA", (180, 180), NAVY)
    at.alpha_composite(up(head32(True, "h"), 5), (10, 10))
    at.save(PUB / "apple-touch-icon.png", optimize=True)
    # 512 icon: navy badge
    b = up(mark("B"), 13)
    ic = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    ic.alpha_composite(b, ((512 - b.width) // 2, (512 - b.height) // 2))
    ic.save(PUB / "icon-512.png", optimize=True)
    og_image().convert("RGB").save(PUB / "media" / "og.png", optimize=True)
    og_download_image().convert("RGB").save(PUB / "media" / "og-download.png", optimize=True)
    # 192 icon for the web manifest: same navy badge, 5x
    b192 = up(mark("B"), 5)
    i192 = Image.new("RGBA", (192, 192), (0, 0, 0, 0))
    i192.alpha_composite(b192, ((192 - b192.width) // 2, (192 - b192.height) // 2))
    i192.save(PUB / "icon-192.png", optimize=True)
    # README mark: transparent mark + wordmark lockup
    lockup("A", 8).save(MEDIA / "logo-yoda.png", optimize=True)


if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] == "--sheet":
        sheet(Path(sys.argv[2]))
    else:
        write_all()
