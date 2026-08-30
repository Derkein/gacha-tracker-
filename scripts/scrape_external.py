#!/usr/bin/env python3
"""
Build the GACHAREVENUE (revenue.ennead.cc) global monthly revenue series from
eog.gg's raw data and write data/external_revenue.json.

This is a *comparison* layer against our own game-i figures. The two are NOT the
same measurement and must never be summed or plotted on one axis:

    game-i (data/<tag>.json .monthly)   JP iOS-regressed estimate, in 億G (¥100M)
    this file                           global mobile estimate, in USD, net of the
                                        30% store cut, combined across all regions

Why reconstruct instead of scraping gacharevenue directly: gacharevenue's own API
is auth-gated. But its numbers are Sensor Tower data with a China-Android model, and
eog.gg publishes the same Sensor Tower data (as one static JS bundle, no auth) split
by region. We verified — to the dollar, across all 10 tracked games and many months —
that gacharevenue equals:

    gacharevenue[month] = eog_combined[month] + 1.75 * eog_China[month]

China's App Store is tracked but Google Play doesn't exist there, so eog's "China"
figure is China-iOS only; gacharevenue models the untracked China-Android at 1.75x
that and adds it on top of eog's already-China-iOS-inclusive combined total. Applying
one formula to every month gives a single consistent series (no method break).

eog.gg only has combined+China for months up to its own latest (its newest month
switches to a blended method with no separate China split); for that one month we
fall back to eog's published combined value (already ~China-modelled) and flag it
`approx`. Pure standard library: fetch /revenue/, find the content-hashed
`revenue-*.js`, read the embedded `Q=[…]` array.
"""
CN_ANDROID_MULT = 1.75      # gacharevenue models China-Android as 1.75x China-iOS
import re, json, urllib.request, urllib.error
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
BASE = "https://eog.gg"
UA = {"User-Agent": "Mozilla/5.0 (gacha-tracker; +https://github.com/)"}

# our tracker tag -> eog.gg game id (see scrape.py GAMES for the tags)
EOG_ID = {
    "genshin":     "genshin-impact",
    "hsr":         "star-rail",
    "zzz":         "zenless",
    "wuwa":        "wuthering-waves",
    "nte":         "neverness-to-everness",
    "endfield":    "arknights-endfield",
    "uma":         "uma-musume",
    "fgo":         "fate-grand-order",
    "bluearchive": "blue-archive",
    "arknights":   "arknights",
}


def fetch(url, tries=3):
    import time
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            return urllib.request.urlopen(req, timeout=40).read().decode("utf-8", "replace")
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(1.5 * (i + 1))


def bundle_url():
    """The revenue-*.js filename is content-hashed and changes on every data update,
    so resolve it fresh from the /revenue/ page each run."""
    html = fetch(BASE + "/revenue/")
    m = re.search(r'/assets/revenue-[A-Za-z0-9_-]+\.js', html)
    if not m:
        raise RuntimeError("could not find revenue bundle URL on /revenue/")
    return BASE + m.group(0)


def _balanced(text, start):
    """Return the substring of a []/{} literal beginning at `text[start]`."""
    depth, in_str, esc = 0, False, False
    for i in range(start, len(text)):
        c = text[i]
        if in_str:
            if esc:      esc = False
            elif c == "\\": esc = True
            elif c == '"': in_str = False
            continue
        if c == '"':          in_str = True
        elif c in "[{":       depth += 1
        elif c in "]}":
            depth -= 1
            if depth == 0:
                return text[start:i + 1]
    raise RuntimeError("unbalanced literal")


def js_array_to_json(js):
    """The bundle's data is a JS array literal that is almost JSON: keys are
    unquoted and booleans are minified to !0/!1. Numbers already use JSON-legal
    exponent form (5599e4). Fix the two differences and parse."""
    js = re.sub(r":!1\b", ":false", js)
    js = re.sub(r":!0\b", ":true", js)
    js = re.sub(r'([{,])([A-Za-z_][A-Za-z0-9_]*):', r'\1"\2":', js)
    return json.loads(js)


def ym(mmyyyy):
    """'07-2026' -> '2026-07'."""
    mm, yyyy = mmyyyy.split("-")
    return f"{yyyy}-{mm}"


def main():
    src = bundle_url()
    js = fetch(src)

    months = [ym(x) for x in re.search(r'months:\[([^\]]+)\]', js).group(1).replace('"', "").split(",")]
    latest = ym(re.search(r'latest_month:"([^"]+)"', js).group(1))

    q_at = js.rindex("[{", 0, js.index('id:"genshin-impact"') + 1)
    games = js_array_to_json(_balanced(js, q_at))
    by_id = {g["id"]: g for g in games}

    out = {
        "source": "gacharevenue (reconstructed from eog.gg raw Sensor Tower data)",
        "source_url": "https://revenue.ennead.cc",
        "raw_source_url": BASE + "/revenue/",
        "bundle": src,
        "fetched": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "unit": "usd",
        "formula": f"gacharevenue = eog_combined + {CN_ANDROID_MULT} * eog_China",
        "note": ("Global mobile revenue estimate (iOS + Android), net of the 30% store "
                 "cut, combined across all regions, matching gacharevenue (revenue.ennead.cc). "
                 "Computed from eog.gg's per-region Sensor Tower data by modelling untracked "
                 "China-Android at 1.75x China-iOS. NOT comparable to game-i's JP-iOS 億G "
                 "figures; shown side by side, never summed."),
        "months": months,
        "latest_month": latest,
        "games": {},
    }

    for tag, eid in EOG_ID.items():
        g = by_id.get(eid)
        if not g:
            print(f"[external] WARN {tag}: eog id {eid!r} not found")
            continue
        combined = g.get("combined", {}).get("series") or []
        cn_r = next((r for r in g.get("regions", []) if r.get("region") == "CN"), None)
        cn = (cn_r or {}).get("series") or []
        monthly = {}
        for i, mkey in enumerate(months):
            base = combined[i] if i < len(combined) else None
            if base is None:
                continue                               # game not live / not tracked that month
            china = cn[i] if i < len(cn) else None
            if china is not None:
                # full gacharevenue formula: base already includes China-iOS; add China-Android
                monthly[mkey] = {"rev": round(base + CN_ANDROID_MULT * china), "method": "gr"}
            else:
                # eog's latest month has no separate China split (blended method); its
                # published combined already ~models China-Android, so use it as-is.
                monthly[mkey] = {"rev": round(base), "method": "approx"}
        out["games"][tag] = {"eog_id": eid, "name": g.get("name"), "monthly": monthly}

    (DATA / "external_revenue.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    ng = len(out["games"])
    npts = sum(len(v["monthly"]) for v in out["games"].values())
    approx = sum(1 for v in out["games"].values() for m in v["monthly"].values() if m["method"] == "approx")
    print(f"[external] wrote data/external_revenue.json — {ng} games, {npts} month-points "
          f"({approx} approx), range {months[0]}..{latest}")


if __name__ == "__main__":
    main()
