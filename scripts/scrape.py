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
from datetime import datetime, timezone, timedelta, date
from pathlib import Path

BASE = "https://game-i.daa.jp/"
ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

# tag -> game-i wiki page under ガチャ分析/ , plus display metadata.
# `apid` (App Store id) also addresses game-i's per-app page ?APP/<apid>, which we
# scrape for today's store ranks and the daily rank history sparkline.
GAMES = {
    "zzz":      {"page": "ガチャ分析/ゼンレスゾーンゼロ",        "name": "Zenless Zone Zero",  "jp": "ゼンレスゾーンゼロ",  "apid": "1606356401"},
    "hsr":      {"page": "ガチャ分析/崩壊：スターレイル",        "name": "Honkai: Star Rail",  "jp": "崩壊：スターレイル",  "apid": "1599719154"},
    "wuwa":     {"page": "ガチャ分析/鳴潮",                  "name": "Wuthering Waves",    "jp": "鳴潮",            "apid": "6475033368"},
    "genshin":  {"page": "ガチャ分析/原神",                  "name": "Genshin Impact",     "jp": "原神",            "apid": "1517783697"},
    "endfield": {"page": "ガチャ分析/アークナイツ：エンドフィールド", "name": "Arknights: Endfield","jp": "アークナイツ：エンドフィールド", "apid": "6752642477"},
    "nte":      {"page": "ガチャ分析/NTE： Neverness to Everness", "name": "Neverness to Everness", "jp": "NTE： Neverness to Everness", "apid": "6754593077"},
    # Top popular gacha titles game-i tracks (resolved by App Store id at runtime,
    # so we don't hardcode long JP page names full of ：＆！／). Data-only: these
    # use banner-art thumbnails, not character icons.
    "uma":         {"apid": "1325457827", "name": "Umamusume: Pretty Derby"},
    "fgo":         {"apid": "1015521325", "name": "Fate/Grand Order"},
    "bluearchive": {"apid": "1515877221", "name": "Blue Archive"},
    "arknights":   {"apid": "1478990007", "name": "Arknights"},
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
        # game-i shows small/brand-new totals in 万G (10,000s) instead of 億G (1e8);
        # accept both (and thousands separators) so day-1 banners aren't dropped.
        mr = re.search(r"売上予測\s*([\d,.]+)\s*(億|万)G", t)
        mk = re.search(r"集計順位\s*【年間】(\d+)位\s*/\s*全(\d+)件\s*【累計】(\d+)位\s*/\s*全(\d+)件", t)
        if not (mp and mr and mk):
            continue
        rev = float(mr.group(1).replace(",", ""))
        if mr.group(2) == "万":          # 万G -> 億G (1億 = 10,000万)
            rev = round(rev / 10000.0, 4)
        img = re.search(r'data-src="([^"]+)"', body) or re.search(r'<img[^>]+src="(https?://[^"]+)"', body)
        rel = re.search(r"関連キャラなど\s*</h4>\s*<p>(.*?)</p>", body, re.S)
        rows.append({
            "name": name,
            "start": f"{mp.group(1)}-{mp.group(2)}-{mp.group(3)}",
            "end": f"{mp.group(4)}-{mp.group(5)}-{mp.group(6)}",
            "rev": rev,
            "yrank": int(mk.group(1)), "ytot": int(mk.group(2)),
            "cum": int(mk.group(3)), "cumtot": int(mk.group(4)),
            "year": int(year),
            "related": clean(rel.group(1)) if rel else "",
            "banner_img": img.group(1) if img else None,
        })
    return rows


# Games whose banner NAME is the character(s) (so 復刻 attaches per-character).
# Event-named games (Arknights, FGO, Uma) are handled by plain "復刻 in name".
CHRONO_GAMES = {"zzz", "hsr", "wuwa", "genshin", "nte", "endfield", "bluearchive"}
_HEAD_SPLIT = re.compile(r"[&＆、,]")        # NB: not / — it would split "Fate/Grand Order"
_HEAD_STRIP = re.compile(r"復刻|[（）()「」『』［］\[\]・･\s　]")
# Genshin lists its two concurrent 5-stars joined by と ("and"), and tags each with
# ピックアップ / 初回 / 復刻 / a rerun number / a ※note. The headliner is the FIRST one,
# so we must split on と and strip those tags to key it. と is a Genshin-only convention
# here — Blue Archive / Arknights use と as a normal particle inside titles, so this
# split must NOT be applied to them (hence the per-game switch in mark_reruns).
_HEAD_SPLIT_G = re.compile(r"[&＆、,と]")
_HEAD_STRIP_G = re.compile(r"復刻|ピックアップ|初回|※.*|\d+|[（）()「」『』［］\[\]・･\s　]")


def mark_reruns(banners, chrono, tag=None):
    """Set `rerun` per banner.

    A banner like 花火&景元復刻 is Sparkle's DEBUT paired with a Jing Yuan rerun —
    the 復刻 belongs to the *second* character, so the banner isn't a rerun. For
    character-named games we therefore look only at the HEADLINER (first character):
    it's a rerun if that first character carries 復刻, or already headlined an
    earlier banner (first appearance = debut). Event-named games just use 復刻.
    """
    if not chrono:
        for b in banners:
            b["rerun"] = "復刻" in b["name"]
        return banners
    split, strip = (_HEAD_SPLIT_G, _HEAD_STRIP_G) if tag == "genshin" else (_HEAD_SPLIT, _HEAD_STRIP)
    seen = set()
    for b in sorted(banners, key=lambda x: (x["start"], x["name"])):
        head = split.split(b["name"])[0]
        key = strip.sub("", head)
        b["rerun"] = ("復刻" in head) or (key in seen)
        if key:
            seen.add(key)
    return banners


def merge_split_runs(banners):
    """Combine consecutive entries with the SAME name that game-i split when a
    limited banner was paused and resumed within one patch — e.g. HSR ran Himeko,
    paused her for another limited banner, then resumed her alongside it. That's
    ONE continuous run, not a rerun. We sum the revenue, span the earliest start
    to the latest end, and keep the original sub-periods so the rank series can
    null out the gap days (when the banner wasn't actually up). A genuine rerun is
    a later patch — a gap far larger than a pause — so it stays separate."""
    from collections import OrderedDict
    groups = OrderedDict()
    for b in banners:
        groups.setdefault(b["name"], []).append(b)
    out = []
    for name, g in groups.items():
        g.sort(key=lambda x: x["start"])
        clusters = [[g[0]]]
        for b in g[1:]:
            gap = (date.fromisoformat(b["start"]) - date.fromisoformat(clusters[-1][-1]["end"])).days
            (clusters[-1].append(b) if gap <= 35 else clusters.append([b]))
        for cl in clusters:
            # A genuine pause-and-resume is ONE banner shown 2-3 times inside a single
            # patch. Games with a GENERIC gacha name (Uma/FGO — every pickup shares the
            # same "…ガチャ" title) would otherwise chain dozens of unrelated pickups into
            # one multi-year "banner", so only merge a short, few-part cluster.
            span = (date.fromisoformat(max(x["end"] for x in cl))
                    - date.fromisoformat(min(x["start"] for x in cl))).days
            if len(cl) == 1 or len(cl) > 3 or span > 49:
                out.extend(cl)
                continue
            m = dict(max(cl, key=lambda x: x["rev"]))     # keep ranks/img from the biggest slice
            m["start"] = min(x["start"] for x in cl)
            m["end"] = max(x["end"] for x in cl)
            m["rev"] = round(sum(x["rev"] for x in cl), 4)
            m["periods"] = [[x["start"], x["end"]] for x in cl]
            out.append(m)
    out.sort(key=lambda x: (x["start"], x["name"]))
    return out


def _rank(pat, h):
    m = re.search(pat, h)
    if not m or m.group(1) == "-":
        return None
    return int(m.group(1).replace(",", ""))


def _jst_now():
    return datetime.now(timezone.utc) + timedelta(hours=9)   # game-i is JST


def _prev_ym(ym):
    y, m = map(int, ym.split("/"))
    m -= 1
    if m == 0:
        y, m = y - 1, 12
    return f"{y}/{m:02d}"


# game-i's per-app chart feed (cmd=app_detail_js) returns two months of daily
# top-grossing ranks per request: the requested month (当月, column 10) and the
# one before it (前月, column 7). We cache both so stitching a banner's run pulls
# each month at most once per store. Ranks are None on days the app sat below the
# trackable ~top 200 ("null" in the feed) — game-i counts those as ¥0.
_month_cache = {}


def _parse_feed(js):
    prev, cur = {}, {}
    for line in re.findall(r"\[('\d+日'[^\]]*)\]", js):
        day = int(re.match(r"'(\d+)日'", line).group(1))
        f = re.sub(r"'[^']*'", "", line).split(",")   # drop quoted date+annotations, keep commas
        if len(f) < 11:
            continue
        prev[day] = int(f[7]) if f[7].strip().isdigit() else None
        cur[day] = int(f[10]) if f[10].strip().isdigit() else None
    return prev, cur


def month_ranks(apid, ym, android=False):
    """{day:int -> rank|None} of daily top-grossing rank for one month, cached."""
    key = (apid, ym, android)
    if key in _month_cache:
        return _month_cache[key]
    url = BASE + f"?cmd=app_detail_js&apid={apid}&Ym={ym}&width=95%25&height=300px&And={'1' if android else ''}"
    try:
        prev, cur = _parse_feed(fetch(url))
        time.sleep(0.25)
    except Exception:
        prev, cur = {}, {}
    _month_cache[key] = cur
    _month_cache.setdefault((apid, _prev_ym(ym), android), prev)   # free previous month
    return cur


def _month_list(d, ym):
    return [d.get(k) for k in range(1, (max(d) if d else 0) + 1)]


def scrape_now(apid):
    """Today's store standing from game-i's per-app page (?APP/<apid>) plus the
    daily iOS top-grossing rank history (previous + current month) for the tile
    sparkline."""
    h = fetch(BASE + f"?APP/{apid}")
    now = {
        "ios":     _rank(r"iOS 総合: ([\d,\-]+)位", h),
        "android": _rank(r"Android: ([\d,\-]+)位", h),
        "month":   _rank(r"月間売上: ([\d,\-]+)位", h),
    }
    m = re.search(r"var max=([\d.]+);", h)                 # 翌日加算売上 (yen)
    now["next_add"] = round(float(m.group(1))) if m else None
    ym = _jst_now().strftime("%Y/%m")
    cur = month_ranks(apid, ym)                            # caches previous month too
    prev = month_ranks(apid, _prev_ym(ym))                 # cache hit
    pa, ca = _month_list(prev, ym), _month_list(cur, ym)
    if any(v is not None for v in pa + ca):
        now["ym"] = ym
        now["ranks"] = {"prev": pa, "cur": ca}
    return now


def scrape_monthly(apid):
    """game-i's per-app monthly revenue table (月次売上予測) as {'YYYY-MM': 億G}.
    This is game-i's own monthly total, independent of our per-banner figures —
    the site uses it to reconcile against the banners active each month."""
    h = fetch(BASE + f"?APP/{apid}")
    i = h.find("月次売上予測")
    if i < 0:
        return {}
    seg = re.sub(r"<[^>]+>", " ", h[i:i + 16000])
    out = {}
    for y, mo, v, unit in re.findall(r"(20\d\d)/(\d\d)\s*([\d,.]+)\s*(億|万)G", seg):
        val = float(v.replace(",", ""))
        out[f"{y}-{mo}"] = round(val / 10000.0, 4) if unit == "万" else val
    return out


def attach_rank_series(apid, banners, tag=None):
    """Per-banner daily iOS top-grossing rank across each run, stitched from the
    monthly feeds and aligned to the banner's start date (index 0 = start day).
    null on days below the trackable ~top 200. game-i only keeps the iOS daily
    series (its model is iOS-regressed; Android is a live snapshot only), so this
    is iOS-only.

    The series stops at *today* (JST), never at the scheduled end date — a banner
    still running has no data past today, and game-i occasionally carries stray
    future-dated rows we must not treat as real. `ongoing` marks a run scheduled
    to continue past today. Skips banners with no tracked day."""
    today = _jst_now().date()
    # A finished banner's rank series never changes, so reuse the one we already
    # computed last run and only fetch the network for new or still-running
    # banners. Essential now that we backfill full history — otherwise every daily
    # run would re-fetch years of month feeds.
    prev = {}
    if tag:
        pf = DATA / f"{tag}.json"
        if pf.exists():
            try:
                for ob in json.loads(pf.read_text(encoding="utf-8")).get("banners", []):
                    if ob.get("rank_series") and not ob.get("ongoing"):
                        prev[(ob["start"], ob["end"], ob["name"])] = ob["rank_series"]
            except Exception:
                pass
    hit = 0
    for b in banners:
        try:
            s, e = date.fromisoformat(b["start"]), date.fromisoformat(b["end"])
        except ValueError:
            continue
        b["ongoing"] = e > today
        cached = prev.get((b["start"], b["end"], b["name"]))
        # Trust the cache only for banners that ended before last year. game-i still
        # edits the recent window — adds reruns, backfills late rows — so always
        # re-fetch this year and the one before it; older history never changes.
        if cached is not None and not b["ongoing"] and e.year < today.year - 1:
            b["rank_series"] = cached
            hit += 1
            continue
        last = min(e, today)
        if last < s or (e - s).days > 400:                 # not started yet / glitchy range
            continue
        # merged (paused-and-resumed) runs carry their sub-periods; null the gap
        # days so revenue isn't attributed to days the banner wasn't actually up.
        pspans = [(date.fromisoformat(p0), date.fromisoformat(p1)) for p0, p1 in b["periods"]] if b.get("periods") else None
        series, d = [], s
        while d <= last:
            up = pspans is None or any(p0 <= d <= p1 for p0, p1 in pspans)
            series.append(month_ranks(apid, f"{d.year}/{d.month:02d}", False).get(d.day) if up else None)
            d += timedelta(days=1)
        if any(v is not None for v in series):
            b["rank_series"] = series
            hit += 1
    return hit


def scrape_game(tag, meta):
    meta["page"] = resolve_page(meta)
    meta.setdefault("jp", meta["page"].split("/", 1)[1] if "/" in meta["page"] else meta["page"])
    h0 = fetch(page_url(meta["page"]))
    # game-i only *links* the last couple of years on the default page, but every
    # older year back to the game's launch is reachable at ?yyyy=YYYY. Walk back
    # from this year until a year has no banners (past the game's first year);
    # game-i's data itself starts in 2018, so that's the floor.
    newest = datetime.now().year
    banners, y = [], newest
    while y >= 2018:
        hp = h0 if y == newest else fetch(page_url(meta["page"], y))
        rows = parse_banners(hp, y)
        if not rows and y < newest:
            break                       # gone past the game's first tracked year
        banners += rows
        y -= 1
        time.sleep(0.4)
    # de-dupe by (start,name) and sort chronologically
    seen, uniq = set(), []
    for b in sorted(banners, key=lambda x: (x["start"], x["name"])):
        key = (b["start"], b["name"])
        if key in seen:
            continue
        seen.add(key)
        uniq.append(b)
    uniq = merge_split_runs(uniq)                 # fold paused-and-resumed runs into one
    return mark_reruns(uniq, tag in CHRONO_GAMES, tag)


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
        now = None
        try:
            now = scrape_now(meta["apid"])
        except Exception as e:
            print(f"[{tag}] now-status failed (non-fatal): {e}", file=sys.stderr)
        monthly = {}
        try:
            monthly = scrape_monthly(meta["apid"])
        except Exception as e:
            print(f"[{tag}] monthly failed (non-fatal): {e}", file=sys.stderr)
        try:
            got = attach_rank_series(meta["apid"], banners, tag)
            print(f"[{tag}] daily rank series on {got}/{len(banners)} banners")
        except Exception as e:
            print(f"[{tag}] rank-series failed (non-fatal): {e}", file=sys.stderr)
        out = {
            "game": tag,
            "name": meta["name"],
            "jp": meta["jp"],
            "unit": "億G",
            "source": page_url(meta["page"]),
            "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "count": len(banners),
            "now": now,
            "monthly": monthly,
            "banners": banners,
        }
        (DATA / f"{tag}.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
        total = round(sum(b["rev"] for b in banners), 1)
        print(f"[{tag}] {len(banners)} banners, total {total} 億G -> data/{tag}.json")
        summary.append({"game": tag, "name": meta["name"], "count": len(banners),
                        "total_oku": total, "updated": out["updated"]})

    # Rebuild the index from what's on disk, preferring this run's fresh summary
    # and falling back to the already-committed data file for any game that failed
    # (e.g. a game-i timeout). A failed scrape must NEVER drop a game or, worst of
    # all, publish an empty index that breaks the site — so we keep the last-good
    # entry and only fail loudly if literally nothing usable exists.
    fresh = {s["game"]: s for s in summary}
    games = []
    for tag in GAMES:
        if tag in fresh:
            games.append(fresh[tag]); continue
        p = DATA / f"{tag}.json"
        if p.exists():
            try:
                d = json.loads(p.read_text(encoding="utf-8"))
                games.append({"game": tag, "name": d.get("name", tag), "count": len(d["banners"]),
                              "total_oku": round(sum(b["rev"] for b in d["banners"]), 1),
                              "updated": d["updated"]})
            except Exception as e:
                print(f"[{tag}] could not read existing data: {e}", file=sys.stderr)
    if not games:
        print("all scrapes failed and no existing data on disk — leaving index.json untouched", file=sys.stderr)
        sys.exit(1)
    (DATA / "index.json").write_text(json.dumps({"games": games}, ensure_ascii=False, indent=1), encoding="utf-8")
    kept = len(games) - len(fresh)
    print(f"wrote data/index.json with {len(games)} games ({len(fresh)} fresh, {kept} kept from disk)")
    if not fresh:
        print("WARNING: every game failed to scrape this run (game-i unreachable?)", file=sys.stderr)
        sys.exit(1)   # fail the CI step so a total outage doesn't commit a no-op 'refresh'


if __name__ == "__main__":
    main()
