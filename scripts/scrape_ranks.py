#!/usr/bin/env python3
"""Daily store-chart snapshots: China iPhone top-grossing and Steam top sellers.

game-i gives the Japanese App Store's daily rank. These add the two other charts people
ask about, saved once a day by the same refresh workflow:

  data/ranks/cn_ios.json        DAILY   Apple China iPhone top-grossing, ALL apps, top 100
                                        -- Apple's own public feed, no key. The headline
                                        chart: games compete with Douyin, WeChat, video apps
  data/ranks/cn_ios_games.json  DAILY   the same, Games category only -- kept because it is
                                        the feed the Wayback Machine saved (see below)
  data/ranks/steam_daily.json   DAILY   Steam global top sellers right now, games only,
                                        top 100 -- the list behind Steam's search sort
  data/ranks/steam_weekly.json  WEEKLY  Steam global weekly top sellers, top 100 --
                                        Valve's official weekly list
  data/ranks/cn_ios_archive.json PAST   Apple China iPhone top-grossing, ALL apps, top 50
                                        (30 from 2025), on ~250 scattered days Sep 2020 ->
                                        Jan 2026 -- Appfigures' public chart page as saved
                                        by the Wayback Machine and Common Crawl. Not daily
  data/ranks/cn_ios_top10.json   PAST   Apple China iPhone top-grossing, ALL apps, TOP 10
                                        only, but EVERY day since Genshin's launch --
                                        AppFollow's free record of the chart. Not daily

WHOLE CHARTS, NOT JUST OUR GAMES
Every snapshot stores the complete top 100 (the archive file: its 50 or 30) as an ordered
id list (rank = position), plus one id -> name map. So any game can be charted later
without re-scraping, and the two kinds of "missing" stay distinct:
  * the date is present but the game isn't in its list -> it did NOT make the list
  * the date itself is absent                           -> no snapshot that day

WHERE THE HISTORY COMES FROM
Apple and Valve publish only the current chart, so a daily series grows one point per
run. Four exceptions, all pulled by --backfill:
  * China iOS, Apple's own feed: the Wayback Machine has been saving the games feed URL
    near-daily since mid-July 2026, and someone saved an all-apps copy (under a bogus
    genre=25129, which Apple ignores) near-daily Dec 2019 - Feb 2020 and on three days
    since Genshin's launch, the only ones imported (someone else's saves; gaps
    included). Each saved copy is keyed by Apple's own timestamp inside it, never by the
    Wayback date -- those disagree, and a missing date silently serves the nearest copy
    instead.
  * Steam weekly: Valve's weekly endpoint takes a start_date, so past weeks are simply
    requested. Steam's DAILY list has no free archive (SteamDB isn't scrapable and
    gaminganalytics sells it), so it starts the day this runs.
  * China iOS, all apps, in the past: Appfigures' free "Top Apps" page for China iPhone
    (appfigures.com/top-apps/ios-app-store/china/iphone/top-overall) showed Apple's
    top-grossing chart, and the Wayback Machine saved it on ~250 days since Sep 2020 --
    almost always as a "?profile=product.N" variant (an app's pop-up open; the chart is
    the same), the plain URL on only 18 days. The page embeds its lists as JSON, each
    entry with "vendor_identifier" = Apple's own app id and each list stamped with its
    chart hour, so rows are matched by id and dated by that hour. Common Crawl's copies of
    the same page fill in days the Wayback Machine lacks (11 of the 247). Only 50 deep (30
    from 2025) and patchy -- 2 days in 2020, 22-28 a year 2021-22, 43-83 a year 2023-25 --
    so it goes to its own file, never mixed into cn_ios.json. --appfigures runs just this.
  * China iOS, all apps, top 10, every day: AppFollow's free top charts keep Apple's real
    chart for every past day, 10 deep. Pulled day by day from Genshin's launch through the
    endpoint its chart page calls (appfollow.io/rankings/top.json), one request per ~4 s;
    a run stops when AppFollow starts refusing (429/400) and the next run resumes.
    Its Terms bar scraping for commercial use; this site is open source and
    non-commercial, and the owner approved the pull on that basis. --appfollow runs just
    this.

SOURCES CHECKED AND NOT USED (Sep 2026), so they needn't be re-tested
  * Qimai (api.qimai.cn/rank/index): a plain request returns today and the two previous
    days for free, 200 deep; any older date answers "请登录后查看更多数据" (log in). The
    old GitHub scrapers for it either need an account cookie or crack its `analysis`
    request signature, and defeating a login/anti-scraping scheme is off the table.
  * Wayback copies of that Qimai API: 173 since Sep 2020, only 50 holding a ranking, and
    none of them the games-only chart -- they mix all-apps grossing, free charts and other
    countries, carry no chart date, and encode the request inside the same opaque token.
    Unusable as a series.
  * SteamCharts: free history, but of concurrent PLAYERS, not sales -- a different chart.
  * AppMagic "Top Apps" (appmagic.rocks/top-charts/apps): daily China ranks back years,
    free to VIEW -- but it ranks by AppMagic's own estimates and merges listings (TikTok
    with Douyin, Genshin with Cloud Genshin), and AppMagic is now governed by Sensor
    Tower's Terms, which forbid access "through the use of bots, spiders, Web crawlers...
    or other automated devices" and redistributing the data. Its "Live Store Rankings"
    (Apple's real chart, hourly) keeps only the last ~7 days.
  * SteamDB / gaminganalytics: have Steam top-seller history, behind login or a paywall.
  * App Annie's old public chart pages (appannie.com/en/apps/ios/top/china/overall/
    iphone/, and the /cn/ edition) in the Wayback Machine: ~170 dated days, nearly all
    before Genshin's launch; the late-2020 copies are empty shells. Its successor data.ai
    (28 saved days, 2022-24) shows only a top-10 free chart and "注册以了解更多" (sign up
    to see more); liangjianghu.com's saved chart pages hold no chart at all.
  * Sensor Tower's public chart pages in the Wayback Machine: JavaScript shells, no data.
  * Dated charts behind a login or paywall: Appark (past dates need an account), ASO.dev
    (paid plans), MWM (history in its paid console). Similarweb ranks by its own
    estimates; 42matters' China page is Google Play only. Apple's own web charts
    (apps.apple.com/cn/charts, in the Wayback Machine since 2022) list free and paid
    only, no grossing; 蝉大师's archived rank pages have no grossing chart either.
    AppLyzer's World Charts show today only, and its per-app rank pages hold nothing for
    our games ("No rankings found").
  * People posting ranks: X has scattered points only (e.g. @GachaAnalytics' Day-1 JP/CN
    rank per banner), and its search needs a login; Weibo, NGA, Bilibili, Telegram and
    Bluesky turned up no daily series. Revenue trackers (ennead, GachaDash, GenshinLab)
    publish monthly or per-banner totals, not ranks; Sohu's "iOS畅销榜周报" is weekly and
    games-only. Apple's feed was never captured by Common Crawl.
  * Apptopia Store Insights (apptopia.com/store-insights/top-charts/itunes-connect): free
    dated charts, 50 deep, with a date picker -- but its Terms bar "scripts, bots,
    spiders, or other automated mechanisms" without written permission, for free and paid
    users alike, and bar sharing the data. By hand only, unless Apptopia grants
    permission. Appfigures' API serves only the last 24 h of chart snapshots, behind a
    paid add-on; 应用雷达 (ann9.com) is now an ad platform; APPDUU is gone.

CHECKING SOURCES -- the real chart, used to verify the files above
  * Diandian (app.diandian.com), logged in with a free account: the deepest view -- far
    past 100 (loads 20 rows per scroll), back to 1 Oct 2020, every chart update of the
    day as a clickable snapshot, all-apps + games-only rank per app. Our saved Apple feed
    matched it 20/20 on 16 of 19 days checked, the rest timing (data/ranks/
    diandian_check.json). Two limits: its data API signs every request (`k=`), which is
    not forged here, so it can only be read through the page; and the free account has a
    DAILY cap on chart views ("View List data has been limited, please try it
    tomorrow"), hit after roughly a hundred page loads -- fine for spot checks, far too
    little for a 2,000-day backfill.
  * AppFollow (appfollow.io/rankings/iphone/cn/all-categories?date=YYYY-MM-DD): free and
    without login, EVERY day back to at least Genshin's launch -- but only the top 10 of
    each list. It verified cn_ios_archive.json (the same ten apps on 5 of 6 days
    checked), and its whole daily top 10 is now saved as cn_ios_top10.json (see above).

APPLE'S CHART MOVES IN STEPS
The China grossing chart changes only a handful of times a day, at irregular times (they
are Diandian's starred snapshots). A feed fetch shows whichever update is live, so its
`updated` timestamp is the fetch, not the chart: copies stamped 09:30 China time matched
updates from the early morning up to a few minutes past 09:30.

ONE SNAPSHOT PER DAY
The workflow fires three times inside an hour after game-i's midnight-JST rollover. The
first reading of a day wins and later ones are skipped, so every day is the same time
slice -- comparable day to day, which is what a rank series needs.

    python scripts/scrape_ranks.py              # today's snapshots
    python scripts/scrape_ranks.py --backfill   # also Wayback China history + Steam weekly history
    python scripts/scrape_ranks.py --appfigures # only the Appfigures China archive
    python scripts/scrape_ranks.py --appfollow  # only the AppFollow daily top 10

Pure standard library, like scrape.py.
"""
import gzip
import io
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "ranks"
UA = {"User-Agent": "Mozilla/5.0 (gacha-tracker; +https://github.com/)"}
MIN_ROWS = 90                 # a snapshot shorter than this is a broken fetch, not a chart

