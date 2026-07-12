#!/usr/bin/env python3
"""
Attach character portraits to scraped banners.

Reads data/<tag>.json (from scrape.py) and icons/<tag>.json (from
build_icons.py) and, for each banner, resolves its headline
character(s) to Enka portraits + an accent color by fuzzy-matching the
Japanese banner title against the character map.

Games with no icon map are left untouched (the site falls back to the
official banner art). Safe to re-run; it only adds fields.
"""
import json, re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
ICONS = ROOT / "icons"

# characters that split a bundle/duo banner title
SPLIT = re.compile(r"[&＆/／、,]|復刻")
# punctuation to ignore when comparing names
STRIP = re.compile(r"[\س「」『』（）()・･\.\-\s　]", re.U) if False else re.compile(r"[「」『』（）()・･\.\-\s　]")


def norm(s):
    return STRIP.sub("", s)


def build_index(cmap):
    """normalized-name -> entry, longest keys first for greedy matching."""
    idx = []
    for name, e in cmap.items():
        idx.append((norm(name), name, e))
    idx.sort(key=lambda x: -len(x[0]))
    return idx


def match_tokens(title, idx):
    """Return ordered, de-duped list of matched entries for a banner title."""
    found, used = [], set()
    tokens = [t for t in SPLIT.split(title) if t.strip()]
    for tok in tokens:
        nt = norm(tok)
        if not nt:
            continue
        best = None
        for nk, name, e in idx:
            if nk and (nk == nt or nk in nt or nt in nk):
                best = (name, e)
                break
        if best and best[0] not in used:
            used.add(best[0])
            found.append(best[1])
    return found


def enrich(tag):
    dfile = DATA / f"{tag}.json"
    ifile = ICONS / f"{tag}.json"
    if not dfile.exists() or not ifile.exists():
        return None
    data = json.loads(dfile.read_text(encoding="utf-8"))
    cmap = json.loads(ifile.read_text(encoding="utf-8"))
    idx = build_index(cmap)
    hit = 0
    for b in data["banners"]:
        matches = match_tokens(b["name"], idx)
        if not matches and b.get("related"):
            matches = match_tokens(b["related"].split("、")[0], idx)
        b["icons"] = [m["icon"] for m in matches[:3]]
        b["agents"] = [m["en"] for m in matches[:3]]
        b["accent"] = matches[0]["accent"] if matches else None
        if matches:
            hit += 1
    dfile.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    return hit, len(data["banners"])


def main():
    for ifile in sorted(ICONS.glob("*.json")):
        tag = ifile.stem
        r = enrich(tag)
        if r:
            print(f"[{tag}] matched icons for {r[0]}/{r[1]} banners")


if __name__ == "__main__":
    main()
