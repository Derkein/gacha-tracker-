#!/usr/bin/env python3
"""
Best-effort character icons for games with no portrait data source
(Wuthering Waves, Neverness to Everness, Endfield).

Preferred source is the character's clean "drip marketing" / splash art from the
game's Fandom wiki (single character, plain background) — found by searching the
wiki for the banner's Japanese name and keeping only results whose page image is
a character-art file (…_Card / …_Portrait). We then detect the face with an
anime-face cascade and crop a circle. When no drip art is found (e.g. an English-
only wiki like Endfield, or a brand-new character), we fall back to face-cropping
game-i's banner art; if even that has no detectable face, the banner keeps no icon
and the site shows the full banner art.

Crops are cached as icons/faces/<tag>/<slug>.webp and committed, so a daily run
only fetches genuinely new banners. Run with --force to regenerate everything.

Requires: opencv-python-headless<5 (5.x dropped CascadeClassifier), numpy, Pillow.
"""
import json, hashlib, colorsys, re, ssl, sys, urllib.request, urllib.parse, urllib.error
from collections import Counter
from pathlib import Path
import cv2, numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
ICONS = ROOT / "icons"
CASCADE = str(Path(__file__).resolve().parent / "lbpcascade_animeface.xml")
# Crops are shown up to 96x60 CSS, so a 2x display wants ~192px; 256 also matches the
# Genshin (enka) and HSR (StarRailRes) icons, which ship at 256. Source art is 1-2k wide,
# so the larger crop costs nothing in quality -- only a few KB per file.
ICON_PX = 256
UA = {"User-Agent": "Mozilla/5.0 (gacha-tracker)"}

# only these games get face-crop icons (others are data-only, banner-art thumbnails)
FACE_GAMES = {"wuwa", "nte", "endfield"}
# games whose characters have clean drip art on a JP-searchable Fandom wiki
FANDOM = {
    "wuwa": "wuthering-waves.fandom.com",
    "nte":  "neverness-to-everness.fandom.com",
}
ART_RE = re.compile(r"(Card|Portrait|Splash|Artwork|Full)", re.I)
BAD_RE = re.compile(r"(Item|Waveband|Letter|Weapon|Echo|Quest|Token)", re.I)
SPLIT = re.compile(r"[&＆/／、,]|復刻")

# Some environments fail TLS verification for the wiki image CDN; fall back to an
# unverified context for these public images only.
_UNVERIFIED = ssl.create_default_context()
_UNVERIFIED.check_hostname = False
_UNVERIFIED.verify_mode = ssl.CERT_NONE


def _open(url):
    # urlopen wraps a cert error in URLError(reason=SSLError), so catch both and
    # retry once without verification (public wiki images only).
    req = urllib.request.Request(url, headers=UA)
    try:
        return urllib.request.urlopen(req, timeout=35)
    except (ssl.SSLError, urllib.error.URLError) as e:
        reason = getattr(e, "reason", e)
        if isinstance(e, ssl.SSLError) or isinstance(reason, ssl.SSLError):
            return urllib.request.urlopen(req, timeout=35, context=_UNVERIFIED)
        raise


def fetch(url):
    return _open(url).read()


def getj(url):
    return json.loads(_open(url).read().decode("utf-8", "replace"))


def primary_name(banner_name):
    for tok in SPLIT.split(banner_name):
        if tok.strip():
            return tok.strip()
    return banner_name


def page_image(dom, title):
    url = (f"https://{dom}/api.php?action=query&prop=pageimages&piprop=original"
           f"&format=json&titles={urllib.parse.quote(title)}")
    for _, p in getj(url)["query"]["pages"].items():
        if "original" in p:
            return p["original"]["source"]
    return None


# titles a JP-name search can surface that aren't the character page itself
_NOTCHAR = re.compile(r"Version|Banner|Event|Update|Patch|Gallery|Storyline|Profile|"
                      r"Category|List of|Timeline|Calendar|Enemy|Weapon|Walkthrough", re.I)


