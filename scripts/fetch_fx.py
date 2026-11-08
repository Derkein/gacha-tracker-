"""Today's US-dollar exchange rates for the site's "show in US$" toggle -> data/fx.json.

The toggle converts game-i's yen (1億G ≈ ¥100M) and the CN ranking's yuan into dollars at ONE
rate, the latest daily one, so every figure on the page moves together. Rates are the European
Central Bank's daily reference rates via frankfurter.dev (no key; the ECB publishes on working
days, so a weekend run keeps Friday's), with open.er-api.com as a fallback. If both fail the old
file is kept, so the toggle never loses its rate. Stdlib only.
"""
import datetime, json, pathlib, sys, urllib.request

OUT = pathlib.Path(__file__).resolve().parent.parent / "data" / "fx.json"
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

if __name__ == "__main__":
    main()
