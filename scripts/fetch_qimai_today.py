#!/usr/bin/env python3
"""Daily Qimai China-iPhone revenue top-up, via a logged-in headless browser.

Reads the last ~month of Qimai's daily revenue for a rotating set of games and appends any
new days to data/qimai_daily/<tag>.json. Qimai's FREE tier shows revenue for only 3 apps
per day per account, so the six games rotate: group A one day, group B the next, chosen by
day-of-year parity. Run scripts/build_qimai.py afterwards to regenerate data/qimai.json.

Auth: QIMAI_COOKIE env var = the account's session Cookie header. Refresh it ~monthly —
Qimai logins use a CAPTCHA, so this can't (and shouldn't) be automated. The page computes
its own signed `analysis` request; nothing here forges or reverse-engineers it — a real
browser runs Qimai's own JS. Requires: pip install playwright && playwright install chromium.

Compliance: Qimai's ToS restricts automated access and republishing its content. This runs
on the owner's own, non-commercial gacha tracker, at one light rotation a day, with the
owner's explicit decision to do so (see cn-ios-grossing/qimai_research.md and TODO.md). It
never rotates accounts/cookies to beat the 3/app cap and never forges the signature.
"""
import os, sys, json, io, datetime, time

GT    = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DAILY = os.path.join(GT, "data", "qimai_daily")
APPID = {"genshin":"1467190251","hsr":"1523037824","zzz":"1606359076",
         "wuwa":"6450693428","endfield":"6753859465","nte":"6514281568"}
GROUPS = [["genshin","hsr","zzz"], ["wuwa","endfield","nte"]]   # 3/day free cap → rotate

# Runs in the page: wait for the Vue app's income component, tell apart the three failure
# modes (not logged in / member-cap / page changed) so the log says which, then click the
# "近一个月" (last month) preset and read the daily series the page loaded. Qimai is Vue 2, so
# the data lives on a component's $data.downloadData; only a logged-in session mounts it.
EXTRACT = r"""
async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const comp = () => [...document.querySelectorAll('*')].map(el => el.__vue__)
      .find(v => v && v.$data && ('downloadData' in v.$data));
  for (let k = 0; k < 90 && !comp(); k++) await sleep(200);
  const t0 = comp();
  if (!t0) {
    // No data component. Say WHY: a logged-out page still shows the 登录/注册 buttons and
    // never mounts the income component; the member cap shows a 开通会员/会员专享 notice.
    const txt = (document.body && document.body.innerText) || '';
    const loginBtn = [...document.querySelectorAll('a,span,button,li')].some(
        e => e.children.length === 0 && /^登\s*录$/.test(e.textContent.trim()));
    if (/每日仅支持查看|开通会员|会员专享|尚未开通/.test(txt)) return { error: 'capped' };
    if (loginBtn || /尚未登录|请先?登录|立即登录/.test(txt))   return { error: 'loggedout' };
    return { error: 'no-data-component' };            // page structure changed
  }
  const btn = [...document.querySelectorAll('a,span,li,div')]
      .find(e => e.children.length === 0 && e.textContent.trim() === '近一个月');
  if (btn) btn.click();
  await sleep(2400);
  const t = comp();
  const rows = [...t.downloadData].sort((a, b) => a.time - b.time).map(x => [x.date, x.income]);
  return { rows, device: t.filterParamObj && t.filterParamObj.platform };
}
"""

def load(tag):
    p = os.path.join(DAILY, f"{tag}.json")
    return json.load(io.open(p, encoding="utf-8")) if os.path.exists(p) else None

