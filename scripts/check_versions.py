#!/usr/bin/env python3
"""
Guard the "by Version" grouping against silently going stale.

The major-version (X.0) launch dates live in app.js (const VERSIONS). game-i's data
carries no version field, so those dates are the only way banners get bucketed into
1.X / 2.X / … — and if a game ships a new major version and nobody adds its date,
every new banner is wrongly lumped into the previous major.

This runs on every scrape: it reads VERSIONS from app.js, buckets each versioned
game's banners, and prints the mapping. If a game's newest banner sits more than
~400 days past its latest known version boundary (majors have been ~yearly), it
almost certainly means a new major launched — so it warns to add the date to app.js.
Informational only; never fails the build.
"""
import json, re
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
APP = ROOT / "app.js"
STALE_DAYS = 400        # majors have run ~11-13 months; well past that => likely a missed major


def load_versions():
    """Parse `const VERSIONS = { tag: [["1.X","YYYY-MM-DD"], …], … };` out of app.js."""
    txt = APP.read_text(encoding="utf-8")
    m = re.search(r"const VERSIONS\s*=\s*\{(.*?)\n\};", txt, re.S)
    if not m:
        return {}
    out = {}
    for line in m.group(1).splitlines():
        lm = re.match(r"\s*(\w+):\s*\[(.*?)\],?\s*(?://.*)?$", line)
        if not lm:
            continue
        pairs = re.findall(r'\["([^"]+)"\s*,\s*"([^"]+)"\]', lm.group(2))
        if pairs:
            out[lm.group(1)] = pairs
    return out


def version_of(anchors, start):
    cur = anchors[0][0]
    for label, d in anchors:
        if start >= d:
            cur = label
        else:
            break
    return cur


def main():
    versions = load_versions()
    if not versions:
        print("[versions] could not parse VERSIONS from app.js"); return
    warnings = 0
    for tag, anchors in versions.items():
        f = DATA / f"{tag}.json"
        if not f.exists():
            continue
        banners = [b for b in json.loads(f.read_text(encoding="utf-8")).get("banners", [])
                   if not b.get("_synthetic")]
        if not banners:
            continue
        latest = max(banners, key=lambda b: b["start"])
        lv = version_of(anchors, latest["start"])
        last_label, last_date = anchors[-1]
        gap = (date.fromisoformat(latest["start"]) - date.fromisoformat(last_date)).days
        flag = gap > STALE_DAYS
        print(f"[versions] {tag:9} {len(anchors)} majors (latest {last_label} @ {last_date}); "
              f"newest banner {latest['start']} -> {lv}  ({gap}d past last boundary)"
              f"{'   *** likely a NEW major version — add its X.0 date to VERSIONS in app.js ***' if flag else ''}")
        warnings += flag
    if warnings:
        print(f"[versions] {warnings} game(s) may be missing a major-version entry — verify and update app.js.")
    else:
        print("[versions] all versioned games map cleanly to a known major version.")


if __name__ == "__main__":
    main()
