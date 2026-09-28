#!/usr/bin/env python3
"""
Detect each banner's main character face and record a focus point, so the Compare
collage can crop toward the face instead of slicing through it.

For every banner in every game's data file we grab its art (`banner_img`), run an
anime-face detector over it, pick the most prominent face (biggest, upper-biased —
the headliner is drawn largest and highest), and store the face centre as a percent
of the image plus the image's natural size. The result goes to data/banner_focus.json,
keyed by game -> banner name, which the site loads to place every crop.

Deterministic + incremental: an entry is reused unless its `src` (the banner_img)
changed, so re-running only touches new / re-arted banners. Detection failures fall
back to a sensible centre-top default (det:false) — the site keeps a small manual
face-override map for the handful the detector gets wrong (turned heads, hidden eyes).

Requires OpenCV *4.x* for CascadeClassifier (OpenCV 5 removed it). If the system cv2
lacks it we add a sibling scripts/.face_cv2 install to the path (see .gitignore).
"""
import json, sys, ssl, hashlib, urllib.request, urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "scripts"
DATA = ROOT / "data"
CASCADE = SCRIPTS / "lbpcascade_animeface.xml"
OUT = DATA / "banner_focus.json"
IMG_CACHE = SCRIPTS / ".focus_imgcache"          # downloaded bytes, keyed by URL hash (gitignored)
GAMES = ["zzz", "hsr", "wuwa", "genshin", "endfield", "nte", "uma"]

# OpenCV 5 dropped CascadeClassifier; fall back to the local 4.x install if needed.
import cv2
if not hasattr(cv2, "CascadeClassifier"):        # OpenCV 5 — swap in the local 4.x
    for m in [k for k in sys.modules if k == "cv2" or k.startswith("cv2.")]:
        del sys.modules[m]
    sys.path.insert(0, str(SCRIPTS / ".face_cv2"))
    import cv2
    if not hasattr(cv2, "CascadeClassifier"):
        sys.exit('OpenCV lacks CascadeClassifier. Run:\n'
                 '  pip install --target scripts/.face_cv2 "opencv-python==4.11.0.86"')
import numpy as np

_CTX = ssl.create_default_context(); _CTX.check_hostname = False; _CTX.verify_mode = ssl.CERT_NONE
_CASCADE = cv2.CascadeClassifier(str(CASCADE))
if _CASCADE.empty():
    sys.exit(f"could not load cascade at {CASCADE}")


def load_image(src):
    """Decode a banner_img (remote URL or repo-relative local path) to a BGR array."""
    if src.startswith("http"):
        IMG_CACHE.mkdir(exist_ok=True)
        cached = IMG_CACHE / (hashlib.md5(src.encode()).hexdigest() + Path(src).suffix[:5])
        if cached.exists():
            buf = cached.read_bytes()
        else:
            req = urllib.request.Request(src, headers={"User-Agent": "Mozilla/5.0"})
            try:
                buf = urllib.request.urlopen(req, timeout=30, context=_CTX).read()
            except (urllib.error.URLError, ssl.SSLError, TimeoutError) as e:
                print(f"    fetch failed: {e}"); return None
            cached.write_bytes(buf)
    else:
        p = ROOT / src
        if not p.exists():
            return None
        buf = p.read_bytes()
    img = cv2.imdecode(np.frombuffer(buf, np.uint8), cv2.IMREAD_COLOR)
    return img


# Games whose banner art is a two-character version promo with the banner's OWN (new) character
# on the LEFT and a concurrent rerun on the right — so we must aim at the left face, never the
# rerun's (often clearer) one on the right.
PREFER_LEFT = {"zzz"}
# When no face is found, aim at where that game usually puts the headliner instead of dead centre.
# WuWa event promos keep the title text on the left and the character center-right.
GAME_FALLBACK = {"wuwa": (63.0, 32.0)}


def detect_focus(img, prefer_left=False, fallback=None):
    """(x%, y%, confident) of the headliner's face, or a sensible fallback.
    Scores each detection by area with an upper-half bias (the headliner is the biggest,
    highest face). For prefer_left games we only consider left-half faces; if the promo has
    faces only on the right (the new character is masked/undetectable), we still aim left."""
    H, W = img.shape[:2]
    portrait = H >= W
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    ms = max(24, int(min(W, H) * 0.05))
    faces = list(_CASCADE.detectMultiScale(gray, scaleFactor=1.03, minNeighbors=2, minSize=(ms, ms)))
    # Drop the bottom strip: gacha promos put a row of small rate-up character ICONS in the
    # lower-right, which the cascade loves — but a headliner's face is never in the bottom ~quarter.
    faces = [f for f in faces if (f[1] + f[3] / 2) / H < 0.72]
    if prefer_left and faces:
        left = [f for f in faces if (f[0] + f[2] / 2) / W < 0.5]
        faces = left                                      # only-right -> [] -> left fallback below
    best, best_score = None, -1.0
    for (x, y, w, h) in faces:
        cy = (y + h / 2) / H
        score = (w * h) * (1.25 if cy < 0.5 else 0.6)     # prefer big, upper faces
        if score > best_score:
            best_score, best = score, (x, y, w, h)
    if best is None:
        if prefer_left:
            return (30.0, 32.0, False)                    # aim at the left character's region
        if fallback:
            return (fallback[0], fallback[1], False)      # game convention (e.g. WuWa center-right)
        return (50.0, 32.0 if portrait else 40.0, False)  # blind but sane: centred, upper
    x, y, w, h = best
    return (float((x + w / 2) / W * 100), float((y + h / 2) / H * 100), bool(w >= W * 0.05))


def main():
    force = "--force" in sys.argv
    try:
        out = json.loads(OUT.read_text(encoding="utf-8"))
    except Exception:
        out = {}
    total = new = failed = 0
    for tag in GAMES:
        f = DATA / f"{tag}.json"
        if not f.exists():
            continue
        data = json.loads(f.read_text(encoding="utf-8"))
        g = out.setdefault(tag, {})
        for b in data.get("banners", []):
            if b.get("_synthetic") or b.get("pending"):
                continue
            src = b.get("banner_img")
            name = b.get("name")
            if not src or not name:
                continue
            total += 1
            prev = g.get(name)
            if prev and prev.get("src") == src and not force:
                continue                                  # unchanged — keep it
            img = load_image(src)
            if img is None:
                failed += 1
                print(f"  [{tag}] {name}: no image")
                continue
            H, W = img.shape[:2]
            x, y, det = detect_focus(img, prefer_left=(tag in PREFER_LEFT),
                                     fallback=GAME_FALLBACK.get(tag))
            g[name] = {"x": round(x, 1), "y": round(y, 1), "w": int(W), "h": int(H),
                       "det": det, "src": src}
            new += 1
            flag = "" if det else "  (fallback)"
            print(f"  [{tag}] {name}: ({x:.0f}%,{y:.0f}%) {W}x{H}{flag}")
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\nfocus: {new} computed, {total-new-failed} reused, {failed} without art; wrote {OUT.name}")


if __name__ == "__main__":
    main()