def drip_from_title(dom, title):
    """Clean character art for a KNOWN wiki page title, or None. Deterministic --
    no search involved, so it cannot wander to a different character."""
    img = page_image(dom, title)
    if not img:
        return None
    fn = img.split("/revision")[0].split("/")[-1]
    return img if (ART_RE.search(fn) and not BAD_RE.search(fn)) else None


def resolve_drip(dom, jp_name):
    """Search the wiki for a Japanese name; return (image_url_or_None, english_name).

    The wiki page title is the character's official global (English) name, which we
    also use to translate the banner label for these otherwise JP-only games. The
    NAME is returned from the top plausible hit even when no clean 'drip' art is
    found — so a brand-new character (page exists, art not uploaded/named yet) is
    still translated automatically instead of being stuck with its Japanese name.
    A matching drip-art image, when present, is preferred and anchors the name."""
    url = (f"https://{dom}/api.php?action=query&list=search&srlimit=6&format=json"
           f"&srsearch={urllib.parse.quote(jp_name)}")
    fallback = None
    for r in getj(url)["query"]["search"]:
        title = r["title"].split("/")[0].strip()          # drop subpages (Chaos/Profile -> Chaos)
        if _NOTCHAR.search(title):
            continue
        if fallback is None:
            fallback = title                               # first plausible hit = the character name
        img = drip_from_title(dom, title)
        if img:
            return img, title                              # clean drip art -> name + icon (best case)
    return None, fallback                                  # no art anywhere -> at least the name resolves


def dominant_accent(pim):
    q = pim.convert("RGB").resize((40, 40)).quantize(colors=8).convert("RGB")
    best, score = None, -1
    for color, cnt in Counter(q.getdata()).most_common():
        r, g, b = [v / 255 for v in color]
        _, l, s = colorsys.rgb_to_hls(r, g, b)
        sc = s * cnt * (1 if 0.2 < l < 0.85 else 0.3)
        if sc > score:
            best, score = color, sc
    if not best or (max(best) - min(best)) < 26:
        return None
    r, g, b = [v / 255 for v in best]
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    r, g, b = colorsys.hls_to_rgb(h, min(0.72, max(0.5, l)), min(1, s * 1.3))
    return "#%02x%02x%02x" % (round(r * 255), round(g * 255), round(b * 255))


def crop_face(raw, cascade, drip):
    """Return an ICON_PX circular RGBA face crop, or None. `drip` art is a clean
    portrait (detect anywhere, fallback top-centre); banner art is wide (detect
    the top 80% to skip rate-up thumbnails, fallback centre-top)."""
    img = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        return None
    H, W = img.shape[:2]
    roi = img if drip else img[0:int(H * 0.80)]
    sc = 1000 / max(roi.shape[:2]) if max(roi.shape[:2]) > 1000 else 1.0
    sm = cv2.resize(roi, (int(roi.shape[1] * sc), int(roi.shape[0] * sc))) if sc < 1 else roi
    gray = cv2.equalizeHist(cv2.cvtColor(sm, cv2.COLOR_BGR2GRAY))
    mn = max(28, int(min(sm.shape[:2]) * (0.05 if drip else 0.08)))
    faces = cascade.detectMultiScale(gray, 1.05, 5, minSize=(mn, mn))
    if len(faces):
        fx, fy, fw, fh = max(faces, key=lambda f: f[2] * f[3])
        fx, fy, fw, fh = [int(v / sc) for v in (fx, fy, fw, fh)]
        cx, cy = fx + fw / 2, fy + fh / 2
        s = int(max(fw, fh) * 1.9)
        y = int(cy - s * 0.6)
    elif drip:                                   # clean portrait: face sits top-centre
        s = int(W * 0.6); cx = W / 2; y = int(H * 0.06)
    else:                                         # wide banner: least-bad guess
        s = min(W, H); cx = W / 2; y = int(H * 0.05)
    x = max(0, min(int(cx - s / 2), W - 1)); y = max(0, min(int(y), H - 1))
    side = int(min(s, W - x, H - y))
    if side < 8:
        return None
    return _circle(img[y:y + side, x:x + side])


