"""Consumer price indexes for the site's "Today's prices" (inflation) toggle.

data/cpi.json  {"us": {"YYYY-MM": index}, "jp": {...}, "us_last", "jp_last", "source": {...}}

  us  US CPI-U, all items, not seasonally adjusted (BLS series CUUR0000SA0), from the BLS public
      API (v1, no key). Used for every dollar figure: game-i's yen once it is in US$, Qimai,
      Sensor Tower, the Global ranking in US$.
  jp  Japan CPI, all items (Statistics Bureau of Japan, 2020 = 100, zmi2020aa.csv). Used for
      game-i's yen when the site shows yen. If the Bureau's newer base-year file runs past the
      2020-base one, the extra months are chained on at their ratio in the last shared month.

A month with no figure (BLS published none for Oct 2025, the US government shutdown) is filled
with the average of the months either side, and marked in "filled". Either source failing keeps
that series from the previous file, so the toggle never loses its data. Stdlib only.
"""
import csv, io, json, pathlib, urllib.request, datetime

OUT = pathlib.Path(__file__).resolve().parent.parent / "data" / "cpi.json"
UA = {"User-Agent": "gacha-tracker-cpi/1.0", "Content-Type": "application/json"}
FROM_YEAR = 2017
JP_FILES = ["https://www.stat.go.jp/data/cpi/2020/csv/zmi2020aa.csv",   # 2020 = 100 (base series)
            "https://www.stat.go.jp/data/cpi/2025/csv/zmi2025aa.csv"]   # newer base, chained on

def fetch(url, data=None):
    req = urllib.request.Request(url, data=data, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()

def us_cpi():
    now = datetime.date.today().year
    body = json.dumps({"seriesid": ["CUUR0000SA0"], "startyear": str(max(FROM_YEAR, now - 9)),
                       "endyear": str(now)}).encode()
    d = json.loads(fetch("https://api.bls.gov/publicAPI/v1/timeseries/data/", body))
    if d.get("status") != "REQUEST_SUCCEEDED":
        raise RuntimeError(d.get("message"))
    out = {}
    for r in d["Results"]["series"][0]["data"]:
        if r["period"].startswith("M") and r["period"] != "M13":
            ym = f"{r['year']}-{r['period'][1:]}"
            out[ym] = float(r["value"]) if r["value"] not in ("-", "") else None
    return out

def jp_file(url):
    rows = csv.reader(io.StringIO(fetch(url).decode("cp932")))
    out = {}
    for f in rows:
        if f and f[0].isdigit() and len(f[0]) == 6 and len(f) > 1:
            try: out[f"{f[0][:4]}-{f[0][4:]}"] = float(f[1])         # column 1 = 総合 (all items)
            except ValueError: out[f"{f[0][:4]}-{f[0][4:]}"] = None
    return out

def jp_cpi():
    base = jp_file(JP_FILES[0])
    try:
        newer = jp_file(JP_FILES[1])
        shared = sorted(k for k in base if k in newer and base[k] and newer[k])
        if shared:
            k = shared[-1]; r = base[k] / newer[k]
            for ym, v in newer.items():
                if ym > max(base) and v: base[ym] = round(v * r, 3)
    except Exception as e:
        print("  jp: newer base-year file skipped:", e)
    return base

def fill(series):
    """None months -> mean of the nearest months either side; returns (series, filled)."""
    ks = sorted(series); filled = []
    for i, k in enumerate(ks):
        if series[k] is None:
            a = next((series[x] for x in reversed(ks[:i]) if series[x] is not None), None)
            b = next((series[x] for x in ks[i + 1:] if series[x] is not None), None)
            if a is not None and b is not None:
                series[k] = round((a + b) / 2, 3); filled.append(k)
    return {k: v for k, v in series.items() if v is not None}, filled

def main():
    old = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    out = {"source": {
        "us": "US Bureau of Labor Statistics, CPI-U all items, not seasonally adjusted (CUUR0000SA0)",
        "jp": "Statistics Bureau of Japan, Consumer Price Index, all items, 2020 = 100"}, "filled": {}}
    for key, fn in (("us", us_cpi), ("jp", jp_cpi)):
        try:
            s, filled = fill(fn())
            if len(s) < 24 or not all(50 < v < 1000 for v in s.values()):
                raise RuntimeError("implausible series")
            out[key] = dict(sorted(s.items())); out["filled"][key] = filled
        except Exception as e:
            print(f"  {key}: fetch failed ({e}); keeping the previous series")
            if key not in old: continue
            out[key] = old[key]; out["filled"][key] = (old.get("filled") or {}).get(key, [])
        out[f"{key}_last"] = max(out[key])
    if "us" not in out and "jp" not in out:
        raise SystemExit("no CPI series at all; nothing written")
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"wrote {OUT.name}: US to {out.get('us_last')}, Japan to {out.get('jp_last')}"
          + (f"; filled {out['filled']}" if any(out['filled'].values()) else ""))

if __name__ == "__main__":
    main()
