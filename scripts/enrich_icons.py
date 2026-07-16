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

# characters that split a bundle/duo banner title into individual characters
SPLIT = re.compile(r"[&＆/／、,]|復刻")
# punctuation to ignore when comparing names (incl. & so combined-unit names like
# "オルペウス&「鬼火」" normalize the same whether the wiki uses full/half-width)
STRIP = re.compile(r"[「」『』（）()・･\.\-\s　&＆：:]")


def norm(s):
    return STRIP.sub("", s)


def build_index(cmap):
    """normalized-name -> entry, longest keys first for greedy matching."""
    idx = []
    for name, e in cmap.items():
        idx.append((norm(name), name, e))
    idx.sort(key=lambda x: -len(x[0]))
    return idx


def _match_one(text, idx):
    """Match a string to a character: exact normalized name, else a character
    name contained *within* the text (key-in-text, longest key first). We never
    match text-in-key, which made ライト (Lighter) grab スターライトビリー."""
    nt = norm(text)
    if not nt:
        return None
    exact = next(((name, e) for nk, name, e in idx if nk == nt), None)
    if exact:
        return exact
    # Alt/SP characters use a "・" separator (丹恒・飲月, 姫子・旅立ち). If the full alt
    # name isn't in the source, do NOT fall back to the base character — 姫子・旅立ち
    # (Himeko • Nova) must not become plain Himeko. It'll use banner art instead.
    if "・" in text or "･" in text:
        return None
    return next(((name, e) for nk, name, e in idx if nk and nk in nt), None)


def match_tokens(title, idx):
    """Return ordered, de-duped matches for a banner title.

    First split into tokens (duos/bundles like 星見雅&浅羽悠真 → two characters).
    If nothing matches, try the whole title — this catches combined-unit names
    whose Enka entry itself contains '&', e.g. オルペウス&「鬼火」 (Orphie & Magus),
    which would otherwise be split apart and match nothing.
    """
    found, used = [], set()
    for tok in [t for t in SPLIT.split(title) if t.strip()]:
        m = _match_one(tok, idx)
        if m and m[0] not in used:
            used.add(m[0])
            found.append(m[1])
    if not found:
        m = _match_one(title, idx)
        if m:
            found.append(m[1])
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
        # Match on the banner title only. We do NOT fall back to `related`
        # (関連キャラなど): those are associated / rerun characters, not the
        # headliner, and using them mislabels banners (e.g. the オルペウス banner
        # grabbed イヴリン復刻 → Evelyn). Unmatched banners show the banner art.
        matches = match_tokens(b["name"], idx)
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