# Two China charts, saved side by side. ALL APPS is the headline: a launch that out-earns
# Douyin (抖音) or WeChat is exactly what it shows, and a games-only chart hides that.
# GAMES (genre 6014) is kept because it is the exact URL the Wayback Machine has been
# saving since mid-July 2026 -- the only free history of either -- so it carries the
# backfill. Apple caps both feeds at 100.
CN_FEED = "https://itunes.apple.com/cn/rss/topgrossingapplications/limit=100/json"
CN_FEED_GAMES = "https://itunes.apple.com/cn/rss/topgrossingapplications/limit=100/genre=6014/json"
# China App Store ids (resolved via the iTunes search API, country=cn). Matching is by id,
# never by name: Apple renames listings every version ("原神·空月之歌" -> "原神-至冬开放").
CN_TRACKED = {
    "genshin":  "1467190251",   # 原神
    "hsr":      "1523037824",   # 崩坏：星穹铁道
    "zzz":      "1606359076",   # 绝区零
    "wuwa":     "6450693428",   # 鸣潮
    "endfield": "6753859465",   # 明日方舟：终末地
    "nte":      "6514281568",   # 异环
    "uma":      "1544031895",   # 闪耀！优俊少女 (Bilibili's CN edition)
}

# Global top sellers, games only (category1=998 drops hardware such as Steam Deck).
# Valve ranks it on the trailing 24h of spending, weighted toward the last 3 hours, and
# in-game purchases count -- which is why free-to-play gacha titles appear at all.
STEAM_DAILY = ("https://store.steampowered.com/search/results/?filter=globaltopsellers"
               "&json=1&start=0&count=100&category1=998&cc=us&l=english")
