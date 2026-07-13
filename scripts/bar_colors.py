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
UA = {"User-Agent": "Mozilla/5.0 (gacha-tracker)"}
_UNVERIFIED = ssl.create_default_context()
_UNVERIFIED.check_hostname = False
_UNVERIFIED.verify_mode = ssl.CERT_NONE


def fetch(url):
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


def main():
    cache = json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {}
    new = 0
    for dfile in sorted(DATA.glob("*.json")):
        if dfile.stem == "index":
            continue
        data = json.loads(dfile.read_text(encoding="utf-8"))
        for b in data["banners"]:
            url = b.get("banner_img")
            if not url:
                continue
            if url not in cache:
                try:
                    cache[url] = prominent_color(fetch(url))
                    new += 1
                except Exception as e:
                    print(f"  [{dfile.stem}] {b['name']}: {e}")
                    continue
            b["bar"] = cache[url]
        dfile.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"bar colors: {new} new, {len(cache)} cached")


if __name__ == "__main__":
    main()
