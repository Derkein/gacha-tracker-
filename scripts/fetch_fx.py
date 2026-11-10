"""US-dollar exchange rates for the site's "show in US$" toggle.

data/fx.json          today's rate (the headline "$1 = ¥…" line)
data/fx_history.json  every ECB business day since 2020 + each month's average, so each figure
                      is converted at the rate of WHEN it was earned: a day's game-i revenue at
                      that day's rate, a monthly figure (CN ranking, the journal) at that month's
                      average (IAS 21: transaction-date rate, a period average as the shortcut).
                      Only the days after the last stored one are fetched on each run.
 Rates are the European
Central Bank's daily reference rates via frankfurter.dev (no key; the ECB publishes on working
days, so a weekend run keeps Friday's), with open.er-api.com as a fallback. If both fail the old
file is kept, so the toggle never loses its rate. Stdlib only.
"""
import datetime, json, pathlib, sys, urllib.request

OUT = pathlib.Path(__file__).resolve().parent.parent / "data" / "fx.json"
HIST = OUT.parent / "fx_history.json"
HIST_FROM = "2020-01-01"        # before the oldest tracked banner (Genshin, Sep 2020)
UA = {"User-Agent": "gacha-tracker-fx/1.0"}

def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20) as r:
        return json.loads(r.read().decode("utf-8"))

def frankfurter():
    d = get("https://api.frankfurter.dev/v1/latest?base=USD&symbols=JPY,CNY")
    return {"date": d["date"], "JPY": float(d["rates"]["JPY"]), "CNY": float(d["rates"]["CNY"]),
            "source": "European Central Bank reference rate (frankfurter.dev)"}

def er_api():
    d = get("https://open.er-api.com/v6/latest/USD")
    day = datetime.datetime.utcfromtimestamp(d["time_last_update_unix"]).date().isoformat()
    return {"date": day, "JPY": float(d["rates"]["JPY"]), "CNY": float(d["rates"]["CNY"]),
            "source": "ExchangeRate-API open rates (open.er-api.com)"}

def main():
    for fn in (frankfurter, er_api):
        try:
            fx = fn()
            if not (50 < fx["JPY"] < 400 and 3 < fx["CNY"] < 15):      # sanity: never write a garbled rate
                raise ValueError(f"implausible rates {fx}")
            break
        except Exception as e:
            print(f"fx: {fn.__name__} failed: {e}", file=sys.stderr)
    else:
        print("fx: no source answered; keeping the previous data/fx.json", file=sys.stderr)
        return
    out = {"date": fx["date"], "per_usd": {"JPY": round(fx["JPY"], 4), "CNY": round(fx["CNY"], 4)}, "source": fx["source"]}
    old = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else None
    if old != out:
        OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"fx {out['date']}: $1 = ¥{out['per_usd']['JPY']} = CN¥{out['per_usd']['CNY']} ({out['source']})")

def history():
    """Append the ECB days after the last stored one to data/fx_history.json and recompute the
    monthly averages. On any failure the old file is kept as it was."""
    old = json.loads(HIST.read_text(encoding="utf-8")) if HIST.exists() else {}
    days = dict(old.get("days") or {})
    since = (datetime.date.fromisoformat(max(days)) + datetime.timedelta(days=1)).isoformat() if days else HIST_FROM
    if since > datetime.date.today().isoformat():
        return
    try:
        d = get(f"https://api.frankfurter.dev/v1/{since}..?base=USD&symbols=JPY,CNY")
        new = {k: [round(float(v["JPY"]), 4), round(float(v["CNY"]), 4)] for k, v in d.get("rates", {}).items() if k >= since}
    except Exception as e:
        print(f"fx history: frankfurter failed ({e}); keeping {HIST.name}", file=sys.stderr); return
    if not new:
        return
    if not all(50 < j < 400 and 3 < c < 15 for j, c in new.values()):
        print("fx history: implausible rates, not written", file=sys.stderr); return
    days.update(new)
    months = {}
    for k in sorted(days):
        months.setdefault(k[:7], []).append(days[k])
    out = {"source": "European Central Bank reference rates via frankfurter.dev", "base": "USD", "cols": ["JPY", "CNY"],
           "days": {k: days[k] for k in sorted(days)},
           "months": {m: [round(sum(r[0] for r in v) / len(v), 4), round(sum(r[1] for r in v) / len(v), 4)] for m, v in months.items()}}
    HIST.write_text(json.dumps(out, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"fx history: +{len(new)} day(s), {min(days)}..{max(days)}")

if __name__ == "__main__":
    main()
    history()