def _circle(bgr_square, px=ICON_PX):
    pim = Image.fromarray(cv2.cvtColor(bgr_square, cv2.COLOR_BGR2RGB))
    pim = pim.resize((px, px), Image.LANCZOS).convert("RGBA")
    mask = Image.new("L", (px, px), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, px - 1, px - 1), fill=255)
    pim.putalpha(mask)
    return pim


def crop_box(raw, box):
    """Curated square crop: [cx, cy, side] as fractions -- cx/cy the centre of the
    face across the image's width/height, side the square's width as a fraction of
    the image width. Needed because the anime-face cascade is FRONTAL-only: on a
    three-quarter or profile pose (or a busy full-scene splash where the character
    is small) it detects nothing at any minSize, and crop_face's fallback then
    lands on background. A hand-picked box is the only reliable answer there."""
    img = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_UNCHANGED)
    if img is None:
        return None
    if img.ndim == 3 and img.shape[2] == 4:
        img = cv2.cvtColor(img, cv2.COLOR_BGRA2BGR)
    H, W = img.shape[:2]
    cx, cy, side = box
    s = max(8, min(int(side * W), W, H))
    x = max(0, min(int(cx * W - s / 2), W - s))
    y = max(0, min(int(cy * H - s / 2), H - s))
    return _circle(img[y:y + s, x:x + s])


def process(tag, cascade, force=False):
    dfile = DATA / f"{tag}.json"
    data = json.loads(dfile.read_text(encoding="utf-8"))
    outdir = ICONS / "faces" / tag
    outdir.mkdir(parents=True, exist_ok=True)
    dom = FANDOM.get(tag)
    # cache of JP banner name -> official English (wiki page) name, so cached
    # crops still get translated on re-runs without re-querying the wiki.
    nfile = ICONS / "faces" / f"{tag}_names.json"
    names = json.loads(nfile.read_text(encoding="utf-8")) if nfile.exists() else {}
    drip_hits = made = kept = 0
    for b in data["banners"]:
        primary = primary_name(b["name"])
        slug = f"{b['start']}-{hashlib.md5((b.get('banner_img') or b['name']).encode()).hexdigest()[:6]}"
        rel = f"icons/faces/{tag}/{slug}.webp"
        fpath = ROOT / rel
        cached = fpath.exists() and not force
        if cached:                      # an older, smaller crop is worth redoing
            try:
                with Image.open(fpath) as _im:
                    cached = _im.width >= ICON_PX
            except Exception:
                cached = False
        # resolve drip art once: gives both the image and the English name
        drip_img, en = None, names.get(primary)
        if dom and (en is None or not cached):
            try:
                if en:
                    # Character already identified: fetch ITS page's art directly. The
                    # JP search is a fuzzy full-text match whose top hit is not stable
                    # -- re-running it has returned Sanhua's page for 今汐 and Lynae's
                    # for シグリカ, which produced a crop of the wrong character even
                    # though the name was right. Search is for DISCOVERY only.
                    drip_img, title = drip_from_title(dom, en), en
                else:
                    drip_img, title = resolve_drip(dom, primary)
                # Take the NAME only the first time. The wiki search is a fuzzy
                # full-text match whose top hit is not stable -- re-running it over
                # already-named banners has returned Sanhua for 今汐 and Lynae for
                # シグリカ. Once a name is cached it stays; overrides.json is the
                # way to correct one. The image lookup above still re-runs, which
                # is the only reason to come back here at all.
                if title and en is None:
                    en = title; names[primary] = title
            except Exception as e:
                print(f"  [{tag}] drip lookup failed for {b['name']}: {e}")
        if en:
            b["agents"] = [en]; b["en"] = en
        if cached:
            b["icons"] = [rel]; kept += 1
            continue
        src, is_drip = (drip_img, True) if drip_img else (b.get("banner_img"), False)
        if not src:
            continue
        try:
            pim = crop_face(fetch(src), cascade, is_drip)
            if not pim:
                continue
            pim.save(fpath, "WEBP", quality=85, method=6)
            b["icons"] = [rel]
            acc = dominant_accent(pim)
            if acc:
                b["accent"] = acc
            made += 1
            drip_hits += is_drip
        except Exception as e:
            print(f"  [{tag}] warn {b['name']}: {e}")
    if names:
        nfile.write_text(json.dumps(names, ensure_ascii=False, indent=1), encoding="utf-8")
    dfile.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    return made, kept, drip_hits, len(data["banners"])


