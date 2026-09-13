#!/usr/bin/env python3
"""Merge one chunk of the AppFollow pull into data/ranks/cn_ios_appfollow.json.

The chart sits behind the user's own logged-in AppFollow session, which lives in the
browser and stays there. The page fetches each day (200 deep, back to Genshin's launch)
and hands over a compact summary per day:

    {"2020-09-28": [depth, {tag: rank, ...}, [top 3 app ids]]}

Only the tracked games' positions, the day's depth and its top three travel -- enough for
everything the site draws, without moving 200 rows a day through anything.

    python scripts/import_appfollow_chunk.py < chunk.json
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "data" / "ranks" / "cn_ios_appfollow.json"


def main() -> int:
    chunk = json.load(sys.stdin)
    doc = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {
        "source": "AppFollow top charts, signed in (watch.appfollow.io/rankings/top.json)",
        "chart": "China iPhone App Store top-grossing, all apps, 200 deep",
        "day_basis": "the date AppFollow files the chart under",
        "note": ("Signed out that endpoint answers 10 ranks; signed in it answers 200, for "
                 "every day back to Genshin's launch. Each day here is [depth, {game: rank}, "
                 "[top 3 app ids]] -- the tracked games' positions rather than the whole list, "
                 "because the session stays in the browser and only this summary is carried "
                 "out of it. A game absent from a day sat below that day's depth."),
        "days": {},
    }
    before = len(doc["days"])
    doc["days"].update(chunk)
    doc["days"] = dict(sorted(doc["days"].items()))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    days = doc["days"]
    print(f"appfollow chunk: +{len(days)-before} day(s), {len(days)} held "
          f"({min(days)} -> {max(days)}), {OUT.stat().st_size/1024:.0f} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
