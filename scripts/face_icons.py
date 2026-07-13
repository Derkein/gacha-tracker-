#!/usr/bin/env python3
"""
Best-effort character icons for games that have no portrait source
(Wuthering Waves, Endfield, Neverness to Everness): detect the character's
face in the official banner art with an anime-face cascade and crop a circle.

Runs after enrich_icons.py and only touches games that lack an icons/<tag>.json
map. Crops are cached as icons/faces/<tag>/<slug>.webp and committed, so a daily
run only downloads/detects genuinely new banners. Banners where no face is found
keep no icon and fall back to the banner art on the site.

Requires: opencv-python-headless<5 (5.x dropped CascadeClassifier), numpy, Pillow.
"""
import json, hashlib, colorsys, urllib.request
from collections import Counter
from pathlib import Path
import cv2, numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
ICONS = ROOT / "icons"
CASCADE = str(Path(__file__).resolve().parent / "lbpcascade_animeface.xml")
UA = {"User-Agent": "Mozilla/5.0 (gacha-tracker)"}


def fetch(u):
    return urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=45).read()


def detect(img, cascade):
    """Return face boxes (x,y,w,h) at full resolution."""
    H, W = img.shape[:2]
    sc = 1000 / max(H, W) if max(H, W) > 1000 else 1.0
    sm = cv2.resize(img, (int(W * sc), int(H * sc))) if sc < 1 else img
    gray = cv2.equalizeHist(cv2.cvtColor(sm, cv2.COLOR_BGR2GRAY))
    mn = max(24, int(min(sm.shape[:2]) * 0.06))
    faces = cascade.detectMultiScale(gray, scaleFactor=1.05, minNeighbors=5, minSize=(mn, mn))
    return [(int(x / sc), int(y / sc), int(w / sc), int(h / sc)) for (x, y, w, h) in faces]


def dominant_accent(pim):
    """Pick a vivid representative color from the crop (or None if it's greyscale)."""
    q = pim.convert("RGB").resize((40, 40)).quantize(colors=8).convert("RGB")
    best, score = None, -1
    for color, cnt in Counter(q.getdata()).most_common():
        r, g, b = [v / 255 for v in color]
        h, l, s = colorsys.rgb_to_hls(r, g, b)
        sc = s * cnt * (1 if 0.2 < l < 0.85 else 0.3)
        if sc > score:
            best, score = color, sc
    if not best or (max(best) - min(best)) < 26:
        return None
    r, g, b = [v / 255 for v in best]
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    r, g, b = colorsys.hls_to_rgb(h, min(0.72, max(0.5, l)), min(1, s * 1.3))
    return "#%02x%02x%02x" % (round(r * 255), round(g * 255), round(b * 255))


def face_circle(img, box):
    x, y, bw, bh = box
    H, W = img.shape[:2]
    x = max(0, min(x, W - 1)); y = max(0, min(y, H - 1))
    side = int(min(bw, W - x, bh, H - y))
    if side < 8:
        return None
    crop = cv2.cvtColor(img[y:y + side, x:x + side], cv2.COLOR_BGR2RGB)
    pim = Image.fromarray(crop).resize((96, 96), Image.LANCZOS).convert("RGBA")
    mask = Image.new("L", (96, 96), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, 95, 95), fill=255)
    pim.putalpha(mask)
    return pim


def process(tag, cascade, force=False):
    dfile = DATA / f"{tag}.json"
    data = json.loads(dfile.read_text(encoding="utf-8"))
    outdir = ICONS / "faces" / tag
    outdir.mkdir(parents=True, exist_ok=True)
    made = kept = 0
    for b in data["banners"]:
        if b.get("icons"):            # already resolved (shouldn't happen for these tags)
            continue
        art = b.get("banner_img")
        if not art:
            continue
        slug = f"{b['start']}-{hashlib.md5(art.encode()).hexdigest()[:6]}"
        rel = f"icons/faces/{tag}/{slug}.webp"
        fpath = ROOT / rel
        if fpath.exists() and not force:
            b["icons"] = [rel]; kept += 1
            continue
        try:
            img = cv2.imdecode(np.frombuffer(fetch(art), np.uint8), cv2.IMREAD_COLOR)
            if img is None:
                continue
            faces = detect(img, cascade)
            if not faces:
                continue              # no face -> leave iconless (banner-art fallback)
            H, W = img.shape[:2]
            fx, fy, fw, fh = max(faces, key=lambda f: f[2] * f[3] * (1.3 if (f[1] + f[3] / 2) < H * 0.6 else 1.0))
            cx, cy = fx + fw / 2, fy + fh / 2
            s = int(max(fw, fh) * 1.8)
            pim = face_circle(img, (int(cx - s / 2), int(cy - s * 0.58), s, s))
            if not pim:
                continue
            pim.save(fpath, "WEBP", quality=85, method=6)
            b["icons"] = [rel]
            acc = dominant_accent(pim)
            if acc:
                b["accent"] = acc
            made += 1
        except Exception as e:
            print(f"  [{tag}] warn {b['name']}: {e}")
    dfile.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    return made, kept, len(data["banners"])


def main():
    cascade = cv2.CascadeClassifier(CASCADE)
    if cascade.empty():
        raise SystemExit("could not load cascade: " + CASCADE)
    # games that have no dedicated portrait map get the face-crop treatment
    tags = [p.stem for p in sorted(DATA.glob("*.json"))
            if p.stem != "index" and not (ICONS / f"{p.stem}.json").exists()]
    for tag in tags:
        made, kept, tot = process(tag, cascade)
        print(f"[{tag}] face icons: {made} new + {kept} cached = {made + kept}/{tot} banners")


if __name__ == "__main__":
    main()