def apply_overrides(cascade):
    """Curated fixes for alt/SP characters missing from the primary sources
    (e.g. 姫子・旅立ち = Himeko • Nova). Sets the English name and, if an art URL is
    given, a clean face-cropped icon. Runs for every game, wins over source matches."""
    ofile = ICONS / "names" / "overrides.json"
    if not ofile.exists():
        return
    ov = json.loads(ofile.read_text(encoding="utf-8"))
    outdir = ICONS / "faces" / "overrides"
    outdir.mkdir(parents=True, exist_ok=True)
    n = 0
    for dfile in sorted(DATA.glob("*.json")):
        if dfile.stem == "index":
            continue
        data = json.loads(dfile.read_text(encoding="utf-8"))
        # data/ also holds revenue tables with no banner list (cn_monthly, cn_revenue,
        # external_revenue, reported_revenue). Skipping by name would break again the
        # next time one is added, so test for the shape instead.
        if not isinstance(data, dict) or "banners" not in data:
            continue
        touched = False
        for b in data["banners"]:
            o = ov.get(b["name"])
            if not o:
                continue
            # The NAME only fills a gap -- once a real source names the character it wins.
            # The ICON is a separate question: an entry carrying an explicit `box` exists
            # precisely because the detector picked the wrong region, so it applies even
            # when the character is named. Without a box we still only fill a gap, so
            # existing art-only overrides keep their old behaviour exactly.
            if o.get("en") and not b.get("agents"):
                b["agents"] = [o["en"]]; b["en"] = o["en"]
            if o.get("art") and (o.get("box") or not b.get("icons")):
                rel = f"icons/faces/overrides/{hashlib.md5(b['name'].encode()).hexdigest()[:8]}.webp"
                fpath = ROOT / rel
                stale = True
                if fpath.exists():
                    try:
                        with Image.open(fpath) as _im:
                            stale = _im.width < ICON_PX
                    except Exception:
                        stale = True
                if stale:
                    try:
                        raw = fetch(o["art"])
                        pim = crop_box(raw, o["box"]) if o.get("box") else crop_face(raw, cascade, True)
                        if pim:
                            pim.save(fpath, "WEBP", quality=85, method=6)
                    except Exception as e:
                        print(f"  override {b['name']}: {e}")
                if fpath.exists():
                    b["icons"] = [rel]
                    acc = dominant_accent(Image.open(fpath))
                    if acc:
                        b["accent"] = acc
            n += 1; touched = True
        if touched:
            dfile.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    if n:
        print(f"[overrides] applied {n} banner override(s)")


def main():
    force = "--force" in sys.argv
    cascade = cv2.CascadeClassifier(CASCADE)
    if cascade.empty():
        raise SystemExit("could not load cascade: " + CASCADE)
    tags = [p.stem for p in sorted(DATA.glob("*.json"))
            if p.stem in FACE_GAMES and not (ICONS / f"{p.stem}.json").exists()]
    for tag in tags:
        made, kept, drip, tot = process(tag, cascade, force)
        via = f" ({drip} from drip art)" if drip else ""
        print(f"[{tag}] face icons: {made} new{via} + {kept} cached = {made + kept}/{tot} banners")
    apply_overrides(cascade)


if __name__ == "__main__":
    main()