def merge(tag, rows):
    """Append days after the last stored one. Returns (added, note)."""
    rec = load(tag)
    if rec is None:
        return 0, "no existing series — needs a first-time by-hand backfill"
    d0 = datetime.date.fromisoformat(rec["first"])
    last = d0 + datetime.timedelta(days=len(rec["daily"]) - 1)
    added = 0
    for ds, inc in rows:
        d = datetime.date.fromisoformat(ds)
        if d <= last:
            continue
        while last + datetime.timedelta(days=1) < d:   # keep the series contiguous
            rec["daily"].append(0); last += datetime.timedelta(days=1)
        rec["daily"].append(int(inc or 0)); last = d; added += 1
    if added:
        rec["n"] = len(rec["daily"])
        rec["total"] = sum(v or 0 for v in rec["daily"])
        rec["last"] = str(last)
        rec["updated"] = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%MZ")
        json.dump(rec, io.open(os.path.join(DAILY, f"{tag}.json"), "w", encoding="utf-8"),
                  ensure_ascii=False, separators=(",", ":"))
    return added, None

def main():
    cookie = os.environ.get("QIMAI_COOKIE", "").strip()
    if not cookie:
        print("QIMAI_COOKIE not set — nothing to do", file=sys.stderr); sys.exit(2)
    from playwright.sync_api import sync_playwright

    yday = datetime.datetime.utcnow().timetuple().tm_yday
    group = GROUPS[yday % 2]
    games = [g for g in group if load(g) is not None]   # only games already backfilled
    if not games:
        print(f"rotation group {yday % 2} ({group}) has no gathered games yet — skipping")
        return
    print(f"rotation group {yday % 2} → {games}")

    cookies = []
    for kv in cookie.split(";"):
        if "=" not in kv:
            continue
        k, v = kv.strip().split("=", 1)
        cookies.append({"name": k, "value": v, "domain": ".qimai.cn", "path": "/"})

    with sync_playwright() as pw:
        # Qimai serves a logged-out page to an obvious bot, so soften the headless
        # fingerprint: hide navigator.webdriver and present a plausible zh-CN desktop. This
        # only makes our own logged-in session look like a normal browser — it does not touch
        # or forge Qimai's request signature (its own JS still computes that).
        browser = pw.chromium.launch(args=["--disable-blink-features=AutomationControlled"])
        ctx = browser.new_context(
            user_agent=("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"),
            locale="zh-CN", timezone_id="Asia/Shanghai", viewport={"width": 1366, "height": 900})
        ctx.add_init_script("Object.defineProperty(navigator,'webdriver',{get:()=>undefined});")
        ctx.add_cookies(cookies)
        page = ctx.new_page()
        total_added = 0
        for tag in games:
            url = f"https://www.qimai.cn/app/incomeEstimate/appid/{APPID[tag]}/country/cn"
            try:
                page.goto(url, wait_until="domcontentloaded", timeout=60000)
                res = page.evaluate(EXTRACT)
            except Exception as e:
                print(f"{tag}: page error — {e}", file=sys.stderr); continue
            err = res.get("error")
            if err == "loggedout":
                # Every game will be the same this run, so stop and say so loudly.
                print(f"{tag}: NOT LOGGED IN — Qimai rejected the cookie. It usually means the "
                      f"session is bound to the machine/IP where you logged in (a home cookie "
                      f"won't work from GitHub's servers) or the login simply expired. Re-copy a "
                      f"fresh Cookie into the QIMAI_COOKIE secret; if it still fails here but "
                      f"works when you run this script on your own PC, the session is IP-bound — "
                      f"run it locally (Task Scheduler) instead of in Actions.", file=sys.stderr)
                break
            if err == "capped":
                print(f"{tag}: member/3-app daily cap reached — skipping", file=sys.stderr); continue
            if err or not res.get("rows"):
                print(f"{tag}: {err or 'no rows returned'}", file=sys.stderr); continue
            added, note = merge(tag, res["rows"])
            total_added += added
            print(f"{tag}: +{added} new day(s)" + (f" — {note}" if note else ""))
            time.sleep(3)   # pace politely
        browser.close()
    print(f"done — {total_added} day(s) added across {len(games)} game(s)")

if __name__ == "__main__":
    main()
