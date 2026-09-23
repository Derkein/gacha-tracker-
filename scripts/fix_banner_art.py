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
from concurrent.futures import ThreadPoolExecutor

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
# paimon image URLs verified 200 on a previous run. They are stably hosted and never move,
# so once good they stay good — caching them means we don't re-request ~100 links every run
# (the step used to make them all sequentially, which could hang for many minutes).
CACHE = DATA / "banner_art_ok.json"
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


def http_status(url, timeout=6):
    """200/4xx from the server, or None if the request itself couldn't complete
    (timeout / DNS): unknown, not proof of breakage — leave such links alone.
    Short timeout so a hung host costs seconds, not the old 25s × ~100 links."""
    try:
        return _open(url, timeout).status
    except urllib.error.HTTPError as e:
        return e.code
    except Exception:
        return None


def verify_many(urls, timeout=6, workers=16):
    """{url: status} for many URLs at once — checked in parallel so the whole step
    finishes in seconds instead of one-at-a-time over a 25s timeout."""
    urls = list(urls)
    if not urls:
        return {}
    with ThreadPoolExecutor(max_workers=workers) as ex:
        return dict(zip(urls, ex.map(lambda u: http_status(u, timeout), urls)))


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
                # values are single- OR double-quoted; wishes with an apostrophe
                # ("The Moongrass' Enlightenment") are double-quoted, so match either
                mm = re.search(k + r":\s*(['\"])(.*?)\1", b); return mm.group(2) if mm else None
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
            return IMG_BASE + quote(f"{name} {img}.png", safe="'")   # keep apostrophes literal
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
    try:
        cache = set(json.loads(CACHE.read_text(encoding="utf-8")))
    except Exception:
        cache = set()

    bans = [b for b in data["banners"] if not b.get("_synthetic")]
    # Round 1 — verify only the "live-looking" current links (present, not a known-expiring
    # Discord attachment). paimon-hosted links we already trust via the cache aren't re-checked.
    cur_to_check = {b["banner_img"] for b in bans
                    if b.get("banner_img") and urlparse(b["banner_img"]).netloc not in DISCORD_HOSTS
                    and b["banner_img"] not in cache}
    cur_status = verify_many(cur_to_check)

    # Decide which banners are broken, resolve their paimon replacement, and gather the paimon
    # URLs still needing a one-time check (everything else is a cache hit → no request).
    resolved, paimon_to_check = {}, set()
    for b in bans:
        cur = b.get("banner_img"); host = urlparse(cur).netloc if cur else ""
        broken = (not cur) or (host in DISCORD_HOSTS)
        if not broken and cur not in cache:
            st = cur_status.get(cur)
            broken = st is not None and st >= 400
        if not broken:
            continue
        url = resolve(b, entries)
        if not url:
            continue
        resolved[id(b)] = url
        if url not in cache:
            paimon_to_check.add(url)

    # Round 2 — verify the not-yet-cached paimon replacements, in parallel.
    pstatus = verify_many(paimon_to_check)

    fixed = 0
    for b in bans:
        url = resolved.get(id(b))
        if url and (url in cache or pstatus.get(url) == 200):
            b["banner_img"] = url
            cache.add(url)                          # stable host — remember it for next time
            fixed += 1
    if fixed:
        dfile.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    CACHE.write_text(json.dumps(sorted(cache), ensure_ascii=False), encoding="utf-8")
    print(f"[banner-art] repaired {fixed} links "
          f"({len(cur_to_check)} live + {len(paimon_to_check)} paimon checked, "
          f"{len(cache)} known-good cached)")


if __name__ == "__main__":
    main()