STEAM_WEEKLY = "https://api.steampowered.com/IStoreTopSellersService/GetWeeklyTopSellers/v1/"
STEAM_TRACKED = {
    "zzz":      4162040,
    "wuwa":     3513350,
    "nte":      4508340,
    "uma":      3224770,
    # store page up, build still "coming soon" -- appears in the lists once it ships
    "endfield": 4732690,
}
STEAM_NOT_ON = {"genshin": "HoYoverse ships Genshin through its own launcher and Epic, "
                           "never Steam.",
                "hsr":     "HoYoverse ships Star Rail through its own launcher and Epic, "
                           "never Steam."}
# Valve's weekly archive reaches back past 2010. The backfill stops at the week holding
# Genshin's launch (28 Sep 2020), the first day any game on this site existed; pass an
# earlier date here to go further -- every week is the full top 100 regardless.
WEEKLY_FLOOR = "2020-09-22"

WAYBACK_CDX = ("https://web.archive.org/cdx/search/cdx?url=itunes.apple.com/cn/rss/"
               "topgrossingapplications*&output=json&fl=timestamp,original"
               "&filter=statuscode:200&limit=10000")

# Appfigures' public Top Apps page for China iPhone. matchType=prefix: nearly every saved
# copy is a ?profile=product.N variant, and the plain URL alone holds only 18 days.
AF_PAGE = "appfigures.com/top-apps/ios-app-store/china/iphone/top-overall"
AF_CDX = ("https://web.archive.org/cdx/search/cdx?url=" + AF_PAGE + "&matchType=prefix"
          "&output=json&fl=timestamp,original&filter=statuscode:200&limit=20000")
AF_MIN_ROWS = 25              # the page lists 50 until late 2024, 30 after

# Common Crawl, the other public web archive: it crawls the web roughly monthly and keeps
# every capture as a byte range of a public WARC file, found through its CDX index. It
# holds Appfigures' China page (mostly the same days as the Wayback Machine, some not);
# Apple's feed itself it never captured. Its HTTPS chain needs an up-to-date CA store;
# on a machine whose store lacks it, point SSL_CERT_FILE at a CA bundle.
CC_COLLECTIONS = "https://index.commoncrawl.org/collinfo.json"
CC_DATA = "https://data.commoncrawl.org/"
CC_FROM = "CC-MAIN-2020-40"   # the crawl holding Genshin's launch week
CC_AF = "appfigures.com/top-apps/ios-app-store/china/*"

# AppFollow's free top charts keep Apple's real China chart for every past day, top 10 only.
# Read through the same endpoint its chart page calls. Its Terms bar scraping for commercial
# use; this site is open source and non-commercial, and the owner approved the pull on that
# basis. Paced at FOLLOW_PAUSE; a run stops as soon as AppFollow starts refusing.
FOLLOW_URL = "https://appfollow.io/rankings/top.json"
FOLLOW_FROM = "2020-09-28"    # Genshin's launch
FOLLOW_PAUSE = 4.0            # seconds between requests; 1.5 s drew 429s after ~450 days


