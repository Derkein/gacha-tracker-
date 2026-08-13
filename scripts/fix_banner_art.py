#!/usr/bin/env python3
"""
Repair dead banner-art links (Genshin only).

game-i hotlinks banner art from wherever it found it, and for older Genshin
banners that source is a Discord CDN attachment — those URLs expire, so the art
404s and the site is left with only the character portrait. paimon.moe keeps a
complete, stably-hosted set of official wish art, so for any banner whose art is
missing / Discord-hosted / dead we swap in the matching paimon image, matched by
the headliner character (agents[0]) and the run dates.

Deterministic and self-healing: the daily scrape rewrites banner_img back to the
dead Discord link, and this step re-repairs it every run. Genshin-only because
paimon only covers Genshin; other games already fall back to the portrait.
Best-effort — any network failure leaves the existing art untouched.
"""
import json, re, ssl, urllib.request, urllib.error
from datetime import date
from urllib.parse import quote, urlparse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
_CTX = ssl.create_default_context(); _CTX.check_hostname = False; _CTX.verify_mode = ssl.CERT_NONE

PAIMON = {
    "https://raw.githubusercontent.com/MadeBaruna/paimon-moe/main/src/data/banners.js",
    "https://raw.githubusercontent.com/MadeBaruna/paimon-moe/main/src/data/bannersDual.js",
}
IMG_BASE = "https://paimon.moe/images/banners/"
DISCORD_HOSTS = {"media.discordapp.net", "cdn.discordapp.com"}   # attachment URLs expire
DAY_TOL = 3                                                      # start-date slack when matching


def _open(url, timeout=25):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})   # no referer, like the site
    try:
        return urllib.request.urlopen(req, timeout=timeout)
    except (ssl.SSLError, urllib.error.URLError) as e:
        if isinstance(e, ssl.SSLError) or isinstance(getattr(e, "reason", None), ssl.SSLError):
            return urllib.request.urlopen(req, timeout=timeout, context=_CTX)
        raise


def http_status(url):
    """200/4xx from the server, or None if the request itself couldn't complete
    (timeout / DNS): unknown, not proof of breakage — leave such links alone."""
    try:
        return _open(url).status
    except urllib.error.HTTPError as e:
        return e.code
    except Exception:
        return None


def _norm(s):
    return re.sub(r"[^a-z]", "", (s or "").lower())


def load_paimon():
    """Return {(wish name, image#): (shortName, start-date)} across both paimon
    banner files, de-duped. Entries commented out with // are skipped."""
    entries = {}
    for url in PAIMON:
        try:
            js = _open(url).read().decode("utf-8", "replace")
        except Exception as e:
            print(f"[banner-art] paimon fetch failed ({url.split('/')[-1]}): {e}")
            continue
        if "characters:" in js:
            js = js[js.index("characters:"):]
        js = "\n".join(l for l in js.splitlines() if not l.strip().startswith("//"))
        for m in re.finditer(r"\{(.*?)\}", js, re.S):
            b = m.group(1)
            def g(k):
                mm = re.search(k + r":\s*'([^']*)'", b); return mm.group(1) if mm else None
            name, short, start = g("name"), g("shortName"), g("start")
            img = re.search(r"image:\s*(\d+)", b)
            if name and short and start and img:
                entries[(name, int(img.group(1)))] = (short, start[:10])
    return entries


def resolve(banner, entries):
    """paimon image URL for a banner's headliner, or None. Matches when the run
    starts within DAY_TOL of a paimon entry whose individual character (shortName)
    is this banner's headliner — 'Raiden' matches our 'Raiden Shogun', etc."""
    lead = _norm((banner.get("agents") or [""])[0])
    if not lead:
        return None
    try:
        bs = date.fromisoformat(banner["start"])
    except ValueError:
        return None
    for (name, img), (short, start) in entries.items():
        try:
            if abs((date.fromisoformat(start) - bs).days) > DAY_TOL:
                continue
        except ValueError:
            continue
        sn = _norm(short)
        if sn and (sn == lead or sn in lead or lead in sn):
            return IMG_BASE + quote(f"{name} {img}.png")
    return None


def main():
    dfile = DATA / "genshin.json"
    if not dfile.exists():
        return
    data = json.loads(dfile.read_text(encoding="utf-8"))
    entries = load_paimon()
    if not entries:
        print("[banner-art] no paimon data; leaving art untouched")
        return
    fixed = checked = 0
    for b in data["banners"]:
        if b.get("_synthetic"):
            continue
        cur = b.get("banner_img")
        host = urlparse(cur).netloc if cur else ""
        # broken = missing, a known-expiring Discord link, or a definitive 4xx
        broken = (not cur) or (host in DISCORD_HOSTS)
        if not broken:
            checked += 1
            st = http_status(cur)
            broken = st is not None and st >= 400
        if not broken:
            continue
        url = resolve(b, entries)
        if url and http_status(url) == 200:
            b["banner_img"] = url
            fixed += 1
    if fixed:
        dfile.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[banner-art] repaired {fixed} dead banner-art links ({checked} live links verified)")


if __name__ == "__main__":
    main()
