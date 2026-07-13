#!/usr/bin/env python3
"""
Build icons/<tag>.json character maps: JP name -> {icon, accent, en}.

Pulls agent/character rosters from Enka.Network's open data store
(github.com/EnkaNetwork/API-docs). Covers the HoYoverse games that
Enka supports (ZZZ, HSR, Genshin). Games without an Enka source
simply get no icon map and fall back to banner art on the site.

Run occasionally (rosters change slowly); the file is committed so
the daily data refresh doesn't depend on it.
"""
import json, re, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ICONS = ROOT / "icons"
RAW = "https://raw.githubusercontent.com/EnkaNetwork/API-docs/master/store/"
UA = {"User-Agent": "Mozilla/5.0 (gacha-tracker)"}


def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40).read().decode("utf-8")


def getj(url):
    return json.loads(get(url))


def enka_img(path):
    return "https://enka.network" + path if path.startswith("/") else path


def build_zzz():
    av = getj(RAW + "zzz/avatars.json")
    loc = getj(RAW + "zzz/locs.json")["ja"]
    out = {}
    for v in av.values():
        nm = v.get("Name", "")
        ja = loc.get(nm)
        icon = v.get("CircleIcon") or v.get("Image")
        if not (ja and icon):
            continue
        out[ja] = {"icon": enka_img(icon), "accent": v.get("Colors", {}).get("Accent", "#888"),
                   "en": loc.get(nm, ja)}
    # english names come from en loc
    en = getj(RAW + "zzz/locs.json")["en"]
    for v in av.values():
        nm = v.get("Name", "")
        if loc.get(nm) in out:
            out[loc[nm]]["en"] = en.get(nm, out[loc[nm]]["en"])
    return out


def build_genshin():
    ch = getj(RAW + "characters.json")
    loc = getj(RAW + "loc.json")
    ja, en = loc.get("ja", {}), loc.get("en", {})
    out = {}
    for v in ch.values():
        h = v.get("NameTextMapHash")
        icon = v.get("SideIconName") or v.get("IconName")
        if not (h and icon):
            continue
        name_ja = ja.get(str(h))
        if not name_ja:
            continue
        # AvatarIcon_Side_Xxx -> UI_AvatarIcon_Xxx (front icon)
        front = icon.replace("_Side", "")
        out[name_ja] = {"icon": f"https://enka.network/ui/{front}.png",
                        "accent": "#c9a86a", "en": en.get(str(h), name_ja)}
    return out


# Honkai: Star Rail comes from Mar-7th/StarRailRes (community-maintained,
# auto-updating, hotlinkable raw images) rather than Enka, whose HSR store
# stores name hashes lossily.
STARRAILRES = "https://raw.githubusercontent.com/Mar-7th/StarRailRes/master/"
HSR_ELEMENT = {
    "Physical": "#b9b9b9", "Fire": "#f0503f", "Ice": "#5fc7e8", "Thunder": "#c56af0",
    "Lightning": "#c56af0", "Wind": "#4fc8a0", "Quantum": "#4a4ad8", "Imaginary": "#f0d24b",
}


def build_hsr():
    ja = getj(STARRAILRES + "index_new/jp/characters.json")
    en = getj(STARRAILRES + "index_new/en/characters.json")
    out = {}
    for cid, v in ja.items():
        name_ja, icon = v.get("name"), v.get("icon")
        if not (name_ja and icon):
            continue
        out[name_ja] = {
            "icon": STARRAILRES + icon,
            "accent": HSR_ELEMENT.get(v.get("element"), "#8a7bd8"),
            "en": en.get(cid, {}).get("name", name_ja),
        }
    return out


BUILDERS = {"zzz": build_zzz, "genshin": build_genshin, "hsr": build_hsr}


def main():
    ICONS.mkdir(exist_ok=True)
    for tag, fn in BUILDERS.items():
        try:
            m = fn()
            (ICONS / f"{tag}.json").write_text(json.dumps(m, ensure_ascii=False, indent=1), encoding="utf-8")
            print(f"[{tag}] {len(m)} characters -> icons/{tag}.json")
        except Exception as e:
            print(f"[{tag}] FAILED: {e}")


if __name__ == "__main__":
    main()