# ---- http --------------------------------------------------------------------------
def fetch(url, tries=3, timeout=40, headers=None, data=None):
    """Bytes, gzip-decoded. Retries with backoff: the Wayback Machine refuses connections
    outright when it throttles, and that must read as "try later", not "no data". A 404
    is an answer rather than a hiccup, so it is raised at once."""
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers=dict(UA, **(headers or {})))
            raw = urllib.request.urlopen(req, timeout=timeout).read()
            return gzip.decompress(raw) if raw[:2] == b"\x1f\x8b" else raw
        except urllib.error.HTTPError as e:
            if e.code == 404:
                raise
            last = e
        except Exception as e:                       # noqa: BLE001 -- retried, then re-raised
            last = e
        time.sleep(4 * (i + 1))
    raise last


def fetch_json(url, **kw):
    return json.loads(fetch(url, **kw).decode("utf-8"))


_cc = {}


def cc_records(pattern):
    """Every capture (status 200) Common Crawl holds of a URL pattern, crawl by crawl since
    Genshin's launch, oldest first. A crawl with no capture answers 404."""
    if pattern not in _cc:
        out = []
        for c in fetch_json(CC_COLLECTIONS, timeout=60):
            if c["id"] < CC_FROM:
                continue
            try:
                body = fetch(c["cdx-api"] + "?output=json&url=" + pattern, timeout=60)
            except urllib.error.HTTPError as e:
                if e.code != 404:
                    print(f"  commoncrawl {c['id']}: skipped (HTTP {e.code})", file=sys.stderr)
                continue
            out += [r for r in (json.loads(l) for l in body.decode("utf-8").splitlines()
                                if l.strip()) if r.get("status") == "200"]
            time.sleep(1)
        _cc[pattern] = sorted(out, key=lambda r: r["timestamp"])
    return _cc[pattern]


def cc_body(r):
    """The HTTP body of one Common Crawl capture: its byte range of a public WARC file,
    past the WARC and HTTP headers."""
    off, n = int(r["offset"]), int(r["length"])
    rec = fetch(CC_DATA + r["filename"], tries=3, timeout=90,
                headers={"Range": "bytes=%d-%d" % (off, off + n - 1)})
    body = rec.split(b"\r\n\r\n", 2)[-1]
    return gzip.decompress(body) if body[:2] == b"\x1f\x8b" else body


# ---- storage -----------------------------------------------------------------------
def load(name, head):
    p = OUT / name
    if p.exists():
        try:
            d = json.loads(p.read_text(encoding="utf-8"))
            d.update({k: v for k, v in head.items() if k not in ("names", "days", "weeks")})
            return d
        except ValueError:
            print(f"{name}: unreadable, starting fresh", file=sys.stderr)
    return dict(head)


def save(name, doc, key):
    """One JSON document, but the dated map is written one entry per line: a daily run
    then commits a one-line diff instead of a hundred."""
    body = {k: v for k, v in doc.items() if k != key}
    head = json.dumps(body, ensure_ascii=False, indent=1)[:-2]
    rows = ["  %s: %s" % (json.dumps(d), json.dumps(doc[key][d], ensure_ascii=False,
                                                    separators=(",", ":")))
            for d in sorted(doc[key])]
    text = head + ',\n "%s": {\n' % key + ",\n".join(rows) + "\n }\n}\n"
    json.loads(text)                                  # never write a file that won't parse
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / name).write_text(text, encoding="utf-8")


