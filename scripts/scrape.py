#!/usr/bin/env python3
"""
Scrape gacha banner revenue estimates from game-i.daa.jp.

Pure standard library (urllib/re/json) so CI needs no pip install.
For each configured game it fetches the current-year page plus every
linked historical year (&yyyy=YYYY) and writes data/<tag>.json.

Each banner record:
    name        banner title (usually the headline character)
    start,end   run dates (YYYY-MM-DD)
    rev         revenue estimate in 億G (100M units)
    yrank,ytot  rank within its calendar year / number of banners that year
    cum,cumtot  all-time rank / total banners tracked
    year        calendar year of the banner
    related     related characters string (game-i's 関連キャラ)
    banner_img  official banner splash art URL (may be null)
"""
import re, json, time, html, sys, urllib.request, urllib.parse, urllib.error
from datetime import datetime, timezone
from pathlib import Path

BASE = "https://game-i.daa.jp/"
ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

# tag -> game-i wiki page under ガチャ分析/ , plus display metadata
GAMES = {
    "zzz":      {"page": "ガチャ分析/ゼンレスゾーンゼロ",        "name": "Zenless Zone Zero",  "jp": "ゼンレスゾーンゼロ"},
    "hsr":      {"page": "ガチャ分析/崩壊：スターレイル",        "name": "Honkai: Star Rail",  "jp": "崩壊：スターレイル"},
    "wuwa":     {"page": "ガチャ分析/鳴潮",                  "name": "Wuthering Waves",    "jp": "鳴潮"},
    "genshin":  {"page": "ガチャ分析/原神",                  "name": "Genshin Impact",     "jp": "原神"},
    "endfield": {"page": "ガチャ分析/アークナイツ：エンドフィールド", "name": "Arknights: Endfield","jp": "アークナイツ：エンドフィールド"},
    "nte":      {"page": "ガチャ分析/NTE： Neverness to Everness", "name": "Neverness to Everness", "jp": "NTE： Neverness to Everness"},
    # Top popular gacha titles game-i tracks (resolved by App Store id at runtime,
    # so we don't hardcode long JP page names full of ：＆！／). Data-only: these
    # use banner-art thumbnails, not character icons.
    "uma":         {"apid": "1325457827", "name": "Umamusume: Pretty Derby"},
    "fgo":         {"apid": "1015521325", "name": "Fate/Grand Order"},
    "bluearchive": {"apid": "1515877221", "name": "Blue Archive"},
    "gbf":         {"apid": "852882903",  "name": "Granblue Fantasy"},
    "arknights":   {"apid": "1478990007", "name": "Arknights"},
    "gfl2":        {"apid": "6499011827", "name": "Girls' Frontline 2: Exilium"},
}

UA = {"User-Agent": "Mozilla/5.0 (gacha-tracker; +https://github.com/)"}


def resolve_page(meta):
    """Return the ガチャ分析/<name> wiki page for a game, following the app_gacha
    redirect when only an App Store id is configured."""
    if meta.get("page"):
        return meta["page"]
    url = BASE + f"?cmd=app_gacha&apid={meta['apid']}"

    class _NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a):
            return None
    opener = urllib.request.build_opener(_NoRedirect)
    try:
        opener.open(urllib.request.Request(url, headers=UA), timeout=40)
    except urllib.error.HTTPError as e:
        loc = e.headers.get("Location")
        if loc and "?" in loc:
            return urllib.parse.unquote(loc.split("?", 1)[1])
    raise RuntimeError(f"could not resolve gacha page for apid={meta.get('apid')}")


