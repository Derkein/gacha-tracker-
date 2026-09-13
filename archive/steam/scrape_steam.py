#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Sample Steam's live concurrent-player count for the games that are on Steam.

Everything else on this site is a third-party *estimate* of money. This is the one
number that is actually measured and published by the platform itself -- Valve's own
count of who is in the game right now -- so it is worth having even though it covers
only part of the roster and says nothing about revenue.

    https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=N

No API key, no auth, no rate limit worth worrying about at this size.

WHAT IT IS NOT
  * Not a daily peak. The refresh workflow fires a few times inside one hour after
    game-i's midnight-JST rollover, so we keep ONE reading per UTC day, taken at
    roughly the same wall-clock time every day (~00:30 JST). That is a fixed-time
    slice, not the day's high -- but it is comparable day to day, which is what a
    trend needs. Bumping to a real peak means sampling every few hours, which is a
    cron change here and nothing else.
  * Not the whole player base. Steam only counts players who launched through Steam;
    the same game's mobile, PlayStation and standalone-launcher players are invisible.
    So the number is a floor, and the ratio between two games reflects how PC-heavy
    each one is as much as how big it is.
  * Not backfillable. Valve publishes the current count and nothing else, so history
    starts the day this script first runs. SteamDB has the archive but is explicitly
    not scrapable.

Genshin and Star Rail are not on Steam at all (HoYoverse ships its own launcher) and
never will be, so they are listed here with a reason rather than left silently absent.

    python scripts/scrape_steam.py
"""

import datetime
import io
import json
import os
import sys
import urllib.error
import urllib.request

if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

OUT = os.path.join("data", "steam_players.json")
API = "https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=%d"
UA = "gacha-tracker (+https://github.com/Derkein/gacha-tracker-)"
KEEP_DAYS = 400          # rolling window, so the file can't grow without bound
TIMEOUT = 20

# Steam app ids, resolved from the store search API and verified against a live call.
APPS = {
    "zzz":      4162040,
    "wuwa":     3513350,
    "nte":      4508340,
    "uma":      3224770,
    # Store page is up but the build is still "coming soon", so the API answers with
    # result 42 (no such stats yet). Left in on purpose: the day it launches this
    # starts returning numbers with no code change.
    "endfield": 4732690,
}
# Tracked games that will never appear above, with the reason, so the page can say
# "not on Steam" instead of showing a hole.
NOT_ON_STEAM = {
    "genshin": "HoYoverse ships Genshin through its own launcher and the Epic Games "
               "Store, never Steam.",
    "hsr":     "HoYoverse ships Star Rail through its own launcher and the Epic Games "
               "Store, never Steam.",
}


def fetch(appid):
    """-> (player_count, None) | (None, reason)."""
    req = urllib.request.Request(API % appid, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            body = json.load(r)
    except (urllib.error.URLError, ValueError, OSError) as e:
        return None, "request failed: %s" % e
    resp = body.get("response") or {}
    # result 1 = ok. Anything else (42 = no stats for this app) means the app exists
    # but has no live count -- an unreleased build, or a delisted one.
    if resp.get("result") != 1 or "player_count" not in resp:
        return None, "steam result %s" % resp.get("result")
    return int(resp["player_count"]), None


def load():
    try:
        with io.open(OUT, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def main():
    prev = load()
    games = prev.get("games") or {}
    now = datetime.datetime.now(datetime.timezone.utc)
    today = now.strftime("%Y-%m-%d")
    cutoff = (now - datetime.timedelta(days=KEEP_DAYS)).strftime("%Y-%m-%d")

    added, held, failed = [], [], []
    for tag, appid in sorted(APPS.items()):
        g = games.setdefault(tag, {"appid": appid, "samples": {}})
        g["appid"] = appid
        count, why = fetch(appid)
        if count is None:
            g["status"] = why
            failed.append("%s (%s)" % (tag, why))
        else:
            g.pop("status", None)
            # One reading per UTC day. The workflow fires several times inside the
            # same hour, so a later run today would only re-measure the same slice --
            # keeping the first makes every day's sample the same time of day.
            if today in g["samples"]:
                held.append("%s %d" % (tag, g["samples"][today]))
            else:
                g["samples"][today] = count
                added.append("%s %d" % (tag, count))
            g["samples"] = {d: v for d, v in sorted(g["samples"].items()) if d >= cutoff}
            vals = g["samples"]
            if vals:
                peak_day = max(vals, key=lambda d: vals[d])
                g["peak"] = {"day": peak_day, "n": vals[peak_day]}
                g["latest"] = {"day": max(vals), "n": vals[max(vals)]}

    out = {
        "source": "Steam Web API — ISteamUserStats/GetNumberOfCurrentPlayers",
        "source_url": "https://partner.steamgames.com/doc/webapi/isteamuserstats",
        "unit": "concurrent players",
        "sampled": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "note": ("One reading per UTC day, taken at roughly the same wall-clock time "
                 "each day (~00:30 JST) — a fixed-time slice, NOT the day's peak. "
                 "Steam counts only players who launched through Steam, so mobile, "
                 "PlayStation and standalone-launcher players are not included and "
                 "the figure is a floor. Valve publishes only the current count, so "
                 "history begins when this scrape did and cannot be backfilled."),
        "keep_days": KEEP_DAYS,
        "not_on_steam": NOT_ON_STEAM,
        "games": {k: games[k] for k in sorted(games)},
    }
    with io.open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    print("sampled  : %s" % (", ".join(added) if added else "none"))
    if held:
        print("already had today: %s" % ", ".join(held))
    if failed:
        print("no count : %s" % ", ".join(failed))
    for tag in sorted(out["games"]):
        g = out["games"][tag]
        n = len(g.get("samples") or {})
        print("  %-9s %3d day%s of history%s" % (tag, n, "" if n == 1 else "s",
              ("  peak %d on %s" % (g["peak"]["n"], g["peak"]["day"])) if g.get("peak") else ""))
    print("wrote %s (%d bytes)" % (OUT, os.path.getsize(OUT)))


if __name__ == "__main__":
    main()