def utc_iso(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---- China iOS ---------------------------------------------------------------------
def parse_cn(payload):
    """-> (chart datetime from Apple's own timestamp, [(id, name), ...])."""
    feed = payload["feed"]
    when = datetime.fromisoformat(feed["updated"]["label"])
    rows = [(e["id"]["attributes"]["im:id"], e["im:name"]["label"])
            for e in feed.get("entry", [])]
    return when, rows


def cn_doc(games=False):
    chart = "Games (genre 6014)" if games else "all apps"
    return load("cn_ios_games.json" if games else "cn_ios.json", {
        "source": "Apple iTunes RSS — China, iPhone, top-grossing, " + chart,
        "source_url": CN_FEED_GAMES if games else CN_FEED,
        "chart": "China iPhone App Store top-grossing, %s, top 100" % chart,
        "day_basis": "UTC date of Apple's own timestamp inside the feed",
        "note": ("Each day stores the full top 100 as ordered ids (rank = position). A "
                 "tracked game missing from a day's list did not make the top 100 that "
                 "day; a missing day means no snapshot. "
                 + ("Ranks are among games only. Days marked src=wayback come from "
                    "Internet Archive copies of this same feed URL. " if games else
                    "Ranks are across ALL apps, so games compete with Douyin, WeChat and "
                    "video apps -- beating them is the point. Days marked src=wayback are "
                    "Internet Archive copies of Apple's all-apps feed (only three since "
                    "Genshin's launch: 21 Oct 2020, 25 Dec 2021, 13 Feb 2023); otherwise it "
                    "starts the day this scrape did. More past days, 50 deep, are in "
                    "cn_ios_archive.json. ")
                 + "iPhone only -- China has no Google Play and no public Android chart. "
                 "Apple's feed sometimes returns 98-99 entries instead of 100 (seen live "
                 "and in archived copies alike); it doesn't say which one it dropped, so on "
                 "those days a game below the gap reads one place higher than it was."),
        "tracked": CN_TRACKED,
        "names": {},
        "days": {},
    })


def add_cn(doc, when, rows, src, extra=None, min_rows=MIN_ROWS):
    """Store one chart. False if the day is already held or the chart looks broken."""
    if len(rows) < min_rows:
        return False
    day = when.astimezone(timezone.utc).strftime("%Y-%m-%d")
    if day in doc["days"]:
        return False
    for i, n in rows:
        doc["names"][i] = n                           # latest name wins
    rec = {"t": utc_iso(when), "src": src, "ids": [i for i, _ in rows]}
    if extra:
        rec.update(extra)
    doc["days"][day] = rec
    return True


def cn_today(doc, url):
    when, rows = parse_cn(fetch_json(url))
    if len(rows) < MIN_ROWS:
        raise RuntimeError(f"feed returned {len(rows)} rows")
    return add_cn(doc, when, rows, "live"), when


def cn_backfill(doc, games=True):
    caps = fetch_json(WAYBACK_CDX, timeout=90)[1:]
    # only copies of the chart at full depth -- limit=50 variants would fail the row check
    # anyway, but skipping them saves a request each. The all-apps chart was saved under
    # "genre=25129", which is no App Store category: Apple ignores it and serves the
    # all-apps chart (mixed categories, titled 畅销 App 排名). Someone saved that URL
    # near-daily Dec 2019 - Feb 2020 (400-odd copies), then only now and then -- the only
    # all-apps copies of Apple's feed in the archive. Nothing tracked here existed before
    # Genshin (Sep 2020), so only copies from then on are fetched: 21 Oct 2020, 25 Dec
    # 2021 and 13 Feb 2023.
    want = ("genre=6014",) if games else ("genre=25129", "/limit=100/json")
    caps = sorted({(ts, orig) for ts, orig in caps
                   if any(w in orig for w in want) and orig.rstrip("/").endswith("json")
                   and "limit=50" not in orig
                   and (games or ("genre=" not in orig or "genre=25129" in orig)
                        and ts >= "20200901")})
    # a copy already imported carries its capture timestamp, so a re-run of --backfill
    # costs one CDX query instead of re-downloading every copy just to discard it
    have = {v.get("capture") for v in doc["days"].values() if v.get("capture")}
    added = 0
    for ts, orig in caps:
        if ts in have:
            continue
        try:
            when, rows = parse_cn(fetch_json(f"https://web.archive.org/web/{ts}id_/{orig}",
                                             tries=4, timeout=60))
        except Exception as e:                       # noqa: BLE001
            print(f"  wayback {ts}: skipped ({str(e)[:60]})", file=sys.stderr)
            continue
        if add_cn(doc, when, rows, "wayback", {"capture": ts}):
            added += 1
        time.sleep(1.2)                               # stay under the archive's throttle
    return added, len(caps)


def parse_af(page):
    """-> (chart datetime, [(Apple id, name), ...]) of the Top Grossing list, or None.
    The page embeds its three lists as JSON, {"results": [{"category": {"name": "Top
    Grossing", "subtype": "topgrossing"}, "timestamp": <chart hour>, "entries": [...]},
    ...]}, beside the free and paid ones."""
    dec = json.JSONDecoder()
    for m in re.finditer(r'"results"\s*:\s*\[', page):
        try:
            res, _ = dec.raw_decode(page, m.end() - 1)
        except ValueError:
            continue
        for r in res:
            if not (isinstance(r, dict) and r.get("timestamp")
                    and (r.get("category") or {}).get("subtype") == "topgrossing"):
                continue
            # an entry or two per list lacks an Apple id; it keeps its place under
            # Appfigures' own id, or every app below it would read one rank too high
            rows = [(str(e.get("vendor_identifier") or "af:%s" % e.get("id")), e.get("name", ""))
                    for e in r.get("entries", [])]
            return datetime.fromisoformat(r["timestamp"].replace("Z", "+00:00")), rows
    return None


def af_doc():
    return load("cn_ios_archive.json", {
        "source": "Appfigures Top Apps page (China, iPhone, Top Grossing), as saved by the "
                  "Internet Archive and Common Crawl",
        "source_url": "https://" + AF_PAGE,
        "chart": "China iPhone App Store top-grossing, all apps, top 50 (top 30 from 2025)",
        "day_basis": "UTC date of the chart hour Appfigures stamped on the list",
        "note": ("Past days only -- not updated daily. Each day is one Wayback Machine copy of "
                 "Appfigures' free chart page, which showed Apple's all-apps top-grossing "
                 "chart with Apple's own app ids (the same ids as cn_ios.json). t = the chart "
                 "hour Appfigures stamped on the list, capture = the archive's timestamp (the Wayback Machine, or Common Crawl where via=commoncrawl), depth "
                 "= rows the page showed. Coverage is only the days someone saved the page -- "
                 "2 in 2020, 22-28 a year in 2021-22, 43-83 a year in 2023-25 -- and a "
                 "tracked game missing from a day ranked below that day's depth. Kept apart "
                 "from cn_ios.json: someone else's copy, at another hour and depth."),
        "checked": ("Top 10 compared with AppFollow's record of the same chart (appfollow.io, "
                    "free, top 10 only) on 6 days of 2020-21: the same ten apps on 5 of them, "
                    "in the same order on 3 (the others ordered at another hour of the day). "
                    "The sixth, 2020-12-01, is stamped 16:00 UTC -- midnight in China -- and "
                    "lines up with AppFollow's 2 Dec instead: 9 of 10, Genshin #2 in both. "
                    "Days are UTC dates, so a chart stamped 16:00 UTC or later is already "
                    "the next day in China."),
        "tracked": CN_TRACKED,
        "names": {},
        "days": {},
    })


def af_backfill(doc):
    """Import every day the Wayback Machine or Common Crawl holds a copy of Appfigures'
    China page -- Wayback copies first, Common Crawl for the days it alone has."""
    by_day = {}
    for ts, orig in sorted(map(tuple, fetch_json(AF_CDX, timeout=120)[1:])):
        by_day.setdefault(ts[:8], []).append(
            (ts, "wayback", f"https://web.archive.org/web/{ts}id_/{orig}"))
    try:
        for r in cc_records(CC_AF):
            if "top-overall" in r["url"]:
                by_day.setdefault(r["timestamp"][:8], []).append((r["timestamp"], "commoncrawl", r))
    except Exception as e:                           # noqa: BLE001 -- Wayback copies still count
        print(f"  commoncrawl index: skipped ({str(e)[:60]})", file=sys.stderr)
    # a day already imported carries its capture timestamp, so a re-run only fetches new days
    held = {v["capture"][:8] for v in doc["days"].values() if v.get("capture")}
    added = 0
    for n, (d, copies) in enumerate(sorted(by_day.items()), 1):
        if d not in held:
            for ts, via, where in copies[:3]:        # a copy can be cut short; try the next
                try:
                    page = fetch(where, tries=4, timeout=90) if via == "wayback" else cc_body(where)
                    got = parse_af(page.decode("utf-8", "replace"))
                except Exception as e:               # noqa: BLE001
                    print(f"  appfigures {via} {ts}: skipped ({str(e)[:60]})", file=sys.stderr)
                    got = None
                time.sleep(1.5)                       # stay under the archives' throttles
                if got and len(got[1]) >= AF_MIN_ROWS:
                    extra = {"capture": ts, "depth": len(got[1])}
                    if via != "wayback":
                        extra["via"] = via
                    added += add_cn(doc, *got, "appfigures", extra, min_rows=AF_MIN_ROWS)
                    break
        if n % 25 == 0:
            print(f"  appfigures: {n}/{len(by_day)} saved days read, {added} imported",
                  flush=True)
            if doc["days"]:
                save("cn_ios_archive.json", doc, "days")   # a long run keeps what it has
    return added, len(by_day)


def follow_doc():
    return load("cn_ios_top10.json", {
        "source": "AppFollow free top charts (appfollow.io) -- China, iPhone, Top Grossing, "
                  "all categories",
        "source_url": "https://appfollow.io/rankings/iphone/cn/all-categories",
        "chart": "China iPhone App Store top-grossing, all apps, top 10",
        "day_basis": "the date AppFollow files the chart under",
        "note": ("Past days only -- not updated daily. Every day since Genshin's launch, but "
                 "only the top 10: a tracked game absent from a day was below #10 that day. "
                 "AppFollow records Apple's real chart (checked against cn_ios_archive.json: "
                 "the same ten apps on 5 of 6 days); it doesn't say at what hour it reads it, so "
                 "on days the chart moved it can differ from cn_ios.json's reading. A null id "
                 "is a rank AppFollow left empty. Pulled through AppFollow's own chart "
                 "endpoint for this open-source, non-commercial site."),
        "tracked": CN_TRACKED,
        "names": {},
        "days": {},
    })


def follow_day(day):
    """-> ([Apple id or None for ranks 1..10], {id: name}) of AppFollow's Top Grossing list
    for one day, or None when it answers for a different date."""
    res = json.loads(fetch(FOLLOW_URL, timeout=40, headers={"Content-Type": "application/json"},
                           data=json.dumps({"date": day, "device": "iphone", "genre": "0",
                                            "country": "cn"}).encode()).decode("utf-8"))
    if str(res.get("date", day))[:10] != day:
        return None
    gross = [x for x in res.get("result", []) if x.get("feed_type") == "gross" and x.get("pos")]
    ids = [None] * max((x["pos"] for x in gross), default=0)
    names = {}
    for x in gross:
        ids[x["pos"] - 1] = str(x["ext_id"])
        names[str(x["ext_id"])] = x.get("title", "")
    return ids, names


def follow_backfill(doc):
    """Every day from Genshin's launch to yesterday not held yet; an empty answer is left
    out, so a re-run retries it."""
    d = datetime.fromisoformat(FOLLOW_FROM).date()
    end = datetime.now(timezone.utc).date() - timedelta(days=1)
    added = empty = asked = refused = 0
    while d <= end:
        day = d.isoformat()
        d += timedelta(days=1)
        if day in doc["days"]:
            continue
        try:
            got = follow_day(day)
            refused = 0
        except urllib.error.HTTPError as e:
            print(f"  appfollow {day}: refused (HTTP {e.code})", file=sys.stderr)
            got = None
            refused += 1
            if refused >= 3:                          # it is saying stop: stop, resume another day
                print("  appfollow: refusing requests -- stopped; re-run later to resume",
                      file=sys.stderr)
                break
        except Exception as e:                       # noqa: BLE001
            print(f"  appfollow {day}: skipped ({str(e)[:60]})", file=sys.stderr)
            got = None
        if got and sum(1 for i in got[0] if i) >= 8:
            doc["names"].update(got[1])               # chronological, so the latest name wins
            doc["days"][day] = {"ids": got[0]}
            added += 1
        else:
            empty += 1
        asked += 1
        if asked % 50 == 0:
            print(f"  appfollow: up to {day}, {added} imported, {empty} empty", flush=True)
            save("cn_ios_top10.json", doc, "days")   # a long run keeps what it has
        time.sleep(FOLLOW_PAUSE)
    return added, empty


# ---- Steam -------------------------------------------------------------------------
def steam_head(kind):
    return {
        "source": ("Steam store search, global top sellers, games only" if kind == "daily"
                   else "Steam Web API — IStoreTopSellersService/GetWeeklyTopSellers, global"),
        "source_url": STEAM_DAILY if kind == "daily" else STEAM_WEEKLY,
        "chart": ("Steam global top sellers at snapshot time, games only, top 100"
                  if kind == "daily" else "Steam global weekly top sellers, top 100"),
        "day_basis": ("UTC date of the snapshot" if kind == "daily"
                      else "UTC start date of the week, as Valve reports it"),
        "note": ("Full top 100 as ordered appids (rank = position). A tracked game missing "
                 "from a list did not make the top 100; a missing date means no snapshot. "
                 "Ranked by revenue including in-game purchases. "
                 + ("Valve weighs the trailing 24h of spending toward the last 3 hours, so "
                    "this is a same-time-each-day slice of a rolling list. No free archive "
                    "exists, so history starts when this scrape did."
                    if kind == "daily" else
                    "Past weeks are requested directly from Valve, so this is complete "
                    "back to the backfill floor.")),
        "tracked": STEAM_TRACKED,
        "not_on_steam": STEAM_NOT_ON,
        "names": {},
        ("days" if kind == "daily" else "weeks"): {},
    }


def steam_daily(doc, now):
    items = fetch_json(STEAM_DAILY)["items"]
    rows = []
    for it in items:
        m = re.search(r"/apps/(\d+)/", it.get("logo", ""))
        if m:                                         # every entry is an app today; a
            rows.append((int(m.group(1)), it["name"]))   # bundle would simply be skipped
    if len(rows) < MIN_ROWS:
        raise RuntimeError(f"search returned {len(rows)} apps")
    day = now.strftime("%Y-%m-%d")
    if day in doc["days"]:
        return False
    for a, n in rows:
        doc["names"][str(a)] = n
    doc["days"][day] = {"t": utc_iso(now), "ids": [a for a, _ in rows]}
    return True


def weekly_page(start=None):
    q = {"context": {"language": "english", "country_code": "US"},
         "data_request": {"include_basic_info": True},
         "page_start": 0, "page_count": 100}
    if start:
        q["start_date"] = start                       # no country_code at top level = global
    r = fetch_json(STEAM_WEEKLY + "?input_json=" + urllib.parse.quote(json.dumps(q)))["response"]
    ranks = sorted(r.get("ranks", []), key=lambda x: x["rank"])
    return r.get("start_date"), ranks


def add_week(doc, start, ranks):
    if not start or len(ranks) < MIN_ROWS:
        return False
    wk = datetime.fromtimestamp(start, timezone.utc).strftime("%Y-%m-%d")
    if wk in doc["weeks"]:
        return False
    for x in ranks:
        name = ((x.get("item") or {}).get("name"))
        if name:
            doc["names"][str(x["appid"])] = name
    doc["weeks"][wk] = {"ids": [x["appid"] for x in ranks]}
    return True


def steam_weekly(doc, backfill):
    start, ranks = weekly_page()
    added = int(add_week(doc, start, ranks))
    if backfill and start:
        floor = datetime.fromisoformat(WEEKLY_FLOOR).replace(tzinfo=timezone.utc).timestamp()
        s = start - 7 * 86400
        while s >= floor:
            wk = datetime.fromtimestamp(s, timezone.utc).strftime("%Y-%m-%d")
            if wk not in doc["weeks"]:
                try:
                    got, rk = weekly_page(s)
                except Exception as e:               # noqa: BLE001
                    print(f"  week {wk}: skipped ({str(e)[:60]})", file=sys.stderr)
                    got, rk = None, []
                if not rk:                            # ran off the end of Valve's archive
                    print(f"  weekly archive ends before {wk}")
                    break
                added += add_week(doc, got, rk)
                time.sleep(0.6)
            s -= 7 * 86400
    return added


# ---- report ------------------------------------------------------------------------
def where(doc, key, day, tracked):
    ids = doc[key].get(day, {}).get("ids", [])
    pos = {str(x): i + 1 for i, x in enumerate(ids)}
    return ", ".join(f"{t} #{pos[str(i)]}" if str(i) in pos else f"{t} —"
                     for t, i in tracked.items())


def main():
    backfill = "--backfill" in sys.argv
    now = datetime.now(timezone.utc)
    ok = 0

    if backfill or "--appfigures" in sys.argv:
        ar = af_doc()
        try:
            got, seen = af_backfill(ar)
            last = max(ar["days"]) if ar["days"] else "-"
            print(f"cn_arch  appfigures: {got} new days from {seen} saved days, "
                  f"{len(ar['days'])} held | {last}: {where(ar, 'days', last, CN_TRACKED)}")
        except Exception as e:                       # noqa: BLE001
            print(f"cn_arch  appfigures FAILED: {e}", file=sys.stderr)
        if ar["days"]:
            save("cn_ios_archive.json", ar, "days")

    if backfill or "--appfollow" in sys.argv:
        fd = follow_doc()
        try:
            got, empty = follow_backfill(fd)
            last = max(fd["days"]) if fd["days"] else "-"
            print(f"cn_top10 appfollow: {got} new days ({empty} empty), {len(fd['days'])} held | "
                  f"{last}: {where(fd, 'days', last, CN_TRACKED)}")
        except Exception as e:                       # noqa: BLE001
            print(f"cn_top10 appfollow FAILED: {e}", file=sys.stderr)
        if fd["days"]:
            save("cn_ios_top10.json", fd, "days")

    if not backfill and ("--appfigures" in sys.argv or "--appfollow" in sys.argv):
        return                                        # a one-archive run skips the live charts

    held = {}
    for games in (False, True):
        tag = "cn_games" if games else "cn_ios  "
        doc = cn_doc(games)
        try:
            added, when = cn_today(doc, CN_FEED_GAMES if games else CN_FEED)
            day = when.astimezone(timezone.utc).strftime("%Y-%m-%d")
            print(f"{tag} {day}: {'saved' if added else 'already had today'} | "
                  f"{where(doc, 'days', day, CN_TRACKED)}")
            ok += 1
        except Exception as e:                       # noqa: BLE001
            print(f"{tag} FAILED: {e}", file=sys.stderr)
        if backfill:
            try:
                got, seen = cn_backfill(doc, games)
                print(f"{tag} wayback: {got} new days from {seen} saved copies")
            except Exception as e:                   # noqa: BLE001
                print(f"{tag} wayback FAILED: {e}", file=sys.stderr)
        if doc["days"]:
            save("cn_ios_games.json" if games else "cn_ios.json", doc, "days")
        held[tag.strip()] = len(doc["days"])

    sd = load("steam_daily.json", steam_head("daily"))
    try:
        added = steam_daily(sd, now)
        day = now.strftime("%Y-%m-%d")
        print(f"steam_d  {day}: {'saved' if added else 'already had today'} | "
              f"{where(sd, 'days', day, STEAM_TRACKED)}")
        save("steam_daily.json", sd, "days")
        ok += 1
    except Exception as e:                           # noqa: BLE001
        print(f"steam_d  FAILED: {e}", file=sys.stderr)

    sw = load("steam_weekly.json", steam_head("weekly"))
    try:
        added = steam_weekly(sw, backfill)
        latest = max(sw["weeks"]) if sw["weeks"] else "-"
        print(f"steam_w  week of {latest}: {added} new week(s), {len(sw['weeks'])} held | "
              f"{where(sw, 'weeks', latest, STEAM_TRACKED) if sw['weeks'] else ''}")
        if sw["weeks"]:
            save("steam_weekly.json", sw, "weeks")
        ok += 1
    except Exception as e:                           # noqa: BLE001
        print(f"steam_w  FAILED: {e}", file=sys.stderr)

    print(f"history: cn_ios {held.get('cn_ios', 0)} days · cn_games {held.get('cn_games', 0)} days · "
          f"steam_daily {len(sd['days'])} days · "
          f"steam_weekly {len(sw['weeks'])} weeks")
    if not ok:
        sys.exit(1)                                   # every source down: show it in the log


if __name__ == "__main__":
    main()
