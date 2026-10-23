#!/usr/bin/env python3
"""
Sample each banner's most prominent color from its banner art and store it as
`bar` on the banner, so the chart bars are tinted by the actual banner artwork.

Colors are cached in icons/bar_colors.json keyed by the image URL, so a daily run
only downloads genuinely new banners. Pure stdlib + Pillow.
"""
import json, colorsys, ssl, urllib.request, urllib.error, io
from collections import Counter
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
CACHE = ROOT / "icons" / "bar_colors.json"
# games to tint (the rest are data-only and use their game accent) — avoids
# downloading ~1000 banner images for the big added catalogues.
BAR_GAMES = {"zzz", "hsr", "wuwa", "genshin", "endfield", "nte", "stellasora", "czn", "lads"}
UA = {"User-Agent": "Mozilla/5.0 (gacha-tracker)"}
_UNVERIFIED = ssl.create_default_context()
_UNVERIFIED.check_hostname = False
_UNVERIFIED.verify_mode = ssl.CERT_NONE


def fetch(url):
    if not url.startswith("http"):                 # art kept in the repo (icons/banner_art/…)
        return (ROOT / url).read_bytes()
    req = urllib.request.Request(url, headers=UA)
    try:
        return urllib.request.urlopen(req, timeout=35).read()
    except (ssl.SSLError, urllib.error.URLError) as e:
        if isinstance(e, ssl.SSLError) or isinstance(getattr(e, "reason", None), ssl.SSLError):
            return urllib.request.urlopen(req, timeout=35, context=_UNVERIFIED).read()
        raise


def prominent_color(raw):
    im = Image.open(io.BytesIO(raw)).convert("RGB").resize((64, 64))
    q = im.quantize(colors=16, method=Image.FASTOCTREE).convert("RGB")
    best, score = None, -1.0
    for color, cnt in Counter(q.getdata()).items():
        r, g, b = [v / 255 for v in color]
        _, l, s = colorsys.rgb_to_hls(r, g, b)
        # weight by frequency and saturation, penalize near-black/near-white
        sc = cnt * (s ** 1.5) * (1.0 if 0.22 < l < 0.86 else 0.2)
        if sc > score:
            best, score = color, sc
    r, g, b = [v / 255 for v in best]
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    r, g, b = colorsys.hls_to_rgb(h, min(0.70, max(0.42, l)), min(1.0, s * 1.25))
    return "#%02x%02x%02x" % (round(r * 255), round(g * 255), round(b * 255))


# Games whose art puts the character on a large coloured backdrop (Stella Sora: sky/snow
# blue on every banner; CZN: a grey sheet with an orange block behind every character).
# Sampling the whole image gives every banner the backdrop's colour, so for these only the
# character's area is sampled (box = x0,y0,x1,y1 as fractions), colours that fill the
# image's outer edge (the backdrop) are discounted, and `drop_hue` skips a template colour.
CHAR_SAMPLE = {
    "stellasora": {"box": (0.20, 0.08, 0.56, 0.96)},                  # character left-centre, title right
    "czn":        {"box": (0.24, 0.12, 0.80, 0.78), "drop_hue": (0.04, 0.115)},   # template orange
}


def _dist(a, b):
    return sum((x - y) ** 2 for x, y in zip(a, b)) ** 0.5


def character_color(raw, box, drop_hue=None):
    im = Image.open(io.BytesIO(raw)).convert("RGB")
    W, H = im.size
    # backdrop palette: the outer 7% frame of the image
    small = im.resize((96, 96))
    k = 7
    frame = [small.getpixel((x, y)) for y in range(96) for x in range(96)
             if x < k or y < k or x >= 96 - k or y >= 96 - k]
    fr = Image.new("RGB", (len(frame), 1)); fr.putdata(frame)
    fq = Counter(fr.quantize(colors=8, method=Image.FASTOCTREE).convert("RGB").getdata())
    backdrop = [c for c, n in fq.items() if n / len(frame) > 0.06]
    crop = im.crop((int(box[0] * W), int(box[1] * H), int(box[2] * W), int(box[3] * H))).resize((64, 64))
    q = crop.quantize(colors=20, method=Image.FASTOCTREE).convert("RGB")
    best, score = None, -1.0
    for color, cnt in Counter(q.getdata()).items():
        r, g, b = [v / 255 for v in color]
        h, l, s = colorsys.rgb_to_hls(r, g, b)
        sc = cnt * (s ** 1.5) * (1.0 if 0.22 < l < 0.86 else 0.2)
        if any(_dist(color, c) < 64 for c in backdrop):
            sc *= 0.03                                     # the backdrop showing through
        if drop_hue and drop_hue[0] <= h <= drop_hue[1] and s > 0.55:
            continue                                       # the art template's own colour
        if (h < 0.11 or h > 0.97) and l > 0.58 and s < 0.75:
            sc *= 0.12                                     # skin: the character, but not their colour
        if sc > score:
            best, score = color, sc
    r, g, b = [v / 255 for v in (best or (128, 128, 128))]
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    r, g, b = colorsys.hls_to_rgb(h, min(0.70, max(0.42, l)), min(1.0, s * 1.25))
    return "#%02x%02x%02x" % (round(r * 255), round(g * 255), round(b * 255))


def main():
    cache = json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {}
    new = 0
    for dfile in sorted(DATA.glob("*.json")):
        if dfile.stem not in BAR_GAMES:
            continue
        data = json.loads(dfile.read_text(encoding="utf-8"))
        for b in data["banners"]:
            url = b.get("banner_img")
            if not url:
                continue
            cs = CHAR_SAMPLE.get(dfile.stem)
            key = url + "#char" if cs else url
            if key not in cache:
                try:
                    raw = fetch(url)
                    cache[key] = character_color(raw, cs["box"], cs.get("drop_hue")) if cs else prominent_color(raw)
                    new += 1
                except Exception as e:
                    print(f"  [{dfile.stem}] {b['name']}: {e}")
                    continue
            b["bar"] = cache[key]
        dfile.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"bar colors: {new} new, {len(cache)} cached")


if __name__ == "__main__":
    main()
