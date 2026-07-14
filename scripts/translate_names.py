#!/usr/bin/env python3
"""
Translate banner labels to official English names for data-only games.

Arknights banners are named after events, so we translate the rate-up 6-star
operator(s) from the `related` field using a committed JP->EN operator map
(icons/names/arknights_map.json, built from Kengxxiao/ArknightsGameData_YoStar,
which has exact global names — including alters). Refresh the map with --refresh.
"""
import json, re, sys, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
NAMES = ROOT / "icons" / "names"
AK_MAP = NAMES / "arknights_map.json"
AK_SRC = "https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData_YoStar/master/{}/gamedata/excel/character_table.json"


def refresh_ak_map():
    def getj(u):
        return json.loads(urllib.request.urlopen(
            urllib.request.Request(u, headers={"User-Agent": "gacha-tracker"}), timeout=120).read().decode("utf-8"))
    ja, en = getj(AK_SRC.format("ja_JP")), getj(AK_SRC.format("en_US"))
    m = {v["name"]: en[cid]["name"] for cid, v in ja.items()
         if v.get("name") and en.get(cid, {}).get("name") and v.get("profession") not in ("TOKEN", "TRAP")}
    NAMES.mkdir(parents=True, exist_ok=True)
    AK_MAP.write_text(json.dumps(m, ensure_ascii=False, indent=0), encoding="utf-8")
    print(f"arknights map: {len(m)} operators")


def ak_operators(related):
    """6-star operator names from '星6：エーベンホルツ 星5：… 星6：…' (keeps alter prefixes)."""
    return re.findall(r"星6：([^\s星（(]+)", related)[:3]


def translate_arknights():
    dfile = DATA / "arknights.json"
    if not dfile.exists():
        return
    if not AK_MAP.exists():
        refresh_ak_map()
    m = json.loads(AK_MAP.read_text(encoding="utf-8"))
    data = json.loads(dfile.read_text(encoding="utf-8"))
    hit = 0
    for b in data["banners"]:
        agents = [m[o] for o in ak_operators(b.get("related", "")) if o in m]
        b["agents"] = agents[:3]
        if agents:
            b["en"] = " & ".join(agents[:3]); hit += 1
        else:
            b.pop("en", None)
    dfile.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[arknights] translated {hit}/{len(data['banners'])} banners")


def main():
    if "--refresh" in sys.argv:
        refresh_ak_map()
    translate_arknights()


if __name__ == "__main__":
    main()
