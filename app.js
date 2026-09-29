// Gacha Revenue Tracker — client logic. Data comes from data/*.json (built by scripts/).
const GAME_ACCENT = {          // per-game hue (used for bars/dots without a sampled color)
  zzz:"#e0a400", hsr:"#8a7bd8", wuwa:"#2fb6c0", genshin:"#d8a24a", endfield:"#e07b3a", nte:"#d94f8a",
  uma:"#3fb98f",
};
const state = { games:[], tag:null, data:null, ext:null, reported:null, cn:null, qimai:null, mode:"time", table:false, reverse:false, bracket:0, tabsExpanded:false, graphYear:"all", graphDim:"year", matchHigh:true, monthYear:"all", periodSort:"timeline", dataSource:"gamei", search:"", agreeMode:"month", compare:{picks:[], sources:{}, chart:"jp"} };

// Major game-version (X.0) launch dates, JST — used to bucket banners into 1.X / 2.X
// groups. Only version-based games have these; sourced from each game's official
// version history (see release-date notes in the repo). A banner belongs to the
// latest major version whose launch date is on or before the banner's start.
const VERSIONS = {
  genshin: [["1.X","2020-09-28"],["2.X","2021-07-21"],["3.X","2022-08-24"],["4.X","2023-08-16"],["5.X","2024-08-28"],["6.X","2025-09-10"],["7.X","2026-08-12"]],
  hsr:     [["1.X","2023-04-26"],["2.X","2024-02-06"],["3.X","2025-01-14"],["4.X","2026-02-13"]],
  zzz:     [["1.X","2024-07-04"],["2.X","2025-06-06"],["3.X","2026-06-17"]],
  wuwa:    [["1.X","2024-05-22"],["2.X","2025-01-02"],["3.X","2025-12-25"]],
  endfield:[["1.X","2026-01-22"]],   // launched at 1.0; still 1.x
  nte:     [["1.X","2026-04-29"]],
};
const hasVersions = tag => !!VERSIONS[tag];
function versionOf(b){
  const v=VERSIONS[state.tag]; if(!v) return null;
  let cur=v[0][0];
  for(const [label,date] of v){ if(b.start>=date) cur=label; else break; }
  return cur;
}
// Manual per-character colour overrides (by agent name), when the sampled colours
// don't match the character's identity. Keep this small and deliberate.
// Curated per-character signature colors (keyed by agent name, per game). game-i's
// sampled art color often grabs a background/UI tone and collides (e.g. 4 ZZZ agents
// sampled the same near-white), so hand-set each character's own recognizable colour.
// Agents not listed fall back to the sampled art colour, then de-collision.
const ACCENT_OVERRIDE = {
  zzz: {
    "Sigrid":"#3d8ee0", "Norma":"#eec643", "Remielle":"#e87ba0",
    "Ellen":"#5cc4ea", "Zhu Yuan":"#1f9fd0", "Qingyi":"#6f7ce0", "Jane":"#b45ad0",
    "Caesar":"#f4c13e", "Burnice":"#e8562c", "Lighter":"#db4b3f",
    "Miyabi":"#4f8fe0", "Harumasa":"#ecc84a", "Yanagi":"#2bb2c4",
    "Astra Yao":"#f2a0cf", "Evelyn":"#d24d4a", "Soldier 0 - Anby":"#5a86e0",
    "Trigger":"#7266c4", "Vivian":"#9a6fe0", "Hugo":"#cf4436", "Yixuan":"#e0b83a",
    "Ju Fufu":"#f2913a", "Yuzuha":"#ef7ea8", "Alice":"#cf5566", "Orphie & Magus":"#db602a",
    "Lucia":"#3f9ed6", "Yidhari":"#9b4dd0", "Ye Shunguang":"#f0b02e", "Zhao":"#c98f3a",
    "Sunna":"#4fd6b8", "Aria":"#f08fb5", "Nangong Yu":"#6fa8d8",
    "Cissia":"#da3674", "Promeia":"#9c69ff", "Starlight - Billy":"#d8493c",
    "Velina":"#c8ccd6", "Dialyn":"#d3d7de", "Banyue":"#dcd8d1",
  },
  wuwa: {
    // the auto-sampler grabbed these banners' dark-blue backgrounds instead of the
    // character; set each from her splash art (Lucy = fire orange, not blue, etc.)
    "Lucy":"#e8763a", "Aemeath":"#e88fb8", "Denia":"#d86f8a",
    "Mornye":"#c4cdda", "Lynae":"#45b2cf",
  },
};
// true when a hex is near-white / washed-out grey (no usable hue) — some character
// portraits sample to ~#e8e7ea, which then paints every bar the same pale colour.
function isWashed(hex){
  if(!hex) return true;
  const n=parseInt(hex.slice(1),16), r=(n>>16&255)/255, g=(n>>8&255)/255, b=(n&255)/255;
  const mx=Math.max(r,g,b), mn=Math.min(r,g,b), l=(mx+mn)/2, d=mx-mn;
  const s = d===0 ? 0 : d/(1-Math.abs(2*l-1));
  return l>0.82 && s<0.22;
}
// Color priority: a curated per-character override (the "adjust" for ones the data gets
// wrong) → the Enka/icon character accent (unless it sampled near-white) → the splash-art
// `bar` colour → the per-game hue. This is the original automatic behaviour; only the
// hand-listed corrections above sit in front of it.
function barColor(b){
  if(!b) return GAME_ACCENT[state.tag];
  const m=ACCENT_OVERRIDE[state.tag]||{};
  const ov=(b.agents||[]).map(a=>m[a]).find(Boolean); if(ov) return ov;
  if(b.accent && !isWashed(b.accent)) return b.accent;
  if(b.bar && !isWashed(b.bar)) return b.bar;
  return b.accent || b.bar || GAME_ACCENT[state.tag];
}
const $ = s => document.querySelector(s);

// ---- theme toggle (Auto → Light → Dark). Auto follows the OS; an explicit
// choice is stored and also applied pre-paint by the inline <head> script. ----
const THEMES=["auto","light","dark"], TICON={auto:"◐",light:"☀",dark:"☾"};
function applyTheme(t){
  if(t==="auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme",t);
  const btn=$("#themeBtn");
  if(btn){ btn.textContent=TICON[t];
    btn.title=`Theme: ${t[0].toUpperCase()+t.slice(1)}${t==="auto"?" (follows your system)":""} — click to change`;
    btn.setAttribute("aria-label",btn.title); }
}
let _theme = (()=>{ try{ return localStorage.getItem("theme")||"auto"; }catch(e){ return "auto"; } })();
applyTheme(_theme);
$("#themeBtn").onclick=()=>{
  _theme=THEMES[(THEMES.indexOf(_theme)+1)%THEMES.length];
  try{ localStorage.setItem("theme",_theme); }catch(e){}
  applyTheme(_theme);
};
const fmtDate = new Intl.DateTimeFormat("en",{year:"numeric",month:"short",day:"numeric"});
const per = s => fmtDate.format(new Date(s+"T00:00:00"));
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// game-i reports revenue in 億 (1e8) of "G". Per game-i's official X, G means "〜ぐらい"
// (about) and 1億G ≈ ¥1億 (~100M yen), i.e. G ≈ 1 yen. So translate 億→M/B magnitude and
// show it as an approximate yen figure.
function fmtG(oku){
  if (oku <= 0) return "0";
  const m = oku * 100;                       // millions of yen
  if (m >= 1000) return (m/1000).toFixed(2) + "B";
  if (m >= 100)  return Math.round(m) + "M";
  return (Math.round(m*10)/10) + "M";
}
const G = oku => "¥" + fmtG(oku);

// ---- external global monthly revenue, in USD (a comparison layer vs game-i) ----
// Source: the actual Sensor Tower / gacharevenue monthly REPORT figures, read from the
// report images (data/reported_revenue.json) — combined region (all regions incl. China
// iOS + a separate JP server where one exists), Oct 2021 -> present. Images only; the
// eog reconstruction (data/external_revenue.json, scripts/scrape_external.py) is kept in
// the repo but no longer used by the app. A month with no report yet simply shows no ST.
// A DIFFERENT measurement from game-i (global USD, not JP-iOS 億G) — shown side by side,
// NEVER summed with game-i.
function fmtUSD(v){
  if(v==null||v<=0) return "$0";
  if(v>=1e9) return "$"+(v/1e9).toFixed(2)+"B";
  if(v>=1e8) return "$"+Math.round(v/1e6)+"M";
  if(v>=1e7) return "$"+(v/1e6).toFixed(1)+"M";
  if(v>=1e6) return "$"+(v/1e6).toFixed(2)+"M";   // small millions keep 2 decimals so
  if(v>=1e3) return "$"+Math.round(v/1e3)+"K";    // e.g. 1.24M and 1.28M don't both read "1.2M"
  return "$"+Math.round(v);
}
// {ym -> {rev, method}} for one game, straight from the published report figures
// (data/reported_revenue.json) — images only, no reconstruction. Months with no
// report yet (the newest, until its report is posted) simply have no ST value.
function extGameMonths(tag){
  tag = tag || state.tag; const out={};
  const rep=state.reported&&state.reported.months;
  if(rep) for(const ym in rep){ const v=rep[ym][tag];
    if(typeof v==="number") out[ym]={rev:v, method: rep[ym]._approx?"reported_approx":"reported", usonly: !!rep[ym]._usonly}; }
  return out;
}
// {rev, method} for one game+month (defaults to the current game), or null.
function extMonth(ym, tag){ return extGameMonths(tag)[ym]||null; }
// Sum external monthly revenue over months matching pred(ym) -> {rev,months,hasApprox} or null.
function extSum(pred, tag){
  const mm=extGameMonths(tag); let rev=0, months=0, hasApprox=false;
  for(const ym in mm){ if(!pred(ym)) continue;
    rev+=mm[ym].rev; months++;
    if(mm[ym].method==="approx"||mm[ym].method==="reported_approx") hasApprox=true; }
  return months?{rev,months,hasApprox}:null;
}
// A banner's ESTIMATED Sensor Tower revenue (global USD). Sensor Tower only publishes a
// monthly total per game, so per banner we take its share of that month's game-i revenue
// and apply it to the month's real ST figure, then SUM across every month the banner ran
// (a banner spanning two months adds both). Returns {total, months:[{ym,share,stMonth,
// contrib}], covered, missing, hasData, partial} — `partial` = ran in a month with no ST
// figure yet, so the total is incomplete. Cached on the banner (data is static per session).
function bannerST(b){
  if(!b || b._synthetic) return {total:0, months:[], covered:0, missing:0, hasData:false, partial:false};
  if(b._st) return b._st;
  const bm=state.monthly||{}, gi=state.data.monthly||{};
  const months=[]; let total=0, covered=0, missing=0;
  for(const ym of Object.keys(bm).sort()){
    const entry=bm[ym].banners.find(x=>x.i===b._i); if(!entry) continue;    // banner ran this month
    const o=bm[ym].ours||0, g=gi[ym];
    const base=(g!=null && o>0 && (g-o)/g>=0.08) ? g : o;                    // same denominator as the composition bar
    // Two-source share: game-i (JP) is one daily read of how the month split between
    // banners; Qimai (China iPhone) is a second, independent one. Average them where both
    // exist, so the monthly total is apportioned on two daily sources instead of just
    // game-i; fall back to game-i alone where Qimai has no data.
    const giShare=base>0 ? entry.rev/base : 0;
    const qmS=qimaiShare(b, ym);
    const share = blendShare(giShare, qmS);
    const qmR=(qmS!=null) ? (((state.qimai.games[state.tag].banners[b._i]||{}).monthly||{})[ym]||0) : null;
    const st=extMonth(ym);
    const rec={ym, share, giShare, qmShare:qmS, qmRev:qmR, jp:entry.rev};
    if(st){ const c=share*st.rev; total+=c; covered++; months.push({...rec, stMonth:st.rev, contrib:c, method:st.method}); }
    else   { missing++; months.push({...rec, stMonth:null, contrib:null}); }
  }
  return (b._st={total, months, covered, missing, hasData:covered>0, partial:missing>0&&covered>0});
}
// Which major version a whole month belongs to (by the version live on the 1st) —
// same rule as versionOf, so months and banners bucket consistently. Data is monthly
// and versions are date-based, so a version's launch month is approximate.
function versionOfYm(ym){
  const v=VERSIONS[state.tag]; if(!v) return null;
  const d=ym+"-01"; let cur=v[0][0];
  for(const [label,date] of v){ if(d>=date) cur=label; else break; }
  return cur;
}
// A small "ST $X" chip (ST = Sensor Tower). "*" marks approximate values — a
// region-summed older report, or eog's newest not-yet-finalized month. The tooltip
// says whether it's a published report figure or the validated reconstruction.
function stChip(rev, method, extra){
  if(rev==null) return "";
  const isSum = method && typeof method==="object";
  const approx = method==="approx" || method==="reported_approx" || (isSum && method.hasApprox);
  let base;
  if(isSum) base = "gacharevenue / Sensor Tower monthly figures summed (published reports where available, else the validated eog reconstruction) — combined region, USD";
  else if(method==="reported"||method==="reported_approx") base = "gacharevenue / Sensor Tower published monthly report figure — combined region (all regions incl. China iOS + separate JP server), USD";
  else base = "gacharevenue combined estimate (USD) — reconstructed from eog.gg Sensor Tower data (China-Android modelled at 1.75× China-iOS), validated against the reports";
  const tip = base
    + (approx?". Approximate — region-summed from an older report, or eog's not-yet-finalized latest month":"")
    + (extra?". "+extra:"");
  return `<span class="st-chip${approx?" est":""}" title="${esc(tip)}">ST ${fmtUSD(rev)}${approx?"*":""}</span>`;
}

// ---- CN monthly revenue layer, in CNY (a third comparison layer) ----------------
// Source: 天天背锅崩坏娘's monthly 二次元手游全球总流水 ranking on Bilibili, the longest
// continuous CN-side gacha record there is (Nov 2021 -> present, no gaps). The author
// publishes it only as burned-in captions in a video, so scripts/scrape_bilibili_cn.py
// reads the figures off the frames with OCR; data/cn_monthly.json is the result.
//
// It measures something different again from BOTH other layers: GLOBAL revenue across
// ALL platforms (mobile + PC + PlayStation + overseas Xbox), in yuan. Never summed with
// either of them. Two quirks the UI has to carry:
//   * miHoYo titles are a RANGE, because the author excludes miHoYo's undisclosed
//     支付中心 (direct top-up) channel — so those figures are understated.
//   * The metric changes basis at Nov 2023, from 总收入 (normally net of the store cut)
//     to 总流水 (gross billings). Rows carry their own label and the UI marks the break.
// Written CN¥, never a bare ¥, so it can't be mistaken for game-i's Japanese yen.
// The source publishes whole 万 (10,000 yuan), so a figure divided by 1e6 always lands
// on exactly two decimals -- keep them. Rounding to whole millions made genuinely
// different months read identically: ZZZ was 34478万 in May and 34502万 in June, and
// both displayed as "CN¥345M". Billions keep three decimals for the same reason.
function fmtCNY(v){
  if(v==null||v<=0) return "CN¥ 0";
  if(v>=1e9) return "CN¥ "+(v/1e9).toFixed(3)+"B";
  if(v>=1e6) return "CN¥ "+(v/1e6).toFixed(2)+"M";
  if(v>=1e3) return "CN¥ "+(v/1e3).toFixed(1)+"K";
  return "CN¥ "+Math.round(v);
}
// A range renders as one figure when both ends match; otherwise the two ends share the
// currency prefix, and the magnitude suffix too when both fall in the same band. A range
// crossing M into B keeps both suffixes but still prints "CN¥" once -- repeating it gave
// "CN¥869.32M–CN¥1.019B", wide enough to push the KPI tile out of its card.
function fmtCNYRange(lo, hi){
  if(hi==null||hi===lo) return fmtCNY(lo);
  const a=fmtCNY(lo), b=fmtCNY(hi);
  const ua=a.replace(/[\d.\s]+/g,""), ub=b.replace(/[\d.\s]+/g,"");
  if(ua===ub) return a.replace(/([\d.]+)/,"$1 – "+b.match(/[\d.]+/)[0]);
  return a+" – "+b.replace("CN¥ ","");
}
// Compact CN range for the tight by-Month cells: whole millions, no spaces (e.g.
// "CN¥161–191M"), so it fits a phone-width column. Full precision stays in the KPI tile
// and the banner modal. Hundreds-of-millions ranges lose nothing meaningful to rounding.
function fmtCNYRangeC(lo, hi){
  const band=v=> v>=1e9?["B",1e9,2] : v>=1e6?["M",1e6,0] : v>=1e3?["K",1e3,0] : ["",1,0];
  const [ua,da,pa]=band(lo);
  if(hi==null||hi===lo) return "CN¥"+(lo/da).toFixed(pa)+ua;
  const [ub,db,pb]=band(hi);
  return ua===ub ? "CN¥"+(lo/da).toFixed(pa)+"–"+(hi/db).toFixed(pb)+ub
                 : "CN¥"+(lo/da).toFixed(pa)+ua+"–"+(hi/db).toFixed(pb)+ub;
}
// One scalar per row for bar length, sorting and sums. A range's midpoint is the
// least-wrong single number; the range itself is always shown in the text beside it.
const cnMid = r => r ? (r.lo + (r.hi==null?r.lo:r.hi))/2 : 0;
// {ym -> {lo, hi, metric, inferred, mihoyo, conf}} for one game.
function cnGameMonths(tag){
  tag = tag || state.tag; const out={};
  const g = state.cn && state.cn.games && state.cn.games[tag];
  if(g) for(const ym in g.monthly){ const r=g.monthly[ym];
    out[ym]={lo:r.rev_min_cny, hi:r.rev_max_cny, metric:r.metric_cn,
             inferred:!!r.metric_inferred, mihoyo:!!r.excludes_mihoyo_payment_center,
             conf:r.confidence}; }
  return out;
}
function cnMonth(ym, tag){ return cnGameMonths(tag)[ym]||null; }
// Sum CN monthly revenue over months matching pred(ym) -> {lo,hi,months,mixed} or null.
function cnSum(pred, tag){
  const mm=cnGameMonths(tag); let lo=0, hi=0, months=0; const labels=new Set();
  for(const ym in mm){ if(!pred(ym)) continue;
    lo+=mm[ym].lo; hi+=(mm[ym].hi==null?mm[ym].lo:mm[ym].hi); months++;
    if(mm[ym].metric) labels.add(mm[ym].metric); }
  return months?{lo,hi,months,mixed:labels.size>1}:null;
}
// The data month at which the caption's metric switches 总收入 -> 总流水. Read from the
// data rather than hard-coded, so it stays right if the scrape is re-run.
function cnMetricBreak(tag){
  const mm=cnGameMonths(tag), ks=Object.keys(mm).sort();
  for(let i=1;i<ks.length;i++) if(mm[ks[i]].metric!==mm[ks[i-1]].metric) return ks[i];
  return null;
}
// Does a set of months straddle the 收入/流水 change? Summing across it compares net
// against gross, so anywhere we do sum we say so.
function cnMixedMetric(pred, tag){
  const mm=cnGameMonths(tag), seen=new Set();
  for(const ym in mm) if(pred(ym) && mm[ym].metric) seen.add(mm[ym].metric);
  return seen.size>1;
}
// A banner's ESTIMATED CN revenue. Same construction as bannerST: the source publishes
// only a monthly total, so a banner takes its share of that month's game-i revenue and
// applies it to the CN month, summed across the months it ran. Inherits every caveat of
// the ST version PLUS a weaker one — game-i is Japan mobile, this total is worldwide and
// includes PC and console, so the share is a rougher proxy still.
function bannerCN(b){
  if(!b || b._synthetic) return {lo:0, hi:0, months:[], covered:0, missing:0, hasData:false, partial:false, mixed:false};
  if(b._cn) return b._cn;
  const bm=state.monthly||{}, gi=state.data.monthly||{};
  const months=[]; let lo=0, hi=0, covered=0, missing=0; const labels=new Set();
  for(const ym of Object.keys(bm).sort()){
    const entry=bm[ym].banners.find(x=>x.i===b._i); if(!entry) continue;
    const o=bm[ym].ours||0, g=gi[ym];
    const base=(g!=null && o>0 && (g-o)/g>=0.08) ? g : o;                   // same denominator as ST
    // same two-source blend as bannerST: average game-i's and Qimai's month share
    const giShare=base>0 ? entry.rev/base : 0;
    const qmS=qimaiShare(b, ym);
    const share = blendShare(giShare, qmS);
    const qmR=(qmS!=null) ? (((state.qimai.games[state.tag].banners[b._i]||{}).monthly||{})[ym]||0) : null;
    const cn=cnMonth(ym);
    const rec={ym, share, giShare, qmShare:qmS, qmRev:qmR, jp:entry.rev};
    if(cn){ lo+=share*cn.lo; hi+=share*(cn.hi==null?cn.lo:cn.hi); covered++;
            if(cn.metric) labels.add(cn.metric);
            months.push({...rec, cnLo:cn.lo, cnHi:cn.hi, metric:cn.metric,
                         contribLo:share*cn.lo, contribHi:share*(cn.hi==null?cn.lo:cn.hi), mihoyo:cn.mihoyo}); }
    else  { missing++; months.push({...rec, cnLo:null, cnHi:null}); }
  }
  return (b._cn={lo, hi, months, covered, missing, hasData:covered>0,
                 partial:missing>0&&covered>0, mixed:labels.size>1});
}
// A small "CN ¥X" chip, mirroring stChip. Marks miHoYo rows, whose 支付中心 revenue the
// source excludes outright, and rows whose metric label had to be read from the episode.
function cnChip(row, extra){
  if(!row) return "";
  const est = row.mihoyo || row.hi>row.lo;
  const tip = "天天背锅崩坏娘's monthly CN ranking — GLOBAL revenue, all platforms "
    + "(mobile + PC + PlayStation), in yuan. Rank-derived estimate, not reported sales"
    + (row.metric?`. Metric on screen: ${row.metric}`:"")
    + (row.mihoyo?". miHoYo's 支付中心 direct top-up channel is excluded, so this is understated — hence the range":"")
    + (row.inferred?". Metric label unreadable on this month's caption; taken from the rest of that episode":"")
    + (extra?". "+extra:"");
  return `<span class="cn-chip${est?" est":""}" title="${esc(tip)}">CN ${fmtCNYRange(row.lo,row.hi)}</span>`;
}

// ---- Qimai China-iPhone revenue layer (USD, App Store gross, daily) ------------------
// A DAILY source like game-i, so per banner it's a direct figure — the sum of Qimai's
// daily China-iPhone revenue over the banner's run (each concurrent day split among the
// running banners the same way game-i's daily model splits it). Precomputed in
// data/qimai.json (scripts build it), keyed by the banner's array index (= _i). USD.
function hasQimai(tag){ tag=tag||state.tag;
  return !!(state.qimai && state.qimai.games && state.qimai.games[tag]); }
function bannerQimai(b){
  if(!b || b._synthetic) return {total:0, months:[], hasData:false};
  if(b._qm!==undefined) return b._qm;
  const g = state.qimai && state.qimai.games && state.qimai.games[state.tag];
  const e = g && g.banners && g.banners[b._i];
  if(!e) return (b._qm={total:0, months:[], daily:[], hasData:false});
  const months=Object.keys(e.monthly||{}).sort().map(ym=>({ym, rev:e.monthly[ym]}));
  const daily=e.daily||[];
  const peak=daily.length?Math.max(...daily):0, peakDay=daily.indexOf(peak)+1;
  return (b._qm={total:e.total||0, months, daily, start:e.start||b.start, peak, peakDay, hasData:(e.total||0)>0});
}
// This game's banners ranked by Qimai China-iPhone revenue (desc) -> {rank, of, yrank, yof}.
function qimaiRankInfo(b){
  const g=state.qimai&&state.qimai.games&&state.qimai.games[state.tag]; if(!g) return null;
  const withRev=state.data.banners.filter(x=>!x._synthetic && !x.pending && bannerQimai(x).total>0);
  const sorted=[...withRev].sort((x,y)=>bannerQimai(y).total-bannerQimai(x).total);
  const rank=sorted.findIndex(x=>x._i===b._i)+1; if(!rank) return null;
  const yr=withRev.filter(x=>x.year===b.year).sort((x,y)=>bannerQimai(y).total-bannerQimai(x).total);
  const yrank=yr.findIndex(x=>x._i===b._i)+1;
  return {rank, of:sorted.length, yrank, yof:yr.length};
}
// Build-up chart from Qimai's REAL daily China revenue (not a reconstruction) — bars are
// each day's dollars, the line is the running total. Mirrors buildupSVG but in USD.
// A game-i-shaped daily breakdown from Qimai's REAL daily China revenue: {days:[{i,rank,
// add,cum}]} — rank is the China iOS rank that day (from cnRunSeries), add is the day's
// attributed China dollars, cum the running total. Feeds the SAME buildupSVG/dailyTable
// game-i uses, so the section renders identically, just in USD with the China rank.
function qimaiBD(b){
  const qm=bannerQimai(b); if(!qm.daily.length) return null;
  const run=cnRunSeries(b)||[];   // China rank, now aligned to the same China window as the revenue
  const g=state.qimai&&state.qimai.games&&state.qimai.games[state.tag];
  const qFirst=(g&&g.first)||null, qLast=(g&&g.last)||null;   // the China dates Qimai has posted
  const s0=new Date((qm.start||b.start)+"T00:00:00");   // China run start (offset from game-i's)
  let cum=0;
  const days=qm.daily.map((add,i)=>{
    const dt=new Date(s0); dt.setDate(dt.getDate()+i);
    const iso=`${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`;
    // game-i tracks the GLOBAL calendar, which can run a day past Qimai's latest posted day
    // (or start before Qimai's history) — those days have no estimate yet, not a real ¥0.
    const noData = (qLast!=null && iso>qLast) || (qFirst!=null && iso<qFirst);
    if(!noData) cum+=add;                        // a pending day doesn't advance the running total
    return {i, iso, rank:(run[i]&&run[i].rank!=null)?run[i].rank:null, add, cum, noData}; });
  return {days};
}
// Front-loading of the REAL daily curve: what share of the run's total landed by day 3,
// day 7, and which day it passed half. Mirrors burnout() but on measured daily, not rank.
function qimaiBurnout(b){
  const qm=bannerQimai(b); const d=qm.daily; if(!d.length) return null;
  const tot=d.reduce((a,c)=>a+c,0); if(tot<=0) return null;
  const at=n=>d.slice(0,n).reduce((a,c)=>a+c,0)/tot;
  let run=0, half=null; for(let i=0;i<d.length;i++){ run+=d[i]; if(half==null && run>=tot/2) half=i+1; }
  return {days:d.length, d3:at(3), d7:at(7), half};
}
// Median cumulative-share-by-day across this game's FINISHED Qimai banners — lets an
// ongoing run be projected (so far / share[day]). Mirrors gameShareCurve() on real daily.
function qimaiShareCurve(){
  if(state._qShareCurve!==undefined) return state._qShareCurve;
  const g=state.qimai&&state.qimai.games&&state.qimai.games[state.tag];
  if(!g){ return (state._qShareCurve=null); }
  const cols=[];
  for(const b of state.data.banners){
    if(b._synthetic||b.pending||b.ongoing) continue;
    const e=g.banners&&g.banners[b._i]; if(!e||!(e.total>0)||!(e.daily&&e.daily.length>=BURN_MIN_DAYS)) continue;
    let run=0; e.daily.forEach((v,i)=>{ run+=v; (cols[i]=cols[i]||[]).push(run/e.total); });
  }
  const q=(a,f)=>{const x=[...a].sort((p,r)=>p-r); return x[Math.min(x.length-1,Math.floor(x.length*f))];};
  const keep=cols.filter(a=>a.length>=5);
  if(keep.length<3) return (state._qShareCurve=null);
  return (state._qShareCurve={ n:keep[0].length, days:keep.length,
    share:keep.map(a=>_med(a)), lo:keep.map(a=>q(a,0.25)), hi:keep.map(a=>q(a,0.75)) });
}
// Median first-3-day / first-week / half-by-day across finished Qimai banners.
function qimaiGameBurn(){
  if(state._qGameBurn!==undefined) return state._qGameBurn;
  const d3=[],d7=[],half=[];
  for(const b of state.data.banners){
    if(b._synthetic||b.pending||b.ongoing) continue;
    const bo=qimaiBurnout(b); if(bo && bo.days>=BURN_MIN_DAYS){ d3.push(bo.d3); d7.push(bo.d7); half.push(bo.half); }
  }
  if(d7.length<5) return (state._qGameBurn=null);
  return (state._qGameBurn={med:_med(d7), med3:_med(d3), medHalf:_med(half), n:d7.length});
}
// The build-up analysis, mirroring burnBlock() but on Qimai's measured China daily: the
// front-loading tiles, an ongoing projection (so far vs the game's usual curve), and a
// finished-run comparison against the game's other Qimai banners.
function qimaiBurnBlock(b){
  const bo=qimaiBurnout(b); if(!bo || (!b.ongoing && bo.days<8)) return "";
  const pc=x=>Math.round(x*100)+"%", nm=esc(gameName());
  const tiles=`<div class="bm-stats bm-share3 bm-burn">
    <div class="bm-stat"><span class="l">First 3 days</span><span class="v">${pc(bo.d3)}</span></div>
    <div class="bm-stat"><span class="l">First week</span><span class="v">${pc(bo.d7)}</span></div>
    <div class="bm-stat"><span class="l">Half earned by</span><span class="v">Day ${bo.half}</span></div>
  </div>`;
  if(b.ongoing){
    const sc=qimaiShareCurve(), D=bo.days, qm=bannerQimai(b);
    const sh=sc && D>=2 && D<=sc.days ? sc.share[D-1] : null;
    const scheduled=Math.round((Date.parse(b.end)-Date.parse(b.start))/864e5)+1;
    if(!sh || !(qm.total>0) || sh<=0.02)
      return `<div class="bm-cap">This run is <b>still going</b> — day <b>${D}</b> of ${scheduled}. There isn't enough finished Qimai history for ${nm} to say where its China total lands yet.</div>`;
    const proj=qm.total/sh, pLo=qm.total/sc.hi[D-1], pHi=qm.total/sc.lo[D-1];
    return `<div class="bm-stats bm-share3 bm-burn">
      <div class="bm-stat"><span class="l">Day</span><span class="v">${D} of ${scheduled}</span></div>
      <div class="bm-stat"><span class="l">Usually banked by now</span><span class="v">${pc(sh)}</span></div>
      <div class="bm-stat sum"><span class="l">Tracking towards</span><span class="v">${fmtUSD(proj)}</span></div>
    </div>
    <div class="bm-cap">Across ${sc.n} finished ${nm} banners the usual one has <b>${pc(sh)}</b> of its
      China-iPhone total by day <b>${D}</b>. This one has <b>${fmtUSD(qm.total)}</b>, which puts it near
      <b>${fmtUSD(proj)}</b> — between <b>${fmtUSD(pLo)}</b> and <b>${fmtUSD(pHi)}</b>.</div>`;
  }
  const g=qimaiGameBurn(); if(!g) return tiles;
  if(bo.days<BURN_MIN_DAYS) return tiles+`<div class="bm-cap">At <b>${bo.days} days</b> this run is too short to line up against ${nm}'s longer banners.</div>`;
  const d=(bo.d7-g.med)*100;
  const verdict = Math.abs(d)<5 ? `right about typical for ${nm}`
    : d>0 ? `<b>more front-loaded</b> than a typical ${nm} banner`
          : `<b>a longer tail</b> than a typical ${nm} banner`;
  const gap=(mine,norm)=>{const k=Math.round((mine-norm)*100);
    return Math.abs(k)<4?"about the same":`<b>${Math.abs(k)} points ${k>0?"more":"less"}</b>`;};
  return tiles+`<div class="bm-cap">In China dollars this run is ${verdict}. Across ${g.n} finished ${nm}
    banners the usual one takes <b>${Math.round(g.med3*100)}%</b> in its first 3 days (this one ${gap(bo.d3,g.med3)}),
    <b>${Math.round(g.med*100)}%</b> in its first week (${gap(bo.d7,g.med)}), and is half done by
    day <b>${g.medHalf}</b> against this one's day <b>${bo.half}</b>.</div>`;
}
// "How this run compares" on Qimai China-iPhone dollars: where the run's total sits among
// the game's banners (all-time + this year), and the nearest peers with their figures.
// "How this run compares" for the Qimai tab. Same structure as the CN tab (it's the same
// China chart), so it carries the full set game-i's tab has — placement scopes, percentile,
// median, top-20/50 hold, rank slip, the anchor, and the two face strips — but the money is
// Qimai's REAL per-banner China-iPhone revenue, not the CN¥ estimate. Rank readings come
// from cnRunStats (the real store chart); the money from bannerQimai.
// Qimai China-$ a peer had banked by day D (sum of its first D daily figures), for the
// "similar total by day" comparison on ongoing runs — mirrors cumAtDay on real daily.
function qmCumAtDay(p, D){ const g=state.qimai&&state.qimai.games&&state.qimai.games[state.tag];
  const e=g&&g.banners&&g.banners[p.b._i]; if(!e||!e.daily) return null;
  return e.daily.slice(0,D).reduce((a,c)=>a+c,0); }
function qimaiAnalysisBlock(b){
  const qm=bannerQimai(b); if(!qm.hasData) return "";
  const st=cnRunStats(b);
  const qmRev=p=>bannerQimai(p.b).total;
  const qmPeak=p=>bannerQimai(p.b).peak;   // biggest single China-iPhone day
  // No China rank for this run: fall back to a revenue-only placement + peers.
  if(!st || st.none){
    const r=qimaiRankInfo(b);
    let place=`<div class="bm-verdict call"><span class="head">Where this run sits by China revenue</span>`;
    if(r){ const band=r.rank<=r.of/2?`top <b>${Math.max(1,Math.round(100*r.rank/r.of))}%</b>`:`bottom <b>${Math.max(1,Math.round(100*(r.of-r.rank+1)/r.of))}%</b>`;
      place+=` This banner's <b>${fmtUSD(qm.total)}</b> ranks <b>${ordinal(r.rank)}</b> of the game's <b>${r.of}</b> banners with Qimai data — its ${band}.`;
      if(r.yof>=2) place+=` Among ${b.year}'s <b>${r.yof}</b> it is <b>${ordinal(r.yrank)}</b>.`; }
    place+=` No China chart covers this run, so this is a revenue-only read.</div>`;
    return `<h3>How this run compares</h3>${place}`;
  }
  const peers=cnPeers().filter(p=>p.b._i!==b._i);
  if(peers.length<3) return "";
  const ver=hasVersions(state.tag)?versionOf(b):null;
  const kind=b.rerun?"rerun":"debut";
  const cohort=peers.filter(p=>!!p.b.rerun===!!b.rerun && !p.b.ongoing);
  const pk=st.peak, n=v=>v===0?"none":`<b>${v}</b>`;

  const scopes=[];
  if(ver){ const g=cohort.filter(p=>versionOf(p.b)===ver).map(p=>p.st.peak); if(g.length>=2) scopes.push([`${ver}`,_place([...g,pk],pk)]); }
  const yrS=cohort.filter(p=>p.b.year===b.year).map(p=>p.st.peak); if(yrS.length>=2) scopes.push([`${b.year}`,_place([...yrS,pk],pk)]);
  const scopeLine=scopes.length?` — `+scopes.map(([lab,r])=>`<b>${ordinal(r.place)} of ${r.of}</b> in ${lab}`).join(" · ")+`, among this game's charted ${kind}s`:"";

  const sameYear=cohort.filter(p=>p.b.year===b.year);
  const base=sameYear.length>=3?sameYear:cohort;
  const baseLab=sameYear.length>=3?`in ${b.year}`:"across this game's history";
  const medPeak=_med(base.map(p=>p.st.peak)), medMed=_med(base.map(p=>p.st.median));
  const ranLine=base.length>=3?` It ran at a median of <span class="fig">#${st.median}</span>${b.ongoing?" so far":""}; the usual ${kind} ${baseLab} peaks at <b>#${medPeak}</b> and runs at a median of <b>#${medMed}</b>.`:"";

  let rankLine="";
  if(cohort.length>=5){ const r=_place([...cohort.map(p=>p.st.peak),pk],pk);
    const band=r.place<=r.of/2?`top <b>${Math.max(1,Math.round(100*r.place/r.of))}%</b>`:`bottom <b>${Math.max(1,Math.round(100*(r.of-r.place+1)/r.of))}%</b>`;
    rankLine=` Among this game's <b>${r.of}</b> charted ${kind}s that is <b>${ordinal(r.place)}</b> — its ${band}.`; }

  let holdLine="";
  if(cohort.length>=5){ const m20=_med(cohort.map(p=>p.st.top20)),m50=_med(cohort.map(p=>p.st.top50));
    const hiPeak=pk<=_med(cohort.map(p=>p.st.peak)), held=st.top50>=m50;
    const read=hiPeak&&held?"it both peaked better and held longer than the usual one":hiPeak&&!held?"it peaked better than most but faded earlier — a short, sharp run":!hiPeak&&held?"it never peaked as high, but it held on longer than most":"it neither climbed as high nor lasted as long as the usual one";
    holdLine=` It held the <b>top 20</b> for <b>${st.top20}</b> of its ${st.days} days and the <b>top 50</b> for <b>${st.top50}</b>, against <b>${m20}</b> and <b>${m50}</b> for the usual ${kind} — ${read}.`; }

  const chkD=Math.min(7,st.days);
  const rkCN=x=>{const r=(x.st.run||[])[chkD-1]; const v=r?r.rank:null; return v==null?OFF_CHART:v;};
  let slipLine="",mineRank=null;
  if(chkD>=3&&st.days>=3){ mineRank=rkCN({b,st}); const mineSlip=slipOf(pk,st.peakDay,mineRank,chkD);
    const peerSlips=cohort.filter(q=>q.st.days>=chkD).map(q=>slipOf(q.st.peak,q.st.peakDay,rkCN(q),chkD)).filter(v=>v!=null);
    if(mineSlip!=null&&peerSlips.length>=5){ const medSlip=_med(peerSlips);
      const word=mineSlip>medSlip*1.3?"<b>falling faster</b> than most":mineSlip<medSlip*0.7?"<b>holding better</b> than most":"sliding at about the usual rate";
      slipLine=` By day ${chkD} it sat at <b>${mineRank>=OFF_CHART?`${OFF_CHART}+`:`#${mineRank}`}</b>, about <b>${mineSlip.toFixed(1)}</b> places a day off its peak against <b>${medSlip.toFixed(1)}</b> for the usual ${kind} — ${word}.`; } }

  let anchorLine="";
  const anchor=cohort.filter(p=>qmRev(p)>0).sort((x,y)=>Math.abs(x.st.peak-pk)-Math.abs(y.st.peak-pk)).slice(0,7);
  if(anchor.length>=5){ const revs=anchor.map(p=>qmRev(p));
    anchorLine=` ${kind[0].toUpperCase()+kind.slice(1)}s peaking near <b>#${pk}</b> have earned around <span class="fig">${fmtUSD(_med(revs))}</span> in China (${fmtUSD(Math.min(...revs))} to ${fmtUSD(Math.max(...revs))}).`; }

  // two face strips: by China revenue (the money spine) and by peak rank
  let revStrip="", rankStrip="";
  // By PEAK China-iPhone day (biggest single day), not total — the "similar total by day"
  // list below already covers the total, so this strip reads the height of the spike instead.
  const yrRev=peers.filter(p=>p.b.year===b.year && !p.b.ongoing && qmPeak(p)>0);
  if(yrRev.length>=2 && qm.peak>0){ const hi=yrRev.filter(p=>qmPeak(p)>qm.peak).length, lo=yrRev.length-hi;
    revStrip=cohortStrip([...yrRev,{b,st}].sort((x,y)=>qmPeak(y)-qmPeak(x)),b,x=>fmtUSD(qmPeak(x)),
      `This game's <b>${yrRev.length+1}</b> banners in ${b.year} by their biggest single China-iPhone day — ${n(hi)} had a bigger day than this one, ${n(lo)} the same or smaller.`,"By China iOS revenue at peak"); }
  const yrAll=peers.filter(p=>p.b.year===b.year && !p.b.ongoing);
  if(yrAll.length>=2){ const hi=yrAll.filter(p=>p.st.peak<pk).length, lo=yrAll.length-hi;
    rankStrip=cohortStrip([...yrAll,{b,st}].sort((x,y)=>x.st.peak-y.st.peak),b,x=>`#${x.st.peak}`,
      `The same banners by peak rank, best first — ${n(hi)} peaked higher than this one, ${n(lo)} the same or lower.`,"By peak rank"); }

  const place=`<div class="bm-verdict call"><span class="head">Where this run sits on China's chart</span>
    Peaked at <span class="fig">#${pk}</span> on day ${st.peakDay}${scopeLine}.${rankLine}${ranLine}${holdLine}${slipLine}${anchorLine}
    ${st.peakDay>1?`It opened at <b>#${st.open}</b>, but an opening day is the least reliable reading of a run, so the comparison keys on the peak.`:``}
    ${revStrip}${rankStrip}
    <span class="after">#1 here is the whole Chinese App Store, not just games, so these ranks sit against Douyin and WeChat as well. The rank is the real store chart; the dollars are Qimai's China-iPhone estimate for this same run — one market, one platform, the tightest read of the tabs. Norms are per-game: a #20 peak is near the bottom for this game's ${kind}s in some years and near the top in others, so the comparison is always against this game alone.</span></div>`;

  // peer lists — figures are Qimai China $ (main), with game-i/ST alongside
  const peerRow=(p,sub)=>{ const stv=bannerST(p.b);
    const figs=[`<span class="main">${fmtUSD(qmRev(p))}</span>`];
    if(stv.hasData) figs.push(`<span>ST ≈${fmtUSD(stv.total)}</span>`);
    if(p.b.rev>0) figs.push(`<span>game-i ${G(p.b.rev)}</span>`);
    return `<div class="bm-peer" data-i="${p.b._i}" title="Open ${esc(peerName(p.b))}" style="--av-ring:${barColor(p.b)}">
      <span class="av">${avatarHTML(p.b)}</span>
      <span class="who"><span class="nm">${esc(peerName(p.b))}</span><span class="sub">${sub}</span></span>
      <span class="figs">${figs.join("")}</span></div>`; };
  // Peers by CHINA TOTAL, not peak rank — for Qimai the money is the spine. On an ongoing
  // run, compare at the same elapsed day (what each had banked by day D); on a finished one,
  // by the final total.
  const D=qm.daily.length;
  const onCum = b.ongoing && D>=2;
  const sameDay = peers.filter(p=>!p.b.ongoing && qmCumAtDay(p,D)!=null && qmCumAtDay(p,D)>0);
  const near = onCum && sameDay.length>=3
    ? pickPeers(sameDay, b, qm.total, p=>qmCumAtDay(p,D))
    : pickPeers(peers.filter(p=>qmRev(p)>0), b, qm.total, p=>qmRev(p));
  const rows=near.map(p=>peerRow(p, onCum && sameDay.length>=3
    ? `${fmtUSD(qmCumAtDay(p,D))} by day ${D} · finished ${fmtUSD(qmRev(p))} · peak #${p.st.peak} · ${per(p.b.start)}${p.b.rerun?" · rerun":""}`
    : `${fmtUSD(qmRev(p))} · peak #${p.st.peak} on day ${p.st.peakDay} · ${per(p.b.start)}${p.b.rerun?" · rerun":""}`)).join("");
  const nearHdr = onCum && sameDay.length>=3 ? `Banners at a similar total by day ${D}` : `Banners at a similar total`;
  const rkLabCN=v=>v>=OFF_CHART?`${OFF_CHART}+`:`#${v}`;
  let dayList="";
  if(mineRank!=null){ const dNear=pickPeers(peers.filter(q=>q.st.days>=chkD && qmRev(q)>0), b, mineRank, rkCN);
    if(dNear.length>=3) dayList=`<h3>Banners at a similar rank by day ${chkD}</h3>
      <div class="bm-peerlist">${dNear.map(q=>peerRow(q,`${rkLabCN(rkCN(q))} by day ${chkD} · peak #${q.st.peak} on day ${q.st.peakDay} · opened #${q.st.open} · ${per(q.b.start)}${q.b.rerun?" · rerun":""}`)).join("")}</div>`; }

  // verdict — this run's China total against the peers it resembles
  const nearRevs=near.map(p=>qmRev(p)).filter(v=>v>0).sort((a,c)=>a-c);
  const spread=nearRevs.length?`${fmtUSD(nearRevs[0])} to ${fmtUSD(nearRevs[nearRevs.length-1])}`:"—";
  const md=nearRevs.length?_med(nearRevs):0;
  let head, body;
  if(!b.ongoing){ const diff=md?qm.total/md:1;
    const word=diff>=1.25?"well above":diff>=1.05?"above":diff<=0.75?"well below":diff<=0.95?"below":"in line with";
    head="How it turned out";
    body=`This run is finished at <span class="fig">${fmtUSD(qm.total)}</span> in China-iPhone gross. The ${near.length} banners nearest it in China total earned ${spread}, so it landed <b>${word}</b> the runs it resembles.`;
  } else {
    // project the China total from the game's own share curve, the same way the build-up does
    const sc=qimaiShareCurve(), sh=sc && D>=2 && D<=sc.days ? sc.share[D-1] : null;
    const proj = sh && sh>0.02 && qm.total>0 ? qm.total/sh : null;
    head="What it is tracking towards";
    body=`Still running, <b>${D}</b> charted day${D>1?"s":""} in at <span class="fig">${fmtUSD(qm.total)}</span> so far in China-iPhone gross.`
      + (proj?` This game's usual banner has banked <b>${Math.round(sh*100)}%</b> of its China total by day ${D}, which puts this one on track for about <span class="fig">${fmtUSD(proj)}</span>.`:``)
      + ` The banners nearest it at this same day went on to finish around ${spread}.`;
  }
  const verdict=`<div class="bm-verdict"><span class="head">${head}</span>${body}
    <span class="after">Rank and revenue here both come from China — the real store chart beside Qimai's China-iPhone dollars, over ${near.length} comparable runs — so this stays in <b>one market and one platform</b>. ${ASSOC_NOTE}</span></div>`;

  return `<h3>How this run compares</h3>${place}
    <h3>${nearHdr}</h3>
    <div class="bm-peerlist">${rows}</div>${dayList}${verdict}`;
}
// Qimai's own monthly game total, and the share denominator used for the 2-source blend.
function qimaiMonth(ym, tag){ const g=state.qimai&&state.qimai.games&&state.qimai.games[tag||state.tag];
  return (g&&g.monthly&&g.monthly[ym])||null; }
// Sum Qimai China month totals (qtot) over months matching pred(ym) -> USD.
function qimaiSum(pred, tag){ const g=state.qimai&&state.qimai.games&&state.qimai.games[tag||state.tag];
  const mm=(g&&g.monthly)||{}; let s=0; for(const ym in mm) if(pred(ym)) s+=mm[ym].qtot||0; return s; }
// The share this banner had of its game's Qimai China month (0..1), or null if no data.
function qimaiShare(b, ym){ const g=state.qimai&&state.qimai.games&&state.qimai.games[state.tag];
  const e=g&&g.banners&&g.banners[b._i], m=g&&g.monthly&&g.monthly[ym];
  if(!e||!m||!m.base) return null;
  const r=(e.monthly&&e.monthly[ym])||0; return r>0 ? r/m.base : 0; }
// The per-banner month share, blending the two daily sources. Wherever Qimai has data for
// the month we AVERAGE the two — and a real zero from either side still counts: a banner
// below game-i's top 200 (¥0 in Japan) that Qimai saw earning in China takes HALF its Qimai
// share, not the full one, so its missing Japan value weighs on the split (and vice-versa).
// `qm` is null only when there's no Qimai data at all for the month — then game-i stands alone.
function blendShare(gi, qm){
  if(qm==null) return gi;              // no Qimai data this month → game-i alone
  return (gi+qm)/2;                    // average — a 0 from either side is a real datapoint
}
// Whether Qimai data exists for the month (so the share is a two-source blend) or not (game-i
// alone). With the averaging rule above there's no longer a Qimai-only case.
function shareMode(m){ return m.qmShare==null ? "gi" : "both"; }
// A small "Qimai $X" chip — China iPhone gross, USD, Qimai model estimate.
function qmChip(rev, extra){
  if(rev==null||rev<=0) return "";
  const tip="Qimai (七麦) estimate — China iPhone App Store gross revenue, USD, summed from its daily figures"+(extra?". "+extra:"");
  return `<span class="qm-chip" title="${esc(tip)}">Qimai ${fmtUSD(rev)}</span>`;
}

// self-hiding scrollbars: flag <html> while anything is scrolling (capture catches the
// non-bubbling scroll events from inner scrollers) and clear it after a short idle, so
// the styled thumb (style.css) only fades in during a scroll.
let _scrollIdle;
addEventListener("scroll", ()=>{
  const h=document.documentElement; h.classList.add("scrolling");
  clearTimeout(_scrollIdle); _scrollIdle=setTimeout(()=>h.classList.remove("scrolling"), 850);
}, {capture:true, passive:true});

// ---- color helpers (clamp lightness for readable bars in each theme) ----
function hexToHsl(h){h=h.replace("#","");if(h.length===3)h=h.split("").map(c=>c+c).join("");
  const r=parseInt(h.slice(0,2),16)/255,g=parseInt(h.slice(2,4),16)/255,b=parseInt(h.slice(4,6),16)/255;
  const mx=Math.max(r,g,b),mn=Math.min(r,g,b);let hue=0,s=0,l=(mx+mn)/2;
  if(mx!==mn){const d=mx-mn;s=l>.5?d/(2-mx-mn):d/(mx+mn);
    hue=mx===r?(g-b)/d+(g<b?6:0):mx===g?(b-r)/d+2:(r-g)/d+4;hue/=6;}return[hue,s,l];}
function hslToHex(h,s,l){function f(n){const k=(n+h*12)%12,a=s*Math.min(l,1-l);
  const c=l-a*Math.max(-1,Math.min(k-3,9-k,1));return Math.round(c*255).toString(16).padStart(2,"0");}
  return "#"+f(0)+f(8)+f(4);}
function barShades(hex){const[h,s,l]=hexToHsl(hex||"#888");
  return[hslToHex(h,Math.max(s,.18),Math.min(Math.max(l,.34),.55)),
         hslToHex(h,Math.max(s,.22),Math.min(Math.max(l,.50),.70))];}

// ---- init ----
// no-cache revalidates with the server (ETag) so a stale or half-written cached
// copy after a Pages redeploy can't wedge the app; throws on HTTP errors so
// failures surface as a retry screen instead of an eternal "Loading…".
async function getJSON(url){
  const r = await fetch(url, {cache:"no-cache"});
  if(!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}
function showError(err, retry){
  console.error(err);
  $("#chart").innerHTML =
    `<div class="loading err">Couldn't load data (${esc(err.message||String(err))}).<br>` +
    `This is usually a brief network hiccup or the site mid-redeploy.<br>` +
    `<button class="ghost" id="retryBtn">Retry</button></div>`;
  $("#retryBtn").onclick = retry;
}
async function init(){
  let idx;
  try { idx = await getJSON("data/index.json"); }
  catch(e){ showError(e, init); return; }
  // external comparison layer. Best-effort: a miss just hides the ST figures.
  // reported = canonical monthly report figures; ext = validated eog reconstruction (fallback).
  try { state.ext = await getJSON("data/external_revenue.json"); } catch(e){ state.ext=null; }
  try { state.reported = await getJSON("data/reported_revenue.json"); } catch(e){ state.reported=null; }
  // CN monthly layer. Best-effort like the others: a miss just hides the CN figures.
  try { state.cn = await getJSON("data/cn_monthly.json"); } catch(e){ state.cn=null; }
  // Qimai daily China-iPhone revenue (USD, App Store gross, Qimai model estimate), per
  // banner + per month. A daily source like game-i, but for China iOS. Best-effort.
  try { state.qimai = await getJSON("data/qimai.json"); } catch(e){ state.qimai=null; }
  // Per-banner face focus points (game -> name -> {x,y,w,h}) for the Compare collage crops.
  try { state.focus = await getJSON("data/banner_focus.json"); } catch(e){ state.focus=null; }
  // China's own store chart, day by day (the real ranking, not an estimate).
  try { state.cnrank = await getJSON("data/ranks/cn_ios_series.json"); } catch(e){ state.cnrank=null; }
  state.pending = {};   // "pending banners" overlay is disabled (no lagging games tracked)
  state.games = (idx && idx.games) || [];
  if(!state.games.length){                    // empty index (e.g. a failed data refresh) — don't crash
    showError(new Error("no games in the data index (a refresh may have failed)"), init);
    return;
  }
  const tabs = $("#tabs"); tabs.innerHTML = "";
  state.games.forEach(g=>{
    const b=document.createElement("button"); b.className="tab"; b.dataset.tag=g.game;
    b.innerHTML=`<span class="g">${g.name}</span><span class="t">${g.count} banners · ${G(g.total_oku)}</span>`;
    b.onclick=()=>selectGame(g.game); tabs.appendChild(b);
  });
  // ResizeObserver fires after layout settles and on width changes; fonts.ready
  // covers late font metrics. Deterministic width math avoids wrap-timing flakiness.
  new ResizeObserver(layoutTabs).observe($("#tabs"));
  addEventListener("resize", layoutTabs);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(layoutTabs);
  // re-fit month-card banner names when the layout reflows (banner widths change)
  let _fitT; addEventListener("resize", ()=>{ clearTimeout(_fitT);
    _fitT=setTimeout(()=>{ if(document.querySelector("#chart .mcb")) fitBannerNames($("#chart")); }, 150); });
  const start = (location.hash||"").replace("#","");
  selectGame(state.games.some(g=>g.game===start)?start:state.games[0].game);
  // a shared ?c= link opens the compare dialog on the saved picks
  const cp=cmpParseURL();
  if(cp && cp.picks.length){
    state.compare.picks=cp.picks;
    state.compare.sources={}; CMP_SOURCES.forEach(([k])=>state.compare.sources[k]=!cp.off.includes(k));
    $("#compareModal").hidden=false; renderCompare();
  }
}

// Collapse the game list to one no-wrap row with an "+N more" toggle. Collapsed is a
// single line, so we count how many tabs fit by summing their widths (deterministic).
function layoutTabs(){
  const tabs=$("#tabs"), toggle=$("#tabsToggle");
  if(!tabs.children.length || !tabs.clientWidth) return;
  tabs.classList.toggle("collapsed", !state.tabsExpanded);
  if(state.tabsExpanded){ toggle.hidden=false; toggle.textContent="Show less ▴"; return; }
  let used=0, fit=0;
  for(const t of tabs.children){ used += t.offsetWidth + 8; if(used > tabs.clientWidth && fit>0) break; fit++; }
  const hidden = tabs.children.length - fit;
  toggle.hidden = hidden<=0;
  toggle.textContent = `+${hidden} more ▾`;
}
$("#tabsToggle").onclick=()=>{ state.tabsExpanded=!state.tabsExpanded; layoutTabs(); };
let _loadSeq = 0;
async function selectGame(tag){
  state.tag=tag; location.hash=tag;
  document.querySelectorAll(".tab").forEach(t=>t.classList.toggle("on",t.dataset.tag===tag));
  document.documentElement.style.setProperty("--accent", GAME_ACCENT[tag]||"#e0a400");
  $("#chart").innerHTML=`<div class="loading">Loading ${tag.toUpperCase()}…</div>`;
  const seq = ++_loadSeq;
  let data;
  try { data = await getJSON(`data/${tag}.json`); }
  catch(e){ if(seq===_loadSeq) showError(e, ()=>selectGame(tag)); return; }
  if(seq!==_loadSeq) return;   // a newer tab click won this race
  state.data = data;
  // rank by revenue *within our dataset* — game-i's cum is against the game's full
  // history (often far larger than what we scrape), so it isn't 1..N here.
  state.data.banners = state.data.banners.filter(b=>!b._synthetic && !b.pending);   // defensive on re-entry
  computeMonthly();                                        // per-month attribution from real banners
  state.data.banners = state.data.banners.concat(computeUnlisted());  // + synthetic 'unlisted revenue'
  // recent banners game-i hasn't logged yet (FGO/Arknights JP sources) — placeholders with
  // no revenue or rank curve, shown until game-i catches up.
  const pend = (state.pending && state.pending[tag]) || [];
  if(pend.length) state.data.banners = state.data.banners.concat(
    pend.map(p=>({...p, rev:0, year:+String(p.start).slice(0,4), pending:true})));
  [...state.data.banners].sort((a,b)=>b.rev-a.rev).forEach((b,i)=>b._rank=i+1);
  state.data.banners.forEach((x,i)=>x._i=i);
  computeSharing();
  state._gameBurn = undefined;
  state._shareCurve = undefined;
  state._qGameBurn = undefined;
  state._qShareCurve = undefined;
  state._cnPeers = undefined;              // peer sets are per game
  state._jpPeers = undefined;             // typical first-week share is per game
  populateGraphYears();
  resetSearch();                         // characters differ per game — clear any active search
  renderStats(); setMode(state.mode);   // setMode wires all mode-dependent control visibility, then renders
}

// tiny inverted sparkline of the daily iOS top-grossing rank (prev + current
// month). Rank 1 sits at the top; gaps are days below the trackable ~top 200.
function sparkline(now){
  if(!now.ranks) return "";
  const vals=[...now.ranks.prev, ...now.ranks.cur];
  while(vals.length && vals[vals.length-1]==null) vals.pop();   // future days
  return sparkSVG(vals);
}
function sparkSVG(vals){
  const known=vals.filter(v=>v!=null);
  if(known.length<2) return "";
  const W=120,H=26,max=Math.max(...known),n=vals.length;
  let d="",pen=false;
  vals.forEach((v,i)=>{
    if(v==null){pen=false;return;}
    const x=(i/(n-1))*W, y=2+((v-1)/Math.max(max-1,1))*(H-4);
    d+=`${pen?"L":"M"}${x.toFixed(1)} ${y.toFixed(1)}`; pen=true;
  });
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path d="${d}"/></svg>`;
}

// The China counterpart of the JP tile. state.cnrank holds the chart itself, so this is
// the game's own place on it: today's rank, the best in the window, and how many of the
// last two months it was in the top 200 at all.
function cnNowTile(){
  const R=state.cnrank;
  if(!R || !R.days || !R.tracked || !R.tracked[state.tag]) return "";
  const days=Object.keys(R.days).sort();
  if(!days.length) return "";
  const mine=(R.games && R.games[state.tag]) || {};
  const last=days[days.length-1], depth=R.days[last][0];
  const win=days.slice(-60), vals=win.map(d=>mine[d]!=null?mine[d]:null);
  const known=vals.filter(v=>v!=null);
  const rank=mine[last]!=null?"#"+mine[last]:depth+"+";
  const best=known.length?Math.min(...known):null;
  const d=new Date(last+"T00:00:00");
  const today=new Date(); today.setHours(0,0,0,0);
  const when=(today-d)/864e5>=1
    ? `as of ${d.toLocaleDateString("en",{month:"short",day:"numeric"})}`
    : `charted ${known.length}/${win.length}d`;
  const note=best!=null ? `Best #${best} · ${when}` : `below #${depth} for ${win.length}d`;
  const tip=`Daily place on China's App Store top-grossing chart, ALL apps (games compete `
    + `with Douyin, WeChat and the video apps), ${depth} deep, last ${win.length} chart days. `
    + `"${depth}+" means it sat below the chart's depth that day.`;
  return `<div class="tile" title="${esc(tip)}"><span class="l">CN store rank today</span>`
       + `<span class="v">iOS ${rank}</span>`
       + `<span class="n">${esc(note)}</span>`
       + sparkSVG(vals)+`</div>`;
}

function nowTile(now){
  if(!now || (now.ios==null && now.android==null)) return "";
  const r=v=>v==null?"200+":"#"+v;
  const add=now.next_add?` · game-i expects ≈${G(now.next_add/1e8)} more tomorrow`:"";
  const tip=`Daily iOS top-grossing rank, last two months (top = #1; gaps = below the trackable ~top 200, which game-i counts as ¥0)${add}`;
  return `<div class="tile" title="${esc(tip)}"><span class="l">JP store rank today</span>`+
         `<span class="v">iOS ${r(now.ios)}</span>`+
         `<span class="n">Android ${r(now.android)} · monthly sales ${now.month?"#"+now.month:"—"}</span>`+
         sparkline(now)+`</div>`;
}

function monthTopBanner(ym){ const bl=(state.monthly&&state.monthly[ym]&&state.monthly[ym].banners)||[]; return bl.length?state.data.banners[bl[0].i]:null; }
function renderStats(){
  const st = state.dataSource==="st", cn = state.dataSource==="cn", qm = state.dataSource==="qimai";
  const fmt = st ? fmtUSD : cn ? fmtCNY : qm ? fmtUSD : G;
  const all = state.data.banners, real = all.filter(x=>!x._synthetic && !x.pending);
  const val = (st||cn||qm) ? srcVal : (x=>x.rev);
  const sum = (st||cn||qm) ? real.reduce((a,x)=>a+val(x),0) : all.reduce((a,x)=>a+x.rev,0);
  const top = real.reduce((a,x)=> val(x)>val(a)?x:a);
  const topName = (top.agents&&top.agents.length) ? top.agents.join(" & ") : top.name;
  // highest single month, on the active data source
  let hmYm=null, hmVal=-1;
  if(cn){ const mm=cnGameMonths(state.tag); for(const ym in mm){ const v=cnMid(mm[ym]); if(v>hmVal){hmVal=v; hmYm=ym;} } }
  else if(st){ const mm=extGameMonths(state.tag); for(const ym in mm){ if(mm[ym].rev>hmVal){hmVal=mm[ym].rev; hmYm=ym;} } }
  else if(qm){ const g=state.qimai&&state.qimai.games&&state.qimai.games[state.tag]; const mm=(g&&g.monthly)||{};
    for(const ym in mm){ if(mm[ym].qtot>hmVal){hmVal=mm[ym].qtot; hmYm=ym;} } }
  else  { // mirror the by-Month total: game-i's published monthly where it exists, else the reconstructed banner sum
          const gi=state.data.monthly||{}, bm=state.monthly||{};
          for(const ym of new Set([...Object.keys(gi),...Object.keys(bm)])){
            const v = gi[ym]!=null ? gi[ym] : ((bm[ym]&&bm[ym].ours)||0);
            if(v>hmVal){hmVal=v; hmYm=ym;} } }
  const hmBanners = hmYm ? (((state.monthly&&state.monthly[hmYm]&&state.monthly[hmYm].banners)||[]).map(x=>state.data.banners[x.i])) : [];
  const hmName = hmYm ? `${MONTHS[+hmYm.slice(5,7)-1]} ${hmYm.slice(0,4)}` : "—";
  // a row of character icons at the BOTTOM of a tile (a month can hold several banners)
  const icRow = bans => {
    const list=(bans||[]).filter(x=>x&&x.icons&&x.icons[0]), cap=9;
    if(!list.length) return "";
    const imgs=list.slice(0,cap).map(x=>`<img class="tile-ic2" src="${esc(x.icons[0])}" alt="" referrerpolicy="no-referrer" data-fb="remove" title="${esc(x.agents&&x.agents.length?x.agents.join(" & "):x.name)}">`).join("");
    return `<div class="tile-ics">${imgs}${list.length>cap?`<span class="tile-icmore">+${list.length-cap}</span>`:""}</div>`;
  };
  const tile=(l,v,n,icons="",attr="")=>`<div class="tile${attr?" tile-click":""}"${attr?" "+attr:""}><span class="l">${l}</span><span class="v">${v}</span><span class="n">${esc(n)}</span>${icons}</div>`;
  $("#tiles").innerHTML=
      tile("Total revenue", fmt(sum), `across ${real.length} banners`)
    + tile("Highest banner", fmt(val(top)), topName, icRow([top]), `data-i="${top._i}" title="Open ${esc(topName)}"`)
    + tile("Highest month", hmVal>=0?fmt(hmVal):"—", hmName, icRow(hmBanners), hmYm?`data-period="month" data-key="${hmYm}" title="Open ${esc(hmName)}"`:"")
    + tile("Average / banner", fmt(sum/real.length),
           st?"mean estimate · combined" : cn?"mean estimate · global, all platforms" : qm?"mean estimate · China iPhone" : "mean estimate")
    + nowTile(state.data.now)
    + cnNowTile();
    const srcs = "game-i.daa.jp + Sensor Tower reports" + (state.cn?" + CN monthly ranking":"");
  $("#updated").textContent=`sources: ${srcs} · updated ${new Date(state.data.updated).toISOString().slice(0,10)}`;
}

function esc(s){return (s||"").replace(/[&<>"'`]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;","`":"&#96;"}[c]));}
function scaleMax(m){const nice=[5,10,15,20,25,30,40,50,75,100,150,200];return nice.find(n=>n>=m)||Math.ceil(m/50)*50;}
function ticks(max,step){
  if(!step) step = max<=1?0.2 : max<=2.5?0.5 : max<=6?1 : max<=12?2 : max<=25?5 : max<=50?10 : max<=100?25 : 50;
  const t=[]; for(let v=0;v<=max+1e-9;v+=step) t.push(+v.toFixed(2)); return t;
}
function niceCeil(oku){ return Math.max(1, Math.ceil(oku)); }   // round up to next 100M (1億)
// USD axis (Sensor Tower mode): fit the axis tightly to the peak (the "match highest"
// behaviour) by rounding up to a fine 1-2-5-ish step, so the tallest bar nearly fills.
function usdTop(peak){
  if(peak<=0) return 1e6;
  const mag=Math.pow(10, Math.floor(Math.log10(peak)));
  const steps=[1,1.1,1.2,1.25,1.3,1.4,1.5,1.6,1.75,1.8,2,2.2,2.5,2.8,3,3.5,4,4.5,5,5.5,6,6.5,7,7.5,8,8.5,9,9.5,10];
  return (steps.find(m=>m*mag>=peak-1) || 10)*mag;
}
function usdTicks(max){
  const targ=max/4, mag=Math.pow(10, Math.floor(Math.log10(targ)));
  const step=([1,2,2.5,5,10].map(m=>m*mag).find(s=>s>=targ)) || 10*mag;
  const t=[]; for(let v=0; v<=max+1; v+=step) t.push(v); return t;
}
// axis top for a peak: a chosen bracket rounds up to it (2.04B @¥200M -> 2.2B); else
// "match highest" fits tightly (next 100M), otherwise a roomy round number.
function roundTop(peak, tight){
  if(state.bracket) return Math.ceil(peak/state.bracket - 1e-9)*state.bracket;
  return tight ? niceCeil(peak) : scaleMax(peak);
}
// ---- character search: match a banner against the active query across its JP name,
// English agent names and related field; empty query matches everything ----
function bannerText(b){ return [b.name, b.related, ...(b.agents||[])].filter(Boolean).join(" "); }
// normalize for matching: lowercase, drop separators (& / ,), collapse whitespace
function normSearch(s){ return (s||"").toLowerCase().replace(/[&/,・]/g," ").replace(/\s+/g," ").trim(); }
// token-AND match so "Miyabi & Harumasa" (label) matches text that stores agents space-joined
function searchMatch(b){ const q=normSearch(state.search); if(!q) return true;
  const t=normSearch(bannerText(b)); return q.split(" ").every(w=>t.includes(w)); }
function searching(){ return !!(state.search||"").trim(); }
function poolBanners(){
  const b=state.data.banners;
  if(state.graphYear==="all") return b;
  if(state.graphDim==="version") return b.filter(x=>versionOf(x)===state.graphYear);
  return b.filter(x=>String(x.year)===state.graphYear);
}

// ---- avatars ----
// No inline onerror handlers: image fallbacks are handled by one delegated
// listener (below), so a strict CSP with no 'unsafe-inline' script can apply and
// scraped names never land in an executable context. src/name are escaped too.
function avatarHTML(b){
  if(b._synthetic) return `<span class="mono syn">≈</span>`;
  if(b.icons&&b.icons.length){
    let h=`<img src="${esc(b.icons[0])}" alt="" referrerpolicy="no-referrer" data-fb="mono" data-nm="${esc(b.name)}">`;
    if(b.icons[1]) h+=`<img class="extra" src="${esc(b.icons[1])}" alt="" referrerpolicy="no-referrer" data-fb="remove">`;
    if(b.icons[2]) h+=`<img class="extra e2" src="${esc(b.icons[2])}" alt="" referrerpolicy="no-referrer" data-fb="remove">`;
    return h;
  }
  if(b.banner_img) return `<img class="artav" src="${esc(b.banner_img)}" alt="" referrerpolicy="no-referrer" data-fb="mono" data-nm="${esc(b.name)}">`;
  return monoStr(b.name);
}
function monoStr(name){return `<span class="mono">${esc((name||"?").trim()[0]||"?")}</span>`;}
window.mono=function(name){const d=document.createElement("span");d.className="mono";d.textContent=(name||"?").trim()[0]||"?";return d;};
// image load failures fall back here instead of via inline handlers (error does
// not bubble, so listen in the capture phase).
document.addEventListener("error", e=>{
  const el=e.target;
  if(!el || el.tagName!=="IMG") return;
  if(el.dataset.fb==="remove") el.remove();
  else if(el.dataset.fb==="mono") el.replaceWith(mono(el.dataset.nm||""));
  // game-i's banner art is often a hotlinked Discord CDN URL that expires; when it
  // 404s, swap in the (stable) Enka portrait once instead of showing nothing.
  else if(el.dataset.fb==="art"){
    const alt=el.dataset.alt;
    if(alt && el.getAttribute("src")!==alt){ el.dataset.fb="remove"; el.src=alt; }
    else el.remove();
  }
}, true);

// ---- concurrent-banner "shared revenue" detection ----
// game-i splits each day's revenue equally among every banner running that day, and
// weights a run's first day +80% / last day -80% — its own stated rules, from
// game-i.daa.jp/?ガチャ売上分析について ("同時に複数のガチャが開催されていた場合は売上を等分します").
// Confirmed against the published figures: yearly banner sums come to 88-98% of its
// own monthly totals (never over), and same-date banners carry equal figures.
// For each banner we find which days overlapped another banner and what share of its
// reconstructed revenue that represents, so the chart can flag the split. HoYo games merge simultaneous characters into one
// "A&B" entry, so this mostly lights up on event games (FGO, Arknights, …) where
// separate banners genuinely run at once. Computed once per game load.
const SHARE_MIN_DAYS = 3;                         // ignore trivial 1-day changeovers
// Synthetic "unlisted revenue" entries: when game-i's monthly total for a month
// is much larger than the banners it has listed (a rate-up/event game-i hasn't
// logged yet, or off-banner sales), add one entry for the difference so the
// game's timeline/graph/totals reflect that it kept earning. Only big positive
// gaps — small residuals are just reconstruction noise, and low-rank games
// (monthly < banners) get none. Derived client-side from the monthly table.
function computeUnlisted(){
  const gi=state.data.monthly||{}, bm=state.monthly||{}, out=[];
  // only within our banner-coverage window — months before the first tracked
  // banner are "not covered yet", not "game-i's list is behind".
  const real=state.data.banners.filter(b=>!b._synthetic);
  if(!real.length) return out;
  const firstYm=real.reduce((m,b)=>b.start.slice(0,7)<m?b.start.slice(0,7):m,"9999-99");
  const spans=real.map(b=>[Date.parse(b.start),Date.parse(b.end)]);
  const cutoff=Date.parse(state.data.updated)+9*3600e3;   // ~now (JST) — don't count future days
  for(const ym in gi){
    if(ym<=firstYm) continue;              // skip pre-coverage months and the partial first month
    const g=gi[ym]; if(!g) continue;
    const gap=g-((bm[ym]&&bm[ym].ours)||0);
    if(gap<1 || gap<g*0.4) continue;                 // >= 1億 (¥100M) AND >= 40% of the month
    const [y,mo]=ym.split("-").map(Number), last=new Date(y,mo,0).getDate();
    // Require days with NO listed banner running. Otherwise a large gap is just
    // a valuation artifact (month-start boost, or an ongoing banner whose current
    // month is under-reconstructed) rather than genuinely unlisted revenue —
    // e.g. an in-progress month whose only banner is clearly running.
    let counted=0, uncovered=0;
    for(let dd=1; dd<=last; dd++){
      const t=Date.UTC(y,mo-1,dd); if(t>cutoff) break;
      counted++;
      if(!spans.some(([s,e])=>s<=t && t<=e)) uncovered++;
    }
    if(!counted || uncovered/counted<0.4) continue;
    out.push({ name:"No rate-up banner listed",
      agents:["game-i monthly — not attributed to a banner"],
      rev:+gap.toFixed(2), start:`${ym}-01`, end:`${ym}-${String(last).padStart(2,"0")}`,
      year:y, _synthetic:true, cum:null, cumtot:null, yrank:null, ytot:null });
  }
  return out;
}

// Is a banner actually up on day `t`? A paused-and-resumed run only counts its
// sub-periods (so the gap is another banner's solo time, not shared).
function runsOn(b, t){
  const R = b._runs; return R.length===1 ? (R[0][0]<=t && t<=R[0][1]) : R.some(([a,z])=>a<=t && t<=z);
}
// Run boundaries (any sub-period), for handoff detection.
const startsOn=(b,t)=>b._runs.some(([a])=>a===t), endsOn=(b,t)=>b._runs.some(([,z])=>z===t);
// A "handoff" day: one banner ends exactly as the other starts (game-i shares that
// changeover date). They're not live at the same time, so it isn't real sharing.
const handoff=(b,o,t)=> (endsOn(b,t)&&startsOn(o,t)) || (startsOn(b,t)&&endsOn(o,t));
function computeSharing(){
  const all=state.data.banners.filter(b=>!b._synthetic), DAY=864e5;
  all.forEach(b=>{ b._runs = b.periods ? b.periods.map(p=>[Date.parse(p[0]),Date.parse(p[1])])
                                       : [[Date.parse(b.start),Date.parse(b.end)]]; });
  for(const b of all){
    const s=Date.parse(b.start), e=Date.parse(b.end), series=b.rank_series;
    // an ongoing banner's scheduled end is in the future — only count days it has
    // actually run (its rank_series length), so "shared X/Yd" reflects days elapsed.
    const eff = series&&series.length ? Math.min(e, s+(series.length-1)*DAY) : e;
    let sharedDays=0, runDays=0, maxN=1, rawTot=0, rawShared=0; const withMap=new Map();
    for(let i=0,t=s; t<=eff; t+=DAY,i++){
      if(!runsOn(b,t)) continue;                        // skip the paused gap of a split run
      runDays++;
      const raw = series ? rankValue(series[i]) : 1;    // weight by that day's reconstructed value
      rawTot += raw;
      const others=all.filter(o=>o!==b && runsOn(o,t));
      if(others.length){ sharedDays++; rawShared+=raw; maxN=Math.max(maxN,others.length+1);
        others.forEach(o=>withMap.set(o,(withMap.get(o)||0)+1)); }
    }
    const revFrac = rawTot ? rawShared/rawTot : 0;
    const sharedRev = b.rev*revFrac, soloRev = b.rev - sharedRev;
    b._share = { days:sharedDays, totalDays:runDays, maxN, revFrac, sharedRev, soloRev,
      on: sharedDays>=SHARE_MIN_DAYS,
      with:[...withMap.entries()].sort((a,c)=>c[1]-a[1])
              .map(([o,d])=>({o, name:(o.agents&&o.agents.length?o.agents.join(" & "):o.name), days:d})) };
  }
}

// ---- bar rows (timeline / ranking) with FLIP reordering ----
// value shown/ranked for a banner under the current data source (game-i yen vs Sensor Tower USD)
function srcVal(b){
  if(state.dataSource==="st") return bannerST(b).total;
  if(state.dataSource==="cn"){ const c=bannerCN(b); return cnMid({lo:c.lo,hi:c.hi}); }
  if(state.dataSource==="qimai") return bannerQimai(b).total;
  return b.rev;
}
// Uma's gacha is generically named — every pickup shares the same "…プリティーダービーガチャ…"
// title — so when we know the actual character(s), show those as the banner's label instead
// of the useless gacha name. Games with a real per-banner name (HoYo etc.) are untouched.
const GENERIC_GACHA = /プリティーダービーガチャ|サポートカードガチャ/;
function bLabel(b){ return (GENERIC_GACHA.test(b.name||"") && b.agents && b.agents.length) ? b.agents.join(" & ") : (b.name||""); }
function rowHTML(b,rank,max){
  const stMode=state.dataSource==="st";
  const c=barColor(b), [bl,bd]=barShades(c);
  const en=b.agents&&b.agents.length?b.agents.join(" & "):"";
  const rr=b.rerun?`<span class="rr" title="Rerun banner">↻ rerun</span>`:"";
  const sh=b._share;
  const shSeg = sh&&sh.on
    ? `<span class="shared" style="width:${Math.min(100,Math.round(sh.revFrac*100))}%" title="~${Math.round(sh.revFrac*100)}% of this run's revenue was split equally with a concurrent banner"></span>` : "";
  let val, valStr;
  if(b.pending){ val=0;
    valStr = `<span class="val pendingval" title="This banner isn't in game-i's data yet, so there's no daily revenue estimate — it'll fill in automatically once game-i lists it.">not on game-i yet</span>`;
  } else if(state.dataSource==="cn"){ const cn=bannerCN(b); val=cnMid({lo:cn.lo,hi:cn.hi});
    valStr = b._synthetic ? `<span class="val muted">—</span>`
      : !cn.hasData ? `<span class="val nodata" title="This banner ran before the CN ranking series starts (Nov 2021), or in months it doesn't cover">no CN data</span>`
      : `<span class="val">≈${fmtCNYRange(cn.lo,cn.hi)}`
        + (cn.partial?`<span class="partialbadge" title="The CN series covers only ${cn.covered} of the ${cn.covered+cn.missing} months this banner ran — total is incomplete">partial</span>`:"")
        + (cn.mixed?`<span class="partialbadge mixbadge" title="This banner spans the Nov 2023 change from 总收入 (net of the store cut) to 总流水 (gross billings) — the two halves are not the same measure">mixed basis</span>`:"")
        + `</span>`;
  } else if(stMode){ const st=bannerST(b); val=st.total||0;
    valStr = b._synthetic ? `<span class="val muted">—</span>`
      : !st.hasData ? `<span class="val nodata" title="No Sensor Tower report covers this banner's run (before Oct 2021, or too low to chart)">no ST data</span>`
      : `<span class="val">≈${fmtUSD(val)}${st.partial?`<span class="partialbadge" title="Sensor Tower has data for only ${st.covered} of the ${st.covered+st.missing} months this banner ran — total is incomplete">partial</span>`:""}</span>`;
  } else if(state.dataSource==="qimai"){ const qm=bannerQimai(b); val=qm.total||0;
    valStr = b._synthetic ? `<span class="val muted">—</span>`
      : !qm.hasData ? `<span class="val nodata" title="No Qimai China-iPhone revenue for this banner (its game isn't in the Qimai set yet, or it ran before Qimai's data)">no Qimai data</span>`
      : `<span class="val">${fmtUSD(val)}</span>`;
  } else { val=b.rev; valStr=`<span class="val">${G(val)}</span>`; }
  const w=Math.max(val>0?1.2:0,(val/max)*100), m=rank<=3?` m${rank}`:"";
  return `<div class="row${b._synthetic?" synrow":""}${b.pending?" pendrow":""}" data-i="${b._i}" style="--bar-l:${bl};--bar-d:${bd};--av-ring:${c}">
    <div class="rk${m}">${rank}</div>
    <div class="av">${avatarHTML(b)}</div>
    <div class="meta">
      <div class="nm"><b>${esc(bLabel(b))}</b>${en&&en!==bLabel(b)?`<span class="en">${esc(en)}</span>`:""}${rr}</div>
      <div class="barline"><div class="track"><div class="barfill" style="width:${w}%">${shSeg}</div></div>
        ${valStr}</div>
    </div></div>`;
}
function axesHTML(max){
  const src=state.dataSource;
  // CN reuses the USD tick maths -- both are plain linear money axes, unlike game-i's 億
  const tk = (src==="st"||src==="cn"||src==="qimai") ? usdTicks(max) : ticks(max,state.bracket);
  const fmt = src==="st" ? fmtUSD : src==="cn" ? fmtCNY : src==="qimai" ? fmtUSD : G;
  return tk.map(t=>`<div class="axis" style="left:calc(87px + (100% - 87px - 74px) * ${t/max})"><span>${fmt(t)}</span></div>`).join("");}

function renderBars(){
  const stMode=state.dataSource==="st";
  const V = state.dataSource==="gamei" ? (b=>b.rev) : srcVal;
  const all=state.data.banners; all.forEach((x,i)=>x._i=i);
  const pool=poolBanners().filter(searchMatch);               // Year filter + character search
  if(!pool.length){ $("#stnote").hidden=true; $("#cnnote").hidden=true; $("#chart").innerHTML=noResultsHTML(); return; }
  [...pool].sort((a,c)=>V(c)-V(a)).forEach((x,i)=>x._rank=i+1);   // rank within the shown set
  // one axis (timeline gridlines are full-height, so they can't vary per year): match-highest
  // fits the axis tightly to the shown set's peak; otherwise leaves roomy headroom.
  const peak=Math.max(0,...pool.map(V));
  const max = (stMode||state.dataSource==="cn"||state.dataSource==="qimai") ? (usdTop(peak)||1) : roundTop(peak, state.matchHigh);
  // FLIP: capture current row positions before we replace the DOM
  const old={};
  document.querySelectorAll("#chart .row").forEach(r=>{ old[r.dataset.i]=r.getBoundingClientRect().top; });
  let list=[...pool], html="";
  if(state.mode==="rank"){ list.sort((x,y)=> state.reverse ? V(x)-V(y) : V(y)-V(x)); html+=axesHTML(max);
    list.forEach(x=>html+=rowHTML(x,x._rank,max)); }
  else { list.sort((x,y)=>y.start.localeCompare(x.start)); if(state.reverse) list.reverse(); let cy=null;  // newest first by default
    list.forEach(x=>{ const gk=groupKey(x); if(gk!==cy){cy=gk; html+=`<div class="yhead">${esc(gk)}</div>`+axesHTML(max);}
      html+=rowHTML(x,x._rank,max); }); }
  $("#chart").innerHTML=html;
  // FLIP: invert to old position, then play to new one (icons slide up/down)
  document.querySelectorAll("#chart .row").forEach(r=>{
    const o=old[r.dataset.i]; if(o==null) return;
    const dy=o-r.getBoundingClientRect().top;
    if(!dy) return;
    r.style.transform=`translateY(${dy}px)`; r.style.transition="none";
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      r.style.transition="transform .5s cubic-bezier(.2,.7,.2,1)"; r.style.transform="";
    }));
  });
}

// ---- grouping: the timeline/graph group (and its x-axis window) follow the
// Year/Version filter toggle, so switching to Version regroups by 1.X / 2.X … ----
function groupKey(b){
  if(state.graphDim==="version"){ const v=versionOf(b); if(v) return v; }
  return String(b.year);
}
// [x0ms, x1ms] the x-axis should span for a group: a calendar year, or a major
// version's window (its launch date to the next version's, or the run's end).
function groupRange(key, items){
  if(state.graphDim==="version" && VERSIONS[state.tag]){
    const v=VERSIONS[state.tag], i=v.findIndex(e=>e[0]===key);
    const x0=Date.parse(v[i][1]);
    const x1 = i>=0 && i+1<v.length ? Date.parse(v[i+1][1])
             : Math.max(...items.map(b=>Date.parse(b.end)))+7*864e5;   // open latest version
    return [x0, x1];
  }
  const y=+key; return [Date.parse(y+"-01-01"), Date.parse((y+1)+"-01-01")];
}
function xAxisTicks(x0, x1){
  if(state.graphDim!=="version") return [0,2,4,6,8,10].map(m=>({frac:m/12, t:MONTHS[m]}));
  const t=[], d=new Date(x0); if(d.getDate()!==1) d.setMonth(d.getMonth()+1,1);
  let g=0;
  while(d.getTime()<=x1 && g++<40){ t.push({frac:(d.getTime()-x0)/(x1-x0), t:MONTHS[d.getMonth()]}); d.setMonth(d.getMonth()+1); }
  const step=Math.max(1,Math.ceil(t.length/7));
  return t.filter((_,i)=>i%step===0);
}
// Rerun mark for graph avatars. The ↻ CHARACTER sits high and to the right inside its
// own line box and its optical centre shifts with the system font, so it can't be
// centred reliably in a small badge -- the mark is drawn instead. Unit circle at (0,0):
// a 290° arc with the gap at the top-right, plus a tangential arrowhead at the arc's
// end. Centred by construction, then scaled into the badge. Same meaning as the ↻ chips.
const RR_ARC  = "M 0.985 -0.174 A 1 1 0 1 1 0.174 -0.985";
const RR_HEAD = "M 0.568 -0.915 L 0.122 -0.689 L 0.226 -1.280 Z";

// ---- graph view (one line chart per year OR per version) ----
function graphVal(b){ return srcVal(b); }
function groupSVG(label, items, gmax, step, x0, x1){
  const usd = state.dataSource==="st" || state.dataSource==="qimai", cnMode = state.dataSource==="cn";
  const fmt = usd ? fmtUSD : cnMode ? fmtCNY : G;
  const W=760,H=470,ML=58,MR=16,MT=18,MB=28, pW=W-ML-MR, pH=H-MT-MB, base=MT+pH;
  const xOf=d=>ML+((Date.parse(d)-x0)/(x1-x0))*pW;
  const yOf=v=>MT+(1-v/gmax)*pH;
  const pts=[...items].sort((a,b)=>a.start.localeCompare(b.start)).map(b=>({x:xOf(b.start),y:yOf(graphVal(b)),b}));
  const grid=((usd||cnMode)?usdTicks(gmax):ticks(gmax,step)).map(t=>{const y=yOf(t);
    return `<line class="grid" x1="${ML}" y1="${y.toFixed(1)}" x2="${W-MR}" y2="${y.toFixed(1)}"/>`+
           `<text class="axislbl" x="${ML-6}" y="${(y+3).toFixed(1)}" text-anchor="end">${fmt(t)}</text>`;}).join("");
  const xt=xAxisTicks(x0,x1).map(tk=>{const x=ML+tk.frac*pW;
    return `<text class="axislbl" x="${x.toFixed(1)}" y="${H-8}" text-anchor="middle">${tk.t||""}</text>`;}).join("");
  const line=pts.map((p,i)=>(i?"L":"M")+p.x.toFixed(1)+" "+p.y.toFixed(1)).join(" ");
  const area=`M${pts[0].x.toFixed(1)} ${base} `+pts.map(p=>"L"+p.x.toFixed(1)+" "+p.y.toFixed(1)).join(" ")+` L${pts[pts.length-1].x.toFixed(1)} ${base} Z`;
  const R=15, gid=String(label).replace(/\W/g,"");
  const marks=pts.map(p=>{
    const acc=barColor(p.b);
    const url=(p.b.icons&&p.b.icons[0])||p.b.banner_img;
    const cx=p.x.toFixed(1), cy=p.y.toFixed(1);
    // rerun badge, top-right of the avatar: the same ↻ the row/card/peer chips use,
    // on the 45° diagonal so it clears the ring without covering the face. Carries
    // data-i like the image and ring, so clicking it opens the banner too.
    const bx=(p.x+R*0.72).toFixed(1), by=(p.y-R*0.72).toFixed(1);
    const br=R*0.38;
    const rr=p.b.rerun
      ? `<g class="g-rr" data-i="${p.b._i}"><title>Rerun banner</title>`
        + `<circle cx="${bx}" cy="${by}" r="${br.toFixed(2)}"/>`
        + `<g transform="translate(${bx} ${by}) scale(${(br*0.60).toFixed(3)})">`
        + `<path class="rr-arc" d="${RR_ARC}"/><path class="rr-head" d="${RR_HEAD}"/></g></g>` : "";
    if(url){
      const id=`clip_${gid}_${p.b._i}`;
      return `<clipPath id="${id}"><circle cx="${cx}" cy="${cy}" r="${R}"/></clipPath>`+
        `<image href="${esc(url)}" x="${(p.x-R).toFixed(1)}" y="${(p.y-R).toFixed(1)}" width="${2*R}" height="${2*R}" `+
        `preserveAspectRatio="xMidYMid slice" clip-path="url(#${id})" data-i="${p.b._i}"/>`+
        `<circle class="gring" cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${acc}" data-i="${p.b._i}"/>`+rr;
    }
    return `<circle class="dot${p.b._synthetic?" syndot":""}" data-i="${p.b._i}" cx="${cx}" cy="${cy}" r="6" fill="${acc}"/>`+rr;
  }).join("");
  return `<svg class="gsvg" viewBox="0 0 ${W} ${H}" role="img">
    ${grid}<path class="area" d="${area}"/><path class="line" d="${line}"/>${marks}${xt}</svg>`;
}
function renderGraph(){
  state.data.banners.forEach((x,i)=>x._i=i);
  const st = state.dataSource==="st", money = state.dataSource!=="gamei";
  const srcLbl = st ? "Sensor Tower" : state.dataSource==="cn" ? "CN" : state.dataSource==="qimai" ? "Qimai" : "";
  let pool = poolBanners();                     // graph ignores the character search entirely
  if(money) pool = pool.filter(b=>graphVal(b)>0);  // money layers: only banners that source actually covers
  if(!pool.length){
    $("#chart").innerHTML = money
      ? `<div class="noresults">No ${srcLbl} data to chart for <b>${esc(state.data.name)}</b> in this range.</div>`
      : `<div class="loading">No banners to chart.</div>`;
    return;
  }
  const sharedMax = money ? usdTop(Math.max(...pool.map(graphVal))) : roundTop(Math.max(...pool.map(x=>x.rev)), false);
  const groups={}; pool.forEach(x=>{ const k=groupKey(x); (groups[k]=groups[k]||[]).push(x); });
  let keys=Object.keys(groups).sort();
  if(!state.reverse) keys.reverse();           // newest group first by default
  $("#chart").innerHTML=keys.map(k=>{
    const items=groups[k];
    const peak=Math.max(...items.map(graphVal));
    const gmax=state.matchHigh ? (money?usdTop(peak):roundTop(peak,true)) : sharedMax;
    const [x0,x1]=groupRange(k, items);
    return `<div class="gyear"><div class="yhead">${esc(k)}</div>${groupSVG(k,items,gmax,state.bracket||0,x0,x1)}</div>`;
  }).join("");
}
function populateGraphYears(){
  if(state.graphDim==="version" && !hasVersions(state.tag)) state.graphDim="year";   // game has no versions
  // the Year/Version filter toggle only appears for version-based games
  const gd=$("#gdim");
  gd.hidden=!hasVersions(state.tag);
  gd.querySelectorAll("button").forEach(b=>b.classList.toggle("on",b.dataset.dim===state.graphDim));
  // the "by Version" view button is likewise game-specific
  $("#bVersion").hidden=!hasVersions(state.tag);
  if(state.mode==="version" && !hasVersions(state.tag)) setMode("time");
  const vals = state.graphDim==="version"
    ? [...new Set(state.data.banners.map(versionOf).filter(Boolean))].sort()
    : [...new Set(state.data.banners.map(b=>b.year))].sort().map(String);
  if(state.graphYear!=="all" && !vals.includes(state.graphYear)) state.graphYear="all";
  $("#gyears").innerHTML=`<button data-y="all"${state.graphYear==="all"?' class="on"':''}>All</button>`+
    vals.map(v=>`<button data-y="${esc(v)}"${state.graphYear===v?' class="on"':''}>${esc(v)}</button>`).join("");
  $("#gyears").querySelectorAll("button").forEach(btn=>btn.onclick=()=>{
    state.graphYear=btn.dataset.y;
    $("#gyears").querySelectorAll("button").forEach(x=>x.classList.toggle("on",x===btn));
    if(!state.table) render();
  });
}
$("#gdim").querySelectorAll("button").forEach(btn=>btn.onclick=()=>{
  state.graphDim=btn.dataset.dim; state.graphYear="all";
  populateGraphYears();
  if(!state.table) render();
});

function noResultsHTML(){
  return `<div class="noresults">No banners match <b>“${esc((state.search||"").trim())}”</b> for ${esc(state.data.name)}.<br><button class="linkbtn" id="clearSearch2">Clear search</button></div>`;
}
// visibility of the secondary controls row (graph filter / sort / direction / table).
// The row itself always shows (it carries the Chart/Table toggle); its inner controls
// switch by view. In table view only the "Chart view" button remains.
function updateControlVis(){
  const m=state.mode, period=isPeriodMode(m);
  $("#graphControls").hidden = false;
  $("#gfilter").hidden   = state.table || period || state.mode==="agree";   // Year/Version graph filter: timeline/graph/ranking only (not Sources)
  $("#bSortWrap").hidden  = state.table || !(period || state.mode==="agree");        // period-card sort dropdown: by-Year/Month/Version only
  $("#agModeWrap").hidden = state.table || state.mode!=="agree";   // Sources month/banner toggle: Sources view only
  $("#bYearsWrap").hidden = state.table || state.mode!=="month";   // month year-filter: by-Month only
  $("#hintRow").hidden    = state.table || isPeriodMode(state.mode) || state.mode==="agree";   // hover hint: Timeline/Graph/Ranking only, under the right-side buttons
  $("#bDir").hidden       = state.table;                   // direction is meaningless in the table view
  $("#dataSrc").hidden    = state.table || m==="agree";   // this view shows all sources at once
  const cnBtn=$("#dataSrc").querySelector('[data-src="cn"]');
  if(cnBtn){ const has=!!(state.cn&&state.cn.games&&state.cn.games[state.tag]);
    cnBtn.hidden=!has;
    // a game with no CN rows must not be left stuck on an empty CN view
    if(!has && state.dataSource==="cn"){ state.dataSource="gamei";
      $("#dataSrc").querySelectorAll("[data-src]").forEach(b=>b.classList.toggle("on",b.dataset.src==="gamei")); } }                   // game-i/ST toggle in every chart view (incl. Graph) except Table
  const qmBtn=$("#dataSrc").querySelector('[data-src="qimai"]');
  if(qmBtn){ const has=hasQimai(state.tag); qmBtn.hidden=!has;
    if(!has && state.dataSource==="qimai"){ state.dataSource="gamei";
      $("#dataSrc").querySelectorAll("[data-src]").forEach(b=>b.classList.toggle("on",b.dataset.src==="gamei")); } }
  $("#search").hidden     = m==="graph";                   // Graph has no per-character search — it charts every banner
}
function render(){
  document.body.dataset.view = state.table ? "table" : state.mode;   // lets CSS tailor per view (e.g. mobile graph)
  $("#chartwrap").hidden=state.table; $("#tablewrap").hidden=!state.table;
  updateControlVis();
  // The source disclaimers belong to the ACTIVE SOURCE, not to one view. Setting them
  // only inside renderBars left a note stranded on screen after switching source in a
  // period view, since those never call it. The caveats apply everywhere, so show the
  // note whenever its source is selected and there's a chart under it.
  const showNote = !state.table;
  $("#stnote").hidden = !(showNote && state.dataSource==="st");
  $("#cnnote").hidden = !(showNote && state.dataSource==="cn");
  if($("#qmnote")) $("#qmnote").hidden = !(showNote && state.dataSource==="qimai");
  if(state.table){ buildTable(); return; }
  if(state.mode==="graph"){ renderGraph(); return; }
  if(state.mode==="year"){ renderYearly(); return; }
  if(state.mode==="month"){ renderMonthly(); return; }
  if(state.mode==="version"){ renderVersions(); return; }
  if(state.mode==="agree"){ renderAgreement(); return; }
  renderBars();
}

// ---- source agreement: how the three layers rank the same months ----------------
// The three datasets CANNOT be compared by value -- game-i is Japan mobile in yen, ST is
// worldwide mobile in dollars, CN is worldwide all-platform in yuan. What IS comparable
// is each month's standing WITHIN its own source: if a month is a source's 3rd-best out
// of 40, that means the same thing whatever the units. So every month is scored as a
// percentile of its own source's history, and the sources are compared on that.
//
// CN gets scored inside its own metric regime. Its captions switch from 总收入 to 总流水
// at Nov 2023 and gross runs materially above net, so pooling the two would make every
// later month look stronger than it was purely from the relabelling.
function pctRank(value, pool){
  if(!pool.length) return null;
  const below = pool.filter(v=>v<value).length, equal = pool.filter(v=>v===value).length;
  return Math.round(((below + equal/2) / pool.length) * 100);
}
// The game's monthly JP top-grossing rank, reconstructed from the banners' rank_series (each
// is the game's daily JP place while that banner ran). The month's value is its PEAK (best,
// lowest-number) charted rank — how high the game reached that month. Lower is better — a rank
// source, not revenue — so the agreement negates it before percentiling.
function jpRankMonths(){
  const bm={};
  for(const b of (state.data.banners||[])){
    if(b._synthetic) continue; const s=b.rank_series; if(!s||!s.length) continue;
    const s0=new Date(b.start+"T00:00:00");
    s.forEach((r,i)=>{ if(r==null) return; const d=new Date(s0); d.setDate(d.getDate()+i);
      const ym=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
      bm[ym]=bm[ym]==null?r:Math.min(bm[ym],r); });
  }
  return bm;
}
// The game's monthly China iOS top-grossing rank — its PEAK (best) place that month — from
// the CN rank series. Lower is better.
function cnRankMonths(tag){
  const g=state.cnrank&&state.cnrank.games&&state.cnrank.games[tag]; if(!g) return {};
  const bm={}; for(const dt in g){ const r=g[dt]; if(r==null) continue; const ym=dt.slice(0,7);
    bm[ym]=bm[ym]==null?r:Math.min(bm[ym],r); }
  return bm;
}
// {ym -> {gi, st, cn}} percentiles (0-100), plus the raw values for the tooltip.
//
// Every source is ranked inside the SAME era, not inside its own full history. Ranking
// each source over whatever span it happens to cover produced a systematic illusion:
// game-i and ST reach back to a game's launch peak while the CN 流水 pool starts Nov
// 2023, so recent months looked strong in CN and weak in the other two on every single
// row. Splitting all three at the CN metric boundary makes each era a like-for-like
// window -- and it is the comparison you actually want anyway, since "was this a good
// month" is a question about neighbouring months, not about 2020.
function sourceAgreement(tag){
  tag = tag || state.tag;
  const gi = state.data.monthly || {}, bm = state.monthly || {};
  const giM = {};
  for(const ym of new Set([...Object.keys(gi), ...Object.keys(bm)])){
    const v = gi[ym]!=null ? gi[ym] : ((bm[ym] && bm[ym].ours) || 0);
    if(v>0) giM[ym]=v;
  }
  const stM = {}; const st = extGameMonths(tag);
  for(const ym in st) if(st[ym].rev>0) stM[ym]=st[ym].rev;
  const qmM = {}; const qg = state.qimai && state.qimai.games && state.qimai.games[tag];
  if(qg) for(const ym in qg.monthly){ const v=qg.monthly[ym].qtot; if(v>0) qmM[ym]=v; }
  const cnRaw = cnGameMonths(tag), cnM = {}, cnMetric = {};
  for(const ym in cnRaw){ const r=cnRaw[ym], mid=cnMid(r);
    if(mid>0){ cnM[ym]=mid; cnMetric[ym]=r.metric||"?"; } }
  // Two extra RANK bases: game-i's JP store rank and the China iOS store rank. Both are
  // store positions (lower = better), not revenue, so a month is scored on its rank the same
  // way — percentile within its own history — after negating so a better (lower) rank reads
  // as a higher percentile. They add a cross-check independent of any revenue estimate.
  const jrM = jpRankMonths(), crM = cnRankMonths(tag);

  // Era = the CN metric label for that month, carried across all three sources. With no
  // CN coverage there is a single era and this collapses to a plain whole-history rank.
  const cnMonths = Object.keys(cnM).sort();
  const boundaries = [];
  for(let i=1;i<cnMonths.length;i++)
    if(cnMetric[cnMonths[i]]!==cnMetric[cnMonths[i-1]]) boundaries.push(cnMonths[i]);
  const eraOf = ym => {
    if(!cnMonths.length) return "all";
    let e = cnMetric[cnMonths[0]];
    for(const b of boundaries) if(ym>=b) e = cnMetric[b];
    return e;
  };

  const months = [...new Set([...Object.keys(giM), ...Object.keys(stM), ...Object.keys(cnM),
    ...Object.keys(qmM), ...Object.keys(jrM), ...Object.keys(crM)])].sort();
  const pools = {};   // era -> {gi:[], qm:[], st:[], cn:[], jr:[], cr:[]}  (jr/cr hold -rank)
  for(const ym of months){
    const e = eraOf(ym), P = pools[e] || (pools[e]={gi:[],qm:[],st:[],cn:[],jr:[],cr:[]});
    if(giM[ym]!=null) P.gi.push(giM[ym]);
    if(qmM[ym]!=null) P.qm.push(qmM[ym]);
    if(stM[ym]!=null) P.st.push(stM[ym]);
    if(cnM[ym]!=null) P.cn.push(cnM[ym]);
    if(jrM[ym]!=null) P.jr.push(-jrM[ym]);
    if(crM[ym]!=null) P.cr.push(-crM[ym]);
  }

  const rows = months.map(ym=>{
    const e = eraOf(ym), P = pools[e];
    const g = giM[ym]!=null ? pctRank(giM[ym], P.gi) : null;
    const q = qmM[ym]!=null ? pctRank(qmM[ym], P.qm) : null;
    const t = stM[ym]!=null ? pctRank(stM[ym], P.st) : null;
    const c = cnM[ym]!=null ? pctRank(cnM[ym], P.cn) : null;
    const jr = jrM[ym]!=null ? pctRank(-jrM[ym], P.jr) : null;
    const cr = crM[ym]!=null ? pctRank(-crM[ym], P.cr) : null;
    const have = [g,q,t,c,jr,cr].filter(v=>v!=null);
    const spread = have.length>1 ? Math.max(...have)-Math.min(...have) : null;
    return {ym, key:ym, gi:g, qm:q, st:t, cn:c, jr, cr, spread, era:e,
            giRaw:giM[ym], qmRaw:qmM[ym], stRaw:stM[ym], cnRaw:cnRaw[ym], cnMetric:cnMetric[ym],
            jrRaw:jrM[ym], crRaw:crM[ym], n:have.length};
  });
  const eraInfo = Object.entries(pools).map(([e,P])=>({era:e,
    months:Math.max(P.gi.length,P.qm.length,P.st.length,P.cn.length,P.jr.length,P.cr.length)}));
  return {rows, eras:eraInfo};
}
// Spearman: correlate two sources on their percentile ranks over the months both cover.
function spearman(rows, a, b){
  const pairs = rows.filter(r=>r[a]!=null && r[b]!=null);
  if(pairs.length<4) return null;
  const rank = key => { const sorted=[...pairs].sort((x,y)=>x[key]-y[key]);
    const m=new Map(); sorted.forEach((r,i)=>m.set(r.key,i+1)); return m; };
  const ra=rank(a), rb=rank(b), n=pairs.length;
  let d2=0; for(const r of pairs){ const d=ra.get(r.key)-rb.get(r.key); d2+=d*d; }
  return {rho: 1 - (6*d2)/(n*(n*n-1)), n};
}
// Plain-language verdict for one month.
//
// Averaging the sources and reporting one spread was too blunt. Oct 2024 (game-i 73,
// ST 57, CN 44) came back as "middling · all 3 close" -- but 73 against 44 is a 29-point
// gap, and the mean buried the fact that one source called it high while another called
// it average. What the reader actually wants is WHICH sources cluster and what each
// cluster says, so that is what this computes: sort the sources, look for a real break
// between them, and describe the groups either side of it.
const AGREE_BAND = 15;   // within this, the sources genuinely track each other
const CLOSE_BAND = 24;   // beyond this they are not "close" by any useful definition
const SPLIT_GAP  = 18;   // a break at least this wide can define two groups
const SPLIT_RATIO= 1.5;  // ...and it must dominate the next-largest break

// Five bands, not three: with only strong/middling/weak, 33 and 65 both read "middling"
// and naming the extremes told the reader nothing.
function levelWord(p){
  return p>=80 ? "very high" : p>=65 ? "high" : p>=36 ? "average" : p>=21 ? "low" : "very low";
}
const SHORT={gi:"GI", qm:"QM", st:"ST", cn:"CN", jr:"JR", cr:"CR"};
const FULL={gi:"game-i", qm:"Qimai", st:"Sensor Tower", cn:"CN", jr:"JP rank", cr:"CN rank"};
const AG_SRC=["gi","qm","st","cn","jr","cr"];

function agreementVerdict(r, unit){
  unit = unit || "month";
  const have=AG_SRC.filter(k=>r[k]!=null);
  const allWord = have.length>=3 ? "all "+have.length : "both";
  if(have.length<2) return {cls:"solo", label:"only "+SHORT[have[0]],
    why:`Only ${FULL[have[0]]} covers this ${unit}, so there is nothing to cross-check against.`};

  const sorted=[...have].sort((a,b)=>r[a]-r[b]);
  const detail=have.map(k=>`${FULL[k]} ${r[k]}`).join(" · ");
  const spread=r[sorted[sorted.length-1]]-r[sorted[0]];

  // everyone within the tight band: one group, report its level
  if(spread<=AGREE_BAND){
    const mean=have.reduce((a,k)=>a+r[k],0)/have.length;
    const lvl=levelWord(mean);
    return {cls:`agree ${mean>=65?"hi":mean<=35?"lo":"mid"}`,
      label:`${lvl} · ${allWord} agree`,
      why:`${detail}. All within ${spread} points — the sources tell the same story, and at ${Math.round(mean)} that story is "${lvl}".`};
  }

  // look for a single dominant break that splits the sources into two groups
  const gaps=[]; for(let i=1;i<sorted.length;i++) gaps.push({at:i, g:r[sorted[i]]-r[sorted[i-1]]});
  gaps.sort((x,y)=>y.g-x.g);
  const top=gaps[0], next=gaps[1];
  const canSplit = top.g>=SPLIT_GAP && (!next || top.g >= next.g*SPLIT_RATIO);

  if(canSplit){
    const lowKeys=sorted.slice(0,top.at), hiKeys=sorted.slice(top.at);
    const mean=ks=>ks.reduce((a,k)=>a+r[k],0)/ks.length;
    const big = lowKeys.length>=hiKeys.length ? lowKeys : hiKeys;
    const small = big===lowKeys ? hiKeys : lowKeys;
    const bigLvl=levelWord(mean(big)), smallLvl=levelWord(mean(small));
    const smallHigher = mean(small)>mean(big);
    return {cls:"split "+(smallHigher?"hi":"lo"),
      label:`${big.map(k=>SHORT[k]).join("+")} ${bigLvl} · ${small.map(k=>SHORT[k]).join("+")} ${smallLvl}`,
      why:`${detail}. ${big.map(k=>FULL[k]).join(" and ")} agree at "${bigLvl}", while ${small.map(k=>FULL[k]).join(" and ")} sits ${Math.round(top.g)} points ${smallHigher?"above":"below"} them at "${smallLvl}" — a ${smallHigher?"higher":"lower"} reading only that source gives.`};
  }

  // no clean grouping: spread out with no single outlier, or merely loose
  if(spread<=CLOSE_BAND){
    const mean=have.reduce((a,k)=>a+r[k],0)/have.length;
    const lvl=levelWord(mean);
    return {cls:`agree ${mean>=65?"hi":mean<=35?"lo":"mid"} loose`,
      label:`${lvl} · ${allWord} close`,
      why:`${detail}. They span ${spread} points — past the ${AGREE_BAND}-point agreement band but still under ${CLOSE_BAND}, so they broadly track without matching.`};
  }
  const lo=sorted[0], hi=sorted[sorted.length-1];
  return {cls:"nocon",
    label:`${SHORT[hi]} ${levelWord(r[hi])} · ${SHORT[lo]} ${levelWord(r[lo])}`,
    why:`${detail}. They span ${spread} points with no clean grouping — ${FULL[hi]} reads "${levelWord(r[hi])}" and ${FULL[lo]} reads "${levelWord(r[lo])}", so this ${unit}'s success depends entirely on which source you ask.`};
}

// ---- per-BANNER agreement -------------------------------------------------------
// The month view asks "was this a strong MONTH for the game, and do the sources agree?".
// This asks the same of each BANNER: score every banner against the game's OTHER banners
// on each source (its percentile in the banner pool), so a banner at 90 on game-i is one
// of the game's best JP earners. Do the revenue AND rank sources agree it was a hit? No era
// split — a banner is one event, compared to the whole catalogue.
function bannerAgreement(tag){
  tag = tag || state.tag;
  const bans=(state.data.banners||[]).filter(b=>!b._synthetic && !b.pending);
  bans.forEach(b=>{ if(b._i==null) b._i=state.data.banners.indexOf(b); });
  const raw=bans.map(b=>{
    const gi = b.rev>0 ? b.rev : null;
    const q=bannerQimai(b); const qm = q.hasData && q.total>0 ? q.total : null;
    const s=bannerST(b);    const st = s.hasData ? s.total : null;
    const c=bannerCN(b);    const cnHi=c.hi==null?c.lo:c.hi;
    const cn = c.hasData ? (c.lo+cnHi)/2 : null;
    const js=(b.rank_series||[]).filter(x=>x!=null); const jr = js.length ? Math.min(...js) : null;
    const cr0=cnRunSeries(b); const crs=cr0?cr0.map(x=>x.rank).filter(x=>x!=null):[];
    const cr = crs.length?Math.min(...crs):null;
    return {b, gi, qm, st, cn, cnRaw:(c.hasData?{lo:c.lo,hi:cnHi,metric:(c.mixed?"":"")}:null), jr, cr};
  });
  const pool=k=>raw.map(r=>r[k]).filter(v=>v!=null);
  const pGi=pool("gi"), pQm=pool("qm"), pSt=pool("st"), pCn=pool("cn");
  const pJr=pool("jr").map(v=>-v), pCr=pool("cr").map(v=>-v);
  const rows=raw.map(r=>{
    const gi=r.gi!=null?pctRank(r.gi,pGi):null, qm=r.qm!=null?pctRank(r.qm,pQm):null;
    const st=r.st!=null?pctRank(r.st,pSt):null, cn=r.cn!=null?pctRank(r.cn,pCn):null;
    const jr=r.jr!=null?pctRank(-r.jr,pJr):null, cr=r.cr!=null?pctRank(-r.cr,pCr):null;
    const have=[gi,qm,st,cn,jr,cr].filter(v=>v!=null);
    const spread=have.length>1?Math.max(...have)-Math.min(...have):null;
    return {b:r.b, key:String(r.b._i), gi,qm,st,cn,jr,cr, spread,
      giRaw:r.gi, qmRaw:r.qm, stRaw:r.st, cnRaw:r.cnRaw, jrRaw:r.jr, crRaw:r.cr, n:have.length};
  });
  return {rows, eras:[]};
}

function renderAgreement(){
  const banner = state.agreeMode==="banner";
  const unit = banner ? "banner" : "month";
  document.body.dataset.agmode = banner ? "banner" : "month";
  const A = banner ? bannerAgreement(state.tag) : sourceAgreement(state.tag);
  let rows=A.rows.filter(r=>r.n>=1);
  if(!rows.length){ $("#chart").innerHTML=`<div class="loading">No ${banner?"banner":"monthly"} data to compare for this game.</div>`; return; }
  if(state.periodSort==="ranking") rows=[...rows].sort((a,b)=>(b.spread==null?-1:b.spread)-(a.spread==null?-1:a.spread));
  else rows=[...rows].reverse();                     // newest first by default
  if(state.reverse) rows.reverse();

  const pairDefs=[];   // every source pair, in order
  for(let i=0;i<AG_SRC.length;i++) for(let j=i+1;j<AG_SRC.length;j++){ const a=AG_SRC[i],b=AG_SRC[j];
    pairDefs.push({a,b,lab:`${FULL[a]} ↔ ${FULL[b]}`,key:a+"-"+b}); }
  const pairs=pairDefs.map(p=>({lab:p.lab, key:p.key, r:spearman(A.rows,p.a,p.b)})).filter(x=>x.r);
  const rhoWord=v=>v>=.8?"very close":v>=.6?"broadly similar":v>=.35?"loosely related":v>=0?"barely related":"opposed";
  const corr=pairs.length?`<div class="ag-corr">${pairs.map(p=>{
      const v=p.r.rho, pc=Math.max(0,Math.min(100,(v+1)/2*100));
      return `<div class="ag-corrcard ag-pair-${p.key}" title="Spearman rank correlation over the ${p.r.n} ${unit}s both cover. +1 = they order the ${unit}s identically, 0 = unrelated, -1 = reversed.">
        <span class="ag-corrk">${p.lab}</span>
        <span class="ag-corrv">${v>=0?"+":""}${v.toFixed(2)}</span>
        <div class="ag-corrbar"><span style="width:${pc}%"></span></div>
        <span class="ag-corrn">${rhoWord(v)} · ${p.r.n} shared ${unit}s</span></div>`;}).join("")}</div>`:"";

  const NAME={gi:"game-i", qm:"Qimai", st:"Sensor Tower", cn:"CN", jr:"JP rank", cr:"CN rank"};
  const bar=(k,v,val,tip)=>v==null
    ? `<div class="ag-src ag-${k} ag-na" title="No ${NAME[k]} figure for this ${unit}"><span class="ag-lab">${k.toUpperCase()}</span><div class="ag-track"></div><span class="ag-pct">—</span><span class="ag-val">no data</span></div>`
    : `<div class="ag-src ag-${k}" title="${esc(tip||"")}"><span class="ag-lab">${k.toUpperCase()}</span><div class="ag-track"><span style="width:${v}%"></span></div><span class="ag-pct">${v}</span><span class="ag-val">${val}</span></div>`;

  // small avatar row of the banners that ran in a month (month mode only)
  const moBanners=ym=>{
    const bl=(state.monthly&&state.monthly[ym]&&state.monthly[ym].banners)||[];
    const list=bl.map(x=>state.data.banners[x.i]).filter(b=>b&&!b._synthetic);
    const pend=(pendingByMonth()[ym]||[]);
    for(const p of pend) if(!list.includes(p)) list.push(p);
    if(!list.length) return "";
    const cap=7;
    const av=list.slice(0,cap).map(b=>`<span class="ag-bic" data-i="${b._i}" title="${esc(bLabel(b))}">${b.icons&&b.icons[0]?`<img src="${esc(b.icons[0])}" alt="" referrerpolicy="no-referrer" data-fb="remove">`:monoStr(b.name)}</span>`).join("");
    return `<div class="ag-mobans">${av}${list.length>cap?`<span class="ag-bicmore">+${list.length-cap}</span>`:""}</div>`;
  };

  const bars=r=>{
    const pct = banner ? n=>n==null?"":` — ${n}th percentile of this game's banners`
                       : n=>n==null?"":` — ${n}th percentile of its era`;
    const rk = banner ? "(peak while it ran; lower is better)" : "(peak that month; lower is better)";
    return `<div class="ag-bars">
        ${bar("gi",r.gi, r.giRaw!=null?G(r.giRaw):"—", `game-i · Japan mobile${pct(r.gi)}`)}
        ${bar("qm",r.qm, r.qmRaw!=null?fmtUSD(r.qmRaw):"—", `Qimai · China iPhone${pct(r.qm)}`)}
        ${bar("st",r.st, r.stRaw!=null?fmtUSD(r.stRaw):"—", `Sensor Tower · worldwide mobile${pct(r.st)}`)}
        ${bar("cn",r.cn, r.cnRaw?fmtCNYRange(r.cnRaw.lo,r.cnRaw.hi):"—", `CN ranking · worldwide, all platforms${pct(r.cn)}`)}
        ${bar("jr",r.jr, r.jrRaw!=null?"#"+Math.round(r.jrRaw):"—", `JP store rank · game-i ${rk}${pct(r.jr)}`)}
        ${bar("cr",r.cr, r.crRaw!=null?"#"+Math.round(r.crRaw):"—", `China iOS store rank ${rk}${pct(r.cr)}`)}
      </div>`;
  };

  let list;
  if(banner){
    list=rows.map(r=>{
      const b=r.b, v=agreementVerdict(r,"banner"), en=b.agents&&b.agents.length?b.agents.join(" & "):"";
      const dts=`${fmtDayMs(Date.parse(b.start))} ${b.start.slice(0,4)}`;
      return `<div class="ag-row ag-brow" data-i="${b._i}" style="--av-ring:${barColor(b)}" title="Open ${esc(bLabel(b))}">
        <div class="ag-mo ag-bmo"><span class="ag-bav mcb-av">${avatarHTML(b)}</span><span class="ag-bnm"><b>${esc(bLabel(b))}</b><span class="ag-bsub">${en&&en!==bLabel(b)?esc(en)+" · ":""}${dts}${b.rerun?" · ↻ rerun":""}</span></span></div>
        ${bars(r)}
        <div class="ag-verdict"><span class="ag-chip ${v.cls}" title="${esc(v.why)}">${esc(v.label)}</span></div>
      </div>`;}).join("");
  } else {
    list=rows.map(r=>{
      const v=agreementVerdict(r,"month");
      const lab=`${MONTHS[+r.ym.slice(5,7)-1]} ${r.ym.slice(0,4)}`;
      return `<div class="ag-row" data-period="month" data-key="${r.ym}" title="Open ${esc(lab)}">
        <div class="ag-mo">${lab}${r.cnMetric&&r.cnMetric!=="?"?`<span class="ag-era">${esc(r.cnMetric)}</span>`:""}${moBanners(r.ym)}</div>
        ${bars(r)}
        <div class="ag-verdict"><span class="ag-chip ${v.cls}" title="${esc(v.why)}">${esc(v.label)}</span></div>
      </div>`;}).join("");
  }

  const eraTxt=A.eras.map(e=>`${e.era==="all"?"whole history":e.era} (${e.months} months)`).join(", ");
  const intro = banner
   ? `<div class="yr-note"><b>Do the sources agree this was a strong banner?</b> Every banner is scored against <b>this game's other banners</b> on each source: the bars show its percentile in that source's banner pool, so 90 means "one of this game's best banners" for that source whatever the units. The per-banner Qimai/Sensor&nbsp;Tower/CN figures are the same estimates the banner cards use (each is game-i's + Qimai's month share, blended, applied to that source's monthly total and summed over the banner's run); the two <b>rank</b> bars are the banner's <b>peak</b> (best) store place while it ran — an independent, estimate-free cross-check.
    <br><br>A banner where the bars line up is one every source calls the same. A banner where one bar stands apart is the interesting case — a <b>region-specific</b> hit (a Japan-loved character lifts game-i alone) or a <b>platform-specific</b> one (a PC/console push lifts only CN).
    <br><br><b>How each banner is labelled.</b> The chip names <b>which sources cluster</b> and what each says. Levels run <b>very low</b> (0–20), <b>low</b> (21–35), <b>average</b> (36–64), <b>high</b> (65–79), <b>very high</b> (80+). Hover a chip for the exact percentiles and the arithmetic. Percentiles are over the whole banner catalogue — no era split, since a banner is one event.</div>`
   : `<div class="yr-note"><b>These bases measure different things</b> — four are revenue: game-i (<b>Japan mobile</b>, yen), Qimai (<b>China iPhone</b>, dollars), Sensor Tower (<b>worldwide mobile</b>, dollars) and the CN ranking (<b>worldwide all-platform</b>, yuan); two are store <b>rank</b>: game-i's <b>JP top-grossing</b> place and the <b>China iOS</b> place (lower is better). Their raw figures are not comparable and are never added. What <i>is</i> comparable is where each month sits <b>inside its own source's history</b>: the bars show each month's percentile against that source's other months, so 90 means "one of this source's best months" whatever the units — and a strong month should read high on the revenue <i>and</i> the rank bases, so the two ranks are an independent cross-check on the money estimates.
    <br><br>A month where the bars line up is one all the covering sources agree about. A month where one bar stands apart is more interesting — often a <b>region-specific</b> event (a Japan-heavy banner lifts game-i alone) or a <b>platform-specific</b> one (a PC or console push lifts only the CN figure). Each row also lists the <b>banners that ran</b> that month — tap one to open it.
    <br><br><b>How each month is labelled.</b> The chip names <b>which sources cluster</b> and what each cluster says, rather than averaging them into one word. Levels run <b>very low</b> (0–20), <b>low</b> (21–35), <b>average</b> (36–64), <b>high</b> (65–79), <b>very high</b> (80+).
    <ul style="margin:6px 0 0 18px">
      <li><b>“high · all N agree”</b> — every source within 15 points of the others, telling one story.</li>
      <li><b>“average · all N close”</b> — within 24 points: broadly tracking, not matching.</li>
      <li><b>“GI+ST average · CN high”</b> — a real break splits them, so each group is reported with its own level. This is the interesting case: a <b>region-specific</b> month lifts game-i alone, a <b>platform-specific</b> one lifts only CN.</li>
      <li><b>“GI high · CN average”</b> — spread out with no clean grouping, so the two extremes are named. The month's success depends on which source you ask.</li>
    </ul>
    Hover any chip for that month's exact percentiles and the arithmetic behind the label; the two rank bars show the month's <b>peak</b> (best) store rank.
    <br><br><b>Every source is ranked inside the same era</b>${eraTxt?` — ${esc(eraTxt)}`:""}. The CN captions switch from 总收入 to 总流水 at Nov 2023 and the two aren't the same measure, so that boundary splits every source, not just CN. Ranking each source over its own full span instead made every recent month read as strong in CN and weak in the others, purely because game-i and Sensor Tower reach back to the launch peak while the CN 流水 pool starts in 2023.</div>`;
  $("#chart").innerHTML=intro
    + corr
    + `<div class="ag-head"><div class="ag-mo">${banner?"Banner":"Month"}</div><div class="ag-bars">${banner?"Percentile among this game's banners":"Percentile within each source"}</div><div class="ag-verdict">Agreement</div></div>`
    + `<div class="ag-list">${list}</div>`;
}

// ---- by-month view: game-i's published monthly revenue (月次売上予測) reconciled
// against the banners active that month. Our per-month figure attributes each
// banner's reconstructed daily revenue to the calendar month it fell in, so the
// two should line up closely — a big gap flags a month game-i's banner list is
// behind on (or days with no banner running). ----
function computeMonthly(){
  const byMonth={};
  // NB: this runs before selectGame assigns b._i, but real banners keep their array
  // position as their eventual _i (synthetics are appended after), so capture bi here.
  state.data.banners.forEach((b,bi)=>{
    if(b._synthetic) return;                 // reconciliation uses real banners only
    const s=b.rank_series; if(!s||!s.length) return;
    const raw=s.map(rankValue), tot=raw.reduce((a,c)=>a+c,0);
    // Attribute to EVERY month the run touches — not just months it earned in. A
    // banner whose rank sat below game-i's trackable top 200 all month earns ¥0
    // there, but it was still running, so it must show in that month's list (as ¥0)
    // rather than vanish and make a co-running banner look like the month's only one.
    const s0=new Date(b.start+"T00:00:00"), per={};
    raw.forEach((rw,i)=>{ const dt=new Date(s0); dt.setDate(dt.getDate()+i);
      const ym=`${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}`;
      if(!(ym in per)) per[ym]=0;                       // mark the month as run-touched
      if(rw>0 && tot>0) per[ym]+=b.rev*rw/tot; });       // add its share on tracked days
    for(const ym in per){ const M=byMonth[ym]||(byMonth[ym]={ours:0,banners:[]});
      M.ours+=per[ym];
      M.banners.push({name:(b.agents&&b.agents.length?b.agents.join(" & "):b.name), rev:per[ym], total:b.rev, i:bi}); }
  });
  for(const ym in byMonth) byMonth[ym].banners.sort((a,c)=>c.rev-a.rev);
  state.monthly=byMonth;
}
// One banner's contribution inside a month: revenue + extrapolated global, plus a
// detail line (dates · days · below-#200 · shared) and a hatched share indicator.
function bannerContribHTML(x, base, st, ym, cnR){
  const b=state.data.banners[x.i]; if(!b) return "";
  const c=barColor(b), en=b.agents&&b.agents.length?b.agents.join(" & "):"";
  const zero = x.rev < 0.001;
  const share = base>0 ? x.rev/base : 0;                   // share of the month (game-i monthly or reconstruction, whichever is larger)
  const part = x.total && x.rev < x.total-1e-9;
  // Gather each source's figure for this banner-month, then lay them out as an aligned
  // grid of small source cells — measured game-i / Qimai first, extrapolated Sensor Tower
  // / CN after — so the four currencies read as scannable columns instead of a wrapping
  // blob. Only the sources the card actually has get a column, so they stay aligned.
  const cells=[];
  cells.push(zero
    ? {cls:"gi below", k:"game-i", v:"¥0", x:"below&nbsp;#200",
       tip:"Ran this month but stayed below game-i's trackable top 200 — counted as ~¥0"}
    : {cls:"gi", k:"game-i", v:G(x.rev),
       x:(base>0?(share*100).toFixed(0)+"% of mo":"")+(part?` · of ${G(x.total)}`:""), tip:""});
  const qg=state.qimai&&state.qimai.games&&state.qimai.games[state.tag];
  if(qg){
    const qe=qg.banners&&qg.banners[x.i];
    if(qe){ const qmm=(qe.monthly&&qe.monthly[ym])||0;
      const qbase=(qimaiMonth(ym)||{}).base||0, qpct=qbase>0?Math.round(qmm/qbase*100):0;
      cells.push({cls:"qm", k:"Qimai", v:qmm>0?fmtUSD(qmm):"$0", x:qmm>0?qpct+"% of mo":"China&nbsp;iOS",
        tip:`Qimai's China iPhone gross estimate for this banner in ${ym} — a real per-banner monthly figure`});
    } else cells.push({cls:"qm na", k:"Qimai", v:"—", x:"", tip:"No Qimai China-iPhone data for this banner"});
  }
  // ST & CN use the SAME blended share as the banner modal / month modal — game-i's Japan
  // split and Qimai's China-iPhone split averaged wherever Qimai has data (a ¥0 from game-i
  // still counts, halving the Qimai share), game-i alone when there's no Qimai — so a banner
  // reads ONE value everywhere.
  const giShare=share, qmShare=qimaiShare(b, ym), blended=blendShare(giShare, qmShare);
  const bmode=shareMode({giShare, qmShare, share:blended}), bpct=Math.round(blended*100);
  const shareTxt = bmode==="both"
                 ? `game-i ${Math.round(giShare*100)}% + Qimai ${Math.round(qmShare*100)}% → blended ${bpct}%`
                     + (giShare<=0?` (below game-i's #200, so its ¥0 halves the Qimai share)`:"")
                 : `game-i's Japan share ${bpct}%`;
  if(st){ const est=blended*st.rev;
    cells.push({cls:"st", k:"Sensor&nbsp;Tower", v:"≈"+fmtUSD(est), x:"est. combined",
      tip: blended<=0 ? "Below game-i's top 200 in JP and no Qimai China revenue this month — assumed ~0 globally"
        : `Extrapolated: ${shareTxt} of the month, applied to the $${(st.rev/1e6).toFixed(1)}M Sensor Tower combined monthly. No per-banner breakdown exists — an estimate.`});
  }
  if(cnR){ const lo=blended*cnR.lo, hi=blended*(cnR.hi==null?cnR.lo:cnR.hi);
    cells.push({cls:"cn", k:"CN", v:"≈"+fmtCNYRangeC(lo,hi), x:"est. global"+(cnR.metric?" · "+esc(cnR.metric):""),
      tip: blended<=0 ? "Below game-i's top 200 in JP and no Qimai China revenue this month — assumed ~0 globally"
        : `Extrapolated: ${shareTxt} of the month, applied to the month's ${fmtCNYRange(cnR.lo,cnR.hi)} CN total`
          + (cnR.metric?` (${cnR.metric})`:"")
          + `. That total is global and all-platform while both daily sources are mobile, so this is a rough estimate`
          + (cnR.mihoyo?", and miHoYo's 支付中心 channel is excluded from it":"") + "."});
  }
  const valsHTML=`<div class="mcb-vals">`+cells.map(cc=>
    `<span class="mcv ${cc.cls}"${cc.tip?` title="${esc(cc.tip)}"`:""}>`
    +`<span class="mcv-k">${cc.k}</span><b class="mcv-v">${cc.v}</b>`
    +(cc.x?`<span class="mcv-x">${cc.x}</span>`:"")+`</span>`).join("")+`</div>`;
  // detail line: run dates (in this month) · days · below-#200 · shared THIS month
  const [Y,Mo]=(ym||"").split("-").map(Number);
  const dd = Y ? bannerDays(b, Y, Mo) : null;
  const det=[];
  if(dd){ det.push(`<span class="mcb-dates">${fmtDayMs(dd.first)}–${fmtDayMs(dd.last)}</span>`);
    det.push(`${dd.days} day${dd.days!==1?"s":""}`);
    if(dd.below>0) det.push(`<span class="mcb-below">${dd.below}d below&nbsp;#200</span>`);
    if(dd.shared>0) det.push(`<span class="mcb-shr" title="Ran alongside ${esc(dd.withList.map(w=>w.name).join(", "))} on ${dd.shared} of its ${dd.days} days this month">▨ shared ${dd.shared}/${dd.days}d</span>`); }
  const detLine = det.length?`<div class="mcb-det">${det.join(" · ")}</div>`:"";
  return `<div class="mcb mcb-n${cells.length}" data-i="${x.i}" style="--av-ring:${c}">
    <div class="mcb-av">${avatarHTML(b)}</div>
    <div class="mcb-meta">
      <div class="mcb-nm"><b>${esc(bLabel(b))}</b>${en&&en!==bLabel(b)?`<span class="mcb-en">${esc(en)}</span>`:""}${b&&b.rerun?`<span class="rr">↻</span>`:""}</div>
      ${valsHTML}
      ${detLine}
    </div></div>`;
}
// A pending banner's row in a by-Month card: icon + name + "not on game-i yet" (no revenue).
function pendContribHTML(b){
  const en=b.agents&&b.agents.length?b.agents.join(" & "):"";
  return `<div class="mcb pendmcb" data-i="${b._i}" style="--av-ring:${barColor(b)}">
    <div class="mcb-av">${avatarHTML(b)}</div>
    <div class="mcb-meta">
      <div class="mcb-nm"><b>${esc(bLabel(b))}</b>${en&&en!==bLabel(b)?`<span class="mcb-en">${esc(en)}</span>`:""}</div>
      <div class="mcb-vals"><span class="mcb-pend" title="This banner isn't in game-i's data yet, so there's no daily revenue estimate — it'll fill in once game-i lists it.">not on game-i yet</span></div>
      <div class="mcb-det"><span class="mcb-dates">${fmtDayMs(Date.parse(b.start))}–${fmtDayMs(Date.parse(b.end))}</span></div>
    </div></div>`;
}
// Compact month-concurrency summary for the card (only when banners actually overlap).
function overlapCardHTML(bans, Y, Mo){
  const real=bans.filter(b=>b&&b.rank_series&&b.rank_series.length);
  if(real.length<2) return "";
  const ov=monthOverlap(real, Y, Mo);
  if(!ov.shared.length) return "";
  const nm=b=>esc(b.agents&&b.agents.length?b.agents.join(" & "):b.name);
  const chips=[...ov.solo.map(x=>({t:nm(x.b)+" alone", d:x.days, shr:false})),
               ...ov.shared.map(x=>({t:x.bs.map(nm).join(" + ")+" together", d:x.days, shr:true}))]
    .sort((a,b)=>b.d-a.d);
  const shown=chips.slice(0,6).map(c=>`<span class="mc-ovc${c.shr?" shr":""}">${c.t} <b>${c.d}d</b></span>`).join("");
  const more=chips.length>6?`<span class="mc-ovc more">+${chips.length-6}</span>`:"";
  return `<div class="mc-ov"><span class="mc-ov-h">▨ How the banners overlapped</span><div class="mc-ovc-row">${shown}${more}</div></div>`;
}
// pending banners (not on game-i) grouped by each calendar month they touch, so the
// by-Month view lists them even where game-i has no data for the month yet.
function pendingByMonth(){
  const by={};
  for(const b of state.data.banners){
    if(!b.pending) continue;
    for(const ym of new Set([String(b.start).slice(0,7), String(b.end).slice(0,7)]))
      (by[ym]=by[ym]||[]).push(b);
  }
  return by;
}
function renderMonthly(){
  const gi=state.data.monthly||{}, bm=state.monthly||{}, pend=pendingByMonth();
  const months=[...new Set([...Object.keys(gi),...Object.keys(bm),...Object.keys(pend)])].sort();
  if(!months.length){ $("#chart").innerHTML=`<div class="loading">No monthly data for this game.</div>`; return; }
  const allYears=[...new Set(months.map(m=>m.slice(0,4)))].sort().reverse();
  if(state.monthYear!=="all" && !allYears.includes(state.monthYear)) state.monthYear="all";  // reset on game switch
  // year filter now lives in the controls bar (#bYears), to the right of the Sort dropdown
  const yBtns=`<button data-my="all"${state.monthYear==="all"?' class="on"':''}>All</button>`
    + allYears.map(y=>`<button data-my="${y}"${state.monthYear===y?' class="on"':''}>${y}</button>`).join("");
  if($("#bYears")) $("#bYears").innerHTML=yBtns;
  const mval=ym=>{ const v=gi[ym]; return v!=null?v:((bm[ym]&&bm[ym].ours)||0); };
  const stM=ym=>(extMonth(ym)||{}).rev||0;
  const cnM=ym=>cnMid(cnMonth(ym));
  const qmM=ym=>{ const m=qimaiMonth(ym); return m?m.qtot:0; };
  const val = state.dataSource==="st" ? stM : state.dataSource==="cn" ? cnM : state.dataSource==="qimai" ? qmM : mval;   // Ranking sorts by the toggled data source
  let order = state.periodSort==="ranking" ? [...months].sort((a,b)=>val(b)-val(a)) : [...months].reverse();
  if(state.reverse) order.reverse();
  if(state.monthYear!=="all") order=order.filter(ym=>ym.slice(0,4)===state.monthYear);
  if(searching()) order=order.filter(ym=>((bm[ym]&&bm[ym].banners)||[]).some(x=>searchMatch(state.data.banners[x.i])));
  if(searching() && !order.length){ $("#chart").innerHTML=noResultsHTML(); return; }
  let dtot=0,dnul=0;
  state.data.banners.forEach(b=>{const s=b.rank_series||[]; dtot+=s.length; dnul+=s.filter(x=>x==null).length;});
  const lowRank = dtot && dnul/dtot>=0.15;
  const hasST = Object.keys(extGameMonths(state.tag)).length>0;
  let html=`<div class="yr-note">Each month shows the source estimates side by side: game-i's published <b>monthly total</b> (月次売上予測), the total we <b>reconstruct from daily ranks</b>, the <b>Qimai</b> China-iPhone total, the <b>CN</b> all-platform figure, and`
    + (hasST?` the <b>Sensor Tower</b> combined figure (from gacharevenue's published monthly reports). <b>*</b> marks approximate values (region-summed older reports).`:` (no Sensor Tower coverage for this game).`)
    + ` The bar splits the month among the banners that ran; each banner lists its game-i share and an <b>extrapolated combined</b> figure (its blended game-i + Qimai share applied to the Sensor Tower total — a rough estimate, since no per-banner breakdown exists).</div>`
    + `<div class="mo-hint">Tap or hover any character for its daily-rank detail; each card shows the full monthly breakdown, run dates &amp; below-#200 days, and how the banners overlapped.</div>`;
  if(lowRank) html+=`<div class="mo-warn">⚠ Many of this game's banners fall <b>below game-i's trackable top&nbsp;200</b> within a few days. game-i counts those days as <b>¥0</b> even though the app is still selling, so its <b>monthly total undercounts</b> and the per-banner split is shaky — take everything here as ballpark.</div>`;
  const lead=cnLead(state.tag);
  if(lead) html+=`<div class="mo-warn">⚠ <b>${esc(state.data.name)}'s China server runs ${lead} days ahead of the global/JP schedule.</b> Each banner really earned this <b>Qimai · China iPhone</b> revenue ~${lead} days before its game-i window, but here it's <b>mapped to the matching global month</b> so it lines up with the game-i, Sensor&nbsp;Tower and CN¥ columns and the split still sums to the month. Open a banner's <b>Qimai</b> tab to see its true China dates.</div>`;
  let curY=null;
  order.forEach(ym=>{
    const y=ym.slice(0,4), mo=+ym.slice(5,7);
    if(state.periodSort==="timeline" && y!==curY){ curY=y; html+=`<div class="yhead">${y}</div>`; }
    const g=gi[ym], o=(bm[ym]&&bm[ym].ours)||0, bl=(bm[ym]&&bm[ym].banners)||[];
    const st=extMonth(ym);
    // composition denominator: normally split the reconstructed banner total exactly
    // (segments sum to 100%). Show an "unlisted revenue" slice ONLY when this month has a
    // synthetic ≈ banner — i.e. game-i's monthly genuinely exceeds its listed banners AND
    // the month has days with no listed banner running (computeUnlisted's test). A bare
    // revenue gap on a fully-covered month is reconstruction / month-split / partial-month
    // noise (e.g. a banner spanning into the ongoing month), not real unattributed revenue.
    const showUnlisted = state.data.banners.some(b=>b._synthetic && b.start.slice(0,7)===ym);
    const base = (showUnlisted && g!=null && g>0) ? g : o;
    // KPI scorecards
    const diff = (g!=null && g>0) ? (o-g)/g*100 : null;
    const kGi = g!=null ? `<div class="mck gi"><span class="mck-k">game-i monthly</span><span class="mck-v">${G(g)}</span><span class="mck-n">月次売上予測</span></div>` : "";
    const kRe = `<div class="mck re"><span class="mck-k">from daily ranks</span><span class="mck-v">${G(o)}</span><span class="mck-n">${diff!=null?`${diff>=0?"+":""}${diff.toFixed(0)}% vs game-i`:"reconstruction"}</span></div>`;
    const stApprox = st && (st.method==="approx"||st.method==="reported_approx");
    const stSub = st ? (st.usonly ? `<span class="usonly-tag" title="Global (US) only — no China figure available for this month, so it's undercounted">global only</span>` : (st.method==="reported"||st.method==="reported_approx" ? "combined · reported" : "combined · reconstructed")) : "";
    const kSt = st ? `<div class="mck st${st.usonly?" usonly":""}"><span class="mck-k">Sensor Tower${stApprox?" *":""}</span><span class="mck-v">${fmtUSD(st.rev)}</span><span class="mck-n">${stSub}</span></div>` : "";
    // Qimai scorecard: China iPhone gross for the month (daily source, summed)
    const qmR = qimaiMonth(ym);
    const kQm = qmR ? `<div class="mck qm"><span class="mck-k">Qimai · CN iPhone</span><span class="mck-v">${fmtUSD(qmR.qtot)}</span><span class="mck-n">China iOS · gross</span></div>` : "";
    // CN scorecard: the published monthly figure, its on-screen metric, and a note when
    // the value is a range because miHoYo's 支付中心 channel is excluded.
    const cnR = cnMonth(ym);
    const cnSubTxt = cnR ? (cnR.mihoyo ? "global · 支付中心 excluded" : "global · all platforms") : "";
    const kCn = cnR ? `<div class="mck cn"><span class="mck-k">CN ranking${cnR.metric?` · ${esc(cnR.metric)}`:""}${cnR.inferred?" *":""}</span>`
      + `<span class="mck-v">${fmtCNYRange(cnR.lo,cnR.hi)}</span><span class="mck-n">${cnSubTxt}</span></div>` : "";
    // composition bar: each banner's BLENDED share of the month — game-i's JP split and
    // Qimai's China split via the same blendShare the ST/CN cells use — so a banner that
    // sat below game-i's #200 (¥0 there) but still earned in China gets a segment too.
    // Shares are normalised to the bar because a blend of two sources needn't sum to 1.
    const segs = bl.map(x=>({x, share: blendShare(base>0?x.rev/base:0, qimaiShare(state.data.banners[x.i], ym))}))
      .filter(s=>s.share>0.0005);
    let sumShare = segs.reduce((a,s)=>a+s.share,0);
    const scale = sumShare>1 ? 1/sumShare : 1;
    const unlisted = showUnlisted ? Math.max(0, 1-sumShare) : 0;
    const barSegs = segs.map(s=>{ const b=state.data.banners[s.x.i];
      const dd=bannerDays(b, +y, mo), shrFrac = dd&&dd.days ? dd.shared/dd.days : 0;   // sharing WITHIN this month
      const hatch = shrFrac>0 ? `<span class="mcs-shr" style="width:${Math.min(100,Math.round(shrFrac*100))}%"></span>`:"";
      const pct = s.share*scale*100;
      return `<div class="mcs" style="width:${pct.toFixed(2)}%;background:${barColor(b)}" title="${esc(s.x.name)} · ${Math.round(pct)}% of month (blended game-i + Qimai)${shrFrac>0?` · shared ${dd.shared}/${dd.days}d this month`:""}">${hatch}</div>`;
    }).join("") + (unlisted>0.01?`<div class="mcs unlisted" style="width:${(unlisted*100).toFixed(2)}%" title="Unlisted revenue (${Math.round(unlisted*100)}%) — game-i's monthly total is higher than its listed banners cover (an event/rate-up game-i hasn't logged, or off-banner sales)"></div>`:"");
    const bar = (base>0 || segs.length) ? `<div class="mc-stack">${barSegs}</div>` : "";
    const pendHTML = (pend[ym]||[]).map(pendContribHTML).join("");
    const contribs = (bl.length || pendHTML)
      ? `<div class="mc-banners">${bl.map(x=>bannerContribHTML(x, base, st, ym, cnR)).join("")}${pendHTML}</div>`
      : `<div class="mc-empty">game-i lists no banner for this month.</div>`;
    const overlap = overlapCardHTML(bl.map(x=>state.data.banners[x.i]), +y, mo);
    // header + composition bar stay pinned to the top (bar spans the full card width);
    // only the banner list (.mc-body) centers vertically when the card is stretched to
    // match a taller row-mate.
    html+=`<div class="mc" data-period="month" data-key="${ym}">
      <div class="mc-hd"><div class="mc-month">${MONTHS[mo-1]||ym} <span class="mc-yr">${y}</span></div>
        <div class="mc-kpis">${kGi}${kRe}${kQm}${kSt}${kCn}</div></div>
      ${bar}<div class="mc-body">${contribs}${overlap}</div></div>`;
  });
  $("#chart").innerHTML=html;
  fitBannerNames($("#chart"));
}
// Shrink a banner name that wrapped to a second line (long JP name + its EN reading) until
// it fits one line, down to a floor — so it reads as one tidy line instead of stacking. The
// parts scale in em from the row's font-size (set in CSS), so one font change moves both.
function fitBannerNames(root){
  (root||document).querySelectorAll(".mcb-nm").forEach(nm=>{
    nm.style.fontSize="";
    const en=nm.querySelector(".mcb-en"); if(en) en.style.display="";   // reset from a prior fit
    const oneLine = () => nm.offsetHeight <= (parseFloat(getComputedStyle(nm).lineHeight)||16)*1.4;
    if(oneLine()) return;                 // already a single line at the base size
    let s=13.5;
    while(s>9.5 && !oneLine()){ s-=0.5; nm.style.fontSize=s+"px"; }
    // still wrapping at the floor (a very long JP+EN name in a narrow card) → drop the
    // secondary EN reading so the primary JP name stays on one line (EN is in the modal).
    if(!oneLine() && en) en.style.display="none";
  });
}

// A year/version summary card: game-i total + Sensor Tower total as KPI scorecards,
// the change vs the previous period, and a magnitude bar. data-period/key wire the
// click-through dialog (banners of that period, ranked).
function periodCard(o){
  const giChgHTML = (o.chg!=null)
    ? ` · <span class="chg ${o.chg>=0?"up":"down"}">${o.chg>=0?"▲":"▼"}${Math.abs(o.chg).toFixed(0)}% vs ${esc(o.chgVs)}</span>` : "";
  const kGi=`<div class="mck"><span class="mck-k">game-i total</span><span class="mck-v">${G(o.rev)}</span>`
    +`<span class="mck-n">${o.cnt} banner${o.cnt!==1?"s":""} · ${o.pct.toFixed(0)}% of all-time${giChgHTML}</span></div>`;
  const stChgHTML = (o.st && o.stChg!=null)
    ? ` · <span class="chg ${o.stChg>=0?"up":"down"}">${o.stChg>=0?"▲":"▼"}${Math.abs(o.stChg).toFixed(0)}% vs ${esc(o.chgVs)}</span>` : "";
  const kSt=o.st?`<div class="mck st"><span class="mck-k">Sensor Tower${o.st.hasApprox?" *":""}</span><span class="mck-v">${fmtUSD(o.st.rev)}</span>`
    +`<span class="mck-n">${o.st.months} mo${o.st.hasApprox?" · approx":""}${stChgHTML}</span></div>`
    :`<div class="mck ghost"><span class="mck-k">Sensor Tower</span><span class="mck-v">—</span><span class="mck-n">no coverage</span></div>`;
  const kQm=o.qm>0?`<div class="mck qm"><span class="mck-k">Qimai · CN iPhone</span><span class="mck-v">${fmtUSD(o.qm)}</span><span class="mck-n">China iOS · gross</span></div>`:"";
  // magnitude bar (width = size vs the biggest period) whose fill is split into one
  // colored segment per banner — the same composition read as a by-Month card, so the
  // bar shows both how big the period was and which banners made it up.
  const bans=(o.bans||[]).filter(b=>b.rev>0.0005 && !b._synthetic);
  const realSum=bans.reduce((a,b)=>a+b.rev,0);
  const unlistedFrac = o.rev>0 ? Math.max(0,(o.rev-realSum)/o.rev) : 0;   // synthetic / not-attributed remainder
  let seg=bans.map(b=>{ const f=o.rev>0?b.rev/o.rev:0;
    return `<div class="mcs" style="width:${(f*100).toFixed(2)}%;background:${barColor(b)}" title="${esc(bnm(b))} · ${G(b.rev)} · ${(f*100).toFixed(0)}%"></div>`;
  }).join("");
  if(unlistedFrac>0.01) seg+=`<div class="mcs unlisted" style="width:${(unlistedFrac*100).toFixed(2)}%" title="Not attributed to a listed banner (${Math.round(unlistedFrac*100)}%) — ${G(o.rev-realSum)}"></div>`;
  const fill = seg
    ? `<div class="yc-fill comp" style="width:${o.w}%">${seg}</div>`
    : `<div class="yc-fill" style="width:${o.w}%"></div>`;
  const legend = bans.length ? `<div class="yc-legend">${bans.slice(0,6).map(b=>
      `<span class="yc-lg"><span class="yc-lg-dot" style="background:${barColor(b)}"></span>${esc(bnm(b))}</span>`).join("")}${bans.length>6?`<span class="yc-lg muted">+${bans.length-6} more</span>`:""}</div>` : "";
  return `<div class="yc" data-period="${o.kind}" data-key="${esc(String(o.key))}">
    <div class="yc-hd"><div class="yc-label">${esc(o.label)}${o.prog?`<span class="yc-prog">in progress</span>`:""}</div>
      <div class="mc-kpis yc-kpis">${kGi}${kQm}${kSt}</div></div>
    <div class="yc-track">${fill}</div>${legend}</div>`;
}
// banner display name (agents joined, else banner name) — shared by cards & bars
function bnm(b){ return b.agents&&b.agents.length?b.agents.join(" & "):b.name; }

// ---- by-year breakdown: revenue per calendar year vs the previous year ----
function renderYearly(){
  const all=state.data.banners;
  const total=all.reduce((a,b)=>a+b.rev,0);
  const byYear={}, cnt={}, bansBy={};
  all.forEach(b=>{ byYear[b.year]=(byYear[b.year]||0)+b.rev; cnt[b.year]=(cnt[b.year]||0)+1;
    (bansBy[b.year]||(bansBy[b.year]=[])).push(b); });
  Object.values(bansBy).forEach(a=>a.sort((x,y)=>y.rev-x.rev));
  const years=Object.keys(byYear).map(Number).sort((a,b)=>a-b);
  const max=Math.max(...years.map(y=>byYear[y]));
  const nowYear=new Date(state.data.updated).getUTCFullYear();
  const stY=y=>(extSum(ym=>ym.slice(0,4)===String(y))||{}).rev||0;
  const cnY=y=>cnMid(cnSum(ym=>ym.slice(0,4)===String(y))||null);
  const qmY=y=>qimaiSum(ym=>ym.slice(0,4)===String(y));
  const vy = state.dataSource==="st" ? stY : state.dataSource==="cn" ? cnY : state.dataSource==="qimai" ? qmY : (y=>byYear[y]);
  let order = state.periodSort==="ranking" ? [...years].sort((a,b)=>vy(b)-vy(a)) : [...years].sort((a,b)=>b-a);
  if(state.reverse) order.reverse();
  if(searching()){ order=order.filter(y=>(bansBy[y]||[]).some(searchMatch));
    if(!order.length){ $("#chart").innerHTML=noResultsHTML(); return; } }
  const head=`<div class="yr-head"><b>${esc(state.data.name)}</b> — ${G(total)} total across ${years.length} year${years.length>1?"s":""}</div>`
    + `<div class="yr-note">Each year shows game-i's tracked total and the Sensor Tower combined sum. Sensor Tower coverage runs from late 2021 (older, region-summed months are marked <b>*</b>), and the current year is in progress, so the first and latest years are partial. <b>Click a card</b> for that year's banners.</div>`;
  const rows=order.map(y=>{
    const rev=byYear[y], prev=byYear[y-1];
    const yoy = prev!=null ? (rev-prev)/prev*100 : null;
    const stCur=extSum(ym=>ym.slice(0,4)===String(y)), stPrev=extSum(ym=>ym.slice(0,4)===String(y-1));
    // only compare when the previous period has comparable coverage (avoids a full year vs a 1-month stub)
    const stChg = (stCur&&stPrev&&stPrev.rev>0&&stPrev.months>=stCur.months*0.6) ? (stCur.rev-stPrev.rev)/stPrev.rev*100 : null;
    return periodCard({label:String(y), prog:y===nowYear, rev, pct: total?rev/total*100:0, cnt:cnt[y],
      chg:yoy, chgVs:String(y-1), st:stCur, stChg, qm:qimaiSum(ym=>ym.slice(0,4)===String(y)), w:Math.max(2,rev/max*100), kind:"year", key:y, bans:bansBy[y]});
  }).join("");
  $("#chart").innerHTML=head+rows;
}

// ---- by-Version breakdown: revenue per major game version (1.X, 2.X, …) ----
function renderVersions(){
  const all=state.data.banners;
  const total=all.reduce((a,b)=>a+b.rev,0);
  const byV={}, cnt={}, bansBy={};
  all.forEach(b=>{ const v=versionOf(b)||"?"; byV[v]=(byV[v]||0)+b.rev; cnt[v]=(cnt[v]||0)+1;
    (bansBy[v]||(bansBy[v]=[])).push(b); });
  Object.values(bansBy).forEach(a=>a.sort((x,y)=>y.rev-x.rev));
  const vers=Object.keys(byV).sort();          // "1.X".."9.X" sort correctly (single-digit majors)
  const max=Math.max(...vers.map(v=>byV[v]),0.1);
  const cur=vers[vers.length-1];               // latest version = in progress
  const stV=v=>(extSum(ym=>versionOfYm(ym)===v)||{}).rev||0;
  const cnV=v=>cnMid(cnSum(ym=>versionOfYm(ym)===v)||null);
  const qmV=v=>qimaiSum(ym=>versionOfYm(ym)===v);
  const vv = state.dataSource==="st" ? stV : state.dataSource==="cn" ? cnV : state.dataSource==="qimai" ? qmV : (v=>byV[v]);
  let order = state.periodSort==="ranking" ? [...vers].sort((a,b)=>vv(b)-vv(a)) : [...vers].reverse();
  if(state.reverse) order.reverse();
  if(searching()){ order=order.filter(v=>(bansBy[v]||[]).some(searchMatch));
    if(!order.length){ $("#chart").innerHTML=noResultsHTML(); return; } }
  const head=`<div class="yr-head"><b>${esc(state.data.name)}</b> — ${G(total)} across ${vers.length} version${vers.length>1?"s":""}</div>`
    + `<div class="yr-note">Grouped by major game version (1.X = all of v1.x, etc.). Sensor Tower months are mapped to versions by date (approximate). The first and latest versions may be partial. <b>Click a card</b> for that version's banners.</div>`;
  const rows=order.map(v=>{
    const i=vers.indexOf(v), rev=byV[v], prev=i>0?byV[vers[i-1]]:null;
    const chg = prev!=null ? (rev-prev)/prev*100 : null;
    const stCur=extSum(ym=>versionOfYm(ym)===v), stPrev=i>0?extSum(ym=>versionOfYm(ym)===vers[i-1]):null;
    const stChg = (stCur&&stPrev&&stPrev.rev>0&&stPrev.months>=stCur.months*0.6) ? (stCur.rev-stPrev.rev)/stPrev.rev*100 : null;
    return periodCard({label:v, prog:v===cur, rev, pct: total?rev/total*100:0, cnt:cnt[v],
      chg, chgVs:vers[i-1]||"", st:stCur, stChg, qm:qimaiSum(ym=>versionOfYm(ym)===v), w:Math.max(2,rev/max*100), kind:"version", key:v, bans:bansBy[v]});
  }).join("");
  $("#chart").innerHTML=head+rows;
}
function buildTable(){
  state.data.banners.forEach((x,i)=>x._i=i);
  const rows=[...state.data.banners].filter(searchMatch).sort((a,b)=>b.rev-a.rev).map(b=>`<tr data-i="${b._i}" class="clk">
    <td>${b.cum!=null?"#"+b.cum:"—"}</td><td class="l">${esc(b.name)}</td>
    <td class="l" style="color:var(--muted)">${esc((b.agents||[]).join(", "))}</td>
    <td>${G(b.rev)}</td>
    <td class="l" style="color:var(--muted)">${per(b.start)} – ${per(b.end)}</td>
    <td class="l">${b.yrank!=null?`${b.year} · #${b.yrank}/${b.ytot}`:b.year}</td></tr>`).join("");
  $("#tablewrap").innerHTML=`<table><thead><tr><th>Rank</th><th class="l">Banner</th>
    <th class="l">Agent(s)</th><th>Revenue</th><th class="l">Period</th><th class="l">Yr rank</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}
$("#tablewrap").addEventListener("click",e=>{
  const tr=e.target.closest("tr[data-i]"); if(!tr) return;
  openBanner(state.data.banners[+tr.dataset.i]);
});

// ---- tooltip (works over bar rows AND graph dots — both carry data-i) ----
const tip=$("#tip");
function place(el,e){ const pad=15,w=el.offsetWidth,h=el.offsetHeight;
  let x=e.clientX+pad,y=e.clientY+pad;
  if(x+w>innerWidth)x=e.clientX-w-pad; if(y+h>innerHeight)y=e.clientY-h-pad;
  el.style.left=Math.max(6,x)+"px"; el.style.top=Math.max(6,y)+"px"; }
function showTip(b,e){
  if(b._synthetic){
    tip.innerHTML=`<div class="body"><h4><span class="dot" style="background:var(--muted)"></span>${esc(b.name)}</h4>
      <div style="color:var(--muted);font-size:11.5px">${MONTHS[+b.start.slice(5,7)-1]} ${b.year}</div>
      <dl><dt>Est. revenue</dt><dd><b>${G(b.rev)}</b></dd></dl>
      <div class="tiphint" style="color:var(--muted);border-color:var(--border)">game-i's monthly total that no listed banner covers — likely an event game-i hasn't logged</div></div>`;
    tip.hidden=false; place(tip,e); return;
  }
  const en=b.agents&&b.agents.length?b.agents.join(" & "):(b.related||"");
  const art=b.banner_img?`<img class="art" src="${esc(b.banner_img)}" alt="" referrerpolicy="no-referrer" data-fb="art" data-alt="${esc((b.icons&&b.icons[0])||"")}">`:"";
  const rr=b.rerun?` <span class="rr">↻ rerun</span>`:"";
  const hint=(b.rank_series&&b.rank_series.length)
    ? `<div class="tiphint">▸ Click to see daily rankings during the run</div>` : "";
  const sh=b._share;
  const shRow = sh&&sh.on
    ? `<dt>On its own</dt><dd>${G(sh.soloRev)}</dd>`
    + `<dt>While shared</dt><dd>${G(sh.sharedRev)}</dd>` : "";
  tip.innerHTML=`${art}<div class="body">
    <h4><span class="dot" style="background:${barColor(b)}"></span>${esc(b.name)}${rr}</h4>
    <div style="color:var(--muted);font-size:11.5px">${esc(en)}</div>
    <dl><dt>Period</dt><dd>${per(b.start)} – ${per(b.end)}</dd>
    <dt>Est. revenue</dt><dd><b>${G(b.rev)}</b></dd>
    <dt>All-time rank</dt><dd>#${b.cum} / ${b.cumtot}</dd>
    <dt>${b.year} rank</dt><dd>#${b.yrank} / ${b.ytot}</dd>${shRow}</dl>${hint}</div>`;
  tip.hidden=false;
  const pad=15,w=tip.offsetWidth,h=tip.offsetHeight;
  let x=e.clientX+pad,y=e.clientY+pad;
  if(x+w>innerWidth)x=e.clientX-w-pad; if(y+h>innerHeight)y=e.clientY-h-pad;
  tip.style.left=x+"px"; tip.style.top=Math.max(6,y)+"px";
}
$("#chart").addEventListener("pointermove",e=>{
  if(e.pointerType==="touch"){ tip.hidden=true; return; }   // touch: a tap opens the full modal instead of a hover card
  const el=e.target.closest("[data-i]"); if(!el){tip.hidden=true;return;}
  showTip(state.data.banners[+el.dataset.i],e);
});
$("#chart").addEventListener("pointerleave",()=>tip.hidden=true);
$("#bYearsWrap").addEventListener("click",e=>{
  const my=e.target.closest("[data-my]"); if(my){ state.monthYear=my.dataset.my; renderMonthly(); }
});
// header tiles: Highest banner → that banner; Highest month → that month's dialog
$("#tiles").addEventListener("click",e=>{
  const bt=e.target.closest("[data-i]"); if(bt){ openBanner(state.data.banners[+bt.dataset.i]); return; }
  const pe=e.target.closest("[data-period]"); if(pe){ openPeriod(pe.dataset.period, pe.dataset.key); }
});
$("#chart").addEventListener("click",e=>{
  const el=e.target.closest("[data-i]"); if(el){ openBanner(state.data.banners[+el.dataset.i]); return; }
  const pe=e.target.closest("[data-period]"); if(pe){ openPeriod(pe.dataset.period, pe.dataset.key); }
});

// ---- period dialog: every banner of a chosen year / month / version, ranked,
// with per-banner run detail (days, dates, below-#200) and month concurrency ----
const periodModal=$("#periodModal");
const _mn=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
// {days, below, first, last} for a banner's run, optionally restricted to (Y,Mo). Dates are ms.
// Per-banner run stats within (Y,Mo) — or the whole run when Y is null. `shared`
// and `withList` are scoped to the SAME window, so a July view never shows sharing
// that only happened in August (when a later banner released).
function bannerDays(b, Y, Mo){
  const s=b.rank_series; if(!s||!s.length) return null;
  const s0=Date.parse(b.start+"T00:00:00Z"), DAY=864e5, all=state.data.banners;
  let days=0, below=0, shared=0, first=null, last=null; const withMap=new Map();
  for(let i=0;i<s.length;i++){ const t=s0+i*DAY, d=new Date(t);
    if(b._runs && !runsOn(b,t)) continue;               // skip a split run's paused gap (those days belong to another banner)
    if(Y!=null && !(d.getUTCFullYear()===Y && d.getUTCMonth()===Mo-1)) continue;
    days++; if(s[i]==null) below++;                       // below-#200 days = while actually running
    const others=all.filter(o=>o!==b && !o._synthetic && o._runs && runsOn(o,t) && !handoff(b,o,t));
    if(others.length){ shared++; others.forEach(o=>withMap.set(o,(withMap.get(o)||0)+1)); }
    if(first==null) first=t; last=t;
  }
  if(!days) return null;
  const withList=[...withMap.entries()].sort((a,c)=>c[1]-a[1])
    .map(([o,dd])=>({name:(o.agents&&o.agents.length?o.agents.join(" & "):o.name), days:dd}));
  return {days,below,shared,first,last,withList};
}
const fmtDayMs=t=>{ const d=new Date(t); return `${_mn[d.getUTCMonth()]} ${d.getUTCDate()}`; };
// Concurrency across a calendar month: solo runs + multi-banner overlaps (by day).
function monthOverlap(bans, Y, Mo){
  const DAY=864e5, last=new Date(Date.UTC(Y,Mo,0)).getUTCDate();
  // each banner's last day with actual data (its rank_series extent) — so an ongoing
  // banner's not-yet-run scheduled days aren't counted as overlap.
  const eff=new Map(bans.map(b=>{ const s=Date.parse(b.start+"T00:00:00Z"), n=(b.rank_series||[]).length;
    return [b, n?s+(n-1)*DAY:Date.parse(b.end)]; }));
  const solo=new Map(), combos=new Map();
  for(let day=1; day<=last; day++){
    const t=Date.UTC(Y,Mo-1,day);
    // a banner that STARTS on t while another ENDS on t is a handoff — the changeover
    // day belongs to the outgoing banner, so drop the incoming one from this day.
    const on=bans.filter(b=>runsOn(b,t) && t<=eff.get(b) && !(startsOn(b,t) && bans.some(o=>o!==b && endsOn(o,t))));
    if(on.length===1) solo.set(on[0],(solo.get(on[0])||0)+1);
    else if(on.length>1){ const k=on.map(b=>b._i).sort((a,c)=>a-c).join("|");
      const c=combos.get(k)||{bs:on,days:0}; c.days++; combos.set(k,c); }
  }
  return {
    solo:[...solo.entries()].map(([b,d])=>({b,days:d})).sort((a,c)=>c.days-a.days),
    shared:[...combos.values()].sort((a,c)=>c.days-a.days),
  };
}
function openPeriod(kind, key){
  state.data.banners.forEach((x,i)=>x._i=i);
  const gname=esc(state.data.name), real=state.data.banners.filter(b=>!b._synthetic);
  let items=[], title="", sub="", extra="", qmSection="", stSection="", cnSection="", giHead="", Y=null, Mo=null;
  if(kind==="year"){
    const bs=real.filter(b=>String(b.year)===key).sort((a,b)=>b.rev-a.rev);
    items=bs.map(b=>({b, rev:b.rev}));
    title=`${gname} — ${esc(key)}`;
    const st=extSum(ym=>ym.slice(0,4)===key);
    sub=`<b>game-i</b> ${G(bs.reduce((a,b)=>a+b.rev,0))} · ${bs.length} banner${bs.length!==1?"s":""}`
      + (st?` &nbsp;·&nbsp; ${stChip(st.rev, st, `${st.months} month${st.months>1?"s":""} summed`)}`:"");
    extra=stMonthsHTML(ym=>ym.slice(0,4)===key);
  } else if(kind==="version"){
    const bs=real.filter(b=>versionOf(b)===key).sort((a,b)=>b.rev-a.rev);
    items=bs.map(b=>({b, rev:b.rev}));
    title=`${gname} — Version ${esc(key)}`;
    const st=extSum(ym=>versionOfYm(ym)===key);
    sub=`<b>game-i</b> ${G(bs.reduce((a,b)=>a+b.rev,0))} · ${bs.length} banner${bs.length!==1?"s":""}`
      + (st?` &nbsp;·&nbsp; ${stChip(st.rev, st, `${st.months} month${st.months>1?"s":""} summed, approximate`)}`:"");
    extra=stMonthsHTML(ym=>versionOfYm(ym)===key);
  } else {                                             // month — each banner's share of that calendar month
    [Y,Mo]=key.split("-").map(Number);
    real.forEach(b=>{
      const s=b.rank_series; if(!s||!s.length) return;
      const raw=s.map(rankValue), tot=raw.reduce((a,c)=>a+c,0);
      const s0=Date.parse(b.start+"T00:00:00Z"), DAY=864e5; let share=0, active=false;
      raw.forEach((rw,i)=>{ const d=new Date(s0+i*DAY);
        if(d.getUTCFullYear()===Y && d.getUTCMonth()===Mo-1){ active=true; if(rw>0 && tot>0) share+=b.rev*rw/tot; } });
      if(active) items.push({b, rev:share, total:b.rev});   // include ran-but-below-#200 banners (share ¥0)
    });
    items.sort((a,b)=>b.rev-a.rev);
    const gi=state.data.monthly&&state.data.monthly[key], o=(state.monthly[key]&&state.monthly[key].ours)||0, st=extMonth(key);
    title=`${gname} — ${MONTHS[Mo-1]||key} ${Y}`;
    // game-i section header + explanation (mirrors the Sensor Tower one below)
    giHead=`<div class="pd-hd pd-hd-gi">
      <div class="pd-hd-main">
        <h3 class="pd-h pd-h-gi">game-i — Japan revenue (this month)</h3>
        <div class="pd-subtitle">${items.length} banner${items.length!==1?"s":""} — ${esc(state.data.name)}'s estimated <b>Japan</b> revenue for ${MONTHS[Mo-1]} ${Y}, split among the banners that ran by each day's top-grossing rank${gi!=null?` (reconstructed from ranks: ${G(o)})`:""}.</div>
      </div>
      <div class="pd-tot pd-tot-gi"><span class="pd-tot-v">${gi!=null?G(gi):G(o)}</span><span class="pd-tot-l">${gi!=null?"月次売上予測 · monthly total":"reconstructed total"}</span></div>
    </div>`;
    // Sensor Tower section for the month: the game's global monthly total, then each
    // banner's assumed slice of it (its share of the game-i month × the global total).
    if(st){
      const base=(gi!=null && o>0 && (gi-o)/gi>=0.08) ? gi : o;   // same denominator as bannerST
      const ap = st.method==="approx"||st.method==="reported_approx";
      const stItems=items.map(it=>{ const gi=base>0?it.rev/base:0, qs=qimaiShare(it.b,key);
        const share=blendShare(gi,qs); return {b:it.b, share, giShare:gi, qmShare:qs, jp:it.rev, val:share*st.rev}; })
        .sort((a,b)=>b.val-a.val);
      const stMax=Math.max(...stItems.map(x=>x.val), 1);
      const stRows=stItems.map((it,i)=>{
        const b=it.b, c=barColor(b), [bl,bd]=barShades(c), zero=it.val<1e4;   // <$0.01M
        const w=zero?0:Math.max(2, it.val/stMax*100);
        const en=b.agents&&b.agents.length?b.agents.join(" & "):"";
        const rr=b.rerun?`<span class="rr">↻</span>`:"";
        const val=zero ? `<span class="pd-val pd-below" title="Below game-i's top 200 this month, so no attributed share">$0</span>`
                       : `<span class="pd-val">≈${fmtUSD(it.val)}</span>`;
        return `<div class="pd-row" data-i="${b._i}" style="--bar-l:${bl};--bar-d:${bd};--av-ring:${c}">
          <div class="pd-rk${i<3&&!zero?` m${i+1}`:""}">${i+1}</div>
          <div class="pd-av">${avatarHTML(b)}</div>
          <div class="pd-meta">
            <div class="pd-nm"><b>${esc(bLabel(b))}</b>${en&&en!==bLabel(b)?`<span class="pd-en">${esc(en)}</span>`:""}${rr}</div>
            <div class="pd-bar"><div class="pd-track"><div class="pd-fill" style="width:${w}%"></div></div>${val}</div>
            <div class="pd-sub">${pctSub(it)}</div>
          </div></div>`;
      }).join("");
      stSection=`<div class="pd-hd pd-hd-st">
        <div class="pd-hd-main">
          <h3 class="pd-h pd-h-st">Sensor Tower — assumed combined (this month)</h3>
          <div class="pd-subtitle">${esc(state.data.name)}'s combined worldwide total for ${MONTHS[Mo-1]} ${Y}, split by each banner's share of the month.</div>
        </div>
        <div class="pd-tot pd-tot-st"><span class="pd-tot-v">${fmtUSD(st.rev)}${ap?" *":""}</span><span class="pd-tot-l">combined total</span></div>
      </div>
      <div class="pd-list">${stRows}</div>`;
    }
    // CN section for the month: the same split against the CN monthly total. The range
    // is carried through per banner instead of being flattened to one number.
    const cnR=cnMonth(key);
    if(cnR){
      const base=(gi!=null && o>0 && (gi-o)/gi>=0.08) ? gi : o;   // same denominator as bannerCN
      const cnHi = cnR.hi==null?cnR.lo:cnR.hi;
      const cnItems=items.map(it=>{ const gi=base>0?it.rev/base:0, qs=qimaiShare(it.b,key);
        const share=blendShare(gi,qs);
        return {b:it.b, share, giShare:gi, qmShare:qs, jp:it.rev, lo:share*cnR.lo, hi:share*cnHi}; }).sort((a,b)=>b.hi-a.hi);
      const cnMax=Math.max(...cnItems.map(x=>(x.lo+x.hi)/2), 1);
      const cnRows=cnItems.map((it,i)=>{
        const b=it.b, c=barColor(b), [bl,bd]=barShades(c), zero=it.hi<1e4;
        const w=zero?0:Math.max(2, ((it.lo+it.hi)/2)/cnMax*100);
        const en=b.agents&&b.agents.length?b.agents.join(" & "):"";
        const rr=b.rerun?`<span class="rr">↻</span>`:"";
        const val=zero ? `<span class="pd-val pd-below" title="Below game-i's top 200 this month, so no attributed share">CN¥0</span>`
                       : `<span class="pd-val">≈${fmtCNYRange(it.lo,it.hi)}</span>`;
        return `<div class="pd-row" data-i="${b._i}" style="--bar-l:${bl};--bar-d:${bd};--av-ring:${c}">
          <div class="pd-rk${i<3&&!zero?` m${i+1}`:""}">${i+1}</div>
          <div class="pd-av">${avatarHTML(b)}</div>
          <div class="pd-meta">
            <div class="pd-nm"><b>${esc(bLabel(b))}</b>${en&&en!==bLabel(b)?`<span class="pd-en">${esc(en)}</span>`:""}${rr}</div>
            <div class="pd-bar"><div class="pd-track"><div class="pd-fill" style="width:${w}%"></div></div>${val}</div>
            <div class="pd-sub">${pctSub(it)}</div>
          </div></div>`;
      }).join("");
      cnSection=`<div class="pd-hd pd-hd-cn">
        <div class="pd-hd-main">
          <h3 class="pd-h pd-h-cn">CN ranking${cnR.metric?` · ${esc(cnR.metric)}`:""} — assumed global (this month)</h3>
          <div class="pd-subtitle">${esc(state.data.name)}'s global all-platform total (mobile + PC + PlayStation) for ${MONTHS[Mo-1]} ${Y}, split by each banner's share of the month.${cnR.mihoyo?" miHoYo's 支付中心 channel is excluded from it, so the figure is understated — hence the range.":""}</div>
        </div>
        <div class="pd-tot pd-tot-cn"><span class="pd-tot-v">${fmtCNYRange(cnR.lo,cnR.hi)}</span><span class="pd-tot-l">global total</span></div>
      </div>
      <div class="pd-list">${cnRows}</div>`;
    }
    // Qimai section for the month: REAL per-banner China-iPhone revenue (a daily source,
    // summed per banner — not a share split like ST/CN).
    const qmMonth=qimaiMonth(key);
    if(qmMonth && hasQimai(state.tag)){
      const qb=state.qimai.games[state.tag].banners, qtot=qmMonth.qtot;
      const qmItems=items.map(it=>({b:it.b, val:((qb[it.b._i]&&qb[it.b._i].monthly)||{})[key]||0})).sort((a,b)=>b.val-a.val);
      const qmMax=Math.max(...qmItems.map(x=>x.val),1);
      const qmRows=qmItems.map((it,i)=>{ const b=it.b,c=barColor(b),[bl,bd]=barShades(c),zero=it.val<1;
        const w=zero?0:Math.max(2,it.val/qmMax*100);
        const en=b.agents&&b.agents.length?b.agents.join(" & "):"";
        const rr=b.rerun?`<span class="rr">↻</span>`:"";
        const val=zero?`<span class="pd-val pd-below" title="No Qimai China-iPhone revenue for this banner this month">$0</span>`:`<span class="pd-val">${fmtUSD(it.val)}</span>`;
        return `<div class="pd-row" data-i="${b._i}" style="--bar-l:${bl};--bar-d:${bd};--av-ring:${c}">
          <div class="pd-rk${i<3&&!zero?` m${i+1}`:""}">${i+1}</div>
          <div class="pd-av">${avatarHTML(b)}</div>
          <div class="pd-meta">
            <div class="pd-nm"><b>${esc(bLabel(b))}</b>${en&&en!==bLabel(b)?`<span class="pd-en">${esc(en)}</span>`:""}${rr}</div>
            <div class="pd-bar"><div class="pd-track"><div class="pd-fill" style="width:${w}%"></div></div>${val}</div>
            <div class="pd-sub">${qtot>0?Math.round(it.val/qtot*100):0}% of the month</div>
          </div></div>`;}).join("");
      qmSection=`<div class="pd-hd pd-hd-qm">
        <div class="pd-hd-main">
          <h3 class="pd-h pd-h-qm">Qimai — China iPhone (this month)</h3>
          <div class="pd-subtitle">${esc(state.data.name)}'s China iPhone App&nbsp;Store <b>gross</b> for ${MONTHS[Mo-1]} ${Y}, summed per banner from Qimai's daily figures — a real per-banner number, not a share of the month.</div>
        </div>
        <div class="pd-tot pd-tot-qm"><span class="pd-tot-v">${fmtUSD(qtot)}</span><span class="pd-tot-l">China iOS total</span></div>
      </div>
      <div class="pd-list">${qmRows}</div>`;
    }
    extra=monthCalendarHTML(items, Y, Mo)+overlapHTML(items.map(it=>it.b), Y, Mo);
  }
  const max=Math.max(...items.map(x=>x.rev), 0.1);
  const rows=items.map((it,i)=>{
    const b=it.b, c=barColor(b), [bl,bd]=barShades(c);
    const zero = it.rev < 0.001;                          // ran the period but stayed below game-i's top 200
    const w=zero?0:Math.max(2, it.rev/max*100);
    const en=b.agents&&b.agents.length?b.agents.join(" & "):"";
    const rr=b.rerun?`<span class="rr">↻</span>`:"";
    const part=it.total && it.rev<it.total-1e-9 ? ` <span class="pd-of">of ${G(it.total)}</span>`:"";
    // run detail: days & dates and SHARING, all scoped to this period (month view = that month)
    const dd = bannerDays(b, Y, Mo), shrFrac = dd&&dd.days ? dd.shared/dd.days : 0;
    const shSeg = (!zero && shrFrac>0) ? `<span class="pd-shared" style="width:${Math.min(100,Math.round(shrFrac*100))}%" title="Ran alongside ${esc(dd.withList.map(x=>x.name).join(", "))} on ${dd.shared}/${dd.days} days here"></span>`:"";
    const valHTML = zero
      ? `<span class="pd-val pd-below" title="Ran this period but stayed below game-i's trackable top 200, so game-i attributes ~¥0">¥0 · below&nbsp;#200</span>`
      : `<span class="pd-val">${G(it.rev)}${part}</span>`;
    const meta=[];
    if(dd){ meta.push(`${fmtDayMs(dd.first)}–${fmtDayMs(dd.last)}`); meta.push(`${dd.days} day${dd.days!==1?"s":""}`);
      if(dd.below>0) meta.push(`<span class="pd-below-d" title="Days below game-i's trackable top 200 (¥0)">${dd.below}d below #200</span>`);
      if(dd.shared>0) meta.push(`<span class="pd-shr-d" title="Ran alongside ${esc(dd.withList.map(x=>x.name).join(", "))}">shared ${dd.shared}/${dd.days}d</span>`); }
    else meta.push(`${per(b.start)} – ${per(b.end)}`);
    return `<div class="pd-row" data-i="${b._i}" style="--bar-l:${bl};--bar-d:${bd};--av-ring:${c}">
      <div class="pd-rk${i<3&&!zero?` m${i+1}`:""}">${i+1}</div>
      <div class="pd-av">${avatarHTML(b)}</div>
      <div class="pd-meta">
        <div class="pd-nm"><b>${esc(bLabel(b))}</b>${en&&en!==bLabel(b)?`<span class="pd-en">${esc(en)}</span>`:""}${rr}</div>
        <div class="pd-bar"><div class="pd-track"><div class="pd-fill" style="width:${w}%">${shSeg}</div></div>${valHTML}</div>
        <div class="pd-sub">${meta.join(" · ")}</div>
      </div></div>`;
  }).join("");
  $("#pdBody").innerHTML=`<h2 id="pdTitle" class="pd-title">${title}</h2>${sub?`<div class="pd-subtitle">${sub}</div>`:""}${giHead}`
    + (items.length?`<div class="pd-list">${rows}</div>`:`<p class="pd-empty">No banners in this period.</p>`)
    + qmSection
    + stSection
    + cnSection
    + extra;
  periodModal.querySelector(".modal-card").scrollTop=0;
  periodModal.hidden=false;
}
// Sensor-Tower monthly breakdown for a year/version dialog (one bar per covered month).
function stMonthsHTML(pred){
  const mm=extGameMonths(state.tag); const list=Object.keys(mm).filter(pred).sort();
  if(!list.length) return "";
  const max=Math.max(...list.map(m=>mm[m].rev),1);
  const rows=list.map(m=>{ const v=mm[m], ap=v.method==="approx"||v.method==="reported_approx";
    const [y,mo]=m.split("-"); const w=Math.max(2,v.rev/max*100);
    return `<div class="pd-mo"><span class="pd-mo-l">${_mn[+mo-1]} ${y}</span>
      <div class="pd-mo-track"><div class="pd-mo-fill" style="width:${w}%"></div></div>
      <span class="pd-mo-v">${fmtUSD(v.rev)}${ap?" *":""}</span></div>`;}).join("");
  return `<h3 class="pd-h">Sensor Tower — monthly (combined, USD)</h3><div class="pd-mos">${rows}</div>`;
}
// Stylized month calendar: a proper month grid (weeks × weekdays) where each banner is
// drawn as a continuous colored band spanning the days it ran, Google-Calendar style.
// Each banner keeps a consistent lane so overlapping runs stack cleanly; bands round off
// on the run's real start/end and carry the character avatar + name.
function monthCalendarHTML(items, Y, Mo){
  const dim=new Date(Date.UTC(Y,Mo,0)).getUTCDate();          // days in month
  const lead=new Date(Date.UTC(Y,Mo-1,1)).getUTCDay();        // weekday of the 1st (0=Sun)
  const monthStart=Date.UTC(Y,Mo-1,1), monthEnd=Date.UTC(Y,Mo-1,dim,23,59,59);
  const today=new Date(state.data.updated);
  const todayD=(today.getUTCFullYear()===Y && today.getUTCMonth()===Mo-1) ? today.getUTCDate() : 0;
  // each run clamped to day-of-month, remembering whether the true start/end falls inside
  const runs=items.map(it=>it.b).filter(b=>b.start&&b.end).map(b=>{
    const s=Date.parse(b.start+"T00:00:00Z"), e=Date.parse(b.end+"T00:00:00Z");
    return {b, sd:Math.max(1,Math.floor((s-monthStart)/864e5)+1), ed:Math.min(dim,Math.floor((e-monthStart)/864e5)+1),
            realStart:s>=monthStart, realEnd:e<=monthEnd};
  }).filter(r=>r.ed>=r.sd).sort((a,b)=>a.sd-b.sd || b.ed-a.ed);
  if(!runs.length) return "";
  // greedy lane assignment: reuse a lane once its previous run has ended (a stable row per banner)
  const laneEnd=[];
  runs.forEach(r=>{ let L=laneEnd.findIndex(end=>end<r.sd); if(L<0){ L=laneEnd.length; laneEnd.push(0); } laneEnd[L]=r.ed; r.lane=L; });
  const nLanes=Math.max(1, laneEnd.length);

  const WD=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const head=`<div class="calm-wd">${WD.map((w,i)=>`<div class="${(i===0||i===6)?"we":""}">${w}</div>`).join("")}</div>`;
  const totalCells=Math.ceil((lead+dim)/7)*7;
  let weeks="";
  for(let base=0; base<totalCells; base+=7){
    const wStart=base-lead+1;                                   // day-of-month at this week's Sunday (can be <1)
    let cells="";
    for(let c=0;c<7;c++){ const d=base+c-lead+1, valid=d>=1&&d<=dim, we=(c===0||c===6);
      cells+=`<div class="calm-day${valid?"":" pad"}${we?" we":""}${d===todayD?" today":""}">${valid?`<span class="calm-dn">${d}</span>`:""}</div>`;
    }
    let bands="";
    runs.forEach(r=>{
      const s=Math.max(r.sd, wStart), e=Math.min(r.ed, wStart+6);
      if(e<s || e<1 || s>dim) return;
      const cS=s-wStart, cE=e-wStart;                          // 0..6 columns within the week
      const roundL = r.sd>=wStart, roundR = r.ed<=wStart+6;    // real edge vs a week-wrap continuation
      const c2=barColor(r.b), wide=(cE-cS)>=1;
      bands+=`<div class="calm-band${roundL?" crl":""}${roundR?" crr":""}" data-i="${r.b._i}"
        style="left:calc(${(cS/7*100).toFixed(3)}% + 2px);width:calc(${((cE-cS+1)/7*100).toFixed(3)}% - 4px);top:${r.lane*20}px;background:${c2}"
        title="${esc(bnm(r.b))} · ${MONTHS[Mo-1]} ${r.sd}–${r.ed}">
        <span class="calm-b-av av" style="--av-ring:${c2}">${avatarHTML(r.b)}</span>${wide?`<span class="calm-b-nm">${esc(bnm(r.b))}</span>`:""}</div>`;
    });
    weeks+=`<div class="calm-wk" style="--lanes:${nLanes}"><div class="calm-days">${cells}</div><div class="calm-bands">${bands}</div></div>`;
  }
  return `<h3 class="pd-h">Banner calendar</h3><div class="calm">${head}${weeks}</div>`;
}
// Month concurrency: which banners ran solo vs together, in days.
function overlapHTML(bans, Y, Mo){
  const real=bans.filter(b=>b.rank_series&&b.rank_series.length);
  if(real.length<1) return "";
  const ov=monthOverlap(real, Y, Mo);
  if(!ov.solo.length && !ov.shared.length) return "";
  const nm=b=>esc(b.agents&&b.agents.length?b.agents.join(" & "):b.name);
  const solo=ov.solo.map(x=>`<li><span class="ov-dot" style="background:${barColor(x.b)}"></span>${nm(x.b)} <b>alone</b> — ${x.days} day${x.days!==1?"s":""}</li>`).join("");
  const shared=ov.shared.map(x=>`<li><span class="ov-dot ov-shr"></span>${x.bs.map(nm).join(" + ")} <b>together</b> — ${x.days} day${x.days!==1?"s":""}</li>`).join("");
  return `<h3 class="pd-h">How the month's banners overlapped</h3><ul class="pd-ov">${solo}${shared}</ul>`;
}
$("#pdClose").onclick=()=>{ periodModal.hidden=true; };
periodModal.onclick=e=>{ if(e.target===periodModal) periodModal.hidden=true; };
$("#pdBody").addEventListener("click",e=>{
  const el=e.target.closest("[data-i]"); if(el) openBanner(state.data.banners[+el.dataset.i]);
});

// ---- banner detail modal (daily rank curve + revenue build-up over the run) ----
const bannerModal=$("#bannerModal");
const dayLabel=i=>{const d=new Date(dayLabel.start); d.setDate(d.getDate()+i); return `${d.getMonth()+1}/${d.getDate()}`;};
// "M/D" straight from an ISO date — used where a chart carries its own dates (e.g. the
// Qimai build-up, whose days are the banner's China run, offset from its game-i window).
const isoMD=iso=>{const [,m,d]=iso.split("-"); return `${+m}/${+d}`;};

// A banner's daily iOS top-grossing rank, drawn with #1 at the top. Gaps in the
// line are days the app sat below the trackable ~top 200 (game-i counts as ¥0).
function rankCurveSVG(b){
  const s=b.rank_series||[]; const n=s.length;
  const known=s.map((v,i)=>[i,v]).filter(([,v])=>v!=null);
  if(known.length<1) return "";
  const worst=Math.max(...known.map(([,v])=>v));
  const ymax = worst<=10?10 : worst<=20?20 : worst<=30?30 : worst<=50?50 : worst<=100?100 : 200;
  const W=680,H=230,ML=38,MR=14,MT=16,MB=26, pW=W-ML-MR, pH=H-MT-MB;
  const xOf=i=> n>1 ? ML+(i/(n-1))*pW : ML+pW/2;
  const yOf=r=> MT+((r-1)/(ymax-1))*pH;                 // rank 1 at top
  const gridR=[...new Set([1,Math.round(ymax/4),Math.round(ymax/2),Math.round(3*ymax/4),ymax])];
  const grid=gridR.map(r=>{const y=yOf(r);
    return `<line class="grid" x1="${ML}" y1="${y.toFixed(1)}" x2="${W-MR}" y2="${y.toFixed(1)}"/>`+
      `<text class="axislbl" x="${ML-6}" y="${(y+3).toFixed(1)}" text-anchor="end">#${r}</text>`;}).join("");
  const xIdx=[...new Set([0,Math.round((n-1)/3),Math.round(2*(n-1)/3),n-1])];
  const xt=xIdx.map(i=>`<text class="axislbl" x="${xOf(i).toFixed(1)}" y="${H-8}" text-anchor="middle">${dayLabel(i)}</text>`).join("");
  let d="",pen=false;
  s.forEach((v,i)=>{ if(v==null){pen=false;return;} const x=xOf(i),y=yOf(v);
    d+=`${pen?"L":"M"}${x.toFixed(1)} ${y.toFixed(1)}`; pen=true; });
  const dots=known.map(([i,v])=>`<circle class="rc-dot" cx="${xOf(i).toFixed(1)}" cy="${yOf(v).toFixed(1)}" r="3"/>`).join("");
  const [pi,pv]=known.reduce((a,c)=>c[1]<a[1]?c:a);
  const peak=`<circle class="rc-peak" cx="${xOf(pi).toFixed(1)}" cy="${yOf(pv).toFixed(1)}" r="5"/>`+
    `<text class="rc-peaklbl" x="${xOf(pi).toFixed(1)}" y="${(yOf(pv)-9).toFixed(1)}" text-anchor="middle">peak #${pv}</text>`;
  const hits=known.map(([i,v])=>`<circle class="rc-hit" data-day="${i}" cx="${xOf(i).toFixed(1)}" cy="${yOf(v).toFixed(1)}" r="9"/>`).join("");
  return `<svg class="rcsvg" viewBox="0 0 ${W} ${H}" role="img" style="--acc:${barColor(b)}">
    ${grid}<path class="rc-line" d="${d}"/>${dots}${peak}${hits}${xt}</svg>`;
}

// game-i's published rank → daily-revenue curve (億G, from its 日別加算値 table).
// Higher rank earns more that day; below ~200 earns nothing. We don't have the
// exact per-day yen (it shifts by date and splits across concurrent banners), so
// we use this curve only to *shape* the run, then scale it so the run's total
// equals game-i's own figure. It's a reconstruction, not a reported number.
const RANK_VAL=[[1,5.90],[2,3.47],[3,3.03],[4,2.61],[5,2.03],[10,.9034],[50,.2584],[100,.1640],[200,.10]];
function rankValue(r){
  if(r==null) return 0;
  if(r<=RANK_VAL[0][0]) return RANK_VAL[0][1];
  if(r>=200) return RANK_VAL[RANK_VAL.length-1][1];
  for(let i=0;i<RANK_VAL.length-1;i++){ const[r0,v0]=RANK_VAL[i],[r1,v1]=RANK_VAL[i+1];
    if(r>=r0&&r<=r1){ const t=(Math.log(r)-Math.log(r0))/(Math.log(r1)-Math.log(r0));
      return Math.exp(Math.log(v0)+t*(Math.log(v1)-Math.log(v0))); } }
  return 0;
}
// ---- how front-loaded a run was -------------------------------------------------
// game-i publishes one total per banner, but its daily rank curve says WHEN that total
// arrived, and the shape differs a lot between games: a Star Rail banner earns most of
// its money in the opening days, an Umamusume one keeps earning for weeks. Same weights
// dailyBreakdown() uses, computed straight off the rank series so this is cheap enough
// to run over every banner in the game for the comparison line.
const BURN_MIN_DAYS = 14;    // shorter runs can't have a meaningful "first week" share
function burnout(b){
  if(b._burn !== undefined) return b._burn;
  const s=b.rank_series||[], w=s.map(rankValue), tot=w.reduce((a,c)=>a+c,0);
  if(!s.length || tot<=0) return (b._burn=null);
  const at=n=>w.slice(0,n).reduce((a,c)=>a+c,0)/tot;
  let run=0, half=null;
  for(let i=0;i<w.length;i++){ run+=w[i]; if(half==null && run>=tot/2) half=i+1; }
  return (b._burn={days:w.length, d3:at(3), d7:at(7), half});
}
// This game's typical first-week share, for context. Finished runs only: an ongoing
// banner's shares are taken over the days elapsed so far, not its eventual total, so
// including them would drag the median upward.
function gameBurn(){
  if(state._gameBurn !== undefined) return state._gameBurn;
  const v=[], v3=[], vh=[];
  for(const b of (state.data?state.data.banners:[])){
    if(b._synthetic || b.pending || b.ongoing) continue;
    const bo=burnout(b);
    if(bo && bo.days>=BURN_MIN_DAYS){ v.push(bo.d7); v3.push(bo.d3); vh.push(bo.half); }
  }
  if(v.length<5) return (state._gameBurn = null);
  return (state._gameBurn = {med:_med(v), med3:_med(v3), medHalf:_med(vh), n:v.length});
}
// What share of its FINAL total a banner of this game has typically earned by day d,
// taken over finished runs. This is the piece that lets a run still in progress be
// read: `so far / share[d]` turns "day 6, banked X" into where it is heading. Only
// days backed by at least 5 finished runs are kept, so the tail doesn't rest on one.
function gameShareCurve(){
  if(state._shareCurve !== undefined) return state._shareCurve;
  const cols=[];
  for(const b of (state.data?state.data.banners:[])){
    if(b._synthetic || b.pending || b.ongoing || !(b.rev>0)) continue;
    const c=cumCurve(b);
    if(!c || c.length<BURN_MIN_DAYS) continue;
    c.forEach((v,i)=>{ (cols[i]=cols[i]||[]).push(v/b.rev); });
  }
  const q=(a,f)=>{const x=[...a].sort((p,r)=>p-r); return x[Math.min(x.length-1,Math.floor(x.length*f))];};
  const keep=cols.filter(a=>a.length>=5);
  if(keep.length<3) return (state._shareCurve = null);
  return (state._shareCurve={ n:keep[0].length, days:keep.length,
    share:keep.map(a=>_med(a)), lo:keep.map(a=>q(a,0.25)), hi:keep.map(a=>q(a,0.75)) });
}

function burnBlock(b){
  const bo=burnout(b);
  // A finished run needs enough days for its shares to mean anything; a run still
  // going is the case this block is most useful for, so it gets in from day 2 and
  // the projection carries its own (wide, early) range.
  if(!bo || (!b.ongoing && bo.days<8)) return "";
  const pc=x=>Math.round(x*100)+"%";
  const stats=`<div class="bm-stats bm-share3 bm-burn">
    <div class="bm-stat"><span class="l">First 3 days</span><span class="v">${pc(bo.d3)}</span></div>
    <div class="bm-stat"><span class="l">First week</span><span class="v">${pc(bo.d7)}</span></div>
    <div class="bm-stat"><span class="l">Half earned by</span><span class="v">Day ${bo.half}</span></div>
  </div>`;
  if(b.ongoing){
    // Shares of a total that doesn't exist yet are meaningless, so the tiles change:
    // where the run is, what this game has usually banked by now, and where that puts it.
    const sc=gameShareCurve(), D=bo.days;
    const sh = sc && D>=2 && D<=sc.days ? sc.share[D-1] : null;
    const scheduled=Math.round((Date.parse(b.end)-Date.parse(b.start))/864e5)+1;
    if(!sh || !(b.rev>0) || sh<=0.02)
      return `<div class="bm-cap">This run is <b>still going</b> — day <b>${D}</b> of
        ${scheduled}. There isn't enough finished history for ${esc(gameName())} to say where it lands yet.</div>`;
    const proj=b.rev/sh, pLo=b.rev/sc.hi[D-1], pHi=b.rev/sc.lo[D-1];
    const pc=v=>Math.round(v*100)+"%";
    return `<div class="bm-stats bm-share3 bm-burn">
      <div class="bm-stat"><span class="l">Day</span><span class="v">${D} of ${scheduled}</span></div>
      <div class="bm-stat"><span class="l">Usually banked by now</span><span class="v">${pc(sh)}</span></div>
      <div class="bm-stat sum"><span class="l">Tracking towards</span><span class="v">${G(proj)}</span></div>
    </div>
    <div class="bm-cap">Across ${sc.n} finished ${esc(gameName())} banners the usual one has
      <b>${pc(sh)}</b> of its final total by day <b>${D}</b>. This one has <b>${G(b.rev)}</b>, which puts
      it near <b>${G(proj)}</b> — between <b>${G(pLo)}</b> and <b>${G(pHi)}</b>, depending on whether it
      holds up better or worse than the middle of the pack from here.</div>`;
  }
  const g=gameBurn();
  if(!g) return stats;
  // A short run's first week is structurally a bigger slice of it than a three-week
  // run's, so comparing the two would be meaningless. Say so rather than going quiet.
  if(bo.days<BURN_MIN_DAYS) return stats+`<div class="bm-cap">At <b>${bo.days} days</b> this run is too short to line up against ${esc(gameName())}'s longer banners — a shorter run packs more of itself into its first week by definition.</div>`;
  const d=(bo.d7-g.med)*100;
  const verdict = Math.abs(d)<5 ? `right about typical for ${esc(gameName())}`
    : d>0 ? `<b>more front-loaded</b> than a typical ${esc(gameName())} banner`
          : `<b>a longer tail</b> than a typical ${esc(gameName())} banner`;
  // all three shares, so the reader can see WHICH part of the curve is unusual
  const gap=(mine,norm)=>{const k=Math.round((mine-norm)*100);
    return Math.abs(k)<4 ? "about the same" : `<b>${Math.abs(k)} points ${k>0?"more":"less"}</b>`;};
  return stats+`<div class="bm-cap">${verdict}. Across ${g.n} finished ${esc(gameName())} banners the
    usual one takes <b>${Math.round(g.med3*100)}%</b> in its first 3 days (this one ${gap(bo.d3,g.med3)}),
    <b>${Math.round(g.med*100)}%</b> in its first week (${gap(bo.d7,g.med)}), and is half done by
    day <b>${g.medHalf}</b> against this one's day <b>${bo.half}</b>.</div>`;
}

function dailyBreakdown(b){
  const s=b.rank_series||[]; if(!s.length) return null;
  const raw=s.map(rankValue), sum=raw.reduce((a,c)=>a+c,0);
  if(sum<=0) return null;
  const all=state.data.banners, DAY=864e5, s0=Date.parse(b.start);
  let cum=0;
  const days=s.map((rank,i)=>{ const add=b.rev*raw[i]/sum; cum+=add;
    const t=s0+i*DAY;
    const shared=all.some(o=>o!==b && !o._synthetic && o._runs && runsOn(o,t) && runsOn(b,t));
    return {i,rank,add,cum,shared}; });
  return {days};
}
function buildupSVG(bd,b,fmt=G,hitAttr="day"){
  const days=bd.days, n=days.length;
  // pending (no-Qimai-data-yet) days are drawn as nothing — the line/dots stop at the last
  // day Qimai has posted, and the total is that last real cumulative, not a padded 0-day.
  const drawn=days.filter(d=>!d.noData);
  const total=drawn.length?drawn[drawn.length-1].cum:(b.rev||1);
  const W=680,H=180,ML=52,MR=14,MT=12,MB=26, pW=W-ML-MR, pH=H-MT-MB;
  const xOf=i=> n>1 ? ML+(i/(n-1))*pW : ML+pW/2;
  const yOf=v=> MT+(1-v/total)*pH;
  const grid=[0,.25,.5,.75,1].map(fr=>{const v=total*fr,y=yOf(v);
    return `<line class="grid" x1="${ML}" y1="${y.toFixed(1)}" x2="${W-MR}" y2="${y.toFixed(1)}"/>`+
      `<text class="axislbl" x="${ML-6}" y="${(y+3).toFixed(1)}" text-anchor="end">${fmt(v)}</text>`;}).join("");
  const bw=Math.min(16, pW/n*0.7);
  const bars=days.map(d=>{ if(d.add<=0||d.noData) return ""; const x=xOf(d.i);
    const top=MT+(1-d.add/total)*pH, h=MT+pH-top;
    return `<rect class="bu-bar${d.shared?' shr':''}" x="${(x-bw/2).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0,h).toFixed(1)}" rx="2"/>`;}).join("");
  const line=drawn.map((d,k)=>(k?"L":"M")+xOf(d.i).toFixed(1)+" "+yOf(d.cum).toFixed(1)).join(" ");
  const cdots=drawn.map(d=>`<circle class="rc-dot" cx="${xOf(d.i).toFixed(1)}" cy="${yOf(d.cum).toFixed(1)}" r="3"/>`).join("");
  const hits=drawn.map(d=>`<circle class="rc-hit" data-${hitAttr}="${d.i}" cx="${xOf(d.i).toFixed(1)}" cy="${yOf(d.cum).toFixed(1)}" r="9"/>`).join("");
  const xIdx=[...new Set([0,Math.round((n-1)/2),n-1])];
  const lbl=i=>days[i]&&days[i].iso?isoMD(days[i].iso):dayLabel(i);   // chart's own dates when it carries them
  const xt=xIdx.map(i=>`<text class="axislbl" x="${xOf(i).toFixed(1)}" y="${H-8}" text-anchor="middle">${lbl(i)}</text>`).join("");
  return `<svg class="rcsvg buildup" viewBox="0 0 ${W} ${H}" role="img" style="--acc:${barColor(b)}">
    ${grid}${bars}<path class="bu-line" d="${line}"/>${cdots}${hits}${xt}</svg>`;
}
function dailyTable(bd,fmt=G,rankHdr="iOS&nbsp;rank"){
  const cell=d=>`<tr>
    <td class="l">${d.iso?isoMD(d.iso):dayLabel(d.i)}</td>`
    + (d.noData
      ? `<td colspan="3" class="muted qbu-nodata">no data yet</td>`
      : `<td>${d.rank==null?'<span class="muted">200+</span>':'#'+d.rank}</td>`
        + `<td>${d.add>=0.005?fmt(d.add):'<span class="muted">—</span>'}</td>`
        + `<td>${fmt(d.cum)}</td>`)
    + `</tr>`;
  // Dealt across two columns like the China rank table. A run is 20-30 days, which
  // is a tall scroller in one column and fits without scrolling in two. Two rather
  // than three because each column carries four fields, not two.
  const per=Math.ceil(bd.days.length/2);
  const cols=[];
  for(let i=0;i<bd.days.length;i+=per)
    cols.push(`<div class="bm-rtcol"><table class="bm-table">
      <thead><tr><th class="l">Date</th><th>${rankHdr}</th><th>+Est.</th><th>Cumulative</th></tr></thead>
      <tbody>${bd.days.slice(i,i+per).map(cell).join("")}</tbody></table></div>`);
  return `<div class="bm-tablewrap bm-rtcols cols2">${cols.join("")}</div>`;
}

// Sensor Tower detail for the banner modal: the assumption, every month the run
// touched (game-i share × real ST monthly total = assumed contribution), who else
// ran that month, and the summed total. Handles no-data / partial-run states.
// How a month's blended share is built, shown inline in the ST/CN breakdowns. When Qimai
// data exists for the month it's game-i% and Qimai% averaged; otherwise game-i alone.
// compact percent-only version of the blend, for the tight month-modal sub-lines
function pctSub(it){ const p=x=>Math.round(x*100)+"%", mode=shareMode(it);
  if(mode==="both") return `game-i ${p(it.giShare)} · Qimai ${p(it.qmShare)} → ${p(it.share)} of month`;
  return `${p(it.share)} of the month`; }
function shareMath(m){
  const p=x=>Math.round(x*100)+"%", mode=shareMode(m);
  if(mode==="both")
    return `game-i <b>${G(m.jp)}</b> = <b>${p(m.giShare)}</b> · Qimai <b>${fmtUSD(m.qmRev)}</b> = <b>${p(m.qmShare)}</b> → blended <b>${p(m.share)}</b>`
      + (m.giShare<=0?` <span class="muted">(below game-i's #200, so its ¥0 halves the Qimai share)</span>`:"");
  return `<b>${G(m.jp)}</b> JP = <b>${p(m.share)}</b> of the month`;
}
function bannerSTBlock(b){
  if(b._synthetic) return "";
  const st=bannerST(b), bm=state.monthly||{};
  const head=`<h3>Sensor Tower — assumed combined revenue</h3>`;
  const how=`<p class="bm-note bm-recon">Sensor Tower publishes only <b>${esc(gameName())}</b>'s <b>monthly worldwide</b> total, not per-banner. We assume this banner took the same <b>slice</b> of that combined total as it did of the month itself — and that slice is read from <b>two daily sources</b>, game-i's Japan split and Qimai's China-iPhone split, <b>averaged where both exist</b> (game-i alone otherwise) — then add those slices across every month it ran.</p>`;
  if(!st.hasData){
    return head+how+`<p class="bm-note"><b>No Sensor Tower data yet.</b> This run is either before the reports began (Oct 2021) or entirely within months not yet published. A figure will appear here once a monthly report covers its run.</p>`;
  }
  const c=barColor(b);
  const stMonths=st.covered+st.missing;
  const headline=`<div class="bm-headline">
    <span><span class="l">Assumed combined revenue${st.partial?" so far":""}</span><div class="v">≈${fmtUSD(st.total)}</div></span>
    <span class="sub">${st.covered} of ${stMonths} month${stMonths>1?"s":""} covered · US$, worldwide, mobile</span></div>`;
  const rows=st.months.map(m=>{
    const ym=m.ym, lab=`${MONTHS[+ym.slice(5,7)-1]} ${ym.slice(0,4)}`;
    const co=((bm[ym]&&bm[ym].banners)||[]).filter(x=>x.i!==b._i && x.rev>0.001)
      .sort((a,d)=>d.rev-a.rev).map(x=>{ const ob=state.data.banners[x.i];
        return `<span class="bm-cochip" style="--av-ring:${barColor(ob)}"><span class="bm-coav">${avatarHTML(ob)}</span>${esc(x.name)}</span>`; });
    const coStr = co.length ? co.join("") : `<span class="muted">ran solo this month</span>`;
    const pct=Math.round(m.share*100);
    const barW=Math.max(2, m.share*100);
    if(m.contrib==null){
      return `<div class="bm-stm">
        <div class="bm-stm-top"><span class="mo">${lab}</span><span class="v muted" title="Sensor Tower hasn't published this month yet">not yet reported</span></div>
        <div class="bm-stm-math">${shareMath(m)} of the month — combined figure lands when the ${lab} report is out.</div>
        <div class="bm-stm-co"><span class="bm-co-l">Shared the month with</span> ${coStr}</div></div>`;
    }
    return `<div class="bm-stm">
      <div class="bm-stm-top"><span class="mo">${lab}</span><span class="v">≈${fmtUSD(m.contrib)}</span></div>
      <div class="bm-stm-mbar"><span class="bm-stm-mfill" style="width:${barW.toFixed(1)}%;background:${c}"></span></div>
      <div class="bm-stm-math">${shareMath(m)} × <b>${fmtUSD(m.stMonth)}</b> combined ⟶ <b>≈${fmtUSD(m.contrib)}</b></div>
      <div class="bm-stm-co"><span class="bm-co-l">Shared the month with</span> ${coStr}</div></div>`;
  }).join("");
  const partial = st.partial
    ? `<p class="bm-note"><b>Partial run.</b> Sensor Tower covers <b>${st.covered}</b> of the <b>${st.covered+st.missing}</b> months this banner ran — the total above counts only the covered months and will grow as later reports land.</p>`
    : "";
  return head+how+headline+partial+`<div class="bm-stmlist">${rows}</div>`;
}
function gameName(){ const g=(state.games||[]).find(x=>x.game===state.tag); return g?g.name:state.tag; }

// rank a banner among all (and its year's) banners by assumed combined ST total
function stRankInfo(b){
  const all=(state.data.banners||[]).filter(x=>!x._synthetic && bannerST(x).hasData);
  const t=bannerST(b).total;
  const yr=all.filter(x=>x.year===b.year);
  return {
    cum: all.filter(x=>bannerST(x).total>t).length+1, cumtot: all.length,
    yrank: yr.filter(x=>bannerST(x).total>t).length+1, ytot: yr.length,
  };
}

function cnRankInfo(b){
  const mid=x=>{ const c=bannerCN(x); return (c.lo+c.hi)/2; };
  const all=(state.data.banners||[]).filter(x=>!x._synthetic && bannerCN(x).hasData);
  const t=mid(b), yr=all.filter(x=>x.year===b.year);
  return {cum: all.filter(x=>mid(x)>t).length+1, cumtot: all.length,
          yrank: yr.filter(x=>mid(x)>t).length+1, ytot: yr.length};
}

// ST-valued "shared with concurrent banners" split. The per-banner combined total
// is game-i's daily shape scaled to Sensor Tower's monthly totals, so it inherits the
// same solo/shared proportion (_share.revFrac) that game-i's daily rank split produces.
// "Ran alongside" line as avatar chips (same chip style as the month "Shared with")
function alongsideChips(sh){
  const chips=sh.with.map(x=>`<span class="bm-cochip" style="--av-ring:${barColor(x.o)}"><span class="bm-coav">${avatarHTML(x.o)}</span>${esc(x.name)} <span class="muted">${x.days}d</span></span>`).join("");
  return `<div class="bm-note bm-recon bm-along"><span class="bm-co-l">Ran alongside</span>${chips}</div>`;
}
function bannerSTShareBlock(b){
  const sh=b._share, st=bannerST(b);
  if(!sh || !sh.on || !st.hasData) return "";
  const sharedRev=st.total*sh.revFrac, soloRev=st.total-sharedRev;
  return `<h3>Shared with concurrent banners</h3>
    <p class="bm-note">The combined figure inherits game-i's daily split — revenue on days two or more banners ran is divided equally between them. This one overlapped <b>${sh.with.length}</b> other banner${sh.with.length>1?"s":""} on <b>${sh.days}</b> of its ${sh.totalDays} days (up to a <b>${sh.maxN}-way</b> split), so the same <b>${Math.round(sh.revFrac*100)}%</b> of its combined total falls in shared days.</p>
    <div class="bm-stats bm-share3">
      <div class="bm-stat"><span class="l">On its own</span><span class="v">≈${fmtUSD(soloRev)}</span></div>
      <div class="bm-stat"><span class="l">While shared</span><span class="v">≈${fmtUSD(sharedRev)}</span></div>
      <div class="bm-stat sum"><span class="l">Total${st.partial?" so far":""}</span><span class="v">≈${fmtUSD(st.total)}</span></div>
    </div>
    ${alongsideChips(sh)}`;
}

// Sensor Tower view for the banner modal: ST-valued stat tiles + the detailed month breakdown
// The CN tab of a banner card: the same month-by-month arithmetic the ST tab shows,
// with the range kept intact and the metric label printed per month so a run that
// straddles the Nov 2023 basis change is obvious rather than silently averaged.
// ---- China iOS chart, day by day -------------------------------------------------
// data/ranks/cn_ios_series.json: days[date]=[depth,source], games[tag][date]=rank.
// A day present in `days` with no rank for the game is a real reading -- the game sat
// BELOW that day's depth -- while a date absent from `days` is simply a day nobody has.
// Days the China server runs AHEAD of the global/JP banner calendar for this game (0 when
// servers are in sync). Written into qimai.json by scripts/build_qimai.py (CN_LEAD), and
// used to line the China rank window up with the banner's ACTUAL China run — same shift
// build_qimai applies to the China revenue, so rank and revenue share one window.
function cnLead(tag){ const g=state.qimai&&state.qimai.games&&state.qimai.games[tag||state.tag];
  return (g&&g.cn_lead)||0; }
function cnRunSeries(b){
  const R=state.cnrank; if(!R||!R.games||!R.days) return null;
  const g=R.games[state.tag]; if(!g) return null;
  const iso=d=>d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
  const out=[]; let any=false;
  const lead=cnLead();   // shift the run window back to the banner's China dates
  const d=new Date(b.start+"T00:00:00"), end=new Date(b.end+"T00:00:00"), today=new Date();
  if(lead){ d.setDate(d.getDate()-lead); end.setDate(end.getDate()-lead); }
  while(d<=end&&d<=today){
    const k=iso(d), day=R.days[k];
    if(day) any=true;
    out.push({iso:k, rank:g[k]!=null?g[k]:null, depth:day?day[0]:null, src:day?day[1]:null});
    d.setDate(d.getDate()+1);
  }
  return any?out:null;
}
function cnRankSVG(run,b){
  const known=run.map((x,i)=>[i,x.rank]).filter(([,r])=>r!=null);
  if(!known.length) return "";
  const n=run.length, worst=Math.max(...known.map(([,r])=>r));
  const ymax = worst<=10?10 : worst<=20?20 : worst<=30?30 : worst<=50?50 : worst<=100?100 : 200;
  const W=680,H=230,ML=38,MR=14,MT=16,MB=26,pW=W-ML-MR,pH=H-MT-MB;
  const xOf=i=> n>1 ? ML+(i/(n-1))*pW : ML+pW/2;
  const yOf=r=> MT+((r-1)/(ymax-1))*pH;
  const grid=[...new Set([1,Math.round(ymax/4),Math.round(ymax/2),Math.round(3*ymax/4),ymax])]
    .map(r=>{const y=yOf(r);
      return `<line class="grid" x1="${ML}" y1="${y.toFixed(1)}" x2="${W-MR}" y2="${y.toFixed(1)}"/>`
        +`<text class="axislbl" x="${ML-6}" y="${(y+3).toFixed(1)}" text-anchor="end">#${r}</text>`;}).join("");
  const xt=[...new Set([0,Math.round((n-1)/3),Math.round(2*(n-1)/3),n-1])]
    .map(i=>`<text class="axislbl" x="${xOf(i).toFixed(1)}" y="${H-8}" text-anchor="middle">${run[i]&&run[i].iso?isoMD(run[i].iso):dayLabel(i)}</text>`).join("");
  let d="",pen=false;
  run.forEach((x,i)=>{ if(x.rank==null){pen=false;return;} const px=xOf(i),py=yOf(x.rank);
    d+=`${pen?"L":"M"}${px.toFixed(1)} ${py.toFixed(1)}`; pen=true; });
  const dots=known.map(([i,r])=>`<circle class="rc-dot" cx="${xOf(i).toFixed(1)}" cy="${yOf(r).toFixed(1)}" r="3"/>`).join("");
  // days the chart is known but the game wasn't on it: a tick along the bottom
  const below=run.map((x,i)=>x.depth!=null&&x.rank==null
    ? `<line class="grid" x1="${xOf(i).toFixed(1)}" y1="${(H-MB-3).toFixed(1)}" x2="${xOf(i).toFixed(1)}" y2="${(H-MB).toFixed(1)}"/>`:"").join("");
  const [pi,pv]=known.reduce((a,c)=>c[1]<a[1]?c:a);
  const peak=`<circle class="rc-peak" cx="${xOf(pi).toFixed(1)}" cy="${yOf(pv).toFixed(1)}" r="5"/>`
    +`<text class="rc-peaklbl" x="${xOf(pi).toFixed(1)}" y="${(yOf(pv)-9).toFixed(1)}" text-anchor="middle">peak #${pv}</text>`;
  // hover targets on every charted day, including the ones the game sat below
  _cnCtx={days:run.map((x,i)=>({...x, i}))};
  const hits=run.map((x,i)=>x.depth==null?"":
    `<circle class="rc-hit" data-cnday="${i}" cx="${xOf(i).toFixed(1)}" cy="${(x.rank!=null?yOf(x.rank):H-MB-6).toFixed(1)}" r="9"/>`).join("");
  return `<svg class="rcsvg" viewBox="0 0 ${W} ${H}" role="img" style="--acc:${barColor(b)}">
    ${grid}${below}<path class="rc-line" d="${d}"/>${dots}${peak}${hits}${xt}</svg>`;
}
// ---- what the China chart says about a run, next to the game's other banners --------
// Everything here is measured, not modelled: the run's own ranks, and the ranks and
// revenue of banners that came before. The one inference is the closing line, and it is
// labelled for what it is -- what similar openings went on to earn, not a forecast.
function cnRunStats(b){
  if(b._cnStats!==undefined) return b._cnStats;
  const run=cnRunSeries(b);
  if(!run) return (b._cnStats=null);
  const known=run.filter(x=>x.rank!=null), charted=run.filter(x=>x.depth!=null);
  if(!known.length) return (b._cnStats={run, charted:charted.length, days:run.length, none:true,
                                        depth:charted.length?Math.max(...charted.map(x=>x.depth)):null});
  const ranks=known.map(x=>x.rank).sort((a,c)=>a-c);
  let peakIdx=-1, peakRank=Infinity;
  run.forEach((x,i)=>{ if(x.rank!=null && x.rank<peakRank){ peakRank=x.rank; peakIdx=i; } });
  return (b._cnStats={run, charted:charted.length, days:run.length, none:false,
    open:known[0].rank, peak:ranks[0], peakDay:peakIdx+1, last:known[known.length-1].rank,
    median:ranks[Math.floor(ranks.length/2)], top10:known.filter(x=>x.rank<=10).length,
    // staying power: days spent inside each tier. Correlates with revenue about as
    // strongly as the peak does (+0.55..+0.86 across games) and is NOT the same thing --
    // it separates "spiked to #8 then died" from "never beat #25 but held three weeks".
    top20:known.filter(x=>x.rank<=20).length, top50:known.filter(x=>x.rank<=50).length});
}
function cnPeers(){
  if(state._cnPeers) return state._cnPeers;
  const out=[];
  for(const p of (state.data.banners||[])){
    if(p._synthetic||p.pending) continue;
    const st=cnRunStats(p);
    if(st&&!st.none) out.push({b:p, st});
  }
  return (state._cnPeers=out);
}
const _med=a=>{ const x=[...a].sort((p,q)=>p-q); return x.length?x[Math.floor(x.length/2)]:null; };
function _place(list, val){            // 1 = best (lowest rank); ties share the better place
  const better=list.filter(v=>v<val).length;
  return {place:better+1, of:list.length};
}
function peerName(x){
  return (x.agents&&x.agents.length) ? x.agents.join(" & ") : (x.en || x.related || bLabel(x));
}
// ---- what game-i's own rank curve says about a run ---------------------------------
// The China block reasons from China's chart; this one reasons from the curve game-i
// publishes for this very banner, in the same market as the yen figure beside it. That
// makes it the stronger comparison of the two -- same source, same measure.
const ordinal = n => { const t=n%100;
  return n + (t>=11&&t<=13 ? "th" : ({1:"st",2:"nd",3:"rd"}[n%10] || "th")); };
// Running total through each day of a run, cached per banner. Same arithmetic
// dailyBreakdown does (cum at i = rev x sum(raw[0..i]) / sum(raw)) without its per-day
// overlap scan, which is O(banners) a day and would run for every peer on a game with
// 200+ of them. For a run still going, game-i's published figure IS the total so far,
// so the last point of this curve is exactly that.
function cumCurve(b){
  if(b._cumCurve!==undefined) return b._cumCurve;
  const s=b.rank_series||[];
  const raw=s.map(rankValue), sum=raw.reduce((a,c)=>a+c,0);
  if(!s.length||sum<=0) return (b._cumCurve=null);
  let run=0;
  return (b._cumCurve=raw.map(v=>{ run+=v; return b.rev*run/sum; }));
}
const cumAtDay=(b,d)=>{ const c=cumCurve(b); return c&&c.length>=d&&d>=1 ? c[d-1] : null; };

function jpRunStats(b){
  if(b._jpStats!==undefined) return b._jpStats;
  const s=b.rank_series||[];
  const known=s.map((v,i)=>[i,v]).filter(([,v])=>v!=null);
  if(!known.length) return (b._jpStats=null);
  const ranks=known.map(([,v])=>v), sorted=[...ranks].sort((a,c)=>a-c);
  const peakDay=known.reduce((a,c)=>c[1]<a[1]?c:a)[0];
  // What the run had banked by its peak. A rank is one day's snapshot; the running total
  // absorbs the rank->yen wobble, so it separates runs that share a peak but not a size.
  const cumPeak=cumAtDay(b, peakDay+1)||0;
  // the day it dropped off game-i's trackable ~top 200 and never came back
  let fellOff=null;
  for(let i=peakDay;i<s.length;i++){
    if(s[i]==null && s.slice(i).every(v=>v==null)){ fellOff=i; break; }
  }
  return (b._jpStats={
    open:known[0][1], peak:Math.min(...ranks), last:known[known.length-1][1],
    median:sorted[Math.floor(sorted.length/2)], days:s.length, charted:known.length,
    top10:ranks.filter(v=>v<=10).length, top20:ranks.filter(v=>v<=20).length,
    top50:ranks.filter(v=>v<=50).length,
    peakDay:peakDay+1, fellOffDay:fellOff==null?null:fellOff+1, cumPeak,
  });
}
function jpPeers(){
  if(state._jpPeers) return state._jpPeers;
  const out=[];
  for(const p of (state.data.banners||[])){
    if(p._synthetic||p.pending||p.ongoing) continue;   // peers must be finished runs
    const st=jpRunStats(p);
    if(st) out.push({b:p, st});
  }
  return (state._jpPeers=out);
}
// ---- money summaries for a set of comparable runs -----------------------------------
// A currency is only summarised when at least 3 of the peers carry it, so the median
// means something. Sensor Tower has NO rank of its own, so it can never be the thing a
// rank comparison is read against -- but it is the only worldwide figure here, so it
// rides along on both the game-i and the China read as a secondary number.
function peerMoney(near){
  const out={};
  const jp=near.map(p=>p.b.rev).filter(v=>v>0);
  if(jp.length) out.jp={lo:Math.min(...jp), hi:Math.max(...jp), md:_med(jp), n:jp.length, f:G, approx:""};
  const stv=near.map(p=>bannerST(p.b)).filter(x=>x.hasData).map(x=>x.total);
  if(stv.length>=3) out.st={lo:Math.min(...stv), hi:Math.max(...stv), md:_med(stv),
                            n:stv.length, f:fmtUSD, approx:"≈"};
  const cnv=near.map(p=>bannerCN(p.b)).filter(x=>x.hasData);
  if(cnv.length>=3){ const mids=cnv.map(cnMid);
    out.cn={lo:Math.min(...mids), hi:Math.max(...mids), md:_med(mids),
            n:cnv.length, f:fmtCNY, approx:"≈", range:fmtCNYRange}; }
  return out;
}
// CN prints its two ends through the shared range formatter so the currency isn't
// repeated three times in one sentence ("CN¥ 226.55 – 370.54M", not "CN¥ x to CN¥ y").
// Pick the runs worth comparing against. Nearest on `keyOf` first, ties broken towards
// the nearest date so a like-for-like era wins. Then drop revenue outliers measured
// against the pool's OWN median: a game's launch banner can peak exactly where an
// ordinary one does and still earn several times as much -- HSR's Seele peaked #3 like
// four later banners and out-earned them about 4x -- and one of those inside a five-run
// median drags the whole read. Falls back to the unfiltered pool when filtering would
// leave too few runs to say anything with.
const PEER_OUTLIER = 3;        // x or / the pool's own median = not the same kind of run
function pickPeers(peers, b, k0, keyOf, n){
  n = n || 5;
  const t0 = Date.parse(b.start);
  const pool = [...peers].sort((p,q) =>
      (Math.abs(keyOf(p)-k0) - Math.abs(keyOf(q)-k0))
   || (Math.abs(Date.parse(p.b.start)-t0) - Math.abs(Date.parse(q.b.start)-t0)))
    .slice(0, n*3);
  const med = _med(pool.map(p=>p.b.rev).filter(v=>v>0));
  const kept = med
    ? pool.filter(p => p.b.rev>0 && p.b.rev <= med*PEER_OUTLIER && p.b.rev >= med/PEER_OUTLIER)
    : pool;
  return (kept.length>=3 ? kept : pool).slice(0, n);
}
// A year's runs as a row of faces, best first, with this one ringed in its own colour.
// This replaces a sentence that was doing the same job in prose -- the point is to SEE
// how many sit ahead of it, not to parse two numbers out of a paragraph. Each face is
// clickable like any other comparable. Items arrive pre-sorted; `label` is what goes
// under each face (a China rank, or what a run had banked by its peak).
// How fast a run is sliding off the chart. Peak alone says how high it got and the
// running total says how big it was; neither says whether it is still holding. Slip is
// places lost per day between the peak and a fixed early checkpoint, which is
// comparable across runs of different lengths -- and readable while a run is live.
const slipOf = (peak, peakDay, rankNow, day) =>
  (rankNow==null || day<=peakDay) ? null : (rankNow-peak)/(day-peakDay);
// a rank of null means it was below the chart that day, which is worse than any number
const OFF_CHART = 200;

function cohortStrip(items, self, label, caption, title){
  if(!items || items.length<3) return "";
  // the rerun badge is the same mark the graph avatars carry -- drawn rather than the
  // glyph, so it is centred identically (see RR_ARC)
  const rr = `<svg class="bm-rr" viewBox="-1.6 -1.6 3.2 3.2" aria-hidden="true"><circle r="1.5"/>`
    + `<path class="rr-arc" d="${RR_ARC}"/><path class="rr-head" d="${RR_HEAD}"/></svg>`;
  const chip=x=>{
    const me = x.b._i===self._i;
    return `<span class="bm-cav${me?" me":""}" data-i="${x.b._i}" style="--av-ring:${barColor(x.b)}"
      title="${esc(peerName(x.b))} — ${label(x)}${x.b.rerun?" · rerun":""}"
      ><span class="pic">${avatarHTML(x.b)}${x.b.rerun?rr:""}</span><span class="lb">${label(x)}</span></span>`;
  };
  return `<div class="bm-cohort">${title?`<span class="bm-cohort-hd">${title}</span>`:""}
    <div class="bm-cavs">${items.map(chip).join("")}</div>
    <div class="bm-cohort-cap">${caption}</div></div>`;
}
const moneySpread = m => (m.range ? `${m.approx}<b>${m.range(m.lo,m.hi)}</b>`
  : `${m.approx}<b>${m.f(m.lo)}</b> to <b>${m.f(m.hi)}</b>`) + `, median <b>${m.f(m.md)}</b>`;
// Both verdicts close the same way, so the wording lives in one place -- otherwise the
// two tabs drift apart as one gets edited. The ST line only appears when ST data exists.
const stScaleNote = m => m.st
  ? ` Sensor Tower's dollars are here for scale only: it publishes <b>no rank</b>, so it can't drive the comparison.` : "";
const ASSOC_NOTE = `Treat it as an association, not a forecast — a rerun can open high and earn little, and a banner that holds a modest rank for weeks can out-earn a spike.`;
const stAside = m => m.st
  ? ` Sensor Tower has ${m.st.n} of them at ≈<b>${fmtUSD(m.st.lo)}</b> to <b>${fmtUSD(m.st.hi)}</b> worldwide, median <b>${fmtUSD(m.st.md)}</b>.` : "";

function jpAnalysisBlock(b){
  const st=jpRunStats(b);
  if(!st) return "";
  const peers=jpPeers().filter(p=>p.b._i!==b._i);
  if(peers.length<3) return "";
  // Ranked on the PEAK, not the opening. game-i snapshots rank at midnight JST, so a
  // banner that went live after the snapshot reads far too low on day 1 -- the peak
  // (usually day 2) is the first honest reading of the same run.
  const ver=hasVersions(state.tag)?versionOf(b):null;
  // Version and year only. All-time lives in cohortLine, which states it WITH a
  // percentile -- having both was the same fact twice under two denominators.
  const kindJP = b.rerun ? "rerun" : "debut";
  const kin = peers.filter(p=>!!p.b.rerun===!!b.rerun);
  const scopes=[];
  if(ver){ const g=kin.filter(p=>versionOf(p.b)===ver).map(p=>p.st.peak);
           if(g.length>=2) scopes.push([ver, _place([...g, st.peak], st.peak)]); }
  const yr=kin.filter(p=>p.b.year===b.year).map(p=>p.st.peak);
  if(yr.length>=2) scopes.push([String(b.year), _place([...yr, st.peak], st.peak)]);
  const scopeLine = scopes.length
    ? ` \u2014 ` + scopes.map(([lab,r])=>`<b>${ordinal(r.place)} of ${r.of}</b> in ${lab}`).join(" \u00b7 ")
      + `, among this game's charted ${kindJP}s`
    : "";

  // same-kind, so "the usual debut" really is a median over debuts
  const sameYear=kin.filter(p=>p.b.year===b.year);
  const base=sameYear.length>=3?sameYear:kin;
  const baseLab=sameYear.length>=3?`in ${b.year}`:"across this game's history";
  const medPeak=_med(base.map(p=>p.st.peak)), medMed=_med(base.map(p=>p.st.median));
  const medTop20=_med(base.map(p=>p.st.top20)), medTop50=_med(base.map(p=>p.st.top50));
  const fellPeers=base.map(p=>p.st.fellOffDay).filter(v=>v!=null);

  // Both tabs now carry the same set of readings; only the units differ. Same-kind
  // cohort (a rerun peaks lower by nature), placement as a rank and a percentile,
  // and what a peak like this has historically been worth.
  const kind = kindJP, cohort = kin;
  let cohortLine = "";
  if(cohort.length>=5){
    const r=_place([...cohort.map(p=>p.st.peak), st.peak], st.peak);
    const band = r.place<=r.of/2
      ? `top <b>${Math.max(1,Math.round(100*r.place/r.of))}%</b>`
      : `bottom <b>${Math.max(1,Math.round(100*(r.of-r.place+1)/r.of))}%</b>`;
    cohortLine = ` Among this game's <b>${r.of}</b> charted ${kind}s that is
      <b>${ordinal(r.place)}</b> \u2014 its ${band}.`;
  }
  let anchorLine = "";
  const anchor = cohort.filter(p=>p.b.rev>0)
    .sort((x,y)=>Math.abs(x.st.peak-st.peak)-Math.abs(y.st.peak-st.peak)).slice(0,7);
  if(anchor.length>=5){
    const revs=anchor.map(p=>p.b.rev);
    anchorLine = ` ${kind[0].toUpperCase()+kind.slice(1)}s peaking near <b>#${st.peak}</b> have
      finished around <span class="fig">${G(_med(revs))}</span>
      (${G(Math.min(...revs))} to ${G(Math.max(...revs))}).`;
  }

  // the fade: how long it held the top 50, and whether it left the chart early
  let fade=`It held the <b>top 20</b> for <b>${st.top20}</b> of its ${st.days} days and the
    <b>top 50</b> for <b>${st.top50}</b>, against <b>${medTop20}</b> and <b>${medTop50}</b>
    for the usual ${kind} ${baseLab}.`;
  if(st.fellOffDay!=null){
    const medFell=fellPeers.length>=3?_med(fellPeers):null;
    const how=medFell==null ? "." :
      st.fellOffDay<medFell*0.7 ? ` \u2014 the usual one lasts to day <b>${medFell}</b>, so this faded <b>much faster</b> than normal.`
      : st.fellOffDay<medFell ? ` \u2014 the usual one lasts to day <b>${medFell}</b>, so this faded <b>faster</b> than normal.`
      : ` \u2014 the usual one lasts to day <b>${medFell}</b>, so that is <b>no faster</b> than normal.`;
    fade+=` It dropped off game-i's trackable top 200 on <b>day ${st.fellOffDay}</b> of ${st.days}${how}`;
  } else if(!b.ongoing){
    fade+=` It never fell off the chart during the run.`;
  }
  // Banked-by-peak only compares like with like when the peaks fall at a similar point:
  // a run that re-spiked to #1 on day 16 has most of its total behind it by then, which
  // says nothing about strength next to a day-2 peak. Say so rather than compare anyway.
  const medCum=_med(base.map(p=>p.st.cumPeak).filter(v=>v>0));
  const medPeakDay=_med(base.map(p=>p.st.peakDay));
  const lateBy = medPeakDay ? st.peakDay-medPeakDay : 0;
  const comparable = medPeakDay ? lateBy<=Math.max(2, medPeakDay) : false;
  const cumLine = !(st.cumPeak>0 && medCum) ? ""
    : comparable
      ? ` By that day it had banked <span class="fig">${G(st.cumPeak)}</span>, against <b>${G(medCum)}</b>
          for the usual ${kind} ${baseLab}.`
      : ` By that day it had banked <span class="fig">${G(st.cumPeak)}</span>, but its peak came on
          <b>day ${st.peakDay}</b> against the usual <b>day ${medPeakDay}</b> for a ${kind} ${baseLab} \u2014 late enough
          that the figure counts most of the run, so it isn't comparable to the <b>${G(medCum)}</b> the
          usual banner had banked at its own peak.`;
  // The year's banners as faces, ordered by what each had BANKED at its own peak rather
  // than by rank: on this tab the money is the published figure and the rank only the
  // shape of it, so banked-by-peak is the better spine. Runs whose peak came far later
  // than usual are left out -- their figure counts most of the run (see cumLine).
  let yearStrip = "";
  const yrJP = peers.filter(p=>p.b.year===b.year && p.st.cumPeak>0
                 && (!medPeakDay || p.st.peakDay-medPeakDay<=Math.max(2, medPeakDay)));
  const n=v=>v===0?"none":`<b>${v}</b>`;
  if(yrJP.length>=2 && st.cumPeak>0 && comparable){
    const hi=yrJP.filter(p=>p.st.cumPeak>st.cumPeak).length, lo=yrJP.length-hi;
    yearStrip = cohortStrip(
      [...yrJP, {b, st}].sort((x,y)=>y.st.cumPeak-x.st.cumPeak), b,
      x=>G(x.st.cumPeak),
      `This game's <b>${yrJP.length+1}</b> banners in ${b.year} by what each had banked at its own
       peak \u2014 ${n(hi)} had more than this one by then, ${n(lo)} the same or less.`,
      "By estimate at its peak");
  }

  // ...and the same year by PEAK RANK. The two answer different questions: the money
  // says how big the run was by its peak, the rank says how high it actually climbed,
  // and a banner can sit high on one and low on the other. No peak-day filter here --
  // a rank is comparable whenever it happened, unlike a running total.
  let rankStrip = "";
  const yrRank = peers.filter(p=>p.b.year===b.year && p.st.peak!=null);
  if(yrRank.length>=2){
    const hi=yrRank.filter(p=>p.st.peak<st.peak).length, lo=yrRank.length-hi;
    rankStrip = cohortStrip(
      [...yrRank, {b, st}].sort((x,y)=>x.st.peak-y.st.peak), b,
      x=>`#${x.st.peak}`,
      `The same <b>${yrRank.length+1}</b> banners by peak rank, best first \u2014 ${n(hi)} peaked
       higher than this one, ${n(lo)} the same or lower.`,
      "By peak rank");
  }

  // where it sat at a fixed early checkpoint, and how fast it got there from its peak
  const chkD = Math.min(7, st.days);
  const rkJP = x => { const r=(x.b.rank_series||[])[chkD-1]; return r==null?OFF_CHART:r; };
  let slipLine = "", mineRank = null;
  if(chkD>=3 && st.days>=3){
    mineRank = rkJP({b, st});
    const mineSlip = slipOf(st.peak, st.peakDay, mineRank, chkD);
    const peerSlips = kin.filter(q=>q.st.days>=chkD)
      .map(q=>slipOf(q.st.peak, q.st.peakDay, rkJP(q), chkD)).filter(v=>v!=null);
    if(mineSlip!=null && peerSlips.length>=5){
      const medSlip=_med(peerSlips);
      const word = mineSlip > medSlip*1.3 ? "<b>falling faster</b> than most"
        : mineSlip < medSlip*0.7 ? "<b>holding better</b> than most"
        : "sliding at about the usual rate";
      slipLine = ` By day ${chkD} it sat at <b>${mineRank>=OFF_CHART?`${OFF_CHART}+`:`#${mineRank}`}</b>,
        about <b>${mineSlip.toFixed(1)}</b> places a day off its peak against <b>${medSlip.toFixed(1)}</b>
        for the usual ${kind} \u2014 ${word}.`;
    }
  }

  const ranLineJP = ` It ran at a median of <span class="fig">#${st.median}</span>${b.ongoing?" so far":""};
    the usual ${kind} ${baseLab} peaks at <b>#${medPeak}</b> and runs at a median of <b>#${medMed}</b>.`;
  // Same order of readings as the China block, so the two tabs read alike.
  const place=`<div class="bm-verdict call"><span class="head">Where this run sits on game-i's chart</span>
    Peaked at <span class="fig">#${st.peak}</span> on day ${st.peakDay}${scopeLine}.${cohortLine}${cumLine}${ranLineJP} ${fade}${slipLine}${anchorLine}
    ${st.peakDay>1?`It opened at <b>#${st.open}</b>, though game-i snapshots rank at midnight JST,
    so a banner that went live after the snapshot reads low on day 1 \u2014 which is why this
    compares on the peak.`:``}
    ${yearStrip}${rankStrip}</div>`;

  // While a run is still going, the sharpest comparison is at the SAME elapsed day: what
  // had each peer banked by day D, and what did it finish at? Two banners can share a
  // peak rank and be nowhere near each other in money -- Aventurine peaked #3 with \u00a5231M
  // banked, Robin peaked #2 with \u00a5350M -- so once there is a running total to compare,
  // that total is the better basis. Peak stays the basis for finished runs, where the
  // whole curve is known and the final figure is the thing being compared anyway.
  const D=st.days;
  const sameDay=peers.filter(p=>cumAtDay(p.b,D)!=null && p.b.rev>0);
  const onCum = b.ongoing && D>=2 && b.rev>0 && sameDay.length>=5;
  const near = onCum ? pickPeers(sameDay, b, b.rev, p=>cumAtDay(p.b,D))
                     : pickPeers(peers, b, st.peak, p=>p.st.peak);
  // one row, shared by the two peer lists below so their look can't drift apart
  const peerRow=(p, sub)=>{
    const stv=bannerST(p.b), cnv=bannerCN(p.b);
    const figs=[`<span class="main">${G(p.b.rev)}</span>`];
    if(stv.hasData) figs.push(`<span>ST \u2248${fmtUSD(stv.total)}</span>`);
    if(cnv.hasData) figs.push(`<span>CN \u2248${fmtCNYRange(cnv.lo,cnv.hi)}</span>`);
    return `<div class="bm-peer" data-i="${p.b._i}" title="Open ${esc(peerName(p.b))}" style="--av-ring:${barColor(p.b)}">
      <span class="av">${avatarHTML(p.b)}</span>
      <span class="who"><span class="nm">${esc(peerName(p.b))}</span>
        <span class="sub">${sub}</span></span>
      <span class="figs">${figs.join("")}</span></div>`;
  };
  const rows=near.map(p=>{
    const atD=onCum?cumAtDay(p.b,D):null;
    const sub = onCum
      ? `${G(atD)} by day ${D} \u00b7 finished ${G(p.b.rev)} \u00b7 peak #${p.st.peak} \u00b7 ${per(p.b.start)}${p.b.rerun?" \u00b7 rerun":""}`
      : `peak #${p.st.peak} on day ${p.st.peakDay}${p.st.cumPeak>0?` \u00b7 ${G(p.st.cumPeak)} by then`:""} \u00b7 opened #${p.st.open} \u00b7 ${per(p.b.start)}${p.b.rerun?" \u00b7 rerun":""}`;
    return peerRow(p, sub);
  }).join("");

  // The same list again, keyed on the chart instead of the money: who else was sitting
  // where this run sits at the same point in its own run, and what did they go on to
  // earn? Picked the same way as the list above, so the two read as a pair.
  const rkLab=v=>v>=OFF_CHART?`${OFF_CHART}+`:`#${v}`;
  let dayList="";
  if(mineRank!=null){
    const dNear=pickPeers(peers.filter(p=>p.st.days>=chkD && p.b.rev>0), b, mineRank, rkJP);
    if(dNear.length>=3) dayList=`<h3>Banners at a similar rank by day ${chkD}</h3>
      <div class="bm-peerlist">${dNear.map(p=>{
        return peerRow(p, `${rkLab(rkJP(p))} by day ${chkD} \u00b7 peak #${p.st.peak}
          \u00b7 finished ${G(p.b.rev)} \u00b7 ${per(p.b.start)}${p.b.rerun?" \u00b7 rerun":""}`);
      }).join("")}</div>`;
  }

  const money=peerMoney(near), J=money.jp, md=J.md, mineST=bannerST(b);
  const ownST=mineST.hasData?`, Sensor Tower's share of those months at <span class="fig">\u2248${fmtUSD(mineST.total)}</span>`:"";
  const daysLeft=b.ongoing
    ? Math.max(0, Math.ceil((Date.parse(b.end+"T23:59:59")-Date.now())/864e5)) : 0;
  let head, body;
  if(!b.ongoing){
    const diff=b.rev/md, word=diff>=1.25?"well above":diff>=1.05?"above":diff<=0.75?"well below":diff<=0.95?"below":"in line with";
    head="How it turned out";
    body=`game-i puts this run at <span class="fig">${G(b.rev)}</span>${ownST}. The ${near.length} banners that peaked nearest <b>#${st.peak}</b> earned ${moneySpread(J)} \u2014 it landed <b>${word}</b> the peaks it resembles.${stAside(money)}`;
  } else if(daysLeft<3){
    head="Almost done";
    body=`This run ends in <b>${daysLeft}</b> day${daysLeft===1?"":"s"}, so game-i's figure \u2014 <span class="fig">${G(b.rev)}</span> so far \u2014 is all but final${ownST}. No estimate needed now.`;
  } else if(st.charted>=5 || (onCum && st.charted>=2)){
    head="Tracking towards";
    // Each peer's final divided by what it had banked by this same day is the multiple
    // still to come. Applying the median of those to this run's own total so far gives a
    // landing figure that moves every day as the total does -- the rank-peer median
    // never did, it only ever said "banners like this one ended around here".
    const mult=onCum ? near.map(p=>p.b.rev/cumAtDay(p.b,D)).filter(v=>v>0&&isFinite(v)) : [];
    if(mult.length>=3){
      const lo=b.rev*Math.min(...mult), hi=b.rev*Math.max(...mult), mid=b.rev*_med(mult);
      const atD=near.map(p=>cumAtDay(p.b,D));
      body=`<b>${st.charted}</b> charted day${st.charted===1?"":"s"} in, <b>${daysLeft}</b> left, at <span class="fig">${G(b.rev)}</span> so far${ownST}.
        The ${near.length} runs closest to it at this same point had banked <b>${G(Math.min(...atD))}</b> to <b>${G(Math.max(...atD))}</b>
        by day ${D}, and went on to multiply that by a median <b>${_med(mult).toFixed(2)}\u00d7</b> \u2014 which puts this one near
        <span class="fig">${G(mid)}</span>, somewhere between <b>${G(lo)}</b> and <b>${G(hi)}</b>.${stAside(money)}`;
    } else {
      body=`<b>${st.charted}</b> charted day${st.charted===1?"":"s"} in, <b>${daysLeft}</b> left, at <span class="fig">${G(b.rev)}</span> so far${ownST}. Banners that peaked nearest <b>#${st.peak}</b> finished at ${moneySpread(J)} \u2014 if this one follows them it ends around that middle.${stAside(money)}`;
    }
  } else {
    head="Too early to call";
    body=`Only <b>${st.charted}</b> charted day${st.charted===1?"":"s"} so far. ${onCum?"Runs at a similar total":"Comparable peaks"} ended anywhere in ${moneySpread(J)} \u2014 too wide to read yet.${stAside(money)}`;
  }
  const verdict=`<div class="bm-verdict"><span class="head">${head}</span>${body}
    <span class="after">Rank and revenue here come from the <b>same source and the same market</b> \u2014 game-i's rank beside game-i's yen, over ${near.length} comparable runs \u2014 which makes this the tighter of the two reads.${stScaleNote(money)} ${ASSOC_NOTE}</span></div>`;

  return `<h3>How this run compares</h3>${place}
    <h3>${onCum?`Banners at a similar total by day ${D}`:`Banners that peaked around #${st.peak}`}</h3>
    <div class="bm-peerlist">${rows}</div>${dayList}${verdict}`;
}

// The comparables and the one judgement call: is a projection still worth making? Once a
// run is over -- or within a couple of days of over -- game-i's own figure is all but
// final, so guessing at it from China's chart adds nothing.
function cnRead(b){
  const st=cnRunStats(b);
  if(!st || st.none) return null;
  const peers=cnPeers().filter(p=>p.b._i!==b._i);
  if(peers.length<3) return null;
  const near=[...peers].sort((p,q)=>Math.abs(p.st.open-st.open)-Math.abs(q.st.open-st.open)).slice(0,5);
  const revs=near.map(p=>p.b.rev).filter(v=>v>0);
  // a run includes its end day, so "days left" counts today through b.end
  const daysLeft=b.ongoing
    ? Math.max(0, Math.ceil((Date.parse(b.end+"T23:59:59")-Date.now())/864e5)) : 0;
  return {st, peers, near, lo:Math.min(...revs), hi:Math.max(...revs), md:_med(revs),
          daysLeft, estimable:b.ongoing && daysLeft>=3};
}
function cnAnalysisBlock(b){
  const st=cnRunStats(b);
  if(!st||st.none) return "";
  const peers=cnPeers().filter(p=>p.b._i!==b._i);
  if(peers.length<3) return "";        // nothing to compare against yet
  const ver=hasVersions(state.tag)?versionOf(b):null;
  // What the rank MEANS, not just where it lands. Norms are wildly game-specific --
  // a #20 debut peak is the bottom 11% for HSR (median #6) and better than anything
  // Umamusume has ever charted (median #114) -- so every comparison here is against
  // THIS game's own runs, and only against runs of the same kind: a rerun peaks lower
  // by nature, so pooling the two flatters a weak debut. Finished runs only, since an
  // ongoing one's peak can still improve.
  const kind = b.rerun ? "rerun" : "debut";
  const cohort = peers.filter(p=>!!p.b.rerun===!!b.rerun && !p.b.ongoing);
  const pk = st.peak;

  // the same placement scopes the game-i tab shows: version, year, all-time
  const scopes=[];
  if(ver){ const g=cohort.filter(p=>versionOf(p.b)===ver).map(p=>p.st.peak);
           if(g.length>=2) scopes.push([`${ver}`, _place([...g, st.peak], st.peak)]); }
  const yrS=cohort.filter(p=>p.b.year===b.year).map(p=>p.st.peak);
  if(yrS.length>=2) scopes.push([`${b.year}`, _place([...yrS, st.peak], st.peak)]);
  const scopeLine = scopes.length
    ? ` — ` + scopes.map(([lab,r])=>`<b>${ordinal(r.place)} of ${r.of}</b> in ${lab}`).join(" \u00b7 ")
      + `, among this game's charted ${kind}s`
    : "";

  // and the same "how it ran" line: its median against the usual peak and median
  const sameYearCN = cohort.filter(p=>p.b.year===b.year);
  const baseCN = sameYearCN.length>=3?sameYearCN:cohort;
  const baseLabCN = sameYearCN.length>=3?`in ${b.year}`:"across this game's history";
  const medPeakCN=_med(baseCN.map(p=>p.st.peak)), medMedCN=_med(baseCN.map(p=>p.st.median));
  const ranLine = baseCN.length>=3
    ? ` It ran at a median of <span class="fig">#${st.median}</span>${b.ongoing?" so far":""};
       the usual ${kind} ${baseLabCN} peaks at <b>#${medPeakCN}</b> and runs at a median of
       <b>#${medMedCN}</b>.` : "";

  let rankLine = "", yearStrip = "";
  if(cohort.length>=5){
    const r=_place([...cohort.map(p=>p.st.peak), pk], pk);
    const half = r.place<=r.of/2;
    const band = half ? `top <b>${Math.max(1,Math.round(100*r.place/r.of))}%</b>`
                      : `bottom <b>${Math.max(1,Math.round(100*(r.of-r.place+1)/r.of))}%</b>`;
    rankLine = ` Among this game's <b>${r.of}</b> charted ${kind}s that is <b>${ordinal(r.place)}</b> — its ${band}.`;
  }

  // The strip shows the year's WHOLE slate, debuts and reruns together, with reruns
  // badged: the prose above is scored same-kind, but the row is meant to be the year
  // at a glance, and hiding half of it made it a worse picture of the year.
  const yrAll = peers.filter(p=>p.b.year===b.year && !p.b.ongoing);
  if(yrAll.length>=2){
    const hi=yrAll.filter(p=>p.st.peak<pk).length, lo=yrAll.length-hi;
    const n=v=>v===0?"none":`<b>${v}</b>`;
    yearStrip = cohortStrip(
      [...yrAll, {b, st}].sort((x,y)=>x.st.peak-y.st.peak), b,
      x=>`#${x.st.peak}`,
      `This game's <b>${yrAll.length+1}</b> banners in ${b.year}, best peak first —
       ${n(hi)} peaked higher than this one, ${n(lo)} the same or lower.`,
      "By peak rank");
  }

  // second axis: how long it held, not just how high it got
  let holdLine = "";
  if(cohort.length>=5){
    const m20=_med(cohort.map(p=>p.st.top20)), m50=_med(cohort.map(p=>p.st.top50));
    const hiPeak = pk <= _med(cohort.map(p=>p.st.peak));
    const held  = st.top50 >= m50;
    const read = hiPeak && held ? "it both peaked better and held longer than the usual one"
      : hiPeak && !held ? "it peaked better than most but faded earlier — a short, sharp run"
      : !hiPeak && held ? "it never peaked as high, but it held on longer than most"
      : "it neither climbed as high nor lasted as long as the usual one";
    holdLine = ` It held the <b>top 20</b> for <b>${st.top20}</b> of its ${st.days} days and the
      <b>top 50</b> for <b>${st.top50}</b>, against <b>${m20}</b> and <b>${m50}</b> for the usual
      ${kind} — ${read}.`;
  }

  // where it sat at a fixed early checkpoint, and how fast it got there from its peak
  const chkD = Math.min(7, st.days);
  const rkCN = x => { const r=(x.st.run||[])[chkD-1]; const v=r?r.rank:null; return v==null?OFF_CHART:v; };
  let slipLine = "", mineRank = null;
  if(chkD>=3 && st.days>=3){
    mineRank = rkCN({b, st});
    const mineSlip = slipOf(pk, st.peakDay, mineRank, chkD);
    const peerSlips = cohort.filter(q=>q.st.days>=chkD)
      .map(q=>slipOf(q.st.peak, q.st.peakDay, rkCN(q), chkD)).filter(v=>v!=null);
    if(mineSlip!=null && peerSlips.length>=5){
      const medSlip=_med(peerSlips);
      const word = mineSlip > medSlip*1.3 ? "<b>falling faster</b> than most"
        : mineSlip < medSlip*0.7 ? "<b>holding better</b> than most"
        : "sliding at about the usual rate";
      slipLine = ` By day ${chkD} it sat at <b>${mineRank>=OFF_CHART?`${OFF_CHART}+`:`#${mineRank}`}</b>,
        about <b>${mineSlip.toFixed(1)}</b> places a day off its peak against <b>${medSlip.toFixed(1)}</b>
        for the usual ${kind} — ${word}.`;
    }
  }

  // what a peak like this has historically been worth, same game, same kind
  let anchorLine = "";
  const anchor = cohort.filter(p=>p.b.rev>0)
    .sort((x,y)=>Math.abs(x.st.peak-pk)-Math.abs(y.st.peak-pk)).slice(0,7);
  if(anchor.length>=5){
    const revs=anchor.map(p=>p.b.rev);
    anchorLine = ` ${kind[0].toUpperCase()+kind.slice(1)}s peaking near <b>#${pk}</b> have finished around
      <span class="fig">${G(_med(revs))}</span> (${G(Math.min(...revs))} to ${G(Math.max(...revs))}).`;
  }

  const place=`<div class="bm-verdict call"><span class="head">Where this run sits on China's chart</span>
    Peaked at <span class="fig">#${pk}</span> on day ${st.peakDay}${scopeLine}.${rankLine}${ranLine}${holdLine}${slipLine}${anchorLine}
    ${st.peakDay>1?`It opened at <b>#${st.open}</b>, but an opening day is the least reliable reading
    of a run, so the comparison keys on the peak.`:``}
    ${yearStrip}
    <span class="after">#1 here is the whole Chinese App Store, not just games, so these ranks sit
    against Douyin and WeChat as well. Across every game we hold, where a run peaks tracks what it
    earns — which is why the chart position is worth reading and not just the money. Norms are
    per-game though: a #20 peak is near the bottom for this game's ${kind}s in some years and near
    the top in others, so the comparison above is always against this game alone.</span></div>`;

  // the closest peaks this game has had, with every revenue figure that exists for them
  const near=pickPeers(peers, b, st.peak, p=>p.st.peak);
  // A China rank has to be read against CHINA's revenue -- setting it beside game-i's yen
  // is an association across two markets, which is exactly what this block should avoid.
  // Yen is only the fallback when too few comparable runs carry a CN figure to median.
  const money=peerMoney(near), cnPrimary=!!money.cn, P=money.cn||money.jp;
  // one row, shared by the two peer lists below so their look can't drift apart
  const peerRow=(p, sub)=>{
    const stv=bannerST(p.b), cnv=bannerCN(p.b);
    const figs=[];
    figs.push(cnPrimary&&cnv.hasData
      ? `<span class="main">≈${fmtCNYRange(cnv.lo,cnv.hi)}</span>`
      : `<span class="main">${G(p.b.rev)}</span>`);
    if(stv.hasData) figs.push(`<span>ST ≈${fmtUSD(stv.total)}</span>`);
    if(cnPrimary&&cnv.hasData) figs.push(`<span>game-i ${G(p.b.rev)}</span>`);
    else if(cnv.hasData) figs.push(`<span>CN ≈${fmtCNYRange(cnv.lo,cnv.hi)}</span>`);
    return `<div class="bm-peer" data-i="${p.b._i}" title="Open ${esc(peerName(p.b))}" style="--av-ring:${barColor(p.b)}">
      <span class="av">${avatarHTML(p.b)}</span>
      <span class="who"><span class="nm">${esc(peerName(p.b))}</span>
        <span class="sub">${sub}</span></span>
      <span class="figs">${figs.join("")}</span></div>`;
  };
  const rows=near.map(p=>peerRow(p,
    `peak #${p.st.peak} on day ${p.st.peakDay} · opened #${p.st.open} · ${per(p.b.start)}${p.b.rerun?" · rerun":""}`)).join("");

  // The same list again, keyed on where each run sat at a fixed early day rather than on
  // its peak -- who else was where this one is at the same point, and what did they earn?
  const rkLabCN=v=>v>=OFF_CHART?`${OFF_CHART}+`:`#${v}`;
  let dayList="";
  if(mineRank!=null){
    const dNear=pickPeers(peers.filter(q=>q.st.days>=chkD && q.b.rev>0), b, mineRank, rkCN);
    if(dNear.length>=3) dayList=`<h3>Banners at a similar rank by day ${chkD}</h3>
      <div class="bm-peerlist">${dNear.map(q=>{
        return peerRow(q, `${rkLabCN(rkCN(q))} by day ${chkD} · peak #${q.st.peak} on day ${q.st.peakDay}
          · opened #${q.st.open} · ${per(q.b.start)}${q.b.rerun?" · rerun":""}`);
      }).join("")}</div>`;
  }

  // the read, decided by how much of this run is actually known
  const mine=bannerST(b), mineCN=bannerCN(b);
  // Only read this run's CN total against CN peers when its OWN months are all in --
  // a partial total (the newest months aren't published yet) would land "well below"
  // peers for a reason that has nothing to do with how the banner did.
  const ownCN=cnPrimary && mineCN.hasData && !mineCN.partial;
  const PV=ownCN?P:(money.jp||P), md=PV.md;
  const ownName=ownCN?"the CN ranking":"game-i";
  const ownFig=ownCN?`≈${fmtCNYRange(mineCN.lo,mineCN.hi)}`:G(b.rev);
  const ownST=mine.hasData?`, Sensor Tower's share of those months at <span class="fig">≈${fmtUSD(mine.total)}</span>`:"";
  const ownJP=ownCN?`, game-i at <span class="fig">${G(b.rev)}</span>`
    : (mineCN.hasData?`, the CN ranking at <span class="fig">≈${fmtCNYRange(mineCN.lo,mineCN.hi)}</span> across the ${mineCN.covered} of its ${mineCN.covered+mineCN.missing} months China has published`:"");
  const read=cnRead(b), daysLeft=read?read.daysLeft:0;
  let head, body;
  if(!b.ongoing){
    const diff=(ownCN?cnMid(mineCN):b.rev)/md;
    const word=diff>=1.25?"well above":diff>=1.05?"above":diff<=0.75?"well below":diff<=0.95?"below":"in line with";
    head="How it turned out";
    body=`This run is finished: ${ownName} puts it at <span class="fig">${ownFig}</span>${ownST}${ownJP}`
      + `. The ${near.length} banners that peaked nearest <b>#${st.peak}</b> earned ${moneySpread(PV)}, so it landed <b>${word}</b> the peaks it resembles.${stAside(money)}`;
  } else if(!read || !read.estimable){
    head="Almost done";
    body=`This run ends in <b>${daysLeft}</b> day${daysLeft===1?"":"s"}, so ${ownName}'s own figure — <span class="fig">${ownFig}</span> so far — is all but final${ownST}. No estimate here: the comparison above is the useful part, and the finished number arrives on its own.`;
  } else if(st.charted>=7){
    head="What it is tracking towards";
    body=`Still running, <b>${st.charted}</b> charted day${st.charted>1?"s":""} in, with ${ownName} at <span class="fig">${ownFig}</span> so far${ownST}. Banners that peaked nearest <b>#${st.peak}</b> finished at ${moneySpread(PV)} — if this one follows them it ends around that middle.${stAside(money)}`;
  } else {
    head="Too early to call";
    body=`Only <b>${st.charted}</b> charted day${st.charted>1?"s":""} so far. Banners that peaked nearest <b>#${st.peak}</b> ended anywhere in ${moneySpread(PV)} — a spread too wide to read anything into yet. It firms up as the run goes.${stAside(money)}`;
  }
  const why=!money.cn ? "Too few comparable runs carry a China figure"
    : !mineCN.hasData ? "This run has no China figure of its own"
    : "This run's China total covers only part of its months";
  const frame=ownCN
    ? `Rank and revenue here both come from China — its chart set beside its own revenue, over ${near.length} comparable runs — so this read stays in <b>one market</b>.`
    : `${why}, so this read falls back to Japanese revenue: a China rank set against yen, <b>across two markets</b>, over ${near.length} runs — looser than the game-i tab's own comparison.`;
  const verdict=`<div class="bm-verdict"><span class="head">${head}</span>${body}
    <span class="after">${frame}${stScaleNote(money)} ${ASSOC_NOTE}</span></div>`;

  return `<h3>How this run compares</h3>${place}
    <h3>Banners that peaked around #${st.peak}</h3>
    <div class="bm-peerlist">${rows}</div>${dayList}${verdict}`;
}
// Day-by-day rank as a table. The chart can only draw days the game was INSIDE the top
// 200 -- once it falls off, the line just stops and those days vanish. Here they stay
// visible as rows, so falling off the chart reads as an event rather than a gap. Three
// states: a rank, "200+" (the chart is known, the game wasn't in it) and "no data" (no
// source holds that day at all). No revenue columns -- China publishes a monthly total,
// never a daily one, so there is no per-day build-up to show the way game-i's tab does.
function cnRankTable(run){
  if(!run||!run.length) return "";
  const md=iso=>`${+iso.slice(5,7)}/${+iso.slice(8,10)}`;
  const cell=x=>`<tr>
    <td class="l">${md(x.iso)}</td>
    <td>${x.rank!=null ? "#"+x.rank
        : x.depth!=null ? `<span class="muted">${x.depth}+</span>`
        : `<span class="muted">no data</span>`}</td></tr>`;
  // Only two narrow columns, so one full-width table leaves a canyon between the date
  // and the rank. Deal the run into a few side-by-side tables instead: each stays
  // compact, the width is used, and a long run stops being a tall scroller. Each
  // column keeps its own header, so it reads correctly wherever the eye lands.
  const cols=Math.min(3, Math.max(1, Math.ceil(run.length/8)));
  const per=Math.ceil(run.length/cols);
  const tables=[];
  // each column is wrapped: a table with border-collapse:collapse IGNORES its own
  // padding, so the divider has to sit on a wrapper or the row rules run into it
  for(let i=0;i<run.length;i+=per)
    tables.push(`<div class="bm-rtcol"><table class="bm-table">
      <thead><tr><th class="l">Date</th><th>Rank</th></tr></thead>
      <tbody>${run.slice(i,i+per).map(cell).join("")}</tbody></table></div>`);
  return `<div class="bm-tablewrap bm-rtcols">${tables.join("")}</div>`;
}
function cnRankBlock(b, noTable){
  const tbl=run=>noTable?"":cnRankTable(run);
  const head=`<h3>Daily China iOS rank during the run</h3>`;
  const run=cnRunSeries(b);
  if(!run) return head+`<p class="bm-note">No source holds a single day of this run. China's chart is captured daily from <b>Aug 2026</b> on; earlier days exist only where an archive kept them, and the rest are still being collected a few at a time. See <b>How these numbers work → China iOS chart</b>.</p>`;
  const known=run.filter(x=>x.rank!=null), charted=run.filter(x=>x.depth!=null);
  const srcs=[...new Set(charted.map(x=>x.src))].map(s=>(state.cnrank.sources||{})[s]?s:s);
  const depths=charted.map(x=>x.depth);
  const cover=`Held for <b>${charted.length}</b> of the run's ${run.length} day${run.length>1?"s":""}`
    +(depths.length?`, ${Math.min(...depths)===Math.max(...depths)?`<b>${depths[0]}</b> deep`:`<b>${Math.min(...depths)}–${Math.max(...depths)}</b> deep`}`:"")
    +` (${srcs.join(", ")}).`;
  if(!known.length)
    return head+`<p class="bm-note">${cover} The game sat <b>below</b> the chart's depth on every one of them — on China's all-apps chart it never entered the top ${Math.max(...depths)} during this run.</p>${tbl(run)}`;
  const first=known[0].rank, last=known[known.length-1].rank, best=Math.min(...known.map(x=>x.rank));
  const cap=`Opened at <b>#${first}</b>, peaked at <b>#${best}</b>, last seen at <b>#${last}</b>.`;
  return head+`<div class="bm-cap">${cap}</div>${cnRankSVG(run,b)}${tbl(run)}
    <p class="bm-note">#1 is the top of China's App Store <b>all-apps</b> top-grossing chart — games compete with Douyin, WeChat and the video apps, so climbing it means out-earning them. ${cover} Ticks along the bottom are days the chart is known but the game wasn't in it, meaning it ranked below that depth; blank stretches are days no source has. This is the <b>real store chart</b>, not an estimate.</p>`;
}
function cnShareBlock(b){
  const sh=b._share, cn=bannerCN(b);
  if(!sh || !sh.on || !cn.hasData) return "";
  const shLo=cn.lo*sh.revFrac, shHi=cn.hi*sh.revFrac;
  return `<h3>Shared with concurrent banners</h3>
    <p class="bm-note">The CN figure inherits game-i's daily split — revenue on days two or more banners ran is divided equally between them. This one overlapped <b>${sh.with.length}</b> other banner${sh.with.length>1?"s":""} on <b>${sh.days}</b> of its ${sh.totalDays} days (up to a <b>${sh.maxN}-way</b> split), so the same <b>${Math.round(sh.revFrac*100)}%</b> of its CN total falls in shared days.</p>
    <div class="bm-stats bm-share3">
      <div class="bm-stat"><span class="l">On its own</span><span class="v">≈${fmtCNYRange(cn.lo-shLo,cn.hi-shHi)}</span></div>
      <div class="bm-stat"><span class="l">While shared</span><span class="v">≈${fmtCNYRange(shLo,shHi)}</span></div>
      <div class="bm-stat sum"><span class="l">Total${cn.partial?" so far":""}</span><span class="v">≈${fmtCNYRange(cn.lo,cn.hi)}</span></div>
    </div>
    ${alongsideChips(sh)}`;
}
// The CN tab: China's real store chart first, then the same month-by-month arithmetic
// the Sensor Tower tab lays out -- same cards, same bar, same "shared the month with"
// chips -- with the range kept intact and the metric labelled per month, so a run that
// straddles the Nov 2023 basis change is obvious rather than silently averaged.
function bannerCNView(b){
  const cn=bannerCN(b), bm=state.monthly||{}, c=barColor(b);
  const head=`<h3>CN ranking — assumed global all-platform revenue</h3>`;
  const how=`<p class="bm-note bm-recon">The CN series publishes only <b>${esc(gameName())}</b>'s <b>monthly total</b>, not per-banner. We assume this banner took the same <b>slice</b> of that month as it did of the month itself — a slice read from <b>two daily sources</b>, game-i's Japan split and Qimai's China-iPhone split, <b>averaged where both exist</b> (game-i alone otherwise) — then add those slices across every month it ran. That total is <b>global and all-platform</b> (mobile + PC + PlayStation) while both daily sources are <b>mobile</b>, so the slice is a rougher proxy here than on the Sensor Tower tab — read it as scale and trend, never as sales.</p>`;
  const na=`<span class="muted">n/a</span>`;
  if(!cn.hasData){
    const blank=[[`Est. revenue`, na], ["All-time rank (CN¥)", na], [`${b.year} rank (CN¥)`, na],
                 ["Covered months", `0${cn.missing?` <span class="muted" style="font-size:12px">/ ${cn.missing}</span>`:""}`]]
      .map(([l,v])=>tileHTML(l,v)).join("");
    return `<div class="bm-stats">${blank}</div>`+head+how
      + `<p class="bm-note"><b>No CN month covers this run.</b> The monthly series starts <b>Nov 2021</b>, and the newest month only appears once that month's video is up.</p>`
      + cnRankBlock(b)+cnAnalysisBlock(b);
  }
  const months=cn.covered+cn.missing;
  const headline=`<div class="bm-headline">
    <span><span class="l">Est. revenue${cn.partial?" so far":""}</span><div class="v">≈${fmtCNYRange(cn.lo,cn.hi)}</div></span>
    <span class="sub">${cn.covered} of ${months} month${months>1?"s":""} covered · yuan, global, all platforms</span></div>`;
  const r=cnRankInfo(b);
  const tiles=[
    [`Est. revenue${b.ongoing?" so far":cn.partial?" (so far)":""}`, `≈${fmtCNYRange(cn.lo,cn.hi)}`],
    ["All-time rank (CN¥)", `#${r.cum} / ${r.cumtot}`],
    [`${b.year} rank (CN¥)`, `#${r.yrank} / ${r.ytot}`],
    ["Covered months", `${cn.covered}${cn.missing?` <span class="muted" style="font-size:12px">/ ${months}</span>`:""}`],
  ].map(([l,v])=>tileHTML(l,v)).join("");
  const rows=cn.months.map(m=>{
    const lab=`${MONTHS[+m.ym.slice(5,7)-1]} ${m.ym.slice(0,4)}`;
    const co=((bm[m.ym]&&bm[m.ym].banners)||[]).filter(x=>x.i!==b._i && x.rev>0.001)
      .sort((a,d)=>d.rev-a.rev).map(x=>{ const ob=state.data.banners[x.i];
        return `<span class="bm-cochip" style="--av-ring:${barColor(ob)}"><span class="bm-coav">${avatarHTML(ob)}</span>${esc(x.name)}</span>`; });
    const coStr = co.length ? co.join("") : `<span class="muted">ran solo this month</span>`;
    const pct=Math.round(m.share*100);
    const tag=m.metric?` <span class="bm-stm-tag">${esc(m.metric)}</span>`:"";
    if(m.cnLo==null){
      return `<div class="bm-stm">
        <div class="bm-stm-top"><span class="mo">${lab}</span><span class="v muted" title="This month isn't in the CN series yet">no CN figure</span></div>
        <div class="bm-stm-math">${shareMath(m)} of the month — the CN figure lands once that month's video is up.</div>
        <div class="bm-stm-co"><span class="bm-co-l">Shared the month with</span> ${coStr}</div></div>`;
    }
    return `<div class="bm-stm">
      <div class="bm-stm-top"><span class="mo">${lab}${tag}</span><span class="v">≈${fmtCNYRange(m.contribLo,m.contribHi)}</span></div>
      <div class="bm-stm-mbar"><span class="bm-stm-mfill" style="width:${Math.max(2,m.share*100).toFixed(1)}%;background:${c}"></span></div>
      <div class="bm-stm-math">${shareMath(m)} × <b>${fmtCNYRange(m.cnLo,m.cnHi)}</b> ⟶ <b>≈${fmtCNYRange(m.contribLo,m.contribHi)}</b>${m.mihoyo?` <span class="bm-stm-note">支付中心 excluded</span>`:""}</div>
      <div class="bm-stm-co"><span class="bm-co-l">Shared the month with</span> ${coStr}</div></div>`;
  }).join("");
  const mixWarn = cn.mixed ? `<p class="bm-note bm-warn">This run spans the <b>Nov 2023</b> change from <b>总收入</b> (normally net of the store cut) to <b>总流水</b> (gross billings). The months below are on two different bases and the total mixes them — read the per-month rows, not the sum.</p>` : "";
  const partWarn = cn.partial ? `<p class="bm-note"><b>Partial run.</b> The series covers <b>${cn.covered}</b> of the <b>${cn.covered+cn.missing}</b> months this banner ran, so the total counts only those and grows as later months are published.</p>` : "";
  return `<div class="bm-stats">${tiles}</div>`
    + head+how+headline+mixWarn+partWarn+`<div class="bm-stmlist">${rows}</div>`+cnShareBlock(b)
    + cnRankBlock(b)+cnAnalysisBlock(b);
}
// A KPI tile. A CN range is half again as long as a yen figure, so anything long enough
// to wrap gets a smaller size rather than breaking across lines mid-number.
function tileHTML(label, value){
  const plain=String(value).replace(/<[^>]*>/g,"");
  return `<div class="bm-stat"><span class="l">${label}</span>`
       + `<span class="v${plain.length>14?" long":""}">${value}</span></div>`;
}
function bannerSTView(b){
  const st=bannerST(b), na=`<span class="muted">n/a</span>`;
  const r=st.hasData?stRankInfo(b):null;
  const tiles=[
    [`Est. revenue${b.ongoing?" so far":st.partial?" (so far)":""}`, st.hasData?`≈${fmtUSD(st.total)}`:na],
    ["All-time rank ($)", r?`#${r.cum} / ${r.cumtot}`:na],
    [`${b.year} rank ($)`, r?`#${r.yrank} / ${r.ytot}`:na],
    ["Covered months", st.hasData?`${st.covered}${st.missing?` <span class="muted" style="font-size:12px">/ ${st.covered+st.missing}</span>`:""}`:na],
  ].map(([l,v])=>tileHTML(l,v)).join("");
  return `<div class="bm-stats">${tiles}</div>${bannerSTBlock(b)}${bannerSTShareBlock(b)}`;
}
// Qimai tab: China iPhone gross revenue (USD), a DAILY source so it is a direct
// per-banner total (summed over the run, concurrent days split like game-i) — no
// monthly-share guess. Shows the total and its month-by-month make-up.
function bannerQimaiView(b){
  const qm=bannerQimai(b), na=`<span class="muted">n/a</span>`, r=qm.hasData?qimaiRankInfo(b):null;
  const scheduled=Math.round((Date.parse(b.end)-Date.parse(b.start))/864e5)+1;
  const lead=cnLead(state.tag);   // China server runs this many days ahead of game-i's global dates
  const offWarn = lead ? `<p class="bm-note bm-warn">⚠ <b>${esc(gameName())}'s China server runs ${lead} days ahead of the global/JP schedule.</b> game-i tracks the global banner dates, so everything below is re-aligned onto this banner's <b>actual China run</b> (~${lead} days earlier): the dates on the chart and table are the China ones and won't match the game-i banner window, and the China total is this banner's real China performance — not whatever was selling globally on the same calendar days.</p>` : "";
  const tiles=[
    [`Est. revenue${b.ongoing?" so far":""}`, qm.hasData?fmtUSD(qm.total):na],
    ["All-time rank ($)", r?`#${r.rank} / ${r.of}`:na],
    [`${b.year} rank ($)`, r?`#${r.yrank} / ${r.yof}`:na],
    ["Run length", b.ongoing?`Day ${Math.min(scheduled,qm.daily.length||1)} of ${scheduled}`:`${scheduled} days`],
  ].map(([l,v])=>tileHTML(l,v)).join("");
  const head=`<h3>Qimai — estimated China iPhone revenue</h3>
    <p class="bm-note">Qimai's <b>daily</b> China App&nbsp;Store <b>gross</b> estimate (USD), summed over this run. On days this banner shared the store with a concurrent one, that day's China total is split between them by game-i's daily shape. <b>China iOS only</b> — a small slice, not comparable to game-i (Japan), Sensor&nbsp;Tower (worldwide) or CN (all platforms). See <b>How these numbers work → Qimai</b> for why it reads low.</p>
    <div class="bm-headline">
      <span><span class="l">Est. revenue${b.ongoing?" so far":""}</span><div class="v">${qm.hasData?fmtUSD(qm.total):na}</div></span>
      <span class="sub">China · iPhone · gross · Qimai's own estimate</span></div>`;
  if(!qm.hasData) return `<div class="bm-stats">${tiles}</div>${head}
    <p class="bm-note">No Qimai China-iPhone revenue for this banner — its game isn't in the Qimai set yet, or it ran before Qimai's daily data.</p>`;
  // build-up from the real daily series — same components as game-i's tab (burn analysis,
  // bars+cumulative chart, four-column daily table), but measured China dollars not a
  // rank reconstruction, and the rank column is the China iOS rank.
  const qbd=qimaiBD(b);
  let build="";
  if(qbd){
    // its own hover context so the chart's tooltip reads China dollars + China rank,
    // not game-i's yen (_bmCtx) — same split the CN rank graph uses (_cnCtx/data-cnday).
    _qbuCtx={start:qm.start||b.start, scheduled, days:qbd.days};
    build=`<h3>Estimated revenue build-up${b.ongoing?" so far":""}</h3>
      <p class="bm-note">Qimai estimates China-iPhone revenue <b>day by day</b>, so unlike the other tabs this build-up isn't spread from a monthly total — each bar is this banner's split of that day's China total and the line is the running total, up to <b>${fmtUSD(qm.total)}</b>. Still a Qimai model estimate, just at daily resolution.</p>
      ${qimaiBurnBlock(b)}
      ${buildupSVG(qbd,b,fmtUSD,"qbu")}
      ${dailyTable(qbd,fmtUSD,"China&nbsp;rank")}`;
  }
  return `<div class="bm-stats">${tiles}</div>${head}${offWarn}${cnRankBlock(b,true)}${build}${qimaiAnalysisBlock(b)}`;
}

// Opening a comparable stacks it ON TOP of the banner you were reading rather than
// replacing it, so closing steps back to where you were instead of dumping you out.
// A back-stack rather than a second overlay on purpose: the modal's charts share one
// hover-tooltip context (_bmCtx, dayLabel.start), and two live modals would fight
// over it. `keepStack` is what a peer click passes; every other entry point starts fresh.
let _bmStack=[], _bmCur=null;
function closeBanner(){
  if(_bmStack.length){ openBanner(_bmStack.pop(), true); return; }
  bannerModal.hidden=true; bmTip.hidden=true;
}
function openBanner(b, keepStack){
  if(!keepStack) _bmStack=[];
  _bmCur=b;
  const under=_bmStack.length?_bmStack[_bmStack.length-1]:null;
  const backBar=under
    ? `<button type="button" class="bm-back" id="bmBack">← Back to ${esc(peerName(under))}</button>` : "";
  if(b._synthetic){
    const mo=`${MONTHS[+b.start.slice(5,7)-1]} ${b.year}`;
    $("#bmBody").innerHTML=backBar+`
      <div class="bm-head" style="--av-ring:var(--muted)">
        <span class="bm-art sq mono syn">≈</span>
        <div class="bm-htext"><h2 id="bmTitle">${esc(b.name)}</h2>
          <div class="bm-sub">${mo}</div></div></div>
      <div class="bm-stats">
        <div class="bm-stat"><span class="l">Unlisted revenue</span><span class="v">${G(b.rev)}</span></div>
        <div class="bm-stat"><span class="l">Month</span><span class="v" style="font-size:13px">${mo}</span></div></div>
      <p class="bm-note">This is <b>not a game-i banner</b>. game-i's monthly total for ${mo} is <b>${G(b.rev)}</b> higher than the banners it has listed — most likely a rate-up/event game-i hasn't logged yet (its banner list lags), or off-banner sales. We show it so the game's timeline and totals aren't left looking idle. The figure comes straight from game-i's monthly table (月次売上予測); there's no per-day rank detail because it isn't tied to a listed banner.</p>`;
    bannerModal.querySelector(".modal-card").scrollTop=0; tip.hidden=true; bannerModal.hidden=false; return;
  }
  if(b.pending){
    const en2=b.agents&&b.agents.length?b.agents.join(" & "):"";
    const scheduled=Math.round((Date.parse(b.end)-Date.parse(b.start))/864e5)+1;
    const icons=(b.icons||[]).slice(0,10).map(u=>`<img class="bm-pi" src="${esc(u)}" alt="" referrerpolicy="no-referrer" data-fb="remove">`).join("");
    const title=`<h2 id="bmTitle">${esc(bLabel(b))} <span class="bm-pendtag">pending</span></h2>
      ${en2&&en2!==bLabel(b)?`<div class="bm-sub">${esc(en2)}</div>`:""}
      <div class="bm-period">${per(b.start)} – ${per(b.end)}</div>`;
    const head=b.banner_img
      ? `<div class="bm-hero" style="--av-ring:${barColor(b)}"><img src="${esc(b.banner_img)}" alt="" referrerpolicy="no-referrer" data-fb="art" data-alt="${esc((b.icons&&b.icons[0])||"")}"><div class="bm-herobar">${title}</div></div>`
      : `<div class="bm-head" style="--av-ring:${barColor(b)}">${(b.icons&&b.icons[0])?`<img class="bm-art sq" src="${esc(b.icons[0])}" alt="" referrerpolicy="no-referrer" data-fb="remove">`:""}<div class="bm-htext">${title}</div></div>`;
    $("#bmBody").innerHTML = backBar + head
      + `<div class="bm-stats"><div class="bm-stat"><span class="l">Run length</span><span class="v">${scheduled} days</span></div><div class="bm-stat"><span class="l">Source</span><span class="v" style="font-size:13px">JP game data</span></div></div>`
      + (icons?`<div class="bm-picons">${icons}</div>`:"")
      + `<p class="bm-note"><b>Not on game-i yet.</b> This is a real ${esc(gameName())} banner from the game's own <b>JP</b> data — game-i hasn't logged it, so there's <b>no daily revenue estimate</b> for it. It'll pick up its ¥ figure and rank curve automatically once game-i adds it. (A brand-new character may show its Japanese name until an official English one exists.)</p>`;
    bannerModal.querySelector(".modal-card").scrollTop=0; tip.hidden=true; bannerModal.hidden=false; return;
  }
  dayLabel.start=b.start+"T00:00:00";
  const en=b.agents&&b.agents.length?b.agents.join(" & "):(b.related||"");
  const rr=b.rerun?`<span class="rr">↻ rerun</span>`:"";
  const live=b.ongoing?`<span class="bm-live">● Running</span>`:"";
  const scheduled=Math.round((Date.parse(b.end)-Date.parse(b.start))/864e5)+1;
  const elapsed=b.rank_series?b.rank_series.length:Math.min(scheduled,Math.round((Date.now()-Date.parse(b.start))/864e5)+1);
  const stats=[
    [`Est. revenue${b.ongoing?" so far":""}`, G(b.rev)],
    ["All-time rank", `#${b.cum} / ${b.cumtot}`],
    [`${b.year} rank`, `#${b.yrank} / ${b.ytot}`],
    ["Run length", b.ongoing?`Day ${elapsed} of ${scheduled}`:`${scheduled} days`],
  ].map(([l,v])=>tileHTML(l,v)).join("");

  // header: full-width hero art when we have banner art, else icon-left compact row
  const title=`<h2 id="bmTitle">${esc(bLabel(b))} ${rr}${live}</h2>
    ${en&&en!==bLabel(b)?`<div class="bm-sub">${esc(en)}</div>`:""}
    <div class="bm-period">${per(b.start)} – ${per(b.end)}</div>`;
  const head=b.banner_img
    ? `<div class="bm-hero" style="--av-ring:${barColor(b)}">
         <img src="${esc(b.banner_img)}" alt="" referrerpolicy="no-referrer" data-fb="art" data-alt="${esc((b.icons&&b.icons[0])||"")}">
         <div class="bm-herobar">${title}</div></div>`
    : `<div class="bm-head" style="--av-ring:${barColor(b)}">
         ${b.icons&&b.icons[0]?`<img class="bm-art sq" src="${esc(b.icons[0])}" alt="" referrerpolicy="no-referrer" data-fb="remove">`:""}
         <div class="bm-htext">${title}</div></div>`;

  const s=b.rank_series||[]; const known=s.filter(v=>v!=null);
  let curve;
  if(known.length){
    const first=s.find(v=>v!=null), last=[...s].reverse().find(v=>v!=null), best=Math.min(...known);
    const cap=b.ongoing
      ? `Opened at <b>#${first}</b>, currently <b>#${last}</b> (peaked <b>#${best}</b>) — <b>still running</b>.`
      : `Opened at <b>#${first}</b>, peaked at <b>#${best}</b>, closed at <b>#${last}</b>.`;
    curve=`<h3>Daily iOS store rank during the run</h3>
      <div class="bm-cap">${cap}</div>
      ${rankCurveSVG(b)}
      <p class="bm-note">#1 is the top of Japan's App Store top-grossing chart. Breaks in the line are days the app sat below game-i's trackable ~top&nbsp;200 (counted as ¥0). Rank is snapshotted at midnight JST, so a launch day can read below-200 when the banner went live after the snapshot. iOS only — game-i keeps no daily Android history.</p>`;
  } else {
    curve=`<h3>Daily iOS store rank during the run</h3>
      <p class="bm-note">No daily rank data for this run — the app stayed below game-i's trackable ~top&nbsp;200 throughout (counted as ¥0), or the run predates game-i's rank history.</p>`;
  }

  const sh=b._share;
  let shareBlock="";
  if(sh&&sh.on){
    shareBlock=`<h3>Shared with concurrent banners</h3>
      <p class="bm-note">game-i splits each day's revenue equally among every banner running that day. This one overlapped <b>${sh.with.length}</b> other banner${sh.with.length>1?"s":""} on <b>${sh.days}</b> of its ${sh.totalDays} days — up to a <b>${sh.maxN}-way</b> split. The hatched part of its bar (and the hatched days below) mark that portion.</p>
      <div class="bm-stats bm-share3">
        <div class="bm-stat"><span class="l">On its own</span><span class="v">${G(sh.soloRev)}</span></div>
        <div class="bm-stat"><span class="l">While shared</span><span class="v">${G(sh.sharedRev)}</span></div>
        <div class="bm-stat sum"><span class="l">Total</span><span class="v">${G(b.rev)}</span></div>
      </div>
      ${alongsideChips(sh)}`;
  }

  const bd=dailyBreakdown(b);
  // context for the shared hover tooltip on both charts (keyed by day index)
  _bmCtx={start:b.start, scheduled, days:(bd?bd.days:[]).map(x=>x)};
  let build="";
  if(bd){
    build=`<h3>Estimated revenue build-up${b.ongoing?" so far":""}</h3>
      <p class="bm-note bm-recon">game-i publishes only one total per banner. This splits that ${G(b.rev)} across the run by each day's rank (bars = that day's share, line = running total), using game-i's published rank→revenue curve. It's an illustration of how the total accumulated — not a separately reported daily figure.</p>
      ${burnBlock(b)}
      ${buildupSVG(bd,b)}
      ${dailyTable(bd)}`;
  }

  const gameiHead=`<h3>game-i — estimated Japan revenue</h3>
    <p class="bm-note bm-recon">game-i publishes one figure per banner: its estimate of what the banner earned from mobile gacha <b>in Japan</b>, in its own "G" unit (1億G ≈ ¥100 million). It is the only per-banner revenue anyone publishes, which is why the other two tabs lean on its shape.</p>
    <div class="bm-headline">
      <span><span class="l">Est. revenue${b.ongoing?" so far":""}</span><div class="v">${G(b.rev)}</div></span>
      <span class="sub">Japan · mobile only · game-i's own estimate</span></div>`;
  // Build-up sits directly under the rank curve: it is the same run, day by day, read
  // off that very curve -- so the two belong together, before the peer comparison.
  const gameiHTML=`<div class="bm-stats">${stats}</div>${gameiHead}${curve}${build}${jpAnalysisBlock(b)}${shareBlock}`;
  const hasQM = hasQimai(state.tag);
  let active = state.dataSource==="st" ? "st" : state.dataSource==="cn" ? "cn" : state.dataSource==="qimai" ? "qimai" : "gamei";
  if(active==="qimai" && !hasQM) active="gamei";   // banner's game has no Qimai data
  // the CN tab carries two different things: China's real store chart (daily) and the
  // monthly CN¥ estimate. Either one alone is worth the tab.
  const hasCN = !!(state.cn && state.cn.games && state.cn.games[state.tag])
             || !!(state.cnrank && state.cnrank.games && state.cnrank.games[state.tag]);
  const toggle=`<div class="seg bm-seg" id="bmSrc" role="tablist" aria-label="Data source for this banner">
    <button data-bmsrc="gamei" class="${active==="gamei"?"on":""}" aria-selected="${active==="gamei"}" title="game-i's JP per-banner revenue estimate">game-i · JP ¥</button>`
    + (hasQM?`<button data-bmsrc="qimai" class="${active==="qimai"?"on":""}" aria-selected="${active==="qimai"}" title="China iPhone App Store gross revenue (USD), Qimai's daily estimate">Qimai · CN iPhone $</button>`:"")
    + `<button data-bmsrc="st" class="${active==="st"?"on":""}" aria-selected="${active==="st"}" title="Assumed combined worldwide revenue from the Sensor Tower monthly reports">Sensor Tower · combined $</button>`
    + (hasCN?`<button data-bmsrc="cn" class="${active==="cn"?"on":""}" aria-selected="${active==="cn"}" title="China's own store chart day by day, plus the assumed global all-platform revenue from the CN monthly ranking">CN chart · CN¥</button>`:"")
    + `</div>`;
  $("#bmBody").innerHTML=backBar+head+toggle
    +`<div id="bmGamei"${active!=="gamei"?" hidden":""}>${gameiHTML}</div>`
    +(hasQM?`<div id="bmQimai"${active!=="qimai"?" hidden":""}>${bannerQimaiView(b)}</div>`:"")
    +`<div id="bmST"${active!=="st"?" hidden":""}>${bannerSTView(b)}</div>`
    +(hasCN?`<div id="bmCN"${active!=="cn"?" hidden":""}>${bannerCNView(b)}</div>`:"");
  bannerModal.querySelector(".modal-card").scrollTop=0;
  tip.hidden=true;
  bannerModal.hidden=false;
}
$("#bmClose").onclick=()=>closeBanner();
bannerModal.onclick=e=>{ if(e.target===bannerModal) closeBanner(); };

// shared hover tooltip for both in-modal charts (rank curve + revenue build-up)
let _bmCtx=null, _cnCtx=null, _qbuCtx=null;
function showCnTip(i,e){
  const day=_cnCtx&&_cnCtx.days[i]; if(!day){ bmTip.hidden=true; return; }
  const dt=new Date(day.iso+"T00:00:00");
  const where = day.rank!=null ? `#${day.rank}` : `<span style="color:var(--muted)">below #${day.depth}</span>`;
  bmTip.innerHTML=`<div class="body">
    <h4>${dt.toLocaleDateString("en",{month:"short",day:"numeric",year:"numeric"})}</h4>
    <div style="color:var(--muted);font-size:11.5px">Day ${i+1} · China, all apps</div>
    <dl><dt>Rank</dt><dd><b>${where}</b></dd>
    <dt>Chart known</dt><dd>${day.depth} deep</dd>
    <dt>Read from</dt><dd>${esc(String(day.src||"-"))}</dd></dl></div>`;
  bmTip.hidden=false;
  const pad=14,w=bmTip.offsetWidth,h=bmTip.offsetHeight;
  let x=e.clientX+pad,y=e.clientY+pad;
  if(x+w>innerWidth)x=e.clientX-w-pad; if(y+h>innerHeight)y=e.clientY-h-pad;
  bmTip.style.left=Math.max(6,x)+"px"; bmTip.style.top=Math.max(6,y)+"px";
}
const bmTip=$("#bmTip");
function showBmTip(dayIdx,e){
  const day=_bmCtx&&_bmCtx.days[dayIdx]; if(!day){ bmTip.hidden=true; return; }
  const d=new Date(_bmCtx.start+"T00:00:00"); d.setDate(d.getDate()+day.i);
  const dateStr=d.toLocaleDateString("en",{month:"short",day:"numeric",year:"numeric"});
  const rank = day.rank==null ? `<span style="color:var(--muted)">below top 200</span>` : `#${day.rank}`;
  const add  = day.rank==null ? "¥0" : (day.add>=0.005 ? "+"+G(day.add) : "≈¥0");
  bmTip.innerHTML=`<div class="body">
    <h4>${dateStr}</h4>
    <div style="color:var(--muted);font-size:11.5px">Day ${day.i+1} of ${_bmCtx.scheduled}</div>
    <dl><dt>iOS rank</dt><dd>${rank}</dd>
    <dt>Est. that day</dt><dd>${add}</dd>
    <dt>Cumulative</dt><dd><b>${G(day.cum)}</b></dd></dl></div>`;
  bmTip.hidden=false;
  const pad=14,w=bmTip.offsetWidth,h=bmTip.offsetHeight;
  let x=e.clientX+pad,y=e.clientY+pad;
  if(x+w>innerWidth)x=e.clientX-w-pad; if(y+h>innerHeight)y=e.clientY-h-pad;
  bmTip.style.left=Math.max(6,x)+"px"; bmTip.style.top=Math.max(6,y)+"px";
}
// Qimai build-up chart tooltip: China dollars + China iOS rank (mirrors showBmTip, which
// is game-i's yen). Its own context (_qbuCtx) because both build-up charts live in #bmBody.
function showQbuTip(i,e){
  const day=_qbuCtx&&_qbuCtx.days[i]; if(!day){ bmTip.hidden=true; return; }
  const d=new Date(_qbuCtx.start+"T00:00:00"); d.setDate(d.getDate()+day.i);
  const dateStr=d.toLocaleDateString("en",{month:"short",day:"numeric",year:"numeric"});
  const rank = day.rank==null ? `<span style="color:var(--muted)">below top 200</span>` : `#${day.rank}`;
  const add  = day.add>=1 ? "+"+fmtUSD(day.add) : "≈$0";
  bmTip.innerHTML=`<div class="body">
    <h4>${dateStr}</h4>
    <div style="color:var(--muted);font-size:11.5px">Day ${day.i+1} of ${_qbuCtx.scheduled} · China iPhone</div>
    <dl><dt>China rank</dt><dd>${rank}</dd>
    <dt>Est. that day</dt><dd>${add}</dd>
    <dt>Cumulative</dt><dd><b>${fmtUSD(day.cum)}</b></dd></dl></div>`;
  bmTip.hidden=false;
  const pad=14,w=bmTip.offsetWidth,h=bmTip.offsetHeight;
  let x=e.clientX+pad,y=e.clientY+pad;
  if(x+w>innerWidth)x=e.clientX-w-pad; if(y+h>innerHeight)y=e.clientY-h-pad;
  bmTip.style.left=Math.max(6,x)+"px"; bmTip.style.top=Math.max(6,y)+"px";
}
$("#bmBody").addEventListener("pointermove",e=>{
  const cn=e.target.closest("[data-cnday]");
  if(cn){ showCnTip(+cn.dataset.cnday,e); return; }
  const qb=e.target.closest("[data-qbu]");
  if(qb){ showQbuTip(+qb.dataset.qbu,e); return; }
  const el=e.target.closest("[data-day]"); if(!el){ bmTip.hidden=true; return; }
  showBmTip(+el.dataset.day,e);
});
$("#bmBody").addEventListener("pointerleave",()=>bmTip.hidden=true);
$("#bmBody").addEventListener("click",e=>{
  // a comparable in "How this run compares" opens that banner in place
  if(e.target.closest("#bmBack")){ closeBanner(); return; }
  const peer=e.target.closest(".bm-peer[data-i], .bm-cav[data-i]");
  if(peer){ if(_bmCur) _bmStack.push(_bmCur); openBanner(state.data.banners[+peer.dataset.i], true); return; }
  const btn=e.target.closest("[data-bmsrc]"); if(!btn) return;
  const which=btn.dataset.bmsrc;
  $("#bmSrc").querySelectorAll("[data-bmsrc]").forEach(x=>{ const on=x===btn; x.classList.toggle("on",on); x.setAttribute("aria-selected",on); });
  const g=$("#bmGamei"), s=$("#bmST"), c=$("#bmCN"), q=$("#bmQimai");
  if(g) g.hidden=which!=="gamei";
  if(s) s.hidden=which!=="st";
  if(c) c.hidden=which!=="cn";
  if(q) q.hidden=which!=="qimai";
  bmTip.hidden=true;
});

// ---- controls ----
const isPeriodMode = m => m==="year"||m==="month"||m==="version";
function updateDirLabel(){
  const byRev = state.mode==="rank" || (isPeriodMode(state.mode) && state.periodSort==="ranking");
  $("#bDir").textContent = byRev
    ? (state.reverse ? "Lowest first" : "Highest first")
    : (state.reverse ? "Oldest first" : "Newest first");
  const bs=$("#bSort"); if(bs) bs.value = state.periodSort;
}
function setMode(m){
  state.mode=m;
  [["bTime","time"],["bGraph","graph"],["bRank","rank"],["bYear","year"],["bMonth","month"],["bVersion","version"],["bAgree","agree"]].forEach(([id,mm])=>{
    const el=$("#"+id); el.classList.toggle("on",m===mm); el.setAttribute("aria-selected",m===mm);
  });
  updateControlVis();
  updateDirLabel();
  if(!state.table) render();
}
$("#bSort").onchange=function(){ state.periodSort = this.value; updateDirLabel(); if(!state.table) render(); };
$("#dataSrc").querySelectorAll("[data-src]").forEach(btn=>btn.onclick=()=>{
  state.dataSource=btn.dataset.src;
  $("#dataSrc").querySelectorAll("[data-src]").forEach(b=>b.classList.toggle("on",b===btn));
  renderStats();                       // header tiles follow the active data source too
  if(!state.table) render();
});
$("#bTime").onclick=()=>setMode("time");
$("#bRank").onclick=()=>setMode("rank");
$("#bGraph").onclick=()=>setMode("graph");
$("#bYear").onclick=()=>setMode("year");
$("#bMonth").onclick=()=>setMode("month");
$("#bVersion").onclick=()=>setMode("version");
$("#bAgree").onclick=()=>setMode("agree");
$("#agModeWrap").querySelectorAll("[data-agmode]").forEach(btn=>btn.onclick=()=>{
  state.agreeMode=btn.dataset.agmode;
  $("#agModeWrap").querySelectorAll("[data-agmode]").forEach(b=>b.classList.toggle("on",b===btn));
  if(!state.table) render();
});
$("#bDir").onclick=()=>{ state.reverse=!state.reverse; updateDirLabel(); if(!state.table) render(); };
$("#bTable").onclick=function(){state.table=!state.table;
  this.classList.toggle("on",state.table); this.textContent=state.table?"Chart view":"Table view";
  render();};   // render() -> updateControlVis() switches the rest of the row

// ---- Compare: head-to-head between two banners ----------------------------------
// A banner is one event, so a fair comparison is day-for-day: it caps BOTH runs to the
// number of days the SHORTER one has (an ongoing banner five days in is compared against
// only the first five days of a finished one). Every metric that exists is computed over
// that window and scored, and whichever banner wins more metrics is called the better run.
// It works across games too — the same rank-and-revenue sources apply — with a warning,
// because the games measure on different scales.
//
// The metric extractors (bannerST/bannerCN/bannerQimai/cnRunSeries/dailyBreakdown) all read
// the global `state` for the CURRENT game. To pull a banner from another game we load that
// game into its own prepared context and briefly swap the globals to it while extracting —
// see loadCtx / withCtx. Only one game's data is ever live at a time, so this reuses every
// existing (tested) calculation instead of duplicating it.
const MONTHS_ABBR=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function cmpDate(iso){ if(!iso) return ""; const [y,m]=iso.split("-"); return `${MONTHS_ABBR[+m-1]} ${y}`; }

// Prepare a game's data exactly as selectGame does, but into a cached side context rather
// than the live globals, so its banners carry the same _i / monthly attribution / sharing.
async function loadCtx(tag){
  state._ctx=state._ctx||{};
  if(state._ctx[tag]) return state._ctx[tag];
  const data=await getJSON(`data/${tag}.json`);
  const save={tag:state.tag,data:state.data,monthly:state.monthly,
    gb:state._gameBurn,sc:state._shareCurve,cp:state._cnPeers,jp:state._jpPeers};
  try{
    state.tag=tag; state.data=data;
    state.data.banners=state.data.banners.filter(b=>!b._synthetic&&!b.pending);
    computeMonthly();
    state.data.banners=state.data.banners.concat(computeUnlisted());
    [...state.data.banners].sort((a,b)=>b.rev-a.rev).forEach((b,i)=>b._rank=i+1);
    state.data.banners.forEach((x,i)=>x._i=i);
    computeSharing();
    state._gameBurn=undefined; state._shareCurve=undefined; state._cnPeers=undefined; state._jpPeers=undefined;
    state._ctx[tag]={tag, data:state.data, monthly:state.monthly, name:(state.data.name||tag)};
  } finally {
    Object.assign(state,{tag:save.tag,data:save.data,monthly:save.monthly,
      _gameBurn:save.gb,_shareCurve:save.sc,_cnPeers:save.cp,_jpPeers:save.jp});
  }
  return state._ctx[tag];
}
// Run fn with the globals pointed at ctx's game, then restore. Synchronous — JS is single
// threaded, so nothing else reads the globals while fn runs.
function withCtx(ctx, fn){
  const save={tag:state.tag,data:state.data,monthly:state.monthly,
    gb:state._gameBurn,sc:state._shareCurve,cp:state._cnPeers,jp:state._jpPeers};
  try{
    state.tag=ctx.tag; state.data=ctx.data; state.monthly=ctx.monthly;
    state._gameBurn=undefined; state._shareCurve=undefined; state._cnPeers=undefined; state._jpPeers=undefined;
    return fn();
  } finally {
    Object.assign(state,{tag:save.tag,data:save.data,monthly:save.monthly,
      _gameBurn:save.gb,_shareCurve:save.sc,_cnPeers:save.cp,_jpPeers:save.jp});
  }
}
// English-preferred display name for a banner: the character(s) in English where we have
// them (agents / the `en` field), else game-i's raw name (which for HoYo games is Japanese).
function cmpDisp(b){
  if(b.agents&&b.agents.length) return b.agents.join(" & ");
  if(b.en) return b.en;
  return bLabel(b);
}
// Load every game once and index every real banner, so both pickers can search across games.
async function buildCompareIndex(){
  if(state._cmpIndex) return;
  await Promise.all((state.games||[]).map(g=>loadCtx(g.game).catch(()=>null)));
  const idx=[];
  for(const g of (state.games||[])){ const ctx=state._ctx&&state._ctx[g.game]; if(!ctx) continue;
    ctx.data.banners.forEach(b=>{ if(b._synthetic||b.pending) return;
      const disp=cmpDisp(b);
      idx.push({gtag:g.game, i:b._i, label:disp,
        en:(b.agents&&b.agents.length?b.agents.join(" & "):""), jp:(b.name&&b.name!==disp?b.name:""),
        game:g.name, icon:(b.icons&&b.icons[0])||"", rev:b.rev||0, start:b.start, rerun:!!b.rerun}); });
  }
  idx.sort((a,b)=> a.game===b.game ? b.rev-a.rev : (a.game<b.game?-1:1));
  state._cmpIndex=idx;
  const rc={}; idx.forEach(it=>{ const k=it.gtag+"|"+it.label.toLowerCase(); rc[k]=(rc[k]||0)+1; });
  state._cmpRunCounts=rc;               // how many banners share a character label (for "compare reruns")
}
// Every banner of one character (same game + display label), chronological — powers the
// one-click "compare its reruns".
function cmpRunsOf(tag,label){
  const k=(label||"").toLowerCase();
  return (state._cmpIndex||[]).filter(it=>it.gtag===tag && it.label.toLowerCase()===k)
    .slice().sort((a,b)=> a.start<b.start?-1 : a.start>b.start?1 : 0);
}

// The periods (months / years / versions) of one game that can be compared, newest first.
function gamePeriods(ctx, kind){
  return withCtx(ctx,()=>{
    if(kind==="month"){
      return Object.keys(ctx.monthly||{}).filter(ym=>/^\d{4}-\d{2}$/.test(ym)).sort().reverse()
        .map(ym=>({key:ym, label:`${MONTHS_ABBR[+ym.slice(5,7)-1]} ${ym.slice(0,4)}`}));
    }
    if(kind==="year"){
      const ys=new Set((ctx.data.banners||[]).filter(b=>!b._synthetic&&!b.pending).map(b=>+String(b.start).slice(0,4)));
      return [...ys].sort((a,b)=>b-a).map(y=>({key:String(y), label:String(y)}));
    }
    if(kind==="version"){
      const v=VERSIONS[ctx.tag]||[];
      return v.map(x=>({key:x[0], label:x[0]})).reverse();
    }
    return [];
  });
}
const _cmpISO=d=>d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
// The calendar [start,end] a comparable entity spans (end is the scheduled/period end, not
// yet capped to today — the snapshot builder does the elapsed cap).
function entityRange(ctx, kind, key){
  if(kind==="banner"){ const b=ctx.data.banners[+key]; return {start:b.start, end:b.end}; }
  if(kind==="month"){ const y=+key.slice(0,4), m=+key.slice(5,7);
    return {start:`${key}-01`, end:_cmpISO(new Date(y, m, 0))}; }              // day 0 of next month = last day
  if(kind==="year"){ return {start:`${key}-01-01`, end:`${key}-12-31`}; }
  if(kind==="version"){ const v=VERSIONS[ctx.tag]||[]; const i=v.findIndex(x=>x[0]===key);
    const start=v[i][1];
    const end = i+1<v.length ? _cmpISO(new Date(Date.parse(v[i+1][1])-864e5)) : `${new Date().getFullYear()}-12-31`;
    return {start, end}; }
  return null;
}
function periodLabel(ctx, kind, key){
  if(kind==="month"){ return {label:`${MONTHS_ABBR[+key.slice(5,7)-1]} ${key.slice(0,4)}`, sub:`${ctx.name} · month`}; }
  if(kind==="year"){ return {label:key, sub:`${ctx.name} · year`}; }
  if(kind==="version"){ return {label:`Version ${key}`, sub:`${ctx.name} · version`}; }
  return {label:key, sub:ctx.name};
}

// An entity's raw comparable data (a banner OR a period), extracted once in its own game
// context and memoised. Every kind produces the SAME shape — day-indexed jp/cn/gi/qm series
// plus full-run totals — so buildComparison treats them identically.
function entityMetrics(entity){
  const cacheKey=[entity.tag,entity.kind,entity.key].join("#");
  state._cmpMetrics=state._cmpMetrics||{};
  if(state._cmpMetrics[cacheKey]) return state._cmpMetrics[cacheKey];
  const ctx=state._ctx&&state._ctx[entity.tag];
  if(!ctx) return null;
  const m=withCtx(ctx,()=> entity.kind==="banner" ? bannerSnapshot(ctx,+entity.key) : periodSnapshot(ctx,entity.kind,entity.key));
  return (state._cmpMetrics[cacheKey]=m);
}
// One banner. Must run inside withCtx(ctx).
function bannerSnapshot(ctx,i){
  const b=ctx.data.banners[i]; if(!b) return null;
  const jp=(b.rank_series||[]).slice();
  const cnRun=cnRunSeries(b); const cn=cnRun?cnRun.map(x=>x.rank):null;
  // whether the China chart was actually recorded that day (depth known). A null rank on a
  // recorded day = genuinely below #200; a null on an unrecorded day = data not fetched yet.
  const cnKnown=cnRun?cnRun.map(x=>x.depth!=null):null;
  const bd=dailyBreakdown(b); const gi=bd?bd.days.map(d=>({add:d.add,cum:d.cum})):[];
  const qm=bannerQimai(b); const qmDaily=(qm.daily||[]).slice();
  const st=bannerST(b); const cnv=bannerCN(b);
  return {
    gtag:ctx.tag, kind:"banner", key:String(i),
    label:cmpDisp(b), name:cmpDisp(b), sub:`${ctx.name} · ${cmpDate(b.start)}${b.rerun?" · ↻ rerun":""}`,
    game:ctx.name, art:b.banner_img||"", icon:(b.icons&&b.icons[0])||"", accent:barColor(b), face:cmpFace(ctx.tag, b.name, b.banner_img),
    start:b.start, end:b.end, ongoing:!!b.ongoing, rerun:!!b.rerun,
    scheduled:Math.round((Date.parse(b.end)-Date.parse(b.start))/864e5)+1,
    rev:b.rev||0, jp, cn, cnKnown, gi, qmDaily, hasQm:!!qm.hasData,
    stTotal: st.hasData?st.total:null,
    cnLo: cnv.hasData?cnv.lo:null, cnHi: cnv.hasData?(cnv.hi==null?cnv.lo:cnv.hi):null,
    runDays: Math.max(jp.length, cn?cn.length:0, qmDaily.length, gi.length),
    pct: bannerPct(ctx,i),          // standing among this game's banners (percentile)
    rival: bannerRival(b),          // biggest concurrent banner it shared the schedule with
    proj: bannerProj(b),            // where an ongoing run is tracking towards
    agents: b.agents||[],
  };
}
// A banner's overall standing among its game's banners: the mean of its available
// source percentiles (game-i / Qimai / ST / CN / JP rank / CN rank). Must run in withCtx.
function bannerPct(ctx,i){
  try{
    const A=bannerAgreement(ctx.tag); const r=A.rows.find(x=>x.key===String(i));
    if(!r) return null;
    const vals=[r.gi,r.qm,r.st,r.cn,r.jr,r.cr].filter(v=>v!=null);
    return vals.length? Math.round(vals.reduce((a,c)=>a+c,0)/vals.length) : null;
  }catch(e){ return null; }
}
// The concurrent banner this one most shared revenue with, by that rival's own size.
function bannerRival(b){
  const sh=b._share; if(!sh || !sh.on || !sh.with||!sh.with.length) return null;
  const top=sh.with.reduce((m,w)=> (w.o.rev||0)>(m.o.rev||0)?w:m, sh.with[0]);
  return { name:top.name, rev:top.o.rev||0, days:sh.days, frac:sh.revFrac };
}
// Where an ongoing run is heading, from how much this game's finished banners have usually
// banked by the same day (same logic burnBlock uses on the game-i tab).
function bannerProj(b){
  if(!b.ongoing) return null;
  const bo=burnout(b), sc=gameShareCurve(); if(!bo||!sc) return null;
  const D=bo.days; if(D<2||D>sc.days) return null;
  const sh=sc.share[D-1]; if(!sh||sh<=0.02||!(b.rev>0)) return null;
  return { day:D, scheduled:Math.round((Date.parse(b.end)-Date.parse(b.start))/864e5)+1,
    sh, projTotal:b.rev/sh, lo:b.rev/sc.hi[D-1], hi:b.rev/sc.lo[D-1] };
}
// A whole month / year / version: the game's daily series over the range, built from every
// banner that ran plus the game's real China chart. Must run inside withCtx(ctx).
function periodSnapshot(ctx, kind, key){
  const R=entityRange(ctx, kind, key); if(!R) return null;
  const startD=new Date(R.start+"T00:00:00");
  let endD=new Date(R.end+"T00:00:00");
  const today=new Date(); today.setHours(0,0,0,0);
  const ongoing = endD>today; if(ongoing) endD=today;
  const idxOf=dt=>Math.round((dt-startD)/864e5);
  const n=idxOf(endD)+1;
  if(n<=0) return null;
  const giAdd=new Array(n).fill(0), jp=new Array(n).fill(null), qm=new Array(n).fill(0);
  let anyQm=false;
  const bans=ctx.data.banners.filter(b=>!b._synthetic&&!b.pending);
  for(const b of bans){
    const bd=dailyBreakdown(b);
    if(bd){ const s0=Date.parse(b.start);
      bd.days.forEach(d=>{ const idx=idxOf(new Date(s0+d.i*864e5));
        if(idx>=0&&idx<n){ giAdd[idx]+=d.add; if(d.rank!=null && (jp[idx]==null||d.rank<jp[idx])) jp[idx]=d.rank; } }); }
    else if(b.rank_series){ const s0=Date.parse(b.start);
      b.rank_series.forEach((r,i)=>{ if(r==null) return; const idx=idxOf(new Date(s0+i*864e5));
        if(idx>=0&&idx<n && (jp[idx]==null||r<jp[idx])) jp[idx]=r; }); }
    const q=bannerQimai(b);
    if(q.hasData && q.daily && q.daily.length){ const qs=Date.parse(q.start||b.start);
      q.daily.forEach((val,i)=>{ const idx=idxOf(new Date(qs+i*864e5)); if(idx>=0&&idx<n && val){ qm[idx]+=val; anyQm=true; } }); }
  }
  const cn=new Array(n).fill(null), cnKnown=new Array(n).fill(false);
  const cr=state.cnrank&&state.cnrank.games&&state.cnrank.games[ctx.tag];
  const crDays=state.cnrank&&state.cnrank.days;
  for(let idx=0; idx<n; idx++){ const iso=_cmpISO(new Date(startD.getTime()+idx*864e5));
    if(crDays&&crDays[iso]) cnKnown[idx]=true;                 // the China chart was recorded that day
    if(cr){ const v=cr[iso]; if(v!=null) cn[idx]=v; } }
  let cum=0; const gi=giAdd.map(a=>({add:a, cum:(cum+=a)}));
  const inRange=ym=>ym>=R.start.slice(0,7) && ym<=R.end.slice(0,7);
  const st=extSum(inRange, ctx.tag), cnv=cnSum(inRange, ctx.tag);
  const lbl=periodLabel(ctx, kind, key);
  // characters running during the period (any overlap), biggest first — shown on the card
  const running=bans.filter(b=>b.start<=R.end && b.end>=R.start)
    .sort((a,b)=>(b.rev||0)-(a.rev||0))
    .map(b=>({label:cmpDisp(b), icon:(b.icons&&b.icons[0])||"", art:b.banner_img||"", face:cmpFace(ctx.tag, b.name, b.banner_img)}));
  return {
    gtag:ctx.tag, kind, key, label:lbl.label, name:`${lbl.label} · ${ctx.name}`, sub:lbl.sub, game:ctx.name,
    art:"", icon:"", accent:GAME_ACCENT[ctx.tag]||"#8a8a8a", banners:running,
    start:R.start, end:R.end, ongoing, rerun:false, scheduled:n,
    rev:gi.length?gi[gi.length-1].cum:0, jp, cn, cnKnown, gi, qmDaily:qm, hasQm:anyQm,
    stTotal: st?st.rev:null, cnLo: cnv?cnv.lo:null, cnHi: cnv?cnv.hi:null,
    runDays:n,
  };
}

// Rank stats over the first k days of a rank series (nulls = below the trackable top 200).
// `mask`, when given, marks which days actually have data — a null on an unrecorded day is
// "not fetched yet", not a real drop, so it never triggers a drop-out.
function cmpRankStats(arr,k,mask){
  if(!arr) return {none:true};
  const OFF=201;                                   // below-200 days penalised, so a run that
  const win=arr.slice(0,k);                        //   held the chart beats one that fell off
  const has=idx=> !mask || mask[idx];              // day has data (default: always)
  const known=win.map((v,idx)=>[idx,v]).filter(([,v])=>v!=null);
  if(!known.length) return {none:true};
  const vals=known.map(([,v])=>v), sorted=[...vals].sort((a,b)=>a-b);
  const peak=sorted[0], peakDay=known.find(([,v])=>v===peak)[0];
  const last=known[known.length-1][1];
  const span=(win.length-1)-peakDay;
  // top-200 drop-out: the FIRST recorded day it falls below #200 after entering the chart (a
  // mid-run exit counts, not only a trailing one). Days with no data (mask false) are skipped,
  // so a run whose recent days simply haven't been fetched isn't misread as a drop.
  const firstIdx=known[0][0]; let firstDrop=-1;
  for(let idx=firstIdx+1; idx<win.length; idx++){ if(!has(idx)) continue; if(win[idx]==null){ firstDrop=idx; break; } }
  const droppedOut = firstDrop>=0;
  // last day with data, so "no drop" scoring isn't inflated by trailing unfetched days
  let lastData=firstIdx; for(let idx=win.length-1; idx>firstIdx; idx--){ if(has(idx)){ lastData=idx; break; } }
  // median skips launch day: day 1 swings wildly between games (partial day, maintenance,
  // time-zone cut), while day 2 is where every game peaks — so count from day 2 onward
  // (falls back to all days when day 1 is the only one charted).
  const medVals=known.filter(([idx])=>idx>=1).map(([,v])=>v).sort((a,b)=>a-b);
  const medPool=medVals.length?medVals:sorted;
  return { none:false, peak, peakDay, open:known[0][1], last,
    med:medPool[Math.floor(medPool.length/2)],
    sum:win.reduce((a,v)=>a+(v==null?OFF:v),0),
    top10:vals.filter(v=>v<=10).length, top20:vals.filter(v=>v<=20).length,
    degrade: span>0 ? (last-peak)/span : 0, charted:known.length,
    heldDays: droppedOut ? firstDrop : lastData+1, droppedOut, dropDay: droppedOut ? firstDrop+1 : null };
}
const cmpSum=(arr,k)=>{ const w=(arr||[]).slice(0,k); return w.length?w.reduce((a,v)=>a+(v||0),0):null; };
const cmpCum=(gi,k)=>{ if(!gi||!gi.length) return null; const idx=Math.min(k,gi.length)-1; return idx>=0?gi[idx].cum:null; };

const cmpMid=(lo,hi)=> lo==null?null:(lo+(hi==null?lo:hi))/2;
// The comparable sources, in display order. Ranks default on alongside the rest.
const CMP_SOURCES=[["gamei","game-i"],["qimai","Qimai"],["st","Sensor Tower"],["cn","CN"],["jp","JP rank"],["cnrank","CN rank"]];
function cmpSources(){ const s=state.compare.sources||(state.compare.sources={});
  CMP_SOURCES.forEach(([k])=>{ if(s[k]===undefined) s[k]=true; }); return s; }
// Assemble the comparison rows for A vs B, honouring which sources are toggled on.
// N-way comparison over an array of entity snapshots (2–4). Each metric picks a single best
// side; ties among the best award no point. Returns rows (one per metric, N cells each),
// per-side points, chart availability and per-side region skew.
function buildComparison(E){
  const en=cmpSources();
  const M=E.length;
  const N=Math.min(...E.map(e=>e.runDays||0));
  const minLen=(arr)=>Math.min(N, ...E.map(e=>(arr(e)||[]).length));
  const kGI=minLen(e=>e.gi);
  const kQM=E.every(e=>e.hasQm)?minLen(e=>e.qmDaily):0;
  const kJP=minLen(e=>e.jp);
  const kCN=E.every(e=>e.cn)?minLen(e=>e.cn):0;
  const sJP=E.map(e=>cmpRankStats(e.jp,kJP)), sCN=E.map(e=>cmpRankStats(e.cn,kCN,e.cnKnown));
  const rows=[];
  const rk=v=>v==null?"—":"#"+Math.round(v);
  const dOnly=v=>v==null?"—":Math.round(v)+"d";
  const dec=v=>v==null?"—":(v>0?"+":"")+v.toFixed(1)+"/day";
  const push=(o)=>rows.push(Object.assign({note:"",full:false},o));
  const cellsFrom=(fn,dispFn)=>E.map((e,i)=>({v:fn(e,i), disp:dispFn?dispFn(e,i):null}));

  if(en.gamei && kGI>0){ const w=Math.min(7,kGI);
    push({group:"Revenue",src:"gamei",metric:"gamei_total",label:"Total",k:kGI,better:"high",fmt:G,cells:cellsFrom(e=>cmpCum(e.gi,kGI))});
    push({group:"Revenue",src:"gamei",metric:"gamei_peak",label:"Peak-rank day",better:"high",fmt:G,note:"revenue on its best JP-rank day",cells:cellsFrom((e,i)=>{const pd=sJP[i].none?null:sJP[i].peakDay; return (pd!=null&&pd<e.gi.length)?e.gi[pd].add:null;})});
    push({group:"Revenue",src:"gamei",metric:"gamei_week",label:"First week",k:w,better:"high",fmt:G,cells:cellsFrom(e=>cmpCum(e.gi,w))});
    push({group:"Revenue",src:"gamei",metric:"gamei_perday",label:"Per day",k:kGI,better:"high",fmt:G,note:"revenue ÷ days compared",cells:cellsFrom(e=>{const c=cmpCum(e.gi,kGI);return c==null?null:c/kGI;})});
  }
  if(en.qimai && kQM>0){ const w=Math.min(7,kQM);
    push({group:"Revenue",src:"qimai",metric:"qimai_total",label:"Total",k:kQM,better:"high",fmt:fmtUSD,cells:cellsFrom(e=>cmpSum(e.qmDaily,kQM))});
    push({group:"Revenue",src:"qimai",metric:"qimai_peak",label:"Peak-rank day",better:"high",fmt:fmtUSD,note:"revenue on its best CN-rank day",cells:cellsFrom((e,i)=>{const pd=sCN[i].none?null:sCN[i].peakDay; return (pd!=null&&pd<e.qmDaily.length)?e.qmDaily[pd]:null;})});
    push({group:"Revenue",src:"qimai",metric:"qimai_week",label:"First week",k:w,better:"high",fmt:fmtUSD,cells:cellsFrom(e=>cmpSum(e.qmDaily,w))});
    push({group:"Revenue",src:"qimai",metric:"qimai_perday",label:"Per day",k:kQM,better:"high",fmt:fmtUSD,note:"revenue ÷ days compared",cells:cellsFrom(e=>{const c=cmpSum(e.qmDaily,kQM);return c==null?null:c/kQM;})});
  }
  if(en.st && E.every(e=>e.stTotal!=null)){
    push({group:"Revenue",src:"st",metric:"st_total",label:"Total",better:"high",fmt:fmtUSD,full:true,note:"whole run — monthly source",cells:cellsFrom(e=>e.stTotal)});
    push({group:"Revenue",src:"st",metric:"st_perday",label:"Per day",better:"high",fmt:fmtUSD,full:true,note:"÷ full run length",cells:cellsFrom(e=>e.stTotal/e.scheduled)});
  }
  if(en.cn && E.every(e=>e.cnLo!=null)){
    push({group:"Revenue",src:"cn",metric:"cn_total",label:"Total",better:"high",fmt:null,full:true,note:"whole run — monthly source",
      cells:cellsFrom(e=>cmpMid(e.cnLo,e.cnHi), e=>fmtCNYRange(e.cnLo,e.cnHi))});
    push({group:"Revenue",src:"cn",metric:"cn_perday",label:"Per day",better:"high",fmt:fmtCNY,full:true,note:"÷ full run length",cells:cellsFrom(e=>cmpMid(e.cnLo,e.cnHi)/e.scheduled)});
  }
  // days a run held the top 200 before falling off (never dropping scores highest). Cell shows
  // the day it fell ("day D"), "no drop" if it held the whole window, or "—" if never charted.
  const dropCells=(stats,k)=>stats.map(s=> s.none ? {v:null,disp:null}
    : s.droppedOut ? {v:s.heldDays, disp:`day ${s.dropDay}`} : {v:k+1, disp:"no drop"});
  if(en.jp && kJP>0){ const jf=(f)=>cellsFrom((e,i)=>sJP[i].none?null:f(sJP[i]));
    push({group:"Japan rank",src:"jp",metric:"jp_peak",label:"Peak rank",k:kJP,better:"low",fmt:rk,cells:jf(s=>s.peak)});
    push({group:"Japan rank",src:"jp",metric:"jp_med",label:"Median rank",k:kJP,better:"low",fmt:rk,note:"from day 2 — launch day skipped",cells:jf(s=>s.med)});
    push({group:"Japan rank",src:"jp",metric:"jp_top10",label:"Days in top 10",k:kJP,better:"high",fmt:dOnly,note:"staying power",cells:jf(s=>s.top10)});
    push({group:"Japan rank",src:"jp",metric:"jp_drop",label:"Dropped from top 200",k:kJP,better:"high",note:"day it fell off — later (or no drop) is better",cells:dropCells(sJP,kJP)});
    if(kJP>=5 && E.every((e,i)=>!sJP[i].none && sJP[i].charted>=3))
      push({group:"Japan rank",src:"jp",metric:"jp_decay",label:"Rank decay",k:kJP,better:"low",fmt:dec,note:"places lost per day after the peak",cells:jf(s=>s.degrade)});
  }
  if(en.cnrank && kCN>0){ const cf=(f)=>cellsFrom((e,i)=>sCN[i].none?null:f(sCN[i]));
    push({group:"China rank",src:"cnrank",metric:"cnr_peak",label:"Peak rank",k:kCN,better:"low",fmt:rk,cells:cf(s=>s.peak)});
    push({group:"China rank",src:"cnrank",metric:"cnr_med",label:"Median rank",k:kCN,better:"low",fmt:rk,note:"from day 2 — launch day skipped",cells:cf(s=>s.med)});
    push({group:"China rank",src:"cnrank",metric:"cnr_top10",label:"Days in top 10",k:kCN,better:"high",fmt:dOnly,note:"staying power",cells:cf(s=>s.top10)});
    push({group:"China rank",src:"cnrank",metric:"cnr_drop",label:"Dropped from top 200",k:kCN,better:"high",note:"day it fell off — later (or no drop) is better",cells:dropCells(sCN,kCN)});
    if(kCN>=5 && E.every((e,i)=>!sCN[i].none && sCN[i].charted>=3))
      push({group:"China rank",src:"cnrank",metric:"cnr_decay",label:"Rank decay",k:kCN,better:"low",fmt:dec,note:"places lost per day after the peak",cells:cf(s=>s.degrade)});
  }
  // score each row: single best side wins a point; a tie for best awards none. Also record how
  // close the win was (relative gap between best and runner-up), so the read-out can flag slim leads.
  const points=new Array(M).fill(0); const W={}, margin={};
  for(const r of rows){
    const vs=r.cells.map(c=>c.v), have=vs.filter(v=>v!=null);
    r.scored=have.length>=2;
    if(!r.scored){ r.winner=null; continue; }
    const best = r.better==="high" ? Math.max(...have) : Math.min(...have);
    const idxs=[]; vs.forEach((v,i)=>{ if(v!=null && v===best) idxs.push(i); });
    if(idxs.length===1){ r.winner=idxs[0]; points[idxs[0]]++; W[r.metric]=idxs[0];
      const srt=[...have].sort((a,b)=> r.better==="high"?b-a:a-b), den=Math.max(Math.abs(srt[0]),Math.abs(srt[1]),1e-9);
      r.margin = margin[r.metric] = Math.abs(srt[0]-srt[1])/den;
    } else { r.winner="tie"; W[r.metric]="tie"; }
  }
  const decided=rows.filter(r=>typeof r.winner==="number").length;
  const top=Math.max(...points), leaders=points.filter(p=>p===top).length;
  const overall = (top>0 && leaders===1) ? points.indexOf(top) : "even";
  const ctxRows=[
    {label:"game-i total (full run)", cells:E.map(e=>({disp:e.rev>0?G(e.rev):"—"}))},
    {label:"Full run length", cells:E.map(e=>({disp:`${e.scheduled}d${e.ongoing?" (ongoing)":""}`}))},
  ];
  return {N,M,kGI,kQM,kJP,kCN,rows,ctxRows,points,decided,W,margin,overall,
    skews:E.map((e,i)=>({jpMed:sJP[i].none?null:sJP[i].med, cnMed:sCN[i].none?null:sCN[i].med})),
    charts:{ jp:kJP>0 && sJP.filter(s=>!s.none).length>=2, cn:kCN>0 && sCN.filter(s=>!s.none).length>=2,
             gamei:kGI>0, qimai:kQM>0 } };
}

// ---- per-category plain-English read-out of the numbers -------------------------------
// Revenue: which markets each side wins, and what a split between them implies (Japan vs
// China, mobile vs all-platform, worldwide vs Japan).
const cmpJoinList=arr=> arr.length>1 ? arr.slice(0,-1).join(", ")+" and "+arr[arr.length-1] : (arr[0]||"");
// ---- two-side (rich) read-outs ----
const CMP_CLOSE=0.10;                                  // a win under ~10% ahead reads as "narrow"
function cmpRevComment2(R,A,B){
  const nA=esc(A.name||A.label), nB=esc(B.name||B.label);
  const w=m=> R.W[m]===0?"a":R.W[m]===1?"b":(R.W[m]==="tie"?"draw":undefined);
  const close=m=> R.margin[m]!=null && R.margin[m]<CMP_CLOSE;
  const short={gamei_total:"Japan (game-i)", qimai_total:"China iPhone (Qimai)", st_total:"worldwide (Sensor Tower)", cn_total:"all-platform (CN)"};
  const totals=Object.keys(short).filter(m=>w(m)==="a"||w(m)==="b");
  if(totals.length<1) return "";
  const mark=m=> close(m) ? short[m].replace(/\)$/, ", narrowly)") : short[m];
  const list=ms=>cmpJoinList(ms.map(mark));
  const byA=totals.filter(m=>w(m)==="a"), byB=totals.filter(m=>w(m)==="b");
  if(!byB.length) return `<b>${nA}</b> out-earns ${nB} on every revenue source shown — ${list(byA)}.`;
  if(!byA.length) return `<b>${nB}</b> out-earns ${nA} on every revenue source shown — ${list(byB)}.`;
  const base=`${nA} earns more in ${list(byA)}, ${nB} more in ${list(byB)}`;
  const clauses=[];
  if(w("gamei_total") && w("qimai_total") && w("gamei_total")!==w("qimai_total"))
    clauses.push(`${w("gamei_total")==="a"?nA:nB} is the stronger earner in Japan while ${w("qimai_total")==="a"?nA:nB} leads in China, so they pull revenue from different regions`);
  if(w("cn_total")){ const mob=["gamei_total","qimai_total","st_total"].map(w).filter(x=>x==="a"||x==="b"); const cnName=w("cn_total")==="a"?nA:nB;
    if(mob.length && mob.every(x=>x!==w("cn_total")))
      clauses.push(close("cn_total")
        ? `${cnName} edges ahead once PC and console are counted (the CN all-platform figure), so that lead is marginal`
        : `${cnName} only pulls ahead once PC and console are counted (the CN all-platform figure), which hints at stronger non-mobile revenue`);
  }
  if(w("st_total") && w("gamei_total") && w("st_total")!==w("gamei_total") && !clauses.length)
    clauses.push(`${w("st_total")==="a"?nA:nB} is larger worldwide despite trailing in Japan, so it earns relatively more outside Japan`);
  return clauses.length ? `${base} — ${clauses.slice(0,2).join("; ")}.` : base+".";
}
function cmpRankComment2(R,E,prefix,market){
  const nA=esc(E[0].name||E[0].label), nB=esc(E[1].name||E[1].label);
  const w=k=> R.W[prefix+k]===0?"a":R.W[prefix+k]===1?"b":(R.W[prefix+k]==="tie"?"draw":undefined);
  const asp=[["peak","a higher peak"],["med","a better median"],["top10","more days in the top 10"],["decay","a slower decay"]];
  const aw=[], bw=[];
  for(const [key,phrase] of asp){ const x=w(key); if(x==="a") aw.push({key,phrase}); else if(x==="b") bw.push({key,phrase}); }
  const join=arr=>cmpJoinList(arr.map(o=>o.phrase));
  const strongTied=[["peak","peak rank"],["top10","days in the top 10"]].filter(([k])=>w(k)==="draw").map(([,l])=>l);
  const tieNote = strongTied.length
    ? ` They tie on ${cmpJoinList(strongTied)} — generally the stronger indicator${strongTied.length>1?"s":""} — so they're more evenly matched than that suggests.` : "";
  if(!aw.length && !bw.length)
    return strongTied.length ? `Neck and neck on the ${market} chart — level on ${cmpJoinList(strongTied)}, the stronger indicator${strongTied.length>1?"s":""}.` : "";
  if(!bw.length) return `<b>${nA}</b> leads the ${market} chart — ${join(aw)}.${tieNote}`;
  if(!aw.length) return `<b>${nB}</b> leads the ${market} chart — ${join(bw)}.${tieNote}`;
  const peakW=w("peak"), stayK=["med","top10","decay"];
  const stayA=aw.filter(o=>stayK.includes(o.key)), stayB=bw.filter(o=>stayK.includes(o.key));
  const stayWin = stayA.length>stayB.length?"a":stayB.length>stayA.length?"b":null;
  if(peakW && (peakW==="a"||peakW==="b") && stayWin && peakW!==stayWin){
    const spike=peakW==="a"?nA:nB, hold=stayWin==="a"?nA:nB, held=join(stayWin==="a"?stayA:stayB);
    return `${spike} hit a higher ${market} peak, but ${hold} held the chart better (${held}) — ${spike} was more front-loaded while ${hold} had the staying power.${tieNote}`;
  }
  return `${nA} takes ${join(aw)}; ${nB} takes ${join(bw)} — a mixed ${market} result.${tieNote}`;
}
// ---- N-side (3–4) read-outs: name the leader of the category and what they took ----
function cmpCatCountN(R,E,metrics){                         // {counts[], leaderIdx|null}
  const counts=new Array(E.length).fill(0); let any=false;
  for(const m of metrics){ const wi=R.W[m]; if(typeof wi==="number"){ counts[wi]++; any=true; } }
  if(!any) return {counts, leaderIdx:null};
  const top=Math.max(...counts), n=counts.filter(c=>c===top).length;
  return {counts, leaderIdx:(top>0&&n===1)?counts.indexOf(top):null};
}
function cmpRevCommentN(R,E){
  const metrics=["gamei_total","qimai_total","st_total","cn_total"].filter(m=>m in R.W);
  if(!metrics.length) return "";
  const {counts,leaderIdx}=cmpCatCountN(R,E,metrics);
  if(leaderIdx==null) return `No single side leads on revenue — the sources split between them.`;
  const name=esc(E[leaderIdx].name||E[leaderIdx].label);
  const closeWon=metrics.filter(m=>R.W[m]===leaderIdx && R.margin[m]!=null && R.margin[m]<CMP_CLOSE).length;
  const closeNote=closeWon?` (${closeWon===1?"one":closeWon} by a slim margin)`:"";
  return counts[leaderIdx]===metrics.length
    ? `<b>${name}</b> out-earns the rest on every revenue source shown${closeNote}.`
    : `<b>${name}</b> leads on revenue, topping ${counts[leaderIdx]} of the ${metrics.length} sources${closeNote}.`;
}
function cmpRankCommentN(R,E,prefix,market){
  const metrics=["peak","med","top10","decay"].map(k=>prefix+k).filter(m=>m in R.W);
  if(!metrics.length) return "";
  const {counts,leaderIdx}=cmpCatCountN(R,E,metrics);
  const strongTied=[["peak","peak rank"],["top10","days in the top 10"]].filter(([k])=>R.W[prefix+k]==="tie").map(([,l])=>l);
  const tieNote = strongTied.length ? ` The ${cmpJoinList(strongTied)} — the stronger indicator${strongTied.length>1?"s":""} — ${strongTied.length>1?"were":"was"} tied.` : "";
  if(leaderIdx==null) return `No single side owns the ${market} chart — the measures split.${tieNote}`;
  return `<b>${esc(E[leaderIdx].name||E[leaderIdx].label)}</b> leads the ${market} chart, taking ${counts[leaderIdx]} of the ${metrics.length} measures.${tieNote}`;
}
function cmpComments(R,E){
  if(E.length===2) return {
    "Revenue": cmpRevComment2(R,E[0],E[1]),
    "Japan rank": cmpRankComment2(R,E,"jp_","Japan"),
    "China rank": cmpRankComment2(R,E,"cnr_","China"),
  };
  return {
    "Revenue": cmpRevCommentN(R,E),
    "Japan rank": cmpRankCommentN(R,E,"jp_","Japan"),
    "China rank": cmpRankCommentN(R,E,"cnr_","China"),
  };
}
// One-line summary under the verdict: how decisive the win was and which categories drove it.
function cmpTLDR(R,E){
  if(!R.decided) return "";
  if(R.overall==="even") return "A dead heat — the sides trade wins across the categories.";
  const wi=R.overall, name=esc(E[wi].name||E[wi].label);
  const gap=R.points[wi]-Math.max(...R.points.filter((_,i)=>i!==wi));
  const decisive = gap>=6?"decisively":gap>=3?"comfortably":"narrowly";
  const lead=ms=>cmpCatCountN(R,E,ms.filter(m=>m in R.W)).leaderIdx;
  const rev=lead(["gamei_total","qimai_total","st_total","cn_total"]);
  const jp=lead(["jp_peak","jp_med","jp_top10","jp_drop","jp_decay"]);
  const cn=lead(["cnr_peak","cnr_med","cnr_top10","cnr_drop","cnr_decay"]);
  const won=[]; if(rev===wi)won.push("revenue"); if(jp===wi)won.push("the Japan chart"); if(cn===wi)won.push("the China chart");
  let s=`${name} takes it ${decisive}`;
  if(won.length) s+=`, leading on ${cmpJoinList(won)}`;
  if(E.length===2){ const li=1-wi, ceded=[];
    if(rev===li)ceded.push("revenue"); if(jp===li)ceded.push("the Japan chart"); if(cn===li)ceded.push("the China chart");
    if(ceded.length) s+=`, while ${esc(E[li].name||E[li].label)} took ${cmpJoinList(ceded)}`;
  }
  return s+".";
}

// ---- Compare card rendering (lives above the game tabs; game -> type -> entity) ----
const CMP_KINDS=[["banner","Character"],["month","Month"],["year","Year"],["version","Version"]];
function cmpArtThumb(m,cls){
  if(m.art) return `<img class="${cls||""}" src="${esc(m.art)}" alt="" referrerpolicy="no-referrer" data-fb="mono" data-nm="${esc(m.label)}"${cmpFacePos(m.face)}>`;
  if(m.icon) return `<img class="${cls||""}" src="${esc(m.icon)}" alt="" referrerpolicy="no-referrer" data-fb="mono" data-nm="${esc(m.label)}">`;
  const kindWord = m.kind==="banner" ? "" : (m.kind||"").toUpperCase();
  const artl = m.kind==="version" ? m.key : m.label;   // avoid "VERSION / Version 2.X"
  return `<span class="cmp-artmono ${cls||""}" style="--acc:${m.dispAccent||m.accent}">${kindWord?`<span class="cmp-artk">${esc(kindWord)}</span>`:""}<span class="cmp-artl">${esc(artl)}</span></span>`;
}
// Where each banner's headliner face sits, as a point in the source art (x%,y% from top-left),
// so every Compare crop can aim at the face instead of slicing through it. The bulk comes from
// data/banner_focus.json (detected by scripts/compute_focus.py in the daily refresh, keyed by
// the art URL); this map, keyed by banner name, is only for the rare art where the detected
// point is right but looks off in the crop — and it wins.
const CMP_FACE_OVERRIDE = {
  "シグリッド": {x:25, y:22},          // Sigrid — head tilted down; the detected point sits low
  "花火&景元復刻": {x:60, y:37},       // Sparkle — pull left onto her face, off the frame edge
  "ロビン・夏空の歌": {x:74, y:24},     // Robin — 16:9 promo, face hard right; pull toward centre
};
// Resolve a banner's face point: manual override first, else the detected entry for its art.
// Returns {x,y} in source-% plus natural {w,h} when known, or null when we have nothing to aim at.
function cmpFace(tag, name, art){
  const ov = CMP_FACE_OVERRIDE[name];
  const d = art && state.focus && state.focus[tag] && state.focus[tag][art];
  if(!ov && !d) return null;
  return { x: ov&&ov.x!=null ? ov.x : d.x, y: ov&&ov.y!=null ? ov.y : d.y,
           w: d?d.w:null, h: d?d.h:null };
}
// data-* attributes carrying the face point onto an <img>, read back by cmpFitWedge / used
// directly as object-position on rectangular tiles.
function cmpFaceAttrs(face){
  if(!face) return "";
  return ` data-fx="${face.x}" data-fy="${face.y}"${face.w?` data-fw="${face.w}"`:""}${face.h?` data-fh="${face.h}"`:""}`;
}
function cmpFacePos(face){ return face ? ` style="object-position:${face.x}% ${face.y}%"` : ""; }
// Geometry of the three collage wedges (fractions of the card box): the bounding box each slice
// must stay covered, the target point the face should land on, and how far to zoom in.
// `poly` is the slice's visible outline (card %, matching the CSS clip-paths); `s`..`smax` is the
// zoom range the fit may use; `tys` are candidate face heights; `low` rewards a lower face and
// `centre` penalises a face off the slice's centre line (both bottom-slice only).
const CMP_WEDGE = {
  l: {bx0:0,   bx1:0.5, by0:0, by1:0.8333, tx:0.24, ty:0.30, s:1.35, smax:2.1,
      poly:[[50,50],[50,0],[0,0],[0,83.333]]},
  r: {bx0:0.5, bx1:1,   by0:0, by1:0.8333, tx:0.76, ty:0.30, s:1.35, smax:2.1,
      poly:[[50,50],[50,0],[100,0],[100,83.333]]},
  // bottom: wide view, face low and centred left-right (the title may overlap it — it reads fine
  // over the scrim); the title flips to the right when the face comes from the art's left side
  b: {bx0:0,   bx1:1,   by0:0.5, by1:1,    tx:0.50, ty:0.80, s:1.5, smax:2.4, low:1, centre:3, flip:true,
      tys:[0.80,0.76,0.72], goal:0.10,
      poly:[[50,50],[0,83.333],[0,100],[100,100],[100,83.333]]},
};
// How far a point sits inside a polygon (px; negative = outside): its distance to the nearest edge.
function cmpInset(px,py,poly){
  let inside=false, d=Infinity;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const [xi,yi]=poly[i], [xj,yj]=poly[j];
    if(((yi>py)!==(yj>py)) && (px<(xj-xi)*(py-yi)/(yj-yi)+xi)) inside=!inside;
    const ex=xj-xi, ey=yj-yi, t=Math.max(0,Math.min(1,((px-xi)*ex+(py-yi)*ey)/((ex*ex+ey*ey)||1)));
    d=Math.min(d, Math.hypot(px-(xi+t*ex), py-(yi+t*ey)));
  }
  return inside ? d : -d;
}
// Place one wedge's art so the face lands on the slice's target, without ever showing background.
// Two stages, cheapest first:
//  1. the cover-crop itself: wide (or tall) art overflows the slice box, so object-position
//     slides that overflow to bring the face as close to the target as it allows — free, no zoom;
//  2. a transform (pan + zoom) for the rest, clamped so the slice's bounding box stays covered.
// A face at the very edge of wide art can't be panned onto the target at the base zoom, so the
// search steps zoom up (to `smax`) and keeps the placement with the best score: least zoom, and on
// the bottom slice a lower, more centred face.
function cmpFitWedge(img){
  const fx=img.dataset.fx; if(fx==null||fx==="") return;
  const p=img.parentElement, cls=p.classList;
  const w = cls.contains("cmp-cpw-l")?"l" : cls.contains("cmp-cpw-r")?"r" : cls.contains("cmp-cpw-b")?"b" : null;
  if(!w) return;
  const box=p.getBoundingClientRect(), W=box.width, H=box.height; if(!W||!H) return;
  const fy=img.dataset.fy, c=CMP_WEDGE[w], Ox=W/2, Oy=H/2, ty0=(c.tys||[c.ty])[0];
  // stage 1 — where the face sits in the <img> box before any transform
  let bx, by;
  const natW=img.naturalWidth||+img.dataset.fw, natH=img.naturalHeight||+img.dataset.fh;
  if(natW && natH){
    const sc=Math.max(W/natW, H/natH), rw=natW*sc, rh=natH*sc;
    const sx=(+fx)/100*rw, sy=(+fy)/100*rh;                 // face in the scaled art
    const offX=Math.max(W-rw, Math.min(0, c.tx*W - sx));    // slide the overflow toward the target
    const offY=Math.max(H-rh, Math.min(0, ty0*H - sy));
    const px = rw-W>0.5 ? offX/(W-rw)*100 : 50, py = rh-H>0.5 ? offY/(H-rh)*100 : 50;
    img.style.objectPosition=`${px.toFixed(2)}% ${py.toFixed(2)}%`;
    bx=sx+offX; by=sy+offY;
  } else {                                                  // no size yet: anchor on the face
    img.style.objectPosition=`${fx}% ${fy}%`;               // (it sits at its own % of the box);
    bx=(+fx)/100*W; by=(+fy)/100*H;                          // refit runs again on load
  }
  // stage 2 — pan + zoom
  const poly=c.poly.map(([x,y])=>[x/100*W, y/100*H]);
  const goal=(c.goal||0.16)*H;                              // "comfortably inside": ~a face's width
  let best=null, ok=null;
  for(let S=c.s; S<=c.smax+1e-9; S+=0.05){
    for(const tgy of (c.tys||[c.ty])){
      let tx=c.tx*W - (Ox + S*(bx-Ox)), ty=tgy*H - (Oy + S*(by-Oy));
      const txMax=c.bx0*W - Ox*(1-S), txMin=c.bx1*W - Ox*(1-S) - S*W;
      const tyMax=c.by0*H - Oy*(1-S), tyMin=c.by1*H - Oy*(1-S) - S*H;
      tx=Math.max(txMin,Math.min(txMax,tx)); ty=Math.max(tyMin,Math.min(tyMax,ty));
      const fx2=Ox+S*(bx-Ox)+tx, fy2=Oy+S*(by-Oy)+ty;
      const inset=cmpInset(fx2,fy2,poly);
      const score=(c.low||0)*(fy2/H) - (c.centre||0)*Math.abs(fx2/W - c.tx) - 0.5*(S-c.s);
      const cand={S,tx,ty,inset,score,fx2,fy2};
      if(inset>=goal && (!ok || score>ok.score+1e-6)) ok=cand;
      if(!best || inset>best.inset+0.5) best=cand;
    }
  }
  const pick=ok||best;
  img.style.transform=`translate(${pick.tx.toFixed(1)}px,${pick.ty.toFixed(1)}px) scale(${pick.S.toFixed(2)})`;
  img.style.transformOrigin="center center";
  img._fit={x:pick.fx2/W*100, y:pick.fy2/H*100, S:pick.S};  // where the face ended up (for checks)
  // Mirror the title to the right when the bottom face comes from the LEFT of its art, so the
  // two don't crowd the same corner.
  if(c.flip){
    const txt=p.closest(".cmp-artperiod")?.querySelector(".cmp-cptext");
    if(txt) txt.classList.toggle("is-right", +fx < 50);
  }
}
// Fit every wedge in a just-rendered subtree, and keep fitting each as it loads (natural size
// isn't known until then). Idempotent — safe to call again on resize.
function cmpFitCollages(root){
  (root||document).querySelectorAll(".cmp-cpw img[data-fx]").forEach(img=>{
    cmpFitWedge(img);
    if(!img._fitBound){ img._fitBound=1; img.addEventListener("load",()=>cmpFitWedge(img)); }
  });
}
if(typeof window!=="undefined" && !window._cmpFitResize){
  window._cmpFitResize=1;
  window.addEventListener("resize",()=>cmpFitCollages(document));
}
// A period (month/year/version) has no single artwork, so its card is a collage of the banner
// arts that ran during it (cropped to fill, never stretched), with the game + period overlaid.
function cmpPeriodArt(m){
  const kindWord=(m.kind||"").toUpperCase(), lab=m.kind==="version"?m.key:m.label;
  const list=(m.banners||[]).filter(b=>b.art||b.icon);
  const N=list.length;
  let grid="";
  if(N===3){
    // three wedges meeting at the centre, 120° apart (one up, two to the bottom corners) —
    // clip-path polygons so each banner art fills its slice, cropped not stretched
    const img=b=>`<img src="${esc(b.art||b.icon)}" referrerpolicy="no-referrer" data-fb="remove" alt="" title="${esc(b.label)}"${cmpFaceAttrs(b.face)}>`;
    grid=`<div class="cmp-cp3wrap">
        <div class="cmp-cpw cmp-cpw-l">${img(list[0])}</div>
        <div class="cmp-cpw cmp-cpw-r">${img(list[1])}</div>
        <div class="cmp-cpw cmp-cpw-b">${img(list[2])}</div>
      </div>
      <svg class="cmp-cp3div" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <line x1="50" y1="50" x2="50" y2="0"/><line x1="50" y1="50" x2="0" y2="83.333"/><line x1="50" y1="50" x2="100" y2="83.333"/>
      </svg>
      <div class="cmp-cpscrim"></div>`;
  } else if(N){
    const cols = N<=1?1 : N<=2?2 : N===4?2 : N<=8?3 : 4;
    const rows=Math.ceil(N/cols), empty=cols*rows-N;
    const tiles=list.map((b,idx)=>{
      const span=(idx===N-1&&empty>0)?` style="grid-column:span ${empty+1}"`:"";
      return `<div class="cmp-cptile"${span}><img src="${esc(b.art||b.icon)}" referrerpolicy="no-referrer" data-fb="remove" alt="" title="${esc(b.label)}"${cmpFacePos(b.face)}></div>`;
    }).join("");
    grid=`<div class="cmp-cpgrid" style="grid-template-columns:repeat(${cols},1fr)">${tiles}</div><div class="cmp-cpscrim"></div>`;
  }
  return `<div class="cmp-artperiod cmp-art-img${N?" has-art":""}" style="--acc:${m.dispAccent||m.accent}">
     ${grid}
     <div class="cmp-cptext">
       <span class="cmp-ap-head"><span class="cmp-ap-kind">${esc(kindWord)}</span>${esc(m.game)}</span>
       <span class="cmp-ap-label">${esc(lab)}</span>
       ${N?"":`<span class="cmp-ap-none">no banners ran</span>`}
     </div>
   </div>`;
}
function cmpPicks(){ const c=state.compare; if(!Array.isArray(c.picks)) c.picks=[]; return c.picks; }
function cmpReady(s){ return s && s.tag && s.kind && s.key!=null && s.key!==""; }
// Same exact pick (reruns are distinct banners with their own key, so they're allowed).
function cmpSame(x,y){ return x&&y && x.tag===y.tag && x.kind===y.kind && String(x.key)===String(y.key); }
function cmpDefaultGame(){ return (state.games||[]).some(g=>g.game===state.tag) ? state.tag : (state.games[0]&&state.games[0].game); }
function cmpMiniAv(m){
  if(m.icon) return `<img src="${esc(m.icon)}" referrerpolicy="no-referrer" data-fb="remove" alt="">`;
  if(m.art)  return `<img src="${esc(m.art)}" referrerpolicy="no-referrer" data-fb="remove" alt="">`;
  return `<span class="cmp-mono sm" style="--acc:${m.dispAccent||m.accent}">${esc((m.label||"?")[0]||"?")}</span>`;
}
// Give each side a distinct display colour: keep the character's own accent, but when two
// sides would share a hue (e.g. comparing a character with its own reruns) shift the later
// ones onto a fallback palette so every card, cell and chart line stays tellable apart.
const CMP_PALETTE=["#4f8fe0","#e8843c","#46b38a","#b06fd0","#d9534f","#e0b83a"];
function cmpAssignColors(E){
  const hue=hex=>hexToHsl(hex)[0]*360;
  const clash=(hex,list)=>list.some(o=>{ let d=Math.abs(hue(hex)-hue(o)); d=Math.min(d,360-d); return d<24; });
  const out=[]; let pi=0;
  for(const e of E){ let c=e.accent||"#888";
    if(clash(c,out)){ while(pi<CMP_PALETTE.length){ const cand=CMP_PALETTE[pi++]; if(!clash(cand,out)){ c=cand; break; } } }
    out.push(c); e.dispAccent=c;
  }
  return out;
}
// One picker column (by index): game, type, then the entity control. Slots after the second
// carry a remove button; a banner with reruns carries a one-click "compare its reruns".
function cmpSlotHTML(i){
  const picks=cmpPicks(), sel=picks[i]||{};
  const gameOpts=(state.games||[]).map(g=>`<option value="${g.game}"${g.game===sel.tag?" selected":""}>${esc(g.name)}</option>`).join("");
  const kindOpts=CMP_KINDS.filter(([k])=>k!=="version"||hasVersions(sel.tag)).map(([k,lab])=>`<option value="${k}"${k===sel.kind?" selected":""}>${lab}</option>`).join("");
  const takenElsewhere=(p)=>picks.some((o,j)=>j!==i && o && o.kind==="banner" && o.tag===sel.tag && +o.key===(p.i!=null?p.i:+p.key));
  let ent="";
  if(sel.kind==="banner"){
    const m=(sel.key!=null)?entityMetrics(sel):null;
    const runs = m ? (state._cmpRunCounts[sel.tag+"|"+m.label.toLowerCase()]||0) : 0;
    const chip=m?`<div class="cmp-chip" style="--acc:${m.accent}">
        <span class="cmp-chip-av">${cmpArtThumb(m)}</span>
        <span class="cmp-chip-tx"><b>${esc(m.label)}</b><span class="cmp-chip-sub">${esc(m.sub)}</span></span>
        ${runs>=2?`<button class="cmp-chip-rr" type="button" data-cmp-reruns="${i}" title="Compare all ${runs} of ${esc(m.label)}'s banners">↻ reruns</button>`:""}
        <button class="cmp-chip-x" type="button" data-cmp-clear="${i}" title="Clear" aria-label="Clear">×</button>
      </div>`:"";
    ent=`${chip}<div class="cmp-combo">
        <input class="cmp-input" type="text" data-cmp-input="${i}" autocomplete="off" spellcheck="false"
          placeholder="${sel.key!=null?"Change character…":"Search a character…"}" aria-label="Pick character for side ${i+1}">
        <div class="cmp-drop" data-cmp-drop="${i}" hidden></div></div>`;
  } else {
    const ctx=state._ctx&&state._ctx[sel.tag];
    const periods=ctx?gamePeriods(ctx, sel.kind):[];
    const opts=periods.map(p=>{ const taken=takenElsewhere(p);
      return `<option value="${esc(p.key)}"${p.key===sel.key?" selected":""}${taken?" disabled":""}>${esc(p.label)}${taken?" (in use)":""}</option>`;}).join("");
    ent=`<select class="cmp-sel cmp-entsel" data-cmp-ent="${i}" aria-label="Pick ${sel.kind} for side ${i+1}">
        <option value="">Choose a ${esc(sel.kind)}…</option>${opts}</select>`;
  }
  return `<div class="cmp-slot">
     <div class="cmp-slot-h"><span>Side ${i+1}</span>${picks.length>2?`<button class="cmp-slotrm" type="button" data-cmp-remove="${i}" title="Remove this side" aria-label="Remove">×</button>`:""}</div>
     <div class="cmp-controls">
       <select class="cmp-sel" data-cmp-game="${i}" aria-label="Game for side ${i+1}">${gameOpts}</select>
       <select class="cmp-sel" data-cmp-kind="${i}" aria-label="What to compare for side ${i+1}">${kindOpts}</select>
     </div>
     <div class="cmp-entpick">${ent}</div>
   </div>`;
}
function renderCmpDrop(i,q){
  const picks=cmpPicks(), sel=picks[i]; const d=$(`[data-cmp-drop="${i}"]`); if(!d||!sel) return;
  const taken=new Set(picks.filter((o,j)=>j!==i && o && o.kind==="banner" && o.tag===sel.tag).map(o=>+o.key));
  const ql=(q||"").trim().toLowerCase();
  let items=(state._cmpIndex||[]).filter(it=>it.gtag===sel.tag && !taken.has(it.i));
  if(ql) items=items.filter(it=>it.label.toLowerCase().includes(ql)
    || (it.en&&it.en.toLowerCase().includes(ql)) || (it.jp&&it.jp.toLowerCase().includes(ql)));
  items=items.slice().sort((a,b)=> a.start<b.start?1 : a.start>b.start?-1 : 0);   // newest release first, all of them
  if(!items.length){ d.innerHTML=`<div class="cmp-drop-empty">No matches</div>`; d.hidden=false; cmpSizeDrop(d); return; }
  d.innerHTML=items.map(it=>`<div class="cmp-drop-item" data-cmp-pick="${it.i}" data-slot="${i}">
     <span class="cmp-di-av">${it.icon?`<img src="${esc(it.icon)}" referrerpolicy="no-referrer" data-fb="remove" alt="">`:`<span class="cmp-mono sm">${esc((it.label||"?")[0]||"?")}</span>`}</span>
     <span class="cmp-di-tx"><b>${esc(it.label)}</b><span class="cmp-di-sub">${esc(cmpDate(it.start))}${it.rerun?" · ↻":""}</span></span>
     <span class="cmp-di-rev">${it.rev>0?G(it.rev):""}</span></div>`).join("");
  d.hidden=false;
  cmpSizeDrop(d);
}
// The list is absolutely positioned inside the dialog, whose overflow clips it. Cap its height
// to the room left below the input so it scrolls internally instead of being cut off.
function cmpSizeDrop(d){
  const card=d.closest(".modal-card");
  const floor=card ? card.getBoundingClientRect().bottom : window.innerHeight;
  const avail=Math.min(floor, window.innerHeight) - d.getBoundingClientRect().top - 12;
  d.style.maxHeight=Math.max(140, Math.min(360, avail))+"px";
}
function wireComparePickers(){
  cmpPicks().forEach((p,i)=>{
    const inp=$(`[data-cmp-input="${i}"]`); if(!inp) return;
    inp.addEventListener("input",()=>renderCmpDrop(i,inp.value));
    inp.addEventListener("focus",()=>renderCmpDrop(i,inp.value));
    inp.addEventListener("blur",()=>setTimeout(()=>{ const d=$(`[data-cmp-drop="${i}"]`); if(d) d.hidden=true; },160));
  });
}
// ---- shareable link (encodes picks + which sources are off, in the ?c= query) ----
function cmpEncodePicks(){ return cmpPicks().filter(cmpReady).map(p=>`${p.tag}:${p.kind}:${p.key}`).join("~"); }
function cmpUpdateURL(){
  try{ const url=new URL(location.href), c=cmpEncodePicks();
    if(c) url.searchParams.set("c",c); else url.searchParams.delete("c");
    const off=CMP_SOURCES.filter(([k])=>!cmpSources()[k]).map(([k])=>k).join(",");
    if(off) url.searchParams.set("coff",off); else url.searchParams.delete("coff");
    history.replaceState(null,"",url);
  }catch(e){}
}
function cmpParseURL(){
  try{ const p=new URLSearchParams(location.search), c=p.get("c"); if(!c) return null;
    const picks=c.split("~").filter(Boolean).map(s=>{ const [tag,kind,key]=s.split(":");
      return {tag, kind, key: kind==="banner"?+key:key}; });
    return {picks, off:(p.get("coff")||"").split(",").filter(Boolean)};
  }catch(e){ return null; }
}
// ---- overlay chart: every side's daily curve on one axis, over the day-capped window ----
function cmpChartSVG(E,R){
  const kind=state.compare.chart, rankMode=(kind==="jp"||kind==="cn");
  const k = kind==="jp"?R.kJP : kind==="cn"?R.kCN : kind==="gamei"?R.kGI : R.kQM;
  if(!k) return "";
  const series=E.map(e=>{ let pts;
    if(kind==="jp") pts=(e.jp||[]).slice(0,k);
    else if(kind==="cn") pts=(e.cn||[]).slice(0,k);
    else if(kind==="gamei") pts=(e.gi||[]).slice(0,k).map(d=>d.cum);
    else { let cum=0; pts=(e.qmDaily||[]).slice(0,k).map(v=>(cum+=(v||0))); }
    return {name:e.name||e.label, accent:e.dispAccent||e.accent, pts};
  });
  const W=720,H=250,ML=52,MR=14,MT=14,MB=26,pW=W-ML-MR,pH=H-MT-MB, n=k;
  const xOf=i=> n>1?ML+(i/(n-1))*pW:ML+pW/2;
  let grid, yOf;
  if(rankMode){
    const worst=Math.max(1,...series.flatMap(s=>s.pts.filter(v=>v!=null)));
    const ymax = worst<=10?10:worst<=20?20:worst<=30?30:worst<=50?50:worst<=100?100:200;
    yOf=r=>MT+((r-1)/(ymax-1))*pH;
    grid=[...new Set([1,Math.round(ymax/4),Math.round(ymax/2),Math.round(3*ymax/4),ymax])]
      .map(r=>{const y=yOf(r);return `<line class="grid" x1="${ML}" y1="${y.toFixed(1)}" x2="${W-MR}" y2="${y.toFixed(1)}"/><text class="axislbl" x="${ML-6}" y="${(y+3).toFixed(1)}" text-anchor="end">#${r}</text>`;}).join("");
  } else {
    const max=Math.max(1,...series.flatMap(s=>s.pts.filter(v=>v!=null)));
    const fmt=kind==="gamei"?G:fmtUSD;
    yOf=v=>MT+(1-v/max)*pH;
    grid=[0,.25,.5,.75,1].map(fr=>{const v=max*fr,y=yOf(v);return `<line class="grid" x1="${ML}" y1="${y.toFixed(1)}" x2="${W-MR}" y2="${y.toFixed(1)}"/><text class="axislbl" x="${ML-6}" y="${(y+3).toFixed(1)}" text-anchor="end">${fmt(v)}</text>`;}).join("");
  }
  const xt=[...new Set([0,Math.round((n-1)/3),Math.round(2*(n-1)/3),n-1])].filter(i=>i>=0)
    .map(i=>`<text class="axislbl" x="${xOf(i).toFixed(1)}" y="${H-8}" text-anchor="middle">d${i+1}</text>`).join("");
  const lines=series.map(s=>{ let d="",pen=false;
    s.pts.forEach((v,i)=>{ if(v==null){pen=false;return;} const x=xOf(i),y=yOf(v); d+=`${pen?"L":"M"}${x.toFixed(1)} ${y.toFixed(1)}`; pen=true; });
    const dots=s.pts.map((v,i)=>v==null?"":`<circle cx="${xOf(i).toFixed(1)}" cy="${yOf(v).toFixed(1)}" r="2.4" fill="${s.accent}"/>`).join("");
    return `<path d="${d}" fill="none" stroke="${s.accent}" stroke-width="2.2" stroke-linejoin="round"/>${dots}`;
  }).join("");
  // hover layer: a guideline, a highlight group filled on hover, and one invisible band per day
  const guide=`<line id="cmpGuide" class="cmp-guide" x1="0" y1="${MT}" x2="0" y2="${MT+pH}" style="opacity:0"/>`;
  const bandHalf = n>1 ? (pW/(n-1))/2 : pW/2;
  const hits=Array.from({length:n},(_,i)=>{ const x=Math.max(ML, xOf(i)-bandHalf), w=Math.min(W-MR-x, bandHalf*2);
    return `<rect class="cmp-hit" data-cd="${i}" x="${x.toFixed(1)}" y="${MT}" width="${Math.max(0,w).toFixed(1)}" height="${pH}" fill="transparent"/>`;}).join("");
  _cmpChartCtx={ series, n, rankMode, xOf, yOf, MT, botY:MT+pH,
    fmt: rankMode?null:(kind==="gamei"?G:fmtUSD) };
  const legend=`<div class="cmp-legend">${series.map(s=>`<span class="cmp-leg"><span class="cmp-legdot" style="background:${s.accent}"></span>${esc(s.name)}</span>`).join("")}</div>`;
  return `<svg class="cmp-chartsvg rcsvg" viewBox="0 0 ${W} ${H}" role="img">${grid}${guide}<g id="cmpHi"></g>${lines}${xt}${hits}</svg>${legend}`;
}
let _cmpChartCtx=null;
// hover read-out for the overlay chart: lists every side's value at the hovered day (so
// overlapping / near-overlapping lines are still separable), with a guideline and dot markers.
function cmpChartTip(i,e){
  const c=_cmpChartCtx, svg=document.querySelector("#cmpBody .cmp-chartsvg"); if(!c||!svg){ bmTip.hidden=true; return; }
  const x=c.xOf(i);
  const g=svg.querySelector("#cmpGuide"); if(g){ g.setAttribute("x1",x.toFixed(1)); g.setAttribute("x2",x.toFixed(1)); g.style.opacity="1"; }
  const hi=svg.querySelector("#cmpHi");
  if(hi) hi.innerHTML=c.series.map(s=>{ const v=s.pts[i]; if(v==null) return "";
    return `<circle cx="${x.toFixed(1)}" cy="${c.yOf(v).toFixed(1)}" r="4.5" fill="${s.accent}" stroke="var(--surface)" stroke-width="1.6"/>`;}).join("");
  const val=v=> v==null ? '<span style="color:var(--muted)">below #200</span>' : (c.rankMode?("#"+v):c.fmt(v));
  const rows=c.series.map(s=>`<div class="cmp-tiprow"><span class="cmp-tipdot" style="background:${s.accent}"></span><span class="cmp-tipnm">${esc(s.name)}</span><span class="cmp-tipval">${val(s.pts[i])}</span></div>`).join("");
  bmTip.innerHTML=`<div class="body"><div class="cmp-tiphd">Day ${i+1}</div>${rows}</div>`;
  bmTip.hidden=false;
  const pad=14,w=bmTip.offsetWidth,h=bmTip.offsetHeight;
  let px=e.clientX+pad,py=e.clientY+pad;
  if(px+w>innerWidth)px=e.clientX-w-pad; if(py+h>innerHeight)py=e.clientY-h-pad;
  bmTip.style.left=Math.max(6,px)+"px"; bmTip.style.top=Math.max(6,py)+"px";
}
function cmpChartHideTip(){ bmTip.hidden=true; const svg=document.querySelector("#cmpBody .cmp-chartsvg"); if(!svg) return;
  const g=svg.querySelector("#cmpGuide"); if(g) g.style.opacity="0"; const hi=svg.querySelector("#cmpHi"); if(hi) hi.innerHTML=""; }
async function renderCompare(){
  const body=$("#cmpBody"); if(!body) return;
  if(!state._cmpIndex){
    body.innerHTML=`<div class="cmp-loading">Loading every game for comparison…</div>`;
    try{ await buildCompareIndex(); }
    catch(e){ body.innerHTML=`<div class="cmp-loading err">Couldn't load the games to compare (${esc(e.message||e)}).</div>`; return; }
  }
  const picks=cmpPicks(), dg=cmpDefaultGame();
  if(picks.length<2){ while(picks.length<2) picks.push({tag:dg, kind:"banner", key:null}); }
  // prefill side 1 with the game's top banner so it isn't empty on first open
  if(picks[0].kind==="banner" && picks[0].key==null){
    const first=(state._cmpIndex||[]).find(it=>it.gtag===picks[0].tag); if(first) picks[0].key=first.i;
  }
  cmpUpdateURL();
  // widen the dialog with more sides, shrink back with fewer, so it fits the cards
  const card=document.querySelector("#compareModal .modal-card");
  if(card) card.style.maxWidth=({2:900,3:1060,4:1200}[picks.length]||900)+"px";
  body.innerHTML=`<div class="cmp-wrap">
      <div class="cmp-intro">Pick two to four of anything — a <b>character</b>, a <b>month</b>, a <b>year</b> or a <b>version</b>, from any game. Every metric is compared <b>day for day</b> over the shortest one, and whoever wins the most comes out on top.</div>
      <div class="cmp-pickers">${picks.map((p,i)=>cmpSlotHTML(i)).join("")}${picks.length<4?`<button class="cmp-add" type="button" data-cmp-add title="Add another side">＋<span>Add</span></button>`:""}</div>
      <div class="cmp-toolbar"><button class="cmp-linkbtn" type="button" data-cmp-link>🔗 Copy link</button></div>
      <div id="cmpResult"></div></div>`;
  wireComparePickers();
  renderCompareResult();
}
function renderCompareResult(){
  const host=$("#cmpResult"); if(!host) return;
  const allPicks=cmpPicks();
  const readyIdx=allPicks.map((_,idx)=>idx).filter(idx=>cmpReady(allPicks[idx]));   // original slot indices
  const picks=readyIdx.map(idx=>allPicks[idx]);
  if(picks.length<2){
    host.innerHTML=`<div class="cmp-empty">${picks.length?"Pick a second thing to compare.":"Choose a game, a type, then a pick on each side."}</div>`; return;
  }
  for(let i=0;i<picks.length;i++) for(let j=i+1;j<picks.length;j++) if(cmpSame(picks[i],picks[j])){
    host.innerHTML=`<div class="cmp-empty">Two sides are the same ${picks[i].kind==="banner"?"banner":picks[i].kind} — pick different things to compare.</div>`; return;
  }
  const E=picks.map(entityMetrics).filter(Boolean);
  if(E.length<2){ host.innerHTML=`<div class="cmp-empty">Couldn't read one of the picks.</div>`; return; }
  cmpAssignColors(E);                 // distinct per-side colour (de-collides same-character reruns)
  const R=buildComparison(E), M=E.length;
  const crossGame=new Set(E.map(e=>e.gtag)).size>1, mixedKind=new Set(E.map(e=>e.kind)).size>1;

  // ---- warnings ----
  const warns=[];
  const shorter = E.reduce((m,e)=> e.runDays<m.runDays?e:m, E[0]);
  warns.push(`<b>Comparing the first ${R.N} day${R.N!==1?"s":""}</b> — the length of the shortest run${shorter.ongoing?` (${esc(shorter.label)} is still ongoing, day ${shorter.runDays})`:""}. Every scored metric is measured over that same window for all sides.`);
  if(crossGame) warns.push(`<b>Different games.</b> These are measured on different scales and player bases — treat cross-game revenue and rank gaps as rough, not like-for-like.`);
  if(mixedKind) warns.push(`<b>Different scopes.</b> A character, a month and a version cover different spans — the day-for-day cap keeps it fair, but read it as a curiosity.`);
  if(R.kCN===0) warns.push(`No shared <b>China rank</b> window — at least one side has no China chart data, so those rows are skipped.`);
  if(R.kQM===0) warns.push(`No shared <b>Qimai</b> window — at least one side has no China-iPhone revenue data, so those rows are skipped.`);

  // ---- side cards ----
  const even=R.overall==="even";
  const skewChip=i=>{ const s=R.skews[i]; if(s.jpMed==null||s.cnMed==null) return "";
    const d=s.jpMed-s.cnMed, lab=d>=8?"China-leaning":d<=-8?"Japan-leaning":"Balanced JP/CN";
    return `<span class="cmp-chip2" title="Median rank over the window, from day 2 (launch day skipped) — Japan #${Math.round(s.jpMed)} vs China #${Math.round(s.cnMed)}">${lab}</span>`; };
  const pctChip=e=> e.pct!=null?`<span class="cmp-chip2" title="Mean percentile across its available sources, among ${esc(e.game)}'s banners (higher = stronger)">${ordinal(e.pct)} pct · ${esc(e.game)}</span>`:"";
  const noteLines=e=>{ let h="";
    if(e.rival) h+=`<div class="cmp-cardnote" title="About ${Math.round(e.rival.frac*100)}% of this run's revenue overlapped a concurrent banner, which can split spending">↔ ran alongside <b>${esc(e.rival.name)}</b></div>`;
    if(e.proj) h+=`<div class="cmp-cardnote" title="From how much this game's finished banners have usually banked by day ${e.proj.day}">→ tracking toward <b>${G(e.proj.projTotal)}</b> (day ${e.proj.day} of ${e.proj.scheduled})</div>`;
    return h; };
  const card=(e,i)=>{
    const won=R.overall===i, lost=!even && !won;
    const ribbon = even ? `<span class="cmp-ribbon tie">TIE</span>` : won ? `<span class="cmp-ribbon win">★ WINNER</span>` : `<span class="cmp-ribbon lose">LOSER</span>`;
    const art = e.kind==="banner" ? cmpArtThumb(e,"cmp-art-img") : cmpPeriodArt(e);
    return `<div class="cmp-side${won?" is-win":""}${lost?" is-lose":""}${even?" is-tie":""}" style="--acc:${e.dispAccent||e.accent}" data-cmp-side="${readyIdx[i]}" title="Click to change this side">
        <div class="cmp-art">${art}${ribbon}</div>
        <div class="cmp-sidename"><b>${esc(e.label)}</b>
          <span class="cmp-sidesub">${esc(e.sub)}${e.ongoing?" · ● ongoing":""}</span>
          <div class="cmp-chips">${R.decided?`<span class="cmp-scorepill">won ${R.points[i]} of ${R.decided}</span>`:""}${skewChip(i)}${pctChip(e)}</div>
          ${noteLines(e)}
        </div>
      </div>`;
  };
  const vs=`<div class="cmp-vs cmp-cols${M}">${E.map((e,i)=>card(e,i)).join("")}</div>`;

  // ---- verdict (head-to-head phrasing for two sides, a points line for more) ----
  const tied=R.rows.filter(r=>r.winner==="tie").length;
  let verdict;
  if(!R.decided) verdict=`No decisive metrics for the selected sources.`;
  else if(M===2){
    const drawn = tied?` (${tied} drawn)`:"";
    verdict = even
      ? `<b>It's a tie</b> — ${R.points[0]} each${drawn}.`
      : `<b>${esc(E[R.overall].name||E[R.overall].label)}</b> wins the head-to-head, ${Math.max(R.points[0],R.points[1])}–${Math.min(R.points[0],R.points[1])}${drawn}.`;
  } else {
    const pointsStr=E.map((e,i)=>`${esc(e.label)} ${R.points[i]}`).join(" · ");
    verdict = even ? `<b>Too close to call</b> — ${pointsStr}.` : `<b>${esc(E[R.overall].name||E[R.overall].label)}</b> comes out on top — ${pointsStr}.`;
  }
  const tldr=cmpTLDR(R,E);

  // ---- charts ----
  const chartTypes=[["jp","JP rank"],["cn","CN rank"],["gamei","game-i ¥"],["qimai","Qimai $"]].filter(([t])=>R.charts[t]);
  let chartHTML="";
  if(chartTypes.length){
    if(!R.charts[state.compare.chart]) state.compare.chart=chartTypes[0][0];
    chartHTML=`<div class="cmp-charts">
      <div class="cmp-chartsel">${chartTypes.map(([t,l])=>`<button type="button" class="cmp-chartbtn${state.compare.chart===t?" on":""}" data-cmp-chart="${t}">${l}</button>`).join("")}</div>
      ${cmpChartSVG(E,R)}</div>`;
  }

  // ---- source toggles ----
  const en=cmpSources();
  const avail={ gamei:R.kGI>0, qimai:R.kQM>0, st:E.every(e=>e.stTotal!=null), cn:E.every(e=>e.cnLo!=null), jp:R.kJP>0, cnrank:R.kCN>0 };
  const tog=`<div class="cmp-srcbar"><span class="cmp-srclabel">Sources</span>${CMP_SOURCES.map(([k,lab])=>
    `<button type="button" class="cmp-srctog${en[k]?" on":""}${avail[k]?"":" na"}" data-cmp-src="${k}"${avail[k]?"":' disabled title="No data for these picks"'}>${lab}</button>`).join("")}</div>`;

  // ---- metric table ----
  const comments=cmpComments(R,E);
  const cell=(r,i)=>{ const c=r.cells[i], v=c.v, win=r.winner===i;
    const txt = v==null?'<span class="cmp-na">—</span>':(c.disp!=null?esc(c.disp):(r.fmt?r.fmt(v):String(v)));
    return `<div class="cmp-cell${win?" w":""}" style="--acc:${E[i].dispAccent||E[i].accent}">${txt}${win?'<span class="cmp-tick">✓</span>':""}</div>`; };
  const mhead=`<div class="cmp-mrow cmp-mhead"><div class="cmp-lab"></div>${E.map(e=>
    `<div class="cmp-mh" style="--acc:${e.dispAccent||e.accent}"><span class="cmp-mh-av">${cmpMiniAv(e)}</span><span class="cmp-mh-nm">${esc(e.name||e.label)}</span></div>`).join("")}</div>`;
  const SRC_SUB={ gamei:"game-i — Japan mobile (¥)", qimai:"Qimai — China iPhone ($)",
    st:"Sensor Tower — worldwide mobile ($)", cn:"CN — all-platform, incl. PC/console (CN¥)" };
  let rowsHTML="", lastGroup="", lastSrc="";
  const flush=g=>{ if(comments[g]) rowsHTML+=`<div class="cmp-comment">${comments[g]}</div>`; };
  for(const r of R.rows){
    if(r.group!==lastGroup){ if(lastGroup) flush(lastGroup); rowsHTML+=`<div class="cmp-grp">${esc(r.group)}</div>`; lastGroup=r.group; lastSrc=""; }
    if(r.group==="Revenue" && r.src!==lastSrc){ rowsHTML+=`<div class="cmp-subgrp">${esc(SRC_SUB[r.src]||r.src)}</div>`; lastSrc=r.src; }
    const kNote = r.full ? "" : (r.k&&r.k!==R.N ? `<span class="cmp-k">first ${r.k}d</span>` : "");
    rowsHTML+=`<div class="cmp-mrow cmp-row${r.scored?"":" cmp-unscored"}">
        <div class="cmp-lab"><span class="cmp-lab-t">${esc(r.label)}</span>${kNote}${r.note?`<span class="cmp-note">${esc(r.note)}</span>`:""}${r.winner==="tie"?`<span class="cmp-draw">tie</span>`:""}</div>
        ${E.map((e,i)=>cell(r,i)).join("")}
      </div>`;
  }
  if(lastGroup) flush(lastGroup);
  if(!R.rows.length) rowsHTML=`<div class="cmp-empty" style="margin:14px">No metrics for the selected sources — turn some on above.</div>`;
  rowsHTML+=`<div class="cmp-grp">For reference — full run<span class="cmp-grp-sub">not day-capped, so not scored</span></div>`;
  for(const r of R.ctxRows){
    rowsHTML+=`<div class="cmp-mrow cmp-row cmp-unscored"><div class="cmp-lab"><span class="cmp-lab-t">${esc(r.label)}</span></div>${r.cells.map((c,i)=>`<div class="cmp-cell" style="--acc:${E[i].dispAccent||E[i].accent}">${c.disp}</div>`).join("")}</div>`;
  }

  host.innerHTML=`${vs}
    <div class="cmp-verdict">${verdict}${tldr?`<div class="cmp-tldr">${tldr}</div>`:""}</div>
    <div class="cmp-warn">${warns.map(w=>`<p>${w}</p>`).join("")}</div>
    ${chartHTML}
    ${tog}
    <div class="cmp-metrics" style="--cols:${M}">${mhead}${rowsHTML}</div>`;
  cmpFitCollages(host);   // pan each 3-wedge art onto its face (needs the DOM box sizes)
}
// Open a compared entity's own detail dialog (banner modal / period modal). These read the
// live game state, so switch to that game first; the detail modal layers above the compare one.
async function openCompareDetail(p){
  if(!cmpReady(p)) return;
  if(state.tag!==p.tag){ try{ await selectGame(p.tag); }catch(e){ return; } }
  if(p.kind==="banner"){ const b=state.data.banners[+p.key]; if(b) openBanner(b); }
  else openPeriod(p.kind, String(p.key));
}
// Compare dialog open/close.
$("#cmpOpen").onclick=()=>{ $("#compareModal").hidden=false; renderCompare(); };
$("#cmpClose").onclick=()=>{ $("#compareModal").hidden=true; cmpChartHideTip(); };
$("#compareModal").addEventListener("click",e=>{ if(e.target.id==="compareModal"){ $("#compareModal").hidden=true; cmpChartHideTip(); } });
// picker actions (delegated once on the persistent dialog body). Character picks fire on
// mousedown+preventDefault so the input doesn't blur and hide the list before the pick lands.
$("#cmpBody").addEventListener("mousedown",e=>{
  const pick=e.target.closest("[data-cmp-pick]"); if(!pick) return;
  e.preventDefault();
  const i=+pick.dataset.slot, picks=cmpPicks();
  picks[i]={tag:picks[i].tag, kind:"banner", key:+pick.dataset.cmpPick};
  renderCompare();
});
$("#cmpBody").addEventListener("click",e=>{
  const picks=cmpPicks();
  const clr=e.target.closest("[data-cmp-clear]");
  if(clr){ const s=picks[+clr.dataset.cmpClear]; if(s) s.key=null; renderCompare(); return; }
  const rr=e.target.closest("[data-cmp-reruns]");
  if(rr){ const s=picks[+rr.dataset.cmpReruns], m=entityMetrics(s);
    if(m){ const runs=cmpRunsOf(s.tag,m.label).slice(0,4);
      if(runs.length>=2){ state.compare.picks=runs.map(it=>({tag:it.gtag,kind:"banner",key:it.i})); } }
    renderCompare(); return; }
  const rm=e.target.closest("[data-cmp-remove]");
  if(rm){ if(picks.length>2){ picks.splice(+rm.dataset.cmpRemove,1); renderCompare(); } return; }
  // click a result card -> open that entity's detail dialog (banner modal, or period modal)
  const sideCard=e.target.closest("[data-cmp-side]");
  if(sideCard){ openCompareDetail(cmpPicks()[+sideCard.dataset.cmpSide]); return; }
  if(e.target.closest("[data-cmp-add]")){ if(picks.length<4){ picks.push({tag:cmpDefaultGame(),kind:"banner",key:null}); renderCompare(); } return; }
  const src=e.target.closest("[data-cmp-src]");
  if(src && !src.disabled){ const s=cmpSources(); s[src.dataset.cmpSrc]=!s[src.dataset.cmpSrc]; cmpUpdateURL(); renderCompareResult(); return; }
  const ch=e.target.closest("[data-cmp-chart]");
  if(ch){ state.compare.chart=ch.dataset.cmpChart; renderCompareResult(); return; }
  const lk=e.target.closest("[data-cmp-link]");
  if(lk){ cmpUpdateURL(); const done=()=>{ lk.classList.add("ok"); lk.textContent="✓ Copied!"; setTimeout(()=>{ lk.classList.remove("ok"); lk.textContent="🔗 Copy link"; },1600); };
    if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(location.href).then(done,done); else done(); return; }
});
// overlay-chart hover: show every side's value at the hovered day (handles line overlap)
$("#cmpBody").addEventListener("mousemove",e=>{
  const hit=e.target.closest(".cmp-hit");
  if(hit) cmpChartTip(+hit.dataset.cd,e); else if(!bmTip.hidden) cmpChartHideTip();
});
$("#cmpBody").addEventListener("mouseleave",cmpChartHideTip);
$("#cmpBody").addEventListener("change",e=>{
  const picks=cmpPicks();
  const g=e.target.closest("[data-cmp-game]");
  if(g){ const s=picks[+g.dataset.cmpGame]; s.tag=g.value;
    if(s.kind==="version" && !hasVersions(s.tag)) s.kind="banner"; s.key=null; renderCompare(); return; }
  const k=e.target.closest("[data-cmp-kind]");
  if(k){ const s=picks[+k.dataset.cmpKind]; s.kind=k.value; s.key=null; renderCompare(); return; }
  const en=e.target.closest("[data-cmp-ent]");
  if(en){ const s=picks[+en.dataset.cmpEnt]; s.key=en.value||null; cmpUpdateURL(); renderCompareResult(); return; }
});

// ---- character search + autocomplete (applies to every view) ----
const searchInput=$("#searchInput"), searchAC=$("#searchAC"), searchClear=$("#searchClear");
let _acItems=[], _acSel=-1;
// unique characters for this game (icon + display name + JP name), from real banners
function charIndex(){
  const seen=new Map();
  (state.data?state.data.banners:[]).forEach(b=>{ if(b._synthetic) return;
    const label=bnm(b), key=label.toLowerCase();
    const prev=seen.get(key);
    if(!prev) seen.set(key,{label, jp:b.name!==label?b.name:"", icon:(b.icons&&b.icons[0])||"", rev:b.rev, n:1});
    else { prev.rev+=b.rev; prev.n++; if(!prev.icon&&b.icons&&b.icons[0]) prev.icon=b.icons[0]; }
  });
  return [...seen.values()].sort((a,c)=>c.rev-a.rev);
}
function applySearch(v){
  state.search=v;
  searchClear.hidden=!v;
  if(!state.table) render(); else buildTable();
}
function renderAC(){
  const q=(searchInput.value||"").trim().toLowerCase();
  if(!q){ searchAC.hidden=true; searchAC.innerHTML=""; _acItems=[]; _acSel=-1; return; }
  _acItems=charIndex().filter(c=>c.label.toLowerCase().includes(q)||(c.jp&&c.jp.toLowerCase().includes(q))).slice(0,8);
  _acSel=-1;
  if(!_acItems.length){ searchAC.hidden=true; searchAC.innerHTML=""; return; }
  searchAC.innerHTML=_acItems.map((c,i)=>`<div class="search-ac-item" role="option" data-i="${i}">
    ${c.icon?`<img src="${esc(c.icon)}" alt="" referrerpolicy="no-referrer" data-fb="remove">`:`<span class="search-ac-ph"></span>`}
    <span class="search-ac-tx"><b>${esc(c.label)}</b>${c.jp?`<span class="search-ac-jp">${esc(c.jp)}</span>`:""}</span>
    <span class="search-ac-n">${c.n>1?c.n+" banners":G(c.rev)}</span></div>`).join("");
  searchAC.hidden=false;
}
function pickAC(i){ const c=_acItems[i]; if(!c) return; searchInput.value=c.label; applySearch(c.label); searchAC.hidden=true; searchInput.focus(); }
searchInput.addEventListener("input",()=>{ applySearch(searchInput.value); renderAC(); });
searchInput.addEventListener("focus",renderAC);
searchInput.addEventListener("keydown",e=>{
  if(e.key==="Escape"){ if(searchAC.hidden && searchInput.value){ searchInput.value=""; applySearch(""); } else { searchAC.hidden=true; } return; }
  if(searchAC.hidden||!_acItems.length) return;
  if(e.key==="ArrowDown"){ e.preventDefault(); _acSel=(_acSel+1)%_acItems.length; }
  else if(e.key==="ArrowUp"){ e.preventDefault(); _acSel=(_acSel-1+_acItems.length)%_acItems.length; }
  else if(e.key==="Enter"){ e.preventDefault(); pickAC(_acSel>=0?_acSel:0); return; }
  else return;
  searchAC.querySelectorAll(".search-ac-item").forEach((el,i)=>el.classList.toggle("sel",i===_acSel));
});
searchAC.addEventListener("mousedown",e=>{ const it=e.target.closest(".search-ac-item"); if(it){ e.preventDefault(); pickAC(+it.dataset.i); } });
searchInput.addEventListener("blur",()=>setTimeout(()=>{ searchAC.hidden=true; },120));
searchClear.onclick=()=>{ searchInput.value=""; applySearch(""); searchAC.hidden=true; searchInput.focus(); };
// "Clear search" link inside a no-results message
$("#chart").addEventListener("click",e=>{ if(e.target.id==="clearSearch2"){ searchInput.value=""; applySearch(""); } });
function resetSearch(){ if(searchInput){ searchInput.value=""; } state.search=""; if(searchClear) searchClear.hidden=true; if(searchAC){ searchAC.hidden=true; searchAC.innerHTML=""; } }

// ---- methodology modal ----
const infoModal=$("#infoModal");
function showInfoTab(which){
  $("#infoToggle").querySelectorAll("[data-info]").forEach(b=>b.classList.toggle("on",b.dataset.info===which));
  $("#infoGamei").hidden = which!=="gamei";
  $("#infoST").hidden    = which!=="st";
  if($("#infoCN")) $("#infoCN").hidden = which!=="cn";
  if($("#infoQimai")) $("#infoQimai").hidden = which!=="qimai";
  if($("#infoCNChart")) $("#infoCNChart").hidden = which!=="cnchart";
  const card=infoModal.querySelector(".modal-card"); if(card) card.scrollTop=0;
}
$("#infoToggle").querySelectorAll("[data-info]").forEach(btn=>btn.onclick=()=>showInfoTab(btn.dataset.info));
$("#infoBtn").onclick=()=>{ showInfoTab(state.dataSource==="st"?"st":state.dataSource==="cn"?"cn":state.dataSource==="qimai"?"qimai":"gamei"); infoModal.hidden=false; };
// click a worked-example source image to enlarge it in a lightbox
const lightbox=$("#lightbox"), lightboxImg=$("#lightboxImg");
$("#infoModal").addEventListener("click",e=>{ const im=e.target.closest(".info-ex-img");
  if(im){ lightboxImg.src=im.dataset.full||im.currentSrc||im.src; lightboxImg.alt=im.alt; lightbox.hidden=false; } });
lightbox.onclick=()=>{ lightbox.hidden=true; lightboxImg.src=""; };
$("#infoClose").onclick=()=>{ infoModal.hidden=true; };
infoModal.onclick=e=>{ if(e.target===infoModal) infoModal.hidden=true; };
addEventListener("keydown",e=>{ if(e.key==="Escape"){
  if(!lightbox.hidden){ lightbox.hidden=true; lightboxImg.src=""; return; }
  if(!bannerModal.hidden){ closeBanner(); return; }   // step back down the stack first
  if(!periodModal.hidden){ periodModal.hidden=true; return; }   // period detail sits above compare
  const cm=$("#compareModal"); if(cm && !cm.hidden){ cm.hidden=true; return; }
  infoModal.hidden=true; } });

init().catch(e=>{$("#chart").innerHTML=`<div class="loading">Failed to load data: ${e}</div>`;});