def fetch(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            return urllib.request.urlopen(req, timeout=40).read().decode("utf-8", "replace")
        except Exception as e:
            if i == tries - 1:
                raise
            time.sleep(1.5 * (i + 1))


def page_url(page, year=None):
    u = BASE + "?" + urllib.parse.quote(page)
    if year:
        u += "&yyyy=" + str(year)
    return u


def clean(s):
    s = re.sub(r"<[^>]+>", "", s)
    return html.unescape(s).strip()


def parse_banners(hpage, year):
    rows = []
    parts = re.split(r"(<h3[^>]*>.*?</h3>)", hpage, flags=re.S)
    for i in range(1, len(parts), 2):
        name = clean(parts[i])
        body = parts[i + 1] if i + 1 < len(parts) else ""
        if "実施期間" not in body:
            continue
        t = re.sub(r"<br[^>]*>", " ", body)
        t = re.sub(r"<[^>]+>", " ", t)
        t = html.unescape(re.sub(r"\s+", " ", t))
        mp = re.search(r"実施期間\s*(\d{4})年(\d{2})月(\d{2})日\s*～\s*(\d{4})年(\d{2})月(\d{2})日", t)
        mr = re.search(r"売上予測\s*([\d.]+)億G", t)
        mk = re.search(r"集計順位\s*【年間】(\d+)位\s*/\s*全(\d+)件\s*【累計】(\d+)位\s*/\s*全(\d+)件", t)
        if not (mp and mr and mk):
            continue
        img = re.search(r'data-src="([^"]+)"', body) or re.search(r'<img[^>]+src="(https?://[^"]+)"', body)
        rel = re.search(r"関連キャラなど\s*</h4>\s*<p>(.*?)</p>", body, re.S)
        rows.append({
            "name": name,
            "start": f"{mp.group(1)}-{mp.group(2)}-{mp.group(3)}",
            "end": f"{mp.group(4)}-{mp.group(5)}-{mp.group(6)}",
            "rev": float(mr.group(1)),
            "yrank": int(mk.group(1)), "ytot": int(mk.group(2)),
            "cum": int(mk.group(3)), "cumtot": int(mk.group(4)),
            "year": int(year),
            "related": clean(rel.group(1)) if rel else "",
            "banner_img": img.group(1) if img else None,
            "rerun": "復刻" in name,        # 復刻 = rerun banner
        })
    return rows


def scrape_game(tag, meta):
    meta["page"] = resolve_page(meta)
    meta.setdefault("jp", meta["page"].split("/", 1)[1] if "/" in meta["page"] else meta["page"])
    h0 = fetch(page_url(meta["page"]))
    years = sorted(set(re.findall(r"yyyy=(20\d\d)", h0)))
    # the default page is the newest year; make sure it's included
    newest = max([int(y) for y in years] + [datetime.now().year])
    all_years = sorted(set(int(y) for y in years) | {newest})
    banners = []
    for y in all_years:
        hp = h0 if y == newest else fetch(page_url(meta["page"], y))
        banners += parse_banners(hp, y)
        time.sleep(0.4)
    # de-dupe by (start,name) and sort chronologically
    seen, uniq = set(), []
    for b in sorted(banners, key=lambda x: (x["start"], x["name"])):
        key = (b["start"], b["name"])
        if key in seen:
            continue
        seen.add(key)
        uniq.append(b)
    return uniq


def main():
    only = sys.argv[1:] or list(GAMES)
    DATA.mkdir(exist_ok=True)
    summary = []
    for tag in only:
        meta = GAMES[tag]
        try:
            banners = scrape_game(tag, meta)
        except Exception as e:
            print(f"[{tag}] FAILED: {e}", file=sys.stderr)
            continue
        out = {
            "game": tag,
            "name": meta["name"],
            "jp": meta["jp"],
            "unit": "億G",
            "source": page_url(meta["page"]),
            "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "count": len(banners),
            "banners": banners,
        }
        (DATA / f"{tag}.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
        total = round(sum(b["rev"] for b in banners), 1)
        print(f"[{tag}] {len(banners)} banners, total {total} 億G -> data/{tag}.json")
        summary.append({"game": tag, "name": meta["name"], "count": len(banners),
                        "total_oku": total, "updated": out["updated"]})
    (DATA / "index.json").write_text(json.dumps({"games": summary}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"wrote data/index.json with {len(summary)} games")


if __name__ == "__main__":
    main()
