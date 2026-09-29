#!/usr/bin/env python3
"""
Detect each banner's headliner face and record a focus point, so the Compare collage
can crop toward the face instead of slicing through it.

For every banner in every game's data file we grab its art (`banner_img`), run deepghs'
YOLO anime face detector over it (falling back to its head detector, which also catches
turned heads and profiles), pick the most prominent one, and store the centre as a
percent of the image plus the image's natural size. The result goes to
data/banner_focus.json, keyed by game -> banner art URL (not name: Uma's pickups share one
generic name across dozens of banners), which the site loads to place every crop.

Deterministic + incremental: an entry is reused unless it predates the current detector
version, so a run only touches new / re-arted banners. The site keeps a
small manual face-override map for the rare art the detector still gets wrong.

Usage:
  python scripts/compute_focus.py            # detect new / changed banners
  python scripts/compute_focus.py --force    # redo every banner
  python scripts/compute_focus.py --pending  # stdlib-only check: exit 0 if there is work,
                                             # 3 if not (lets CI skip installing the detector)

Detector deps (NOT in requirements.txt — they'd clash with face_icons.py's headless
OpenCV): pip install -r requirements-focus.txt, ideally into its own venv.
"""
import json, sys, ssl, hashlib, urllib.request, urllib.error
from io import BytesIO
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = DATA / "banner_focus.json"
IMG_CACHE = ROOT / "scripts" / ".focus_imgcache"   # downloaded bytes, keyed by URL hash (gitignored)
GAMES = ["zzz", "hsr", "wuwa", "genshin", "endfield", "nte", "uma"]
VERSION = 2                                        # bump when the detector/selection changes

# Games whose banner art became a two-character version promo — the banner's OWN (new)
# character on the LEFT, a concurrent rerun on the right — from a given date. From then on we
# aim only at the left half (even when the new character's face is undetectable, e.g. masked);
# before it the art is a single character, usually on the right, and is detected normally.
PREFER_LEFT = {"zzz": "2025-10-15"}   # ZZZ: from リュシア on, every promo is new-left / rerun-right
# When nothing is found, aim at where that game usually puts the headliner instead of dead centre.
# WuWa event promos keep the title text on the left and the character center-right.
GAME_FALLBACK = {"wuwa": (63.0, 32.0)}
# Gacha promos put a row of small rate-up character ICONS along the bottom; a headliner's
# face is never in the bottom ~quarter, so anything centred below this is ignored.
ICON_STRIP = 0.72

_CTX = ssl.create_default_context(); _CTX.check_hostname = False; _CTX.verify_mode = ssl.CERT_NONE


def arts():
    """{tag: {banner_img: (banner name, start date)}} for every real banner with art. Keyed by
    the ART, not the name: a face position belongs to an image, and names aren't unique (Uma's
    pickups share one generic name across dozens of different banners)."""
    out = {}
    for tag in GAMES:
        f = DATA / f"{tag}.json"
        if not f.exists():
            continue
        g = out.setdefault(tag, {})
        for b in json.loads(f.read_text(encoding="utf-8")).get("banners", []):
            if b.get("_synthetic") or b.get("pending") or not b.get("banner_img"):
                continue
            prev = g.get(b["banner_img"])
            if prev is None or b.get("start", "") < prev[1]:     # earliest use of the art wins
                g[b["banner_img"]] = (b.get("name", ""), b.get("start", ""))
    return out


def prefers_left(tag, start):
    cut = PREFER_LEFT.get(tag)
    return bool(cut) and start >= cut


def is_current(e):
    return bool(e) and e.get("v") == VERSION


def load_image(src):
    """A banner_img (remote URL or repo-relative path) as a PIL RGB image, or None."""
    from PIL import Image
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
    try:
        return Image.open(BytesIO(buf)).convert("RGB")
    except Exception:
        return None


def pick(dets, W, H, prefer_left):
    """(x%, y%) of the strongest detection (area × confidence), skipping the icon strip and,
    for prefer_left games, anything on the right half. None if nothing qualifies."""
    best = None
    for (x0, y0, x1, y1), _label, conf in dets:
        cx, cy = (x0 + x1) / 2 / W, (y0 + y1) / 2 / H
        if cy >= ICON_STRIP or (prefer_left and cx >= 0.5):
            continue
        score = (x1 - x0) * (y1 - y0) * conf
        if best is None or score > best[0]:
            best = (score, cx * 100, cy * 100)
    return best and best[1:]


def fallback_point(tag, portrait, left=False):
    if left:
        return (30.0, 32.0)                       # the new character's side of the promo
    if tag in GAME_FALLBACK:
        return GAME_FALLBACK[tag]
    return (50.0, 32.0 if portrait else 40.0)     # blind but sane: centred, upper


def main():
    force = "--force" in sys.argv
    try:
        out = json.loads(OUT.read_text(encoding="utf-8"))
    except Exception:
        out = {}

    cur = arts()
    # Work = art with no current entry. Art that failed to load keeps a fallback point and a
    # `fail` flag; it's retried on the next full run but doesn't count as pending on its own,
    # so a permanently dead link can't force a detector install every day.
    def entry(t, s): return out.get(t, {}).get(s)
    todo = [(t, s, n, d) for t, g in cur.items() for s, (n, d) in g.items()
            if force or not is_current(entry(t, s))]
    if "--pending" in sys.argv:
        print(f"focus: {len(todo)} banner art(s) need a face point")
        sys.exit(0 if todo else 3)
    if not force:                                  # full run: also retry earlier load failures
        todo += [(t, s, n, d) for t, g in cur.items() for s, (n, d) in g.items()
                 if (entry(t, s) or {}).get("fail") and (t, s, n, d) not in todo]

    done = failed = 0
    if todo:
        from imgutils.detect import detect_faces, detect_heads   # heavy; only when there is work
    for tag, src, name, start in todo:
        img = load_image(src)
        g = out.setdefault(tag, {})
        pl = prefers_left(tag, start)
        if img is None:
            old = g.get(src) or {}
            fx, fy = fallback_point(tag, False, pl)
            g[src] = {"x": fx, "y": fy, "w": old.get("w"), "h": old.get("h"), "det": False,
                      "fail": True, "name": name, "v": VERSION}
            failed += 1
            print(f"  [{tag}] {name}: no image")
            continue
        W, H = img.size
        pt = pick(detect_faces(img), W, H, pl) or pick(detect_heads(img), W, H, pl)
        det = pt is not None
        x, y = pt if det else fallback_point(tag, H >= W, pl)
        g[src] = {"x": round(x, 1), "y": round(y, 1), "w": W, "h": H, "det": det,
                  "name": name, "v": VERSION}
        done += 1
        print(f"  [{tag}] {name}: ({x:.0f}%,{y:.0f}%) {W}x{H}{'' if det else '  (fallback)'}")
    # prune art no banner uses any more (re-arted banners, old name-keyed entries)
    out = {t: {s: out[t][s] for s in g if s in out.get(t, {})} for t, g in cur.items()}
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\nfocus: {done} computed, {failed} without art; wrote {OUT.name}")


if __name__ == "__main__":
    main()
