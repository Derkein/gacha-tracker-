#!/usr/bin/env python3
"""Build the site's China iOS rank series: data/ranks/cn_ios_series.json.

One source: **AppFollow, signed in** -- the real China all-apps top-grossing chart, 200
deep, every day from Genshin's launch (28 Sep 2020) onward. Mixing shallower or
differently-timed sources into the same line made days incomparable (a game "missing"
could mean below #10, below #50 or below #200 depending on who recorded that day), so
they are collected but no longer merged here.

The site can't carry the 400k-row chart database and doesn't need to -- it only cares
where the tracked games sat, so this reduces it to two small maps:

  days  : date -> [depth, source]   how deep that day's chart is known
  games : tag  -> {date: rank}      where each tracked game sat that day

A game missing from a day that IS in `days` sat below that day's depth -- a real reading,
not a gap. A date missing from `days` is a day AppFollow has no grossing chart for (there
are 16 of those; see the README).

Reads ../cn-ios-grossing/cn_grossing.sqlite, where the backfill stores its rows. Days
already in the output survive a run made without the database, so a scheduled job can
append the newest day without the whole history being present.
"""
from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RANKS = ROOT / "data" / "ranks"
OUT = RANKS / "cn_ios_series.json"
DB = ROOT.parent / "cn-ios-grossing" / "cn_grossing.sqlite"
SOURCE = "appfollow"

sys.path.insert(0, str(ROOT / "scripts"))
from scrape_ranks import CN_TRACKED                      # noqa: E402  (tag -> Apple id)

BY_ID = {v: k for k, v in CN_TRACKED.items()}


def from_db(days, games):
    if not DB.exists():
        print(f"  (no {DB.name} beside the repo -- keeping what the file already holds)")
        return 0
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    rows = con.execute(
        """SELECT date, rank, app_id FROM rankings
           WHERE country='cn' AND category='overall' AND source=?
           ORDER BY date, rank""", (SOURCE,)).fetchall()
    con.close()
    per: dict[str, list] = {}
    for date, rank, app in rows:
        per.setdefault(date, []).append((rank, app))
    for date, items in per.items():
        depth = max(r for r, _ in items)
        if depth < 5:
            continue
        days[date] = [depth, SOURCE]
        for tag in list(games):
            games[tag].pop(date, None)
        for rank, app in items:
            tag = BY_ID.get(str(app))
            if tag:
                games.setdefault(tag, {})[date] = rank
    return len(per)


def main():
    doc = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    # anything from the old multi-source build is dropped: one source, one basis
    days = {d: list(v) for d, v in doc.get("days", {}).items() if v[1] == SOURCE}
    games = {t: {d: r for d, r in v.items() if d in days} for t, v in doc.get("games", {}).items()}

    n = from_db(days, games)
    print(f"  cn_grossing.sqlite: {n} day(s) of AppFollow chart read")

    out = {
        "what": "Where each tracked game sat on China's iPhone App Store top-grossing chart "
                "(all apps), day by day.",
        "source": "AppFollow, signed in -- the real store chart, 200 deep",
        "day_basis": "the date AppFollow files the chart under",
        "note": ("days[date] = [how deep that day's chart is known, the source]; "
                 "games[tag][date] = that game's rank that day. A game missing from a day "
                 "listed in days sat BELOW that day's depth -- a real reading, not a gap. A "
                 "date absent from days is one AppFollow has no grossing chart for. Only this "
                 "one source is used, so every day is measured the same way."),
        "tracked": CN_TRACKED,
        "days": dict(sorted(days.items())),
        "games": {t: dict(sorted(v.items())) for t, v in sorted(games.items()) if v},
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    deep = sum(1 for d in days.values() if d[0] >= 190)
    print(f"cn_ios_series: {len(days)} days ({deep} of them 200 deep) -> {OUT.name} "
          f"({OUT.stat().st_size/1024:.0f} KB)")
    for tag in sorted(out["games"]):
        got = out["games"][tag]
        print(f"  {tag:9s} {len(got):5d} days on the chart, best #{min(got.values())}")


if __name__ == "__main__":
    main()
