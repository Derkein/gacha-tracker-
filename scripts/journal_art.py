#!/usr/bin/env python3
"""Fetch the Journal's character art once and keep a small local copy.

Each story in data/journal/stories.json may name art by its source URL:
    "art": {"portrait": <url>, "scene": <url>, "scene_caption": "...", "credit": "<page the art came from>"}
portrait = a full-body render or splash (shown whole, never cropped); scene = an image from the
story or a promo illustration. Wiki CDNs rate-limit and hotlinks rot, so each image is downloaded
once, resized (portrait <= 900px tall, scene <= 1400px wide) and saved as webp under
assets/journal/. data/journal/art.json maps source URL -> {file, w, h}; the page prefers the local
file and falls back to the source URL when an image hasn't been fetched yet.

    python scripts/journal_art.py           fetch anything new
    python scripts/journal_art.py --force   refetch everything

Downloads go through headless Chromium (playwright), the same browser the other build scripts drive.
"""
import argparse, hashlib, io, json, pathlib, re, sys, time

ROOT = pathlib.Path(__file__).resolve().parent.parent
STORIES = ROOT / "data" / "journal" / "stories.json"
MAP = ROOT / "data" / "journal" / "art.json"
OUT = ROOT / "assets" / "journal"
LIMIT = {"portrait": ("h", 900), "scene": ("w", 1400)}
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"

def fetch(url, br):
    """Load the image as a page in headless Chromium — wiki CDNs refuse plain HTTP clients.
    A fresh page each try, so a refused load can't leave a half-finished navigation behind."""
    status = "?"
    for wait in (0, 30, 90):                      # CDNs answer bursts with 403/429 for a while
        if wait:
            print(f"  waiting {wait}s: {url}", file=sys.stderr); time.sleep(wait)
        page = br.new_page()
        try:
            r = page.goto(url, wait_until="load", timeout=60000)
            if r and r.ok: return r.body()
            status = r.status if r else "?"
        finally:
            page.close()
    raise RuntimeError(f"gave up: HTTP {status}")

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    for s in (sys.stdout, sys.stderr):
        try: s.reconfigure(encoding="utf-8", errors="replace")
        except Exception: pass
    from PIL import Image
    stories = json.loads(STORIES.read_text(encoding="utf-8"))
    art = json.loads(MAP.read_text(encoding="utf-8")) if MAP.exists() else {}
    OUT.mkdir(parents=True, exist_ok=True)
    from playwright.sync_api import sync_playwright
    pw = sync_playwright().start(); br = pw.chromium.launch()
    for key, s in stories.items():
        for kind in ("portrait", "scene"):
            url = (s.get("art") or {}).get(kind)
            if not url or (url in art and not a.force and (ROOT / art[url]["file"]).exists()): continue
            tag, name = key.split(":", 1)
            slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
            f = OUT / f"{tag}-{slug}-{kind}-{hashlib.sha1(url.encode()).hexdigest()[:6]}.webp"
            try:
                im = Image.open(io.BytesIO(fetch(url, br)))
            except Exception as e:
                print(f"  skip {key} {kind}: {e}", file=sys.stderr); continue
            im = im.convert("RGBA") if im.mode in ("RGBA", "LA", "P") else im.convert("RGB")
            side, cap = LIMIT[kind]
            cur = im.height if side == "h" else im.width
            if cur > cap: im = im.resize((round(im.width * cap / cur), round(im.height * cap / cur)), Image.LANCZOS)
            im.save(f, "WEBP", quality=82, method=6)
            art[url] = {"file": f.relative_to(ROOT).as_posix(), "w": im.width, "h": im.height}
            print(f"  {key} {kind}: {f.name} {im.width}x{im.height} {f.stat().st_size // 1024}KB")
            time.sleep(2)                          # be gentle with wiki CDNs
    br.close(); pw.stop()
    MAP.write_text(json.dumps(art, ensure_ascii=False, indent=1), encoding="utf-8")

if __name__ == "__main__":
    main()
