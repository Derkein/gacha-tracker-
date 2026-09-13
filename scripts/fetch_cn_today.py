#!/usr/bin/env python3
"""Keep the China chart series current: fetch the newest days from AppFollow.

The backfill filled 2020-09-28 onward from the same source; this is the daily top-up, so
the site's newest days are measured exactly like its oldest ones. It runs in CI, where
the chart database isn't available, so it writes straight to the two files the repo keeps:

  data/ranks/cn_ios_series.json          what the site draws (depth + the tracked ranks)
  data/ranks/cn_ios_appfollow_days.jsonl the whole 200-app list per day, one line each

Two ways in, in order of preference:

  APPFOLLOW_TOKEN  an API token from the AppFollow account's API page -- the official
                   endpoint, and the token does not expire the way a session does. Costs
                   10 of the account's monthly API credits per day fetched (a free
                   account gets 500 a month, so a daily run uses 300).
  AF_COOKIE        the browser session cookie, same request the chart page makes. Works,
                   but expires every few weeks and then every run is refused.

With neither set the script says so and exits 0 -- a missing key is a skipped day, never
a failed refresh. Staleness is what actually matters, so `--check-only` exits non-zero
when the newest day held is too old, which is the signal worth turning a CI run red.

    python scripts/fetch_cn_today.py              # any of the last 4 days still missing
    python scripts/fetch_cn_today.py --days 10
    python scripts/fetch_cn_today.py --check-only # no requests; fails if the data is stale
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RANKS = ROOT / "data" / "ranks"
SERIES = RANKS / "cn_ios_series.json"
RAW = RANKS / "cn_ios_appfollow_days.jsonl"
API_TOKEN_URL = "https://api.appfollow.io/api/v2/charts/topcharts"   # official, token
API_SESSION_URL = "https://watch.appfollow.io/rankings/top.json"     # the page's own call

sys.path.insert(0, str(ROOT / "scripts"))
from scrape_ranks import CN_TRACKED                      # noqa: E402

BY_ID = {v: k for k, v in CN_TRACKED.items()}


def _grossing(payload) -> list[tuple[int, str]]:
    return sorted((x["pos"], str(x["ext_id"])) for x in payload.get("result", [])
                  if x.get("feed_type") == "gross" and x.get("pos"))


def fetch_day(day: str, token: str, cookie: str):
    """-> [(rank, app id), ...] for that day's grossing chart, or None when refused.

    genre=0 is the all-apps chart -- games alongside Douyin, WeChat and the video apps,
    which is the whole point of watching China's."""
    if token:
        url = (f"{API_TOKEN_URL}?country=cn&device=iphone&genre=0&date={day}")
        req = urllib.request.Request(url, headers={
            "X-AppFollow-API-Token": token, "Accept": "application/json",
            "User-Agent": "gacha-tracker (+https://github.com/)"})
    else:
        body = json.dumps({"date": day, "device": "iphone", "genre": "0",
                           "country": "cn"}).encode()
        req = urllib.request.Request(API_SESSION_URL, data=body, headers={
            "Content-Type": "application/json", "Accept": "application/json",
            "Origin": "https://watch.appfollow.io", "Referer": "https://watch.appfollow.io/",
            "User-Agent": "Mozilla/5.0 (gacha-tracker; +https://github.com/)", "Cookie": cookie})
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            j = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        why = {401: "token rejected", 402: "out of API credits", 400: "refused (allowance spent?)"}
        print(f"  {day}: HTTP {e.code} -- {why.get(e.code, 'refused')}", file=sys.stderr)
        return None
    if not token and str(j.get("date") or "")[:10] != day:
        return None                                      # session endpoint answered another date
    return _grossing(j) or None


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--days", type=int, default=4, help="how far back to look for missing days")
    p.add_argument("--delay", type=float, default=2.0)
    p.add_argument("--check-only", action="store_true",
                   help="fetch nothing; exit 1 if the newest day held is older than --max-age")
    p.add_argument("--max-age", type=int, default=3, help="days before the series counts as stale")
    args = p.parse_args(argv)

    if args.check_only:
        doc = json.loads(SERIES.read_text(encoding="utf-8")) if SERIES.exists() else {"days": {}}
        held = doc.get("days", {})
        if not held:
            print("china chart: nothing held at all", file=sys.stderr)
            return 1
        newest = max(held)
        age = (dt.date.today() - dt.date.fromisoformat(newest)).days
        print(f"china chart: newest day {newest} ({age} day(s) old), {len(held)} held")
        if age > args.max_age:
            print(f"china chart is STALE -- nothing newer than {newest}. The API token or "
                  f"session cookie has probably stopped working.", file=sys.stderr)
            return 1
        return 0

    token = os.environ.get("APPFOLLOW_TOKEN", "").strip()
    cookie = os.environ.get("AF_COOKIE", "").strip()
    if not token and not cookie:
        print("no APPFOLLOW_TOKEN or AF_COOKIE set -- skipping the China chart for today")
        return 0
    print(f"china chart: using {'the API token' if token else 'the session cookie'}")

    doc = json.loads(SERIES.read_text(encoding="utf-8")) if SERIES.exists() else {
        "what": "Where each tracked game sat on China's iPhone App Store top-grossing chart "
                "(all apps), day by day.",
        "source": "AppFollow, signed in -- the real store chart, 200 deep",
        "tracked": CN_TRACKED, "days": {}, "games": {},
    }
    days, games = doc.setdefault("days", {}), doc.setdefault("games", {})

    today = dt.date.today()
    added = 0
    for back in range(args.days):
        day = (today - dt.timedelta(days=back)).isoformat()
        if day in days:
            continue
        rows = fetch_day(day, token, cookie)
        if not rows:
            continue
        days[day] = [max(r for r, _ in rows), "appfollow"]
        for rank, app in rows:
            tag = BY_ID.get(app)
            if tag:
                games.setdefault(tag, {})[day] = rank
        with RAW.open("a", encoding="utf-8") as f:       # the whole chart, kept in the repo
            f.write(json.dumps({"date": day, "ids": [a for _, a in rows]},
                               ensure_ascii=False) + "\n")
        added += 1
        print(f"  {day}: {len(rows)} ranks stored")
        time.sleep(args.delay)

    if added:
        doc["days"] = dict(sorted(days.items()))
        doc["games"] = {t: dict(sorted(v.items())) for t, v in sorted(games.items())}
        SERIES.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")),
                          encoding="utf-8")
    print(f"cn chart: {added} new day(s), {len(days)} held "
          f"({min(days)} -> {max(days)})" if days else "cn chart: nothing held yet")
    return 0


if __name__ == "__main__":
    sys.exit(main())
