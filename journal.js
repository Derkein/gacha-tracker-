// Gacha Tracker Monthly — renders one issue from data/journal/YYYY-MM.json (facts, built by
// scripts/build_journal.py from the tracker's own numbers). The copy is written here from those
// facts. Optional layers: data/journal/notes/YYYY-MM.json (hand-written copy, overrides the
// written-from-data copy), data/journal/upcoming.json (announced next banners, for the latest
// issue only — the data has no future banners) and data/journal/themes.json (character-themed
// headline lines, keyed "tag:Name").
const GAME_ACCENT = { zzz:"#e0a400", hsr:"#8a7bd8", wuwa:"#2fb6c0", genshin:"#d8a24a", endfield:"#e07b3a",
  nte:"#d94f8a", uma:"#3fb98f", stellasora:"#5aa9e6", czn:"#d2463c", lads:"#b87ee6" };
const SHORT = { genshin:"Genshin", hsr:"Star Rail", zzz:"ZZZ", wuwa:"Wuthering Waves", nte:"NTE", endfield:"Endfield",
  uma:"Umamusume", czn:"Chaos Zero Nightmare", stellasora:"Stella Sora", lads:"Love and Deepspace" };
// the six the audience follows get full spreads; the rest run as shorter "in brief" pieces
const FEATURED = ["genshin","hsr","zzz","wuwa","endfield","nte"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const $ = s => document.querySelector(s);
const esc = s => String(s==null?"":s).replace(/[&<>"'`]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;","`":"&#96;"}[c]));
const J = { index:null, upcoming:{}, themes:{}, cache:{} };

// ---- formatting (same rules as the tracker's fmtG / fmtUSD) ----
// US$ toggle, shared with the tracker (localStorage "ccy"): an issue's yen and yuan go to dollars at
// THAT MONTH's average ECB rate (data/fx_history.json; today's rate from data/fx.json if the month
// isn't in it), the same rule as the tracker's monthly figures. One rate per issue, so a change on
// last month still reads as spending, not as the yen. Display only — every order on the page was
// decided on native figures.
let _ccy=(()=>{ try{ return localStorage.getItem("ccy")==="native" ? "native" : "usd"; }catch(e){ return "usd"; } })();
const fxMonthOf = (ym, cur) => { const m=J.fxh && J.fxh.months && ym && J.fxh.months[ym]; return m ? m[cur==="CNY"?1:0] : null; };
const fxRate = cur => fxMonthOf(G_YM, cur) || (J.fx && J.fx.per_usd && J.fx.per_usd[cur]) || null;
const usdOn = () => _ccy==="usd" && !!fxRate("JPY") && !!fxRate("CNY");
function fmtG(oku){ if(usdOn()) return fmtUSD((oku>0?oku:0)*1e8/fxRate("JPY"));
  if(!(oku>0)) return "¥0"; const m=oku*100;
  return "¥"+(m>=1000 ? (m/1000).toFixed(2)+"B" : m>=100 ? Math.round(m)+"M" : (Math.round(m*10)/10)+"M"); }
function fmtUSD(v){ if(!(v>0)) return "$0";
  if(v>=1e9) return "$"+(v/1e9).toFixed(2)+"B"; if(v>=1e8) return "$"+Math.round(v/1e6)+"M";
  if(v>=1e7) return "$"+(v/1e6).toFixed(1)+"M"; if(v>=1e6) return "$"+(v/1e6).toFixed(2)+"M";
  if(v>=1e3) return "$"+Math.round(v/1e3)+"K"; return "$"+Math.round(v); }
// Japan + China iPhone as one figure, ALWAYS in US$ (whatever the toggle says): game-i's yen at
// the issue month's average rate + Qimai's dollars. null without a rate.
const jpUSD = oku => (oku>0 && fxRate("JPY")) ? oku*1e8/fxRate("JPY") : 0;
const bothUSD = (oku, usd) => fxRate("JPY") && (oku>0 || usd>0) ? jpUSD(oku)+(usd||0) : null;
function fxLine(cny){ const j=fxRate("JPY"), c=fxRate("CNY"); if(!j) return "";
  const r=v=>v>=100?v.toFixed(2):v.toFixed(4).replace(/0+$/,"");
  return fxMonthOf(G_YM,"JPY") ? `$1 = ¥${r(j)}${cny?` = CN¥${r(c)}`:""} (ECB, ${monthName(G_YM)} average)`
    : `$1 = ¥${r(j)}${cny?` = CN¥${r(c)}`:""} (ECB reference rate, ${J.fx&&J.fx.date||"today"})`; }
const BOTH_TIP = () => `Japan + China iPhone: game-i's yen converted at ${fxLine()}, plus Qimai's China iPhone dollars. Each issue uses its own month's average rate.`;
// CN¥ ranges, compact like the tracker's by-Month cells: "CN¥4.57–5.34B", "CN¥191–228M"
function fmtCNYr(lo, hi){
  if(usdOn()){ const a=fmtUSD(lo/fxRate("CNY")); if(hi==null||hi===lo) return a; const b=fmtUSD(hi/fxRate("CNY"));
    const ua=a.replace(/[\d.$]/g,""), ub=b.replace(/[\d.$]/g,""); return ua===ub ? a.slice(0,a.length-ua.length)+"–"+b.slice(1) : a+"–"+b.slice(1); }
  const band=v=> v>=1e9?["B",1e9,2] : v>=1e6?["M",1e6,0] : ["K",1e3,0];
  const [ua,da,pa]=band(lo); if(hi==null||hi===lo) return "CN¥"+(lo/da).toFixed(pa)+ua;
  const [ub,db,pb]=band(hi);
  return ua===ub ? `CN¥${(lo/da).toFixed(pa)}–${(hi/db).toFixed(pb)}${ub}` : `CN¥${(lo/da).toFixed(pa)}${ua}–${(hi/db).toFixed(pb)}${ub}`;
}
// The 总流水 tag: those figures come from a Bilibili chart published weeks after the month
// closes, so every issue marks them — "added later", or "pending" while the video isn't out.
const SHOW_ZL = false;                     // CN 总流水 hidden for now (user, 2026-11-04); the data is still built
const ZL_TIP = "总流水 (global all-platform gross, CN¥) comes from 天天背锅崩坏娘's monthly Bilibili chart, published weeks after the month ends, so it is added to each issue later than everything else. Rank-derived estimates, shown as the author's range.";
const lateTag = pending => `<span class="late${pending?" pending":""}" title="${esc(ZL_TIP)}"><i></i>${pending?"Pending":"Added later"}</span>`;
// ---- two editions per issue (user, 2026-11-11) ----
// START OF MONTH: Japan (game-i) + China iPhone (Qimai), out as soon as the month closes.
// MID-MONTH, GLOBAL: 天天背锅崩坏娘's worldwide all-platform chart (CN¥, data/cn_monthly.json), out once
// that month's video is up, usually mid next month. The switch rewrites the whole issue: cover, totals,
// charts, cards and copy. Openings keep their head-to-head order (equal days need DAILY figures and
// Global is one figure a month); every other list is ordered by Global. A banner's Global figure is
// the tracker's own split (bannerCN): its share of the month's Japan and China iPhone revenue × the
// game's worldwide month. Choice shared by the issue and the archive (localStorage "jed").
let _ed=(()=>{ try{ return localStorage.getItem("jed")==="global" ? "global" : "start"; }catch(e){ return "start"; } })();
let GL=false;                                    // the issue on screen is its Global edition
const hasGL = f => !!(f && f.market && f.market.zl);
const GL_SRC = `<a href="https://space.bilibili.com/20313793" target="_blank" rel="noopener">天天背锅崩坏娘</a>`;
const GL_TIP = "Global: worldwide revenue on every platform (mobile, PC, console), from 天天背锅崩坏娘's monthly Bilibili chart, in yuan. A banner's figure is its estimated share of its game's month (its share of the month's Japan and China iPhone revenue).";
const zmid = z => z ? (z.lo + (z.hi==null?z.lo:z.hi))/2 : 0;
const bz = b => b && b.zl_month ? (b.zl_month[0]+b.zl_month[1])/2 : 0;          // a banner's Global month (midpoint)
const fmtZ = z => z ? fmtCNYr(z.lo, z.hi) : "—";
const fmtBZ = b => b && b.zl_month ? "≈"+fmtCNYr(b.zl_month[0], b.zl_month[1]) : "—";
// change on last month, only on the same basis (Nov 2023: 总收入, net -> 总流水, gross)
const zlPct = g => g.zl && g.zl_prev && g.zl.metric===g.zl_prev.metric ? pct(zmid(g.zl), zmid(g.zl_prev)) : null;
const GLOBE = `<svg class="globe" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><ellipse cx="12" cy="12" rx="4.2" ry="9.5"/><path d="M2.5 12h19M4 7h16M4 17h16"/></svg>`;
// the edition switch, on top of every issue and of the archive
function edBar(v){
  // An issue without a Global edition greys the Global button out (it can't be picked there); the
  // saved choice is kept, so the next issue that has one opens as Global again.
  const st = v.archive ? null : v.st, mo = v.ym ? MONTHS[+v.ym.slice(5)-1] : "", nx = v.ym ? MONTHS[+nextYm(v.ym).slice(5)-1] : "";
  const off = !v.archive && st!=="out", cur = off ? "start" : _ed;
  const badge = v.archive ? `<span class="ed-st out">${v.n} of ${v.of} issues</span>`
    : st==="out" ? `<span class="ed-st out">Out</span>` : st==="pending" ? `<span class="ed-st pend"><i></i>Pending</span>` : `<span class="ed-st none">Not covered</span>`;
  const sub = !off ? `Worldwide · all platforms · 天天背锅崩坏娘`
    : st==="pending" ? `Not out yet: ${mo}'s chart usually lands around mid-${nx}` : `Not covered: the chart starts in November 2021`;
  let note = "";
  if(cur==="global")
    note = v.archive ? `Each issue as its <b>Global edition</b>. Issues without one (before November 2021, or the newest month until its chart is out) are dimmed.`
      : `<b>Worldwide revenue on every platform</b> (mobile, PC, console), in yuan, from ${GL_SRC}'s monthly chart. A banner's figure is its share of its game's month. Every figure, rank and verdict in this edition is Global; the head-to-heads follow the start-of-month rules on Global alone.`;
  const on = k => cur===k ? " on" : "";
  return `<div class="edbar" role="tablist" aria-label="Edition">
      <button type="button" role="tab" class="ed ed-start${on("start")}" data-ed="start" aria-selected="${cur==="start"}">
        <span class="ed-k">Start of month</span><b>Japan + China iPhone</b><small>game-i · Qimai · out when the month closes</small></button>
      <button type="button" role="tab" class="ed ed-global${on("global")}${off?" off":""}" data-ed="global" aria-selected="${cur==="global"}"${off?` disabled aria-disabled="true" title="${esc(sub)}"`:` title="${esc(GL_TIP)}"`}>
        <span class="ed-k">Mid-month ${badge}</span><b>${GLOBE}Global</b><small>${sub}</small></button>
    </div>${note?`<p class="ednote">${note}</p>`:""}`;
}
const monthName = ym => MONTHS[+ym.slice(5)-1]+" "+ym.slice(0,4);
const monShort = ym => MONTHS[+ym.slice(5)-1].slice(0,3)+" "+ym.slice(0,4);
const dayStr = iso => iso ? MONTHS[+iso.slice(5,7)-1].slice(0,3)+" "+(+iso.slice(8)) : "";
const ord = n => n+(["th","st","nd","rd"][(n%100-20)%10]||["th","st","nd","rd"][n%100]||"th");
const pct = (a,b) => (a>0&&b>0) ? (a/b-1)*100 : null;
const pctStr = p => p==null ? "" : (p>=0?"+":"−")+Math.abs(p).toFixed(Math.abs(p)<10?1:0)+"%";
const plural = (n,w) => `${n} ${w}${n===1?"":"s"}`;
const rk = r => r==null ? "—" : "#"+r;
function monthsBetween(a,b){ return (+b.slice(0,4)-+a.slice(0,4))*12 + (+b.slice(5)-+a.slice(5)); }
const nextYm = ym => { let y=+ym.slice(0,4), m=+ym.slice(5)+1; if(m>12){m=1;y++;} return y+"-"+String(m).padStart(2,"0"); };
let G_YM = "";                                    // the issue being rendered (for month-relative labels)
const prevYm = ym => { let y=+ym.slice(0,4), m=+ym.slice(5)-1; if(!m){m=12;y--;} return y+"-"+String(m).padStart(2,"0"); };

async function getJSON(u){ const r=await fetch(u,{cache:"no-cache"}); if(!r.ok) throw new Error(u+" "+r.status); return r.json(); }
async function loadIssue(ym){
  if(J.cache[ym]) return J.cache[ym];
  const facts = await getJSON(`data/journal/${ym}.json`);
  const ix=J.index.issues.find(x=>x.ym===ym);              // only fetch notes the index says exist
  let notes = null; if(ix&&ix.written) try{ notes = await getJSON(`data/journal/notes/${ym}.json`); }catch(e){}
  return (J.cache[ym] = {facts, notes});
}

function applyCcy(){ const b=$("#ccyBtn"), ok=!!(fxRate("JPY")&&fxRate("CNY")), on=usdOn(); if(!b) return;
  b.hidden=!ok; b.classList.toggle("on",on); b.setAttribute("aria-pressed",String(on)); b.textContent=on?"US$":"¥";
  if(ok) b.title=(on?"Showing yen and yuan in US$":"Show yen and yuan in US$")+` — each issue at its month's average ECB rate (today $1 = ¥${J.fx.per_usd.JPY} = CN¥${J.fx.per_usd.CNY}). Click to switch.`; }
// ---- theme (shares the tracker's saved choice) ----
const THEMES=["auto","light","dark"], TICON={auto:"◐",light:"☀",dark:"☾"};
let _theme=(()=>{ try{ return localStorage.getItem("theme")||"auto"; }catch(e){ return "auto"; } })();
function applyTheme(t){ _theme=t; const r=document.documentElement;
  if(t==="auto") r.removeAttribute("data-theme"); else r.setAttribute("data-theme",t);
  try{ localStorage.setItem("theme",t); }catch(e){}
  $("#themeBtn").textContent=TICON[t]; $("#themeBtn").title="Theme: "+t; }

// ---- written-from-the-facts copy, used wherever notes don't supply it ----
const P = g => GL ? zlPct(g) : pct(g.jp,g.jp_prev);        // the edition's month-on-month change
const HIST = g => GL ? g.zl_hist : g.hist;                   // ... and its place in the game's history
function histPhrase(g, ym){
  const h=HIST(g); if(!h) return "";
  if(h.rank===1) return "its best month on record";
  if(h.rank===h.of && h.of>=4) return "its weakest month on record";
  if(h.best_since && monthsBetween(h.best_since, ym)>=4) return `its best month since ${monShort(h.best_since)}`;
  if(!h.best_since && h.of>=4) return "its best month on record";
  if(h.low_since && monthsBetween(h.low_since, ym)>=4) return `its weakest month since ${monShort(h.low_since)}`;
  if(!h.low_since && h.of>=4) return "its weakest month on record";
  return "";
}
// Banners arrive ranked by the median of their ranks on every measure (build_journal.py), so
// banners[0] is the month's real leader even when another banner edged it on Japan revenue.
// Rich copy. Sentences are built as plain text with marked spans, escaped as a whole, then the
// marks turn into styled elements — so banner names from the data stay escaped while figures,
// changes, names, ranks and verdicts get their own look.
const MK = {
  n: v => `\u0001${v}\u0002`,                              // a figure (bold, accent underline)
  c: (p, t) => `\u0003${p>=0?"u":"d"}${t}\u0004`,          // a change: ▲ green / ▼ red
  b: b => `\u0005${b.color||""}|${b.label}\u0006`,         // a banner, in its own colour
  g: (tag, t) => `\u0007${tag}|${t||SHORT[tag]}\u0008`,    // a game, in its accent
  r: v => `\u000e${v}\u000f`,                              // a chart rank badge
  good: t => `\u0010${t}\u0011`, bad: t => `\u0012${t}\u0013`,   // verdict highlights
};
const judgeMark = t => !t ? "" : /worst|weakest|underwhelming|bottom/.test(t) ? MK.bad(t) : /best|strongest|top third/.test(t) ? MK.good(t) : t;
function rich(t){
  return esc(t)
    .replace(/\u0001(.*?)\u0002/g, '<b class="fig">$1</b>')
    .replace(/\u0003([ud])(.*?)\u0004/g, (_, d, v) => `<span class="dlt ${d}"><i>${d==="u"?"▲":"▼"}</i>${v.replace(/^[+−-]/,"")}</span>`)   // the arrow carries the sign
    .replace(/\u0005([^|\u0006]*)\|(.*?)\u0006/g, '<b class="bn" style="--bc:$1">$2</b>')
    .replace(/\u0007([a-z]+)\|(.*?)\u0008/g, (_, tag, v) => `<span class="gn" style="--gc:${GAME_ACCENT[tag]||"var(--ink)"}">${v}</span>`)
    .replace(/\u000e(.*?)\u000f/g, '<span class="rkp">$1</span>')
    .replace(/\u0010(.*?)\u0011/g, '<mark class="good">$1</mark>')
    .replace(/\u0012(.*?)\u0013/g, '<mark class="bad">$1</mark>');
}
const MEASURE = { rev_month:"Japan revenue", cn_month:"China revenue", jp_peak:"Japan peak rank", cn_peak:"China peak rank" };
const poss = n => n+(/s$/.test(n)?"'":"'s");                        // Wuthering Waves' / Genshin's
const vb = (lbl, one, many) => / & /.test(lbl) ? many : one;          // "Lucy & Rebecca post", "Pearl posts"
// still running when the month closed (ongoing = running TODAY, which only fits the latest issue)
const runsOn = (b, ym) => b.end > ym+"-31";
const andList = a => a.length<2 ? (a[0]||"") : a.slice(0,-1).join(", ")+" and "+a.at(-1);
// Where a banner's whole run sits in its game's history, as the median of its Japan and China
// percentiles (0 = best ever, 1 = worst). Ongoing runs are still growing: only good news is final.
// Where a banner's whole run sits in its game's history, as the median of its Japan and China
// percentiles (0 = best ever, 1 = worst). Ongoing runs are still growing: only good news is final.
// A run's Global total is complete only when every month it ran has a Global figure: the chart
// starts Nov 2021 and the newest months arrive mid next month (J.glLast = newest Global issue).
const glPartial = b => !!b.ongoing || b.start.slice(0,7) < "2021-11" || !J.glLast || b.end.slice(0,7) > J.glLast;
const runOpen = b => GL ? glPartial(b) : !!b.ongoing;       // the run's total can still change
function verdict(b){
  const ps=(GL ? [b.zl_alltime] : [b.alltime,b.cn_alltime]).filter(x=>x&&x[1]>=6).map(([r,n])=>(r-1)/(n-1));
  if(!ps.length) return null;
  const v=ps.length===2?(ps[0]+ps[1])/2:ps[0];
  const tier = v<=.15?"top": v<=.34?"strong": v>=.85?"bottom": v>=.66?"weak":"mid";
  return {v, tier, final:!runOpen(b) || v<=.34};          // b.ongoing: still running today, so its run isn't final
}
const weakRun = b => { const v=verdict(b); return v && v.final && (v.tier==="weak"||v.tier==="bottom"); };
const TIER = { top:"one of the game's strongest runs", strong:"in the top third of the game's banners", mid:"around the middle of the pack",
  weak:"an underwhelming run, in the game's bottom third", bottom:"one of the game's weakest runs" };
// the month's other new (non-rerun) banners, and the first of them whose finished run was weak
// (a banner that opened in the month's last days belongs to next month's story, not this one's)
const rivals = g => g.banners.slice(1).filter(b=>b.new && !b.rerun && (+b.start.slice(8)<=20 ||
  (GL ? !!b.zl_total && bz(b)>=(b.zl_total[0]+b.zl_total[1])/4 : b.rev_month>=b.rev_total/2)));
const flopOf = g => rivals(g).find(weakRun);
// Headlines rotate through blunt templates so the issue doesn't repeat itself. The choice is a
// hash of the issue + game + situation, so a given issue always reads the same. Tokens: {L} lead
// banner, {R} rival, {G} game, {Gp} game's, {p} percent; [L:one|many] agrees a verb with {L}.
const BANK = {
  flopNew: ["{L} [L:steals|steal] the show as {R} [R:underwhelms|underwhelm]", "{L} [L:buries|bury] {R}", "{R} [R:flops|flop], {L} [L:feasts|feast]",
            "No contest: {L} [L:crushes|crush] {R}", "{R} [R:fizzles|fizzle] while {L} [L:cashes|cash] in", "{L} [L:leaves|leave] {R} in the dust"],
  flopOld: ["{L} still [L:runs|run] the show as {R} [R:underwhelms|underwhelm]", "{R} [R:arrives|arrive] to a shrug; {L} [L:keeps|keep] the crown",
            "Even the old guard beats {R}: {L} on top", "{R} can't dethrone {L}", "Dead on arrival: {R} [R:loses|lose] to {L}"],
  rivalOld:["{L} [L:outpaces|outpace] newcomer {R}", "{R} [R:lands|land], but {L} [L:keeps|keep] the crown", "{L} [L:holds|hold] off {R}",
            "Not yet, {R}: {L} still [L:leads|lead] {G}"],
  top:     ["{L} [L:posts|post] one of {Gp} best runs", "{L} [L:hits|hit] the jackpot", "{L} [L:is|are] a blockbuster", "{L} [L:prints|print] money for {G}",
            "Jackpot: {L} [L:joins|join] {Gp} elite"],
  weak:    ["{L} [L:disappoints|disappoint]", "{L} [L:falls|fall] flat", "Nobody pulled for {L}", "{L} [L:is|are] a dud", "Cold reception for {L}", "{L} [L:bombs|bomb]"],
  lift:    ["{L} [L:lifts|lift] {G}", "{L} [L:sends|send] {G} soaring", "{G} rebounds behind {L}", "{L} [L:gives|give] {G} a {p}% jolt"],
  leadNew: ["{L} [L:leads|lead] {Gp} month", "{L} [L:takes|take] the top spot", "{L} on top, nothing more", "A solid, unspectacular month for {L}", "{L} [L:does|do] the job"],
  rerun:   ["The {L} rerun leads {Gp} month", "{G} leans on a {L} rerun", "Rerun season: {L} carries {G}", "Old faithful: {L} again"],
  quiet:   ["A quiet month for {G}, led by {L}", "{G} goes cold", "{G} slumps {p}%", "Slow month for {G}", "{G} drops {p}%; {L} [L:leads|lead] a weak field"],
  bottom:  ["Rock bottom for {G}", "{Gp} worst month on record", "{G} hits a new low"],
  carry:   ["{L} [L:carries|carry] {G}", "{L} [L:keeps|keep] {G} ticking", "Business as usual: {L} on top"],
};
function hashStr(t){ let h=2166136261; for(const c of t){ h^=c.charCodeAt(0); h=Math.imul(h,16777619); } return h>>>0; }
const pick = (key, arr) => arr[hashStr(G_YM+"|"+key) % arr.length];
function fill(t, v){
  return t.replace(/\[(L|R):([^|\]]+)\|([^\]]+)\]/g, (_, w, one, many) => / & /.test(v[w]||"") ? many : one)
          .replace(/\{(L|R|G|Gp|p|M|Mp)\}/g, (_, k) => v[k]==null ? "" : v[k]);
}
// a character-themed line (themes.json: "tag:Name" -> {good:[...], bad:[...]}) beats the generic bank
function themed(g, b, mood){ const t=b && J.themes[`${g.tag}:${b.label}`]; return t && t[mood] && t[mood].length ? t[mood] : null; }
function autoHeadline(g){
  const lead=g.banners[0]; if(!lead) return `${g.name}'s month`;
  const fl=flopOf(g), nb=rivals(g)[0], p=P(g), v=verdict(lead), G=SHORT[g.tag], h=HIST(g);
  const vars={L:lead.label, R:(fl||nb||{}).label, G, Gp:poss(G), p:p==null?"":Math.abs(p).toFixed(0)};
  const say=(sit, arr)=>fill(pick(g.tag+sit, arr), vars);
  if(fl) return say("fl", themed(g,fl,"flop") || BANK[lead.new?"flopNew":"flopOld"]);
  if(nb && !lead.new) return say("ro", BANK.rivalOld);
  if(h && h.rank===h.of && h.of>=4) return say("bt", BANK.bottom);
  if(lead.new && !lead.rerun){
    if(v&&v.tier==="top") return say("tp", themed(g,lead,"good") || BANK.top);
    if(weakRun(lead)) return say("wk", themed(g,lead,"bad") || BANK.weak);
    if(p!=null&&p>25) return say("lf", themed(g,lead,"good") || BANK.lift);
    return say("ln", BANK.leadNew);
  }
  if(lead.rerun) return say("rr", BANK.rerun);
  return p!=null&&p<-25 ? say("qt", BANK.quiet) : say("cr", BANK.carry);
}
function autoDek(g, ym){
  const parts=[], p=pct(g.jp,g.jp_prev), pc=pct(g.cn,g.cn_prev), hp=histPhrase(g,ym);
  if(g.jp && p!=null) parts.push(`Japan ${p>=0?"up":"down"} ${Math.abs(p).toFixed(0)}% to ${fmtG(g.jp)}${hp?`, ${hp}`:""}`);
  if(g.cn && pc!=null) parts.push(`China ${pc>=0?"up":"down"} ${Math.abs(pc).toFixed(0)}%`);
  return parts.length ? parts.join("; ")+"." : "";
}
function autoDekGL(g, ym){
  const parts=[], p=zlPct(g), hp=histPhrase(g,ym);
  if(g.zl) parts.push(p!=null ? `Worldwide ${p>=0?"up":"down"} ${Math.abs(p).toFixed(0)}% to ${fmtZ(g.zl)}${hp?`, ${hp}`:""}` : `${fmtZ(g.zl)} worldwide, all platforms`);
  return parts.length ? parts.join("; ")+"." : "";
}
// the cover's headline in the Global edition (also the archive card's): the biggest banner worldwide
function glHead(c, ym){
  if(!c) return `${monthName(ym)}, worldwide`;
  const bank=["{L} [L:tops|top] the world in {M}", "Worldwide, {L} [L:rules|rule] {M}", "{L}: {Mp} biggest banner on Earth",
              "The whole world pulled for {L}", "{L} [L:wins|win] {M} worldwide"], mo=MONTHS[+ym.slice(5)-1];
  return fill(bank[hashStr(ym+"|gcov") % bank.length], {L:c.label, M:mo, Mp:poss(mo)});
}
function autoCoverLinesGL(f){
  const lines=[], z=(f.market||{}).zl;
  const gs=f.games.filter(g=>g.zl).sort((a,b)=>zmid(b.zl)-zmid(a.zl));
  if(gs[0]) lines.push(`${SHORT[gs[0].tag]} tops the world with ${fmtZ(gs[0].zl)}`);
  const pz=pctOf(z);
  if(pz!=null) lines.push(`The tracked games ${pz>=0?"up":"down"} ${Math.abs(pz).toFixed(0)}% worldwide`);
  const sw=gs.filter(g=>FEATURED.includes(g.tag) && zlPct(g)!=null).sort((a,b)=>Math.abs(zlPct(b))-Math.abs(zlPct(a)))[0];
  if(sw && sw!==gs[0] && Math.abs(zlPct(sw))>=15) lines.push(`${SHORT[sw.tag]} ${zlPct(sw)>0?"up":"down"} ${Math.abs(zlPct(sw)).toFixed(0)}% worldwide`);
  const d=J.gopen&&J.gopen.list[0]; if(d&&d.gbeat) lines.push(`${d.label} is the month's best opening worldwide (${SHORT[d.tag]})`);
  return lines.slice(0,4);
}
// Openings in the Global edition: every pair head to head on GLOBAL revenue over the same number of
// days (the shorter of the two runs inside the month, the start-of-month edition's rule). A banner's
// Global over its first n days = its revenue over those days turned into Global at its game's own ratio
// that month (the game's worldwide month ÷ its Japan month and ÷ its China iPhone month, averaged):
// the same construction as its Global month figure, cut to the window.
const MIN_GL_DAYS = 3;
function glWin(b, g, n){
  const Z=zmid(g.zl); if(!(Z>0)) return 0;
  const sj=sum(g.banners.map(x=>x.rev_month)), sc=sum(g.banners.map(x=>x.cn_month)), w0=b.w0||0, parts=[];
  if(sj>0 && b.jp_daily && b.jp_daily.length) parts.push(sum(b.jp_daily.slice(w0,w0+n))*Z/sj);
  if(sc>0 && b.cn_daily && b.cn_daily.length) parts.push(sum(b.cn_daily.slice(w0,w0+n))*Z/sc);
  return parts.length ? sum(parts)/parts.length : 0;
}
function glOpenings(f){
  const rows=f.games.flatMap(g=>g.banners.filter(b=>b.new).map(b=>({...b, tag:g.tag, game:g.name, _g:g})));
  const span=r=>r.wdays||r.days||0, ok=r=>span(r)>=MIN_GL_DAYS && zmid(r._g.zl)>0;
  const R=rows.filter(ok), wins=new Map(R.map(r=>[r,0]));
  for(let i=0;i<R.length;i++) for(let j=i+1;j<R.length;j++){
    const a=R[i], b=R[j], n=Math.min(span(a),span(b)), va=glWin(a,a._g,n), vb=glWin(b,b._g,n);
    const w = va>vb ? a : vb>va ? b : (bz(a)>=bz(b) ? a : b); wins.set(w, wins.get(w)+1); }
  R.forEach(r=>{ r.gbeat=[wins.get(r), R.length-1]; });
  R.sort((a,b)=>b.gbeat[0]-a.gbeat[0] || bz(b)-bz(a));
  let pair=null;
  if(R.length>=2){ const [a,b]=R, n=Math.min(span(a),span(b)); pair={a, b, n, va:glWin(a,a._g,n), vb:glWin(b,b._g,n)}; }
  return {list:[...R, ...rows.filter(r=>!ok(r)).sort((a,b)=>bz(b)-bz(a))], pair};
}
// every banner on sale in the month, by its Global estimate (the Global edition's "top banners")
function glTop(f){
  return f.games.flatMap(g=>g.banners.filter(b=>bz(b)>0).map(b=>({...b, tag:g.tag, game:g.name, share:g.zl?bz(b)/zmid(g.zl):null})))
    .sort((a,b)=>bz(b)-bz(a));
}
function topPlaceGL(g, b){
  const t=J.gtop||[]; if(t.length<3) return "";
  const i=t.findIndex(x=>x.tag===g.tag && x.label===b.label), mo=MONTHS[+G_YM.slice(5)-1];
  if(i===0) return `Across every game, ${MK.b(b)} was the ${MK.good("biggest banner in the world")} in ${mo}.`;
  if(i>0 && i<10) return `Across every game, ${MK.b(b)} placed ${MK.n(ord(i+1))} worldwide of all the banners on sale.`;
  return t.length>=10 ? `${MK.b(b)} didn't make the month's top 10 worldwide.` : "";
}
function autoBodyGL(g, ym){
  const out=[], p=zlPct(g), hp=histPhrase(g,ym), mo=MONTHS[+ym.slice(5)-1], pm=MONTHS[+prevYm(ym).slice(5)-1];
  if(!g.zl) return [`${g.name} isn't on 天天背锅崩坏娘's chart for ${mo}, so it has no Global figure this month.`];
  let s=`${MK.g(g.tag,g.name)} took ${MK.n(fmtZ(g.zl))} worldwide in ${mo}, across every platform`;
  if(p!=null) s+=`, ${MK.c(p, `${p>=0?"up":"down"} ${Math.abs(p).toFixed(0)}%`)} on ${pm}`;
  else if(g.zl_prev) s+=` (the chart changed basis this month, so there's no change on ${pm})`;
  if(hp) s+=` — ${judgeMark(hp)}`;
  if(g.zl_rank && g.zl_rank[1]>1) s+=`. That made it ${g.zl_rank[0]===1?MK.good("the biggest earner in the world"):"No. "+MK.n(g.zl_rank[0])} of the ${g.zl_rank[1]} games tracked`;
  s+=".";
  if(g.zl.mihoyo) s+=` The chart leaves out miHoYo's own 支付中心 top-up channel, so this figure is understated.`;
  out.push(s);
  const bs=g.banners.filter(b=>bz(b)>0); if(!bs.length) return out;
  const tot=zmid(g.zl);
  const sent=(b,lead)=>{ const when=b.new?`opened on ${dayStr(b.start)}${b.rerun?" (a rerun)":""} and `:(b.rerun?"(rerun) ":"");
    const sh=tot>0?Math.round(bz(b)/tot*100):null;
    return `${MK.b(b)} ${when}${lead?"led the month with":"took"} ${MK.n(fmtBZ(b))} worldwide${sh!=null?`, ${MK.n(sh+"%")} of ${poss(SHORT[g.tag])} month`:""}${b.days?`, in ${plural(b.days,"day")}`:""}.`; };
  out.push([sent(bs[0],true), topPlaceGL(g,bs[0])].filter(Boolean).join(" "));
  if(bs.length>1) out.push(bs.slice(1,3).map(b=>sent(b,false)).join(" "));
  const runs=g.banners.filter(b=>b.new).map(b=>runSentence(b,SHORT[g.tag])).filter(Boolean);
  if(runs.length) out.push(runs.join(" "));
  return out;
}
function bannerSentence(b, lead){
  const when = b.new ? `opened on ${dayStr(b.start)}${b.rerun?" (a rerun)":""} and ` : (b.rerun?"(rerun) ":"");
  const amt = b.rev_month>0 ? `${lead?"led the month with":"took"} ${MK.n(fmtG(b.rev_month))} in Japan` : "stayed below Japan's top 200";
  const pk = [b.jp_peak?`${MK.r("#"+b.jp_peak)} in Japan`:null, b.cn_peak?`${MK.r("#"+b.cn_peak)} on China's iPhone chart`:null].filter(Boolean);
  const cn = b.cn_month>0 ? ` and ${MK.n(fmtUSD(b.cn_month))} in China` : "";
  return `${MK.b(b)} ${when}${amt}${cn}${pk.length?`, peaking at ${pk.join(" and ")}`:""}.`;
}
function headToHead(g){
  const [a,b]=g.banners; if(!a||!b||!a.mranks) return "";
  const ms=(g.measures||[]).filter(k=>a.mranks[k]!==b.mranks[k]);
  const won=ms.filter(k=>a.mranks[k]<b.mranks[k]).map(k=>MEASURE[k]), lost=ms.filter(k=>a.mranks[k]>b.mranks[k]).map(k=>MEASURE[k]);
  if(!won.length) return "";
  if(!lost.length) return `It finished ahead of ${MK.b(b)} on ${MK.good("every measure")}.`;
  return `It beat ${MK.b(b)} on ${andList(won)}; only ${andList(lost)} went ${MK.b(b)}'s way.`;
}
// The month's leader vs the runner-up, counting how many days each actually had in the month:
// a banner that opened on the 28th and still won has to be read against a full-month rival.
const sum = a => a.reduce((x,y)=>x+(y||0),0);
function daysEdge(g){
  const [a,b]=g.banners; if(!a||!b||!a.days||!b.days||!(a.rev_month>0)||!(b.rev_month>0)) return "";
  const perDay=x=>MK.n(fmtG(x.rev_month/x.days));
  if(a.days <= b.days*0.6){
    const N=a.days, out=[];
    if(a.rev_month>=b.rev_month*0.6){
      const r=a.rev_month/b.rev_month, mo=MONTHS[+G_YM.slice(5)-1];
      out.push(`${MK.b(a)} needed only ${MK.n(plural(N,"day"))} to make ${MK.good(r>=1?"more than":Math.round(r*100)+"% of")} what ${MK.b(b)} made in its ${MK.n(b.days)} ${mo} days.`);
    } else out.push(`${MK.b(a)} did it in ${MK.n(plural(N,"day"))}, against ${MK.b(b)}'s ${MK.n(b.days)}: ${perDay(a)} a day to ${perDay(b)}.`);
    if(a.day0===0 && b.day0===0 && b.jp_daily && b.jp_daily.length>=N){
      const w=sum(b.jp_daily.slice(0,N)), wc=b.cn_daily&&b.cn_daily.length>=N?sum(b.cn_daily.slice(0,N)):0;
      if(w>0) out.push(`Over its own first ${plural(N,"day")}, ${MK.b(b)} had only ${MK.n(fmtG(w))}${wc>0?` and ${MK.n(fmtUSD(wc))}`:""}, against ${MK.n(fmtG(a.rev_month))}${a.cn_month>0?` and ${MK.n(fmtUSD(a.cn_month))}`:""}.`);
    }
    return out.join(" ");
  }
  if(b.days <= a.days*0.6 && b.rev_month/b.days > a.rev_month/a.days)
    return `Per day, though, ${MK.b(b)} was ${MK.good("faster")}: ${perDay(b)} a day over ${plural(b.days,"day")}, against ${MK.b(a)}'s ${perDay(a)} over ${a.days}.`;
  return "";
}
function runSentence(b, G){
  const v=verdict(b); if(!v) return "";
  if(GL){ const judge = v.final ? `: ${judgeMark(TIER[v.tier])}` : b.ongoing ? ", with the run still going"
      : b.start.slice(0,7) < "2021-11" ? ", counting only its months from November 2021, where the chart starts" : ", with its later months not in the chart yet";
    return `${MK.b(b)}'s run ${runOpen(b)?"so far ":""}ranks ${MK.n(ord(b.zl_alltime[0]))} of ${b.zl_alltime[1]} among ${G} banners worldwide${judge}.`; }
  const where=[b.alltime&&`${MK.n(ord(b.alltime[0]))} of ${b.alltime[1]} in Japan`, b.cn_alltime&&`${MK.n(ord(b.cn_alltime[0]))} of ${b.cn_alltime[1]} in China`].filter(Boolean);
  const judge = v.final ? `: ${judgeMark(TIER[v.tier])}` : ", with the run still going";
  return `${MK.b(b)}'s run ${b.ongoing?"so far ":""}ranks ${andList(where)} among ${G} banners${judge}.`;
}
// where a game's banner placed in the month's top banners, across every game
function topPlace(g, b){
  const f=J.cache[G_YM]&&J.cache[G_YM].facts, t=(f&&f.top)||[]; if(t.length<3) return "";
  const i=t.findIndex(x=>x.tag===g.tag && x.label===b.label);
  if(i===0) return `Across every game, ${MK.b(b)} was the ${MK.good("best banner on sale")} in ${MONTHS[+G_YM.slice(5)-1]}${b.new?"":", even against the month's newcomers"}.`;
  if(i>0) return `Across every game, ${MK.b(b)} placed ${MK.n(ord(i+1))} of all the banners on sale.`;
  return t.length>=10 ? `${MK.b(b)} didn't make the month's top ${t.length} across every game.` : "";
}
function autoBody(g, ym){
  const out=[], p=pct(g.jp,g.jp_prev), hp=histPhrase(g,ym), pm=MONTHS[+prevYm(ym).slice(5)-1];
  if(g.jp){
    let s=`${MK.g(g.tag,g.name)} took ${MK.n(fmtG(g.jp))} in Japan in ${MONTHS[+ym.slice(5)-1]}`;
    if(p!=null) s+=`, ${MK.c(p, `${p>=0?"up":"down"} ${Math.abs(p).toFixed(0)}%`)} on ${pm}`;
    if(hp) s+=` — ${judgeMark(hp)}`;
    if(g.jp_rank && g.jp_rank[1]>1) s+=`. That made it ${g.jp_rank[0]===1?MK.good("the top earner"):"No. "+MK.n(g.jp_rank[0])} of the ${g.jp_rank[1]} games tracked`;
    s+=".";
    if(g.cn){ const pc=pct(g.cn,g.cn_prev);
      s+=` On China's iPhone store it made ${MK.n(fmtUSD(g.cn))}${pc!=null?` (${MK.c(pc,pctStr(pc))})`:""}${g.cn_rank&&g.cn_rank[1]>1?`, No. ${MK.n(g.cn_rank[0])} of ${g.cn_rank[1]}`:""}.`; }
    out.push(s);
  }
  const bs=g.banners.filter(b=>b.rev_month>0||b.cn_month>0);
  if(!bs.length){ if(g.banners.length) out.push(`No banner reached Japan's top 200 this month.`); return out; }
  out.push([bannerSentence(bs[0],true), headToHead(g), daysEdge(g), topPlace(g, bs[0])].filter(Boolean).join(" "));
  if(bs.length>1) out.push(bs.slice(1,3).map(b=>bannerSentence(b,false)).join(" "));
  const runs=g.banners.filter(b=>b.new).map(b=>runSentence(b,SHORT[g.tag])).filter(Boolean);
  if(runs.length) out.push(runs.join(" "));
  return out;
}
function autoCoverLines(f){
  const lines=[], feat=f.games.filter(g=>FEATURED.includes(g.tag));
  const d=f.debuts[0]; if(d) lines.push(`${d.label} is the month's best opening (${SHORT[d.tag]})`);
  const tp=(f.top||[])[0]; if(tp && (!d || tp.label!==d.label)) lines.push(`${tp.label} (${SHORT[tp.tag]}) is the best banner on sale${tp.new?"":", carried over from last month"}`);
  const flop=feat.map(g=>[g,flopOf(g)]).find(([g,b])=>b);
  if(flop) lines.push(`${flop[1].label} ${vb(flop[1].label,"underwhelms","underwhelm")} as ${flop[0].banners[0].label} ${vb(flop[0].banners[0].label,"leads","lead")} ${SHORT[flop[0].tag]}`);
  const top=[...f.games].filter(g=>g.jp_rank).sort((a,b)=>a.jp_rank[0]-b.jp_rank[0])[0];
  if(top) lines.push(`${SHORT[top.tag]} tops Japan with ${fmtG(top.jp)}`);
  const sw=feat.filter(g=>pct(g.jp,g.jp_prev)!=null).sort((a,b)=>Math.abs(pct(b.jp,b.jp_prev))-Math.abs(pct(a.jp,a.jp_prev)))[0];
  if(sw && Math.abs(pct(sw.jp,sw.jp_prev))>=20 && sw!==top) lines.push(`${SHORT[sw.tag]} ${pct(sw.jp,sw.jp_prev)>0?"up":"down"} ${Math.abs(pct(sw.jp,sw.jp_prev)).toFixed(0)}% in Japan`);
  const cn=[...f.games].filter(g=>g.cn_rank).sort((a,b)=>a.cn_rank[0]-b.cn_rank[0])[0];
  if(cn && f.games.filter(g=>g.cn).length>1) lines.push(`${SHORT[cn.tag]} leads China's iPhone store`);
  return lines.slice(0,4);
}

// ---- pieces ----
// o.face = [x%, y%] of the face in the art (from banner_focus.json); o.tx/o.ty = where in the
// frame the face should land (o.txm on phones). Without a face point the crop stays centred.
const img = (src, cls, alt, o) => src ? `<img class="${cls||""}" src="${esc(src)}" alt="${esc(alt||"")}" loading="lazy" referrerpolicy="no-referrer"${
  o&&o.face?` data-fx="${o.face[0]}" data-fy="${o.face[1]}"${o.tx!=null?` data-tx="${o.tx}"`:""}${o.ty!=null?` data-ty="${o.ty}"`:""}${o.txm!=null?` data-txm="${o.txm}"`:""}${o.z?` data-z="${o.z}"`:""}`:""}>` : "";
// Place an object-fit:cover crop so the face sits at (tx,ty) of the frame, clamped so the art
// still covers it. Works for wide banners and for tall character sheets (CZN) alike.
// A banner's picture: the Star Rail splash when there is one (a cut-out on a transparent
// background), else its banner art. mode "whole" shows the whole splash (cover, feature),
// "zoom" crops in on the face (cards). Returns the <img>; frame() adds the backdrop class.
function pic(b, alt, o, mode){
  if(b && b.art) return mode==="whole" ? img(b.art, "splash whole", alt)
    : img(b.art, "splash", alt, {face:b.art_face, ty:(o&&o.ty)||0.38, tx:o&&o.tx, z:(o&&o.z)||1.7});
  return b && b.img ? img(b.img, "", alt, {face:b.face, ...(o||{})}) : "";
}
const frame = b => b && b.art ? " has-splash" : "";
function fitFace(im){
  const fx=parseFloat(im.dataset.fx), fy=parseFloat(im.dataset.fy);
  const iw=im.naturalWidth, ih=im.naturalHeight, cw=im.clientWidth, ch=im.clientHeight;
  if(isNaN(fx)||!iw||!cw||!ch) return;
  const s=Math.max(cw/iw, ch/ih), dw=iw*s, dh=ih*s;
  const tx=parseFloat((innerWidth<760&&im.dataset.txm)||im.dataset.tx||"0.5")*cw, ty=parseFloat(im.dataset.ty||"0.38")*ch;
  const ox=Math.min(0, Math.max(cw-dw, tx-fx/100*dw)), oy=Math.min(0, Math.max(ch-dh, ty-fy/100*dh));
  im.style.objectPosition=`${ox.toFixed(1)}px ${oy.toFixed(1)}px`;
  const z=parseFloat(im.dataset.z||"1");                     // splash cut-outs: zoom in on the face
  if(z>1){ im.style.transformOrigin=`${(ox+fx/100*dw).toFixed(1)}px ${(oy+fy/100*dh).toFixed(1)}px`; im.style.transform=`scale(${z})`; }
}
const fitAll = () => document.querySelectorAll("img[data-fx]").forEach(i=>{ if(i.complete) fitFace(i); });
document.addEventListener("load", e=>{ if(e.target.tagName==="IMG" && e.target.dataset.fx) fitFace(e.target); }, true);
let _fitT; addEventListener("resize", ()=>{ clearTimeout(_fitT); _fitT=setTimeout(fitAll, 120); });
// a dead CDN link hides itself (delegated: the page's CSP allows no inline handlers)
document.addEventListener("error", e=>{ if(e.target.tagName==="IMG") e.target.classList.add("broken"); }, true);
function rankChart(f, key, fmt, title, sub, cls){
  const rows=f.games.filter(g=>g[key]>0).sort((a,b)=>b[key]-a[key]); if(!rows.length) return "";
  const max=rows[0][key];
  return `<div class="chartcol${cls?" "+cls:""}"><h4>${title}</h4><p class="sub">${sub}</p><ol class="rchart">${rows.map((g,i)=>{
    const p=pct(g[key], g[key+"_prev"]);
    return `<li style="--acc:${GAME_ACCENT[g.tag]}"><span class="pos">${i+1}</span>
      <img class="gic" src="${g.icon}" alt=""><a class="nm" href="#${f.ym}/${g.tag}">${esc(SHORT[g.tag])}</a>
      <span class="bar"><i style="width:${(g[key]/max*100).toFixed(1)}%"></i></span>
      <span class="val">${fmt(g[key], g)}</span><span class="chg ${p==null?"":p>=0?"up":"dn"}">${pctStr(p)}</span></li>`; }).join("")}</ol></div>`;
}
// Japan + China iPhone added up, always in dollars. The month-on-month change uses the same rate
// on both months, so it is the change in spending, not in the yen. A game missing from one
// market in either month gets no change rather than a fake jump.
function bothChart(f){
  if(!fxRate("JPY")) return "";
  const games=f.games.map(g=>{ const both=bothUSD(g.jp, g.cn);
    const same=(g.jp>0)===(g.jp_prev>0) && (g.cn>0)===(g.cn_prev>0);
    return {...g, both, both_prev: same ? bothUSD(g.jp_prev, g.cn_prev) : null}; });
  return rankChart({...f, games}, "both", fmtUSD, "Japan + China iPhone",
    `game-i + Qimai, US$ · yen at ${esc(fxLine())}`, "bothcol");
}
function globalChart(f){
  const games=f.games.filter(g=>g.zl).map(g=>({...g, zlv:zmid(g.zl), zlv_prev: zlPct(g)!=null ? zmid(g.zl_prev) : null}));
  return rankChart({...f, games}, "zlv", (v,g)=>fmtZ(g.zl), "Worldwide, all platforms",
    `${GL_SRC}'s monthly chart · ${usdOn()?`yuan in US$ at ${esc(fxLine(true))}`:"CN¥"}`, "glcol");
}
// ---- the month in totals: every tracked game added up, per source, plus Japan vs China ----
const pctOf = m => m && !m.break && m.same_prev>0 ? (m.same/m.same_prev-1)*100 : null;
function yearPhrase(m, ym){
  if(!m || m.year_n<3) return "";
  const y=ym.slice(0,4);
  if(m.year_rank===1) return `its best month of ${y} so far`;
  if(m.year_rank===m.year_n) return `its worst month of ${y} so far`;
  return `${ord(m.year_rank)} of ${m.year_n} months in ${y}`;
}
function marketCopy(f){
  const mk=f.market||{}, jp=mk.jp, cn=mk.cn, mo=MONTHS[+f.ym.slice(5)-1], out=[];
  const pj=pctOf(jp), pc=pctOf(cn), chg=p=>MK.c(p, `${p>=0?"up":"down"} ${Math.abs(p).toFixed(0)}%`);
  if(jp){
    const red=jp.down.length, n=jp.same_n;
    let s = red===n ? `${MK.bad("Every single game")} ended ${mo} in the red in Japan.`
      : red>n/2 ? `${MK.bad(`${red} of ${n} games`)} ended ${mo} in the red in Japan.`
      : red===n/2 ? `Half the games went backwards in Japan: ${MK.n(`${red} of ${n}`)}.`
      : red ? `${MK.n(`${red} of ${n}`)} games lost ground in Japan; ${MK.n(jp.up.length)} grew.` : `${MK.good("Every game grew")} in Japan.`;
    const yp=yearPhrase(jp,f.ym);
    s+=` Japan took ${MK.n(fmtG(jp.total))} from the tracked games${pj!=null?`, ${chg(pj)} on the month`:""}${yp?`: ${judgeMark(yp)}`:""}.`;
    out.push(s);
  }
  if(cn){
    const yp=yearPhrase(cn,f.ym);
    out.push(`China's iPhone store added ${MK.n(fmtUSD(cn.total))}${pc!=null?`, ${chg(pc)}`:""}, with ${MK.n(`${cn.down.length} of ${cn.same_n}`)} games down${yp?`: ${judgeMark(yp)}`:""}.`);
  }
  if(pj!=null && pc!=null){
    if(pj>=0 && pc<0) out.push(`The markets split: Japan spent ${MK.good("more")} while China ${MK.bad("pulled back")}.`);
    else if(pj<0 && pc>=0) out.push(`The markets split: China spent ${MK.good("more")} while Japan ${MK.bad("pulled back")}.`);
    else if(pj<=-10 && pc<=-10) out.push(MK.bad(pick("both-down",[`Both markets fell hard. Nobody was spending.`, `A cold month in both markets.`, `Japan and China both closed their wallets.`])));
    else if(pj<0 && pc<0) out.push(`Both markets slipped.`);
    else if(pj>=10 && pc>=10) out.push(MK.good(pick("both-up",[`Both markets boomed.`, `Wallets open in both markets.`])));
    else out.push(`Both markets grew a little.`);
  }
  const mv=(m,dir)=>{ const t=m&&m[dir][0]; return t?`${MK.g(t)} ${MK.c(m.chg[t], pctStr(m.chg[t]*100))}`:null; };
  const ups=mv(jp,"up"), dns=mv(jp,"down");
  if(ups||dns) out.push(`In Japan, ${[ups&&`${ups} led the risers`, dns&&`${dns} the fallers`].filter(Boolean).join(" and ")}.`);
  return out;
}
function marketCopyGL(f){
  const mk=f.market||{}, z=mk.zl, mo=MONTHS[+f.ym.slice(5)-1], pm=MONTHS[+prevYm(f.ym).slice(5)-1], out=[];
  if(!z) return out;
  const pz=pctOf(z), chg=p=>MK.c(p, `${p>=0?"up":"down"} ${Math.abs(p).toFixed(0)}%`);
  if(!z.break){ const red=z.down.length, n=z.same_n;
    out.push(red===n ? `${MK.bad("Every single game")} ended ${mo} in the red worldwide.`
      : red>n/2 ? `${MK.bad(`${red} of ${n} games`)} ended ${mo} in the red worldwide.`
      : red===n/2 ? `Half the games went backwards worldwide: ${MK.n(`${red} of ${n}`)}.`
      : red ? `${MK.n(`${red} of ${n}`)} games lost ground worldwide; ${MK.n(z.up.length)} grew.` : `${MK.good("Every game grew")} worldwide.`); }
  const yp=yearPhrase(z,f.ym);
  out.push(`Across every country and every platform, the tracked games took ${MK.n(fmtCNYr(z.lo,z.hi))}${pz!=null?`, ${chg(pz)} on the month`:""}${yp&&!z.break?`: ${judgeMark(yp)}`:""}.`);
  if(z.break) out.push(`This is the month the chart switched from 总收入 (normally net of the store cut) to 总流水 (gross billings), so it isn't compared with ${pm}.`);
  const mv=dir=>{ const t=z[dir][0]; return t&&!z.break?`${MK.g(t)} ${MK.c(z.chg[t], pctStr(z.chg[t]*100))}`:null; };
  const ups=mv("up"), dns=mv("down");
  if(ups||dns) out.push(`Worldwide, ${[ups&&`${ups} led the risers`, dns&&`${dns} the fallers`].filter(Boolean).join(" and ")}.`);
  return out;
}
function marketHTML(f){
  const mk=f.market||{}; if(!mk.jp && !mk.cn) return "";
  const mo=MONTHS[+f.ym.slice(5)-1];
  const tile=(k,label,src,val,m,extra)=>{ const p=pctOf(m);
    return `<div class="mt-tile${k==="zl"?" zl":""}"><span class="mt-k">${label}</span><b>${val}</b>
      <em class="${p==null?"":p>=0?"up":"dn"}">${p==null?"&nbsp;":pctStr(p)+" on "+MONTHS[+prevYm(f.ym).slice(5)-1].slice(0,3)}</em>
      <small>${src}${m?` · ${plural(m.n,"game")}${m.year_n>=2?` · ${ord(m.year_rank)} of ${m.year_n} in ${f.ym.slice(0,4)}`:""}`:""}</small>${extra||""}</div>`; };
  const zl=SHOW_ZL?mk.zl:null;
  const zlTile = !SHOW_ZL ? "" : zl ? tile("zl",`China 总流水 ${lateTag(false)}`,`all platforms${zl.video?` · <a href="https://www.bilibili.com/video/${esc(zl.video)}" target="_blank" rel="noopener">source video</a>`:""}`,fmtCNYr(zl.lo,zl.hi),zl)
    : mk.zl_pending ? `<div class="mt-tile zl"><span class="mt-k">China 总流水 ${lateTag(true)}</span><b class="mu">Not out yet</b><em>&nbsp;</em>
        <small>The Bilibili chart for ${mo} usually lands weeks after the month closes.</small></div>` : "";
  const col=(m,label,fmtv)=>{ if(!m) return "";
    const rows=Object.entries(m.chg).sort((a,b)=>b[1]-a[1]);
    const mx=Math.max(...rows.map(r=>Math.abs(r[1])),0.01);
    return `<div class="mcol"><h4>${label}</h4><ol class="mchg">${rows.map(([t,c])=>`<li class="${c>=0?"up":"dn"}" style="--gacc:${GAME_ACCENT[t]}">
      <span class="nm">${esc(SHORT[t])}</span><span class="cbar"><i style="width:${(Math.abs(c)/mx*50).toFixed(1)}%"></i></span><span class="cv">${pctStr(c*100)}</span></li>`).join("")}</ol></div>`; };
  if(GL){ const z=mk.zl, pz=pctOf(z), pm3=MONTHS[+prevYm(f.ym).slice(5)-1].slice(0,3);
    const gt=`<div class="mt-tile gl"><span class="mt-k">${GLOBE}Worldwide · all platforms</span><b>${fmtCNYr(z.lo,z.hi)}</b>
      <em class="${pz==null?"":pz>=0?"up":"dn"}">${pz==null?(z.break?"new basis: no change":"&nbsp;"):pctStr(pz)+" on "+pm3}</em>
      <small>${GL_SRC} · ${esc(z.metric||"总流水")}${z.video?` · <a href="https://www.bilibili.com/video/${esc(z.video)}" target="_blank" rel="noopener">source video</a>`:""} · ${plural(z.n,"game")}${z.year_n>=2&&!z.break?` · ${ord(z.year_rank)} of ${z.year_n} in ${f.ym.slice(0,4)}`:""}</small></div>`;
    return `<section class="market"><div class="sec-k">The month in totals</div><h3 class="sec-h">Every tracked gacha, worldwide</h3>
    <div class="mtiles gl1">${gt}</div>
    <div class="mcopy">${marketCopyGL(f).map(t=>`<p>${rich(t)}</p>`).join("")}</div>
    ${z.break?"":`<div class="mcols">${col(z,"Worldwide, game by game")}</div>`}
    <p class="mnote">Worldwide = ${GL_SRC}'s monthly <b>二次元手游全球总流水</b> chart: every platform, every country, in yuan, as a range where the author gives one (miHoYo's own top-up channel is left out, so their figures are understated). Changes compare the games present in both months.</p></section>`; }
  return `<section class="market"><div class="sec-k">The month in totals</div><h3 class="sec-h">Every tracked gacha, added up</h3>
    <div class="mtiles">${mk.jp?tile("jp","Japan",`game-i · App Store + Google Play${usdOn()?` · at ${esc(fxLine())}`:""}`,fmtG(mk.jp.total),mk.jp):""}${mk.cn?tile("cn","China iPhone","Qimai · App Store",fmtUSD(mk.cn.total),mk.cn):""}${zlTile}</div>
    <div class="mcopy">${marketCopy(f).map(t=>`<p>${rich(t)}</p>`).join("")}</div>
    <div class="mcols">${col(mk.jp,"Japan, game by game")}${col(mk.cn,"China iPhone, game by game")}${zl?col(zl,`China 总流水, game by game ${lateTag(false)}`):""}</div>
    <p class="mnote">Changes compare the games present in both months, so a launch doesn't count as growth. Japan${SHOW_ZL?", China iPhone and 总流水 are":" and China iPhone are"} different measurements of different stores; they are added together only in the <b>Japan + China iPhone</b> figures, in US$ with the yen at ${esc(fxLine())}, also for last month's figures, so a change reads as spending and not as the yen.</p></section>`;
}
// #1 vs #2 over their shared window, so a big lead the runner-up held in one market is said out loud
function topPairNote(f, t){
  t = t===undefined ? f.top_pair : t; if(!t) return "";
  const {a,b,n}=t, x=(p,q)=>q>0?p/q:Infinity, fx=r=>r===Infinity?"":` by ${r.toFixed(1)}×`;
  const jp = a.jp>=b.jp ? [a,b,x(a.jp,b.jp)] : [b,a,x(b.jp,a.jp)], cn = a.cn>=b.cn ? [a,b,x(a.cn,b.cn)] : [b,a,x(b.cn,a.cn)];
  const hasCN=a.cn>0||b.cn>0, split = hasCN && jp[0]!==cn[0];
  const span0 = a.new && b.new ? `the same first ${plural(n,"day")}` : `the same ${plural(n,"day")} in the month`;
  if(!split) return `<p class="dnote">${rich(`Over ${span0}, ${MK.b(jp[0])} beat ${MK.b(jp[1])} in ${hasCN?"both markets":"Japan"}: Japan${fx(jp[2])} (${MK.n(fmtG(jp[0].jp))} to ${fmtG(jp[1].jp)})${hasCN?` and China${fx(cn[2])} (${MK.n(fmtUSD(cn[0].cn))} to ${fmtUSD(cn[1].cn)})`:""}.`)}</p>`;
  const parts=[`${MK.b(jp[0])} took Japan${fx(jp[2])} (${MK.n(fmtG(jp[0].jp))} to ${fmtG(jp[1].jp)})`,
               `${MK.b(cn[0])} took China${fx(cn[2])} (${MK.n(fmtUSD(cn[0].cn))} to ${fmtUSD(cn[1].cn)})`];
  return `<p class="dnote">${rich(`Over ${span0}, ${parts.join(", while ")}. Weighted by the size of each lead, ${a.label} comes out ahead.`)}</p>`;
}
const DEBUT_CARDS = 10;
// a banner card's combined line: Japan + China iPhone, in US$, and per day
function bothRow(d){
  const v=bothUSD(d.rev_month, d.cn_month); if(v==null || !(d.cn_month>0)) return "";
  return `<div class="dboth" title="${esc(BOTH_TIP())}"><span>Japan + China</span><strong>${fmtUSD(v)}</strong>${d.days?`<small>${fmtUSD(v/d.days)}/day</small>`:""}</div>`;
}
const glRow = d => `<div class="dboth dgl" title="${esc(GL_TIP)}"><span>${GLOBE}Worldwide · est.</span><strong>${fmtBZ(d)}</strong>${d.days&&bz(d)>0?`<small>≈${fmtCNYr(bz(d)/d.days)}/day</small>`:""}</div>`;
// a Global-edition card (openings: mode "open", top banners: mode "top"): Global figures only
function openCardGL(d, i, f, mode){
  const mo=MONTHS[+f.ym.slice(5)-1], showOld=mode==="top", ranked=showOld || !!d.gbeat;
  const tag = showOld && !d.new ? ` · from ${dayStr(d.start)}` : d.rerun ? " · rerun" : "";
  const rec = showOld ? (d.share!=null?`≈${Math.round(d.share*100)}% of ${esc(poss(SHORT[d.tag]))} month worldwide`:"&nbsp;")
    : d.gbeat ? `Won ${d.gbeat[0]} of ${d.gbeat[1]} head-to-heads` : `Too new to rank: ${plural(d.days,"day")} in ${mo}`;
  return `<a class="dcard${ranked?"":" late"}" href="#${f.ym}/${d.tag}" style="--acc:${d.color||GAME_ACCENT[d.tag]}">
      <div class="dart${frame(d)}">${pic(d,"",{},"zoom")}<span class="dno${ranked&&i<3?" m"+(i+1):""}">${ranked?i+1:"–"}</span>${showOld&&d.new&&!d.rerun?`<span class="dnew">New</span>`:""}</div>
      <div class="dtx"><span class="dg">${esc(SHORT[d.tag])}${tag}</span><b>${esc(d.label)}</b>
      ${glRow(d)}
      <div class="dpills">${d.zl_alltime?`<span class="pk">${ord(d.zl_alltime[0])} of ${d.zl_alltime[1]} all-time${runOpen(d)?" so far":""}</span>`:""}<span class="dd">${plural(d.days,"day")}${showOld?" in "+mo.slice(0,3):""}</span></div>
      <span class="drec">${rec}</span></div></a>`;
}
function openCard(d, i, f, showOld){
  const mo=MONTHS[+f.ym.slice(5)-1];
  const tag = showOld && !d.new ? ` · from ${dayStr(d.start)}` : d.rerun ? " · rerun" : "";
  return `<a class="dcard${d.beat?"":" late"}" href="#${f.ym}/${d.tag}" style="--acc:${d.color||GAME_ACCENT[d.tag]}">
      <div class="dart${frame(d)}">${pic(d,"",{},"zoom")}<span class="dno${d.beat&&i<3?" m"+(i+1):""}">${d.beat?i+1:"–"}</span>${showOld&&d.new&&!d.rerun?`<span class="dnew">New</span>`:""}</div>
      <div class="dtx"><span class="dg">${esc(SHORT[d.tag])}${tag}</span><b>${esc(d.label)}</b>
      <div class="dstats">
        <div><span>Japan</span><strong>${d.rev_month>0?fmtG(d.rev_month):"—"}</strong><small>${d.days&&d.rev_month>0?fmtG(d.rev_month/d.days)+"/day":"&nbsp;"}</small></div>
        <div><span>China iPhone</span><strong>${d.cn_month>0?fmtUSD(d.cn_month):"—"}</strong><small>${d.days&&d.cn_month>0?fmtUSD(d.cn_month/d.days)+"/day":"&nbsp;"}</small></div>
      </div>${bothRow(d)}
      <div class="dpills"><span class="pk${d.jp_peak<=10?" t1":d.jp_peak<=50?" t2":""}">${rk(d.jp_peak)} JP</span>${d.cn_peak?`<span class="pk${d.cn_peak<=10?" t1":d.cn_peak<=50?" t2":""}">${rk(d.cn_peak)} CN</span>`:""}<span class="dd">${plural(d.days,"day")}${showOld?" in "+mo.slice(0,3):""}</span></div>
      <span class="drec">${d.beat?`Won ${d.beat[0]} of ${d.beat[1]} head-to-heads`:`Too new to rank: ${plural(d.days,"day")} in ${mo}`}</span></div></a>`;
}
function debutsHTML(f){
  if(GL){ const {list, pair}=J.gopen||{list:[]}; if(!list.length) return "";
    const pn = pair ? `<p class="dnote">${rich(`Over the same first ${plural(pair.n,"day")}, ${MK.b(pair.a)} took ${MK.n("≈"+fmtCNYr(pair.va))} worldwide, ${MK.b(pair.b)} ${MK.n("≈"+fmtCNYr(pair.vb))}.`)}</p>` : "";
    return `<section class="debuts"><div class="sec-k">New this month</div><h3 class="sec-h">The month's openings, worldwide</h3>
    <p class="sec-sub">Head to head on Global revenue over equal days. <button class="howbtn" type="button" data-how="gopen">How the order is decided</button></p>
    <div class="dgrid">${list.slice(0,DEBUT_CARDS).map((d,i)=>openCardGL(d,i,f,"open")).join("")}</div>${pn}
    ${list.length>DEBUT_CARDS?`<p class="dmore"><b>Also opened:</b> ${list.slice(DEBUT_CARDS).map((d,i)=>`<a href="#${f.ym}/${d.tag}">${d.gbeat?(DEBUT_CARDS+i+1)+". ":""}${esc(d.label)}</a> <span class="mu">(${esc(SHORT[d.tag])}${d.rerun?", rerun":""}, ${esc(fmtBZ(d))})</span>`).join(" · ")}</p>`:""}</section>`; }
  if(!f.debuts.length) return "";
  return `<section class="debuts"><div class="sec-k">New this month</div><h3 class="sec-h">The month's openings</h3>
    <p class="sec-sub"><button class="howbtn" type="button" data-how="open">How the order is decided</button></p>
    <div class="dgrid">${f.debuts.slice(0,DEBUT_CARDS).map((d,i)=>openCard(d,i,f)).join("")}</div>
    ${topPairNote(f)}
    ${f.debuts.length>DEBUT_CARDS?`<p class="dmore"><b>Also opened:</b> ${f.debuts.slice(DEBUT_CARDS).map((d,i)=>`<a href="#${f.ym}/${d.tag}">${d.beat?(DEBUT_CARDS+i+1)+". ":""}${esc(d.label)}</a> <span class="mu">(${esc(SHORT[d.tag])}${d.rerun?", rerun":""}, ${fmtG(d.rev_month)})</span>`).join(" · ")}</p>`:""}</section>`;
}
// Top banners of the month: every banner on sale that month, new or carried over, by the same
// head-to-head as the openings — each pair over the same number of days inside the month.
function topHTML(f){
  if(GL){ const t=(J.gtop||[]).slice(0,10); if(!t.length) return "";
    const mo=MONTHS[+f.ym.slice(5)-1], nNew=t.filter(b=>b.new&&!b.rerun).length;
    return `<section class="debuts topm"><div class="sec-k">Every banner on sale</div><h3 class="sec-h">Top banners of the month, worldwide</h3>
      <p class="sec-sub">New or carried over, by estimated Global revenue inside ${mo}: each banner's share of its game's worldwide month. ${plural(nNew,"newcomer")} in the top ${t.length}.</p>
      <div class="dgrid">${t.map((d,i)=>openCardGL(d,i,f,"top")).join("")}</div></section>`; }
  const t=f.top||[]; if(!t.length) return "";
  const mo=MONTHS[+f.ym.slice(5)-1], nNew=t.filter(b=>b.new&&!b.rerun).length;
  const firstNew=t.findIndex(b=>b.new&&!b.rerun);
  const line = !t[0].new ? `A banner carried over from last month, ${t[0].label}, beat every newcomer.`
    : firstNew===0 ? `A newcomer took the top spot: ${t[0].label}.` : "";
  return `<section class="debuts topm"><div class="sec-k">Every banner on sale</div><h3 class="sec-h">Top banners of the month</h3>
    <p class="sec-sub">New or carried over, ranked the same way as the openings, on their days inside ${mo}. ${plural(nNew,"newcomer")} in the top ${t.length}. ${esc(line)}
      <button class="howbtn" type="button" data-how="top">How the order is decided</button></p>
    <div class="dgrid">${t.map((d,i)=>openCard(d,i,f,true)).join("")}</div>
    ${topPairNote(f, f.top_note)}</section>`;
}
// The month's banners as ranked cards. Order = median rank across every measure; each measure
// shows its value, a bar against the month's best, and a star on the banner that won it.
function bannerCard(b, i, ctx){
  const v=verdict(b), many=ctx.n>1;
  const win=k=>k==="zl" ? (many && bz(b)>0 && bz(b)===ctx.maxZ ? " win" : "") : many && b.mranks && b.mranks[k]===1 && b[k] ? " win" : "";
  const bar=(x,m)=>`<i class="bc-bar"><i style="width:${m>0&&x>0?Math.max(2,x/m*100).toFixed(1):0}%"></i></i>`;
  const tier=r=>r==null?"":r<=10?" t1":r<=50?" t2":"";
  const cell=(k,label,val,extra)=>`<div class="m${win(k)}"><span class="k">${label}</span><b>${val}</b>${extra||""}</div>`;
  const nx=MONTHS[+nextYm(G_YM).slice(5)-1].slice(0,3), mo=MONTHS[+G_YM.slice(5)-1].slice(0,3);
  const chips=[ctx.game?`<span class="chip game" style="--gacc:${GAME_ACCENT[b.tag]}">${esc(SHORT[b.tag])}</span>`:"",
    b.new&&!b.rerun?`<span class="chip new">New</span>`:"", b.rerun?`<span class="chip">Rerun</span>`:"", runsOn(b,G_YM)?`<span class="chip live">Runs into ${nx}</span>`:"",
    v&&v.final&&v.tier==="top"?`<span class="chip good">Top run</span>`:"", v&&v.final&&v.tier==="bottom"?`<span class="chip bad">Weak run</span>`:""].join("");
  const AT=ctx.gl ? b.zl_alltime : b.alltime;
  const pctl=AT&&AT[1]>1?(1-(AT[0]-1)/(AT[1]-1))*100:null;
  const perDay=ctx.gl ? (bz(b)>0&&b.days?` · ≈${fmtCNYr(bz(b)/b.days)}/day`:"") : (b.rev_month>0&&b.days?` · ${fmtG(b.rev_month/b.days)}/day`:"");
  const daysTxt=b.days?` · ${plural(b.days,"day")} in ${mo}${perDay}`:"";
  const allTime=`<div class="m"><span class="k">All-time${ctx.gl?" worldwide":""}${runOpen(b)?" (so far)":""}</span><b>${AT?`${ord(AT[0])}<small> of ${AT[1]}</small>`:"—"}</b>${pctl!=null?`<i class="bc-bar pct"><i style="width:${pctl.toFixed(1)}%"></i></i>`:""}</div>`;
  return `<li class="bc${ctx.compact?" compact":""}" style="--acc:${b.color}">
    <div class="bc-pos"><span class="${i<3?"m"+(i+1):""}">${i+1}</span></div>
    <div class="bc-art${frame(b)}">${pic(b,b.label,{ty:0.42},"zoom")}</div>
    <div class="bc-body">
      <div class="bc-hd"><span class="bav">${b.icons&&b.icons[0]?img(b.icons[0]):img(b.img,"","",{face:b.face,ty:0.5})}</span>
        <div class="bc-nm"><b>${ctx.game?`<a href="#${G_YM}/${b.tag}">${esc(b.label)}</a>`:esc(b.label)}</b><small>${dayStr(b.start)} – ${dayStr(b.end)}${daysTxt}</small></div><div class="chips">${chips}</div></div>
      <div class="bc-m">${ctx.gl ? `
        ${cell("zl",`${GLOBE}Worldwide`,b.zl_month?fmtBZ(b):'<span class="mu">—</span>',bar(bz(b),ctx.maxZ))}
        <div class="m"><span class="k">Share of the month</span><b>${ctx.totZ>0&&bz(b)>0?Math.round(bz(b)/ctx.totZ*100)+"%":'<span class="mu">—</span>'}</b></div>
        ${ctx.game?"":allTime}` : `
        ${cell("rev_month","Japan",b.rev_month>0?fmtG(b.rev_month):'<span class="mu">below #200</span>',bar(b.rev_month,ctx.maxJ))}
        ${ctx.hasCN?cell("cn_month","China iPhone",b.cn_month>0?fmtUSD(b.cn_month):'<span class="mu">—</span>',bar(b.cn_month,ctx.maxC)):""}
        ${ctx.hasCN&&fxRate("JPY")?`<div class="m both" title="${esc(BOTH_TIP())}"><span class="k">Japan + China</span><b>${b.cn_month>0||b.rev_month>0?fmtUSD(bothUSD(b.rev_month,b.cn_month)):'<span class="mu">—</span>'}</b></div>`:""}
        ${cell("jp_peak","Peak JP",`<span class="pk${tier(b.jp_peak)}">${rk(b.jp_peak)}</span>`)}
        ${ctx.hasCN?cell("cn_peak","Peak CN",`<span class="pk${tier(b.cn_peak)}">${rk(b.cn_peak)}</span>`):""}
        ${ctx.game?"":allTime}`}
      </div>
    </div></li>`;
}
function cardCtx(list, extra){
  const mx=k=>Math.max(0,...list.map(b=>b[k]||0));
  return {n:list.length, maxJ:mx("rev_month"), maxC:mx("cn_month"), maxZ:Math.max(0,...list.map(bz)), gl:GL,
          hasCN:list.some(b=>b.cn_month>0||b.cn_peak), ...extra};
}
// The month's banners as ranked cards. Order = median rank across every measure; each measure
// shows its value, a bar against the month's best, and a star on the banner that won it.
function bannerList(g){
  if(!g.banners.length) return "";
  const ctx=cardCtx(g.banners, {totZ:zmid(g.zl)});
  return `<div class="blist-hd"><span>The month's banners${GL?", by worldwide estimate":""}</span><small>★ = best on that measure${GL?"":` · <button class="howbtn" type="button" data-how="month">How the order is decided</button>`}</small></div>
  <ol class="blist">${g.banners.map((b,i)=>bannerCard(b,i,ctx)).join("")}</ol>`;
}
// Top of the month: every banner running in the month, from every game, on the same rule — so
// the month's new arrivals can be read against everything else that was on sale.
// What's next: for the latest issue, the announced next banner (upcoming.json); for older
// issues, the banners that actually came next.
const SHOW_NEXT = false;                   // hidden for now (user, 2026-11-04)
function nextHTML(g, f){
  const latest=J.index.issues[0] && J.index.issues[0].ym===f.ym;
  const u=latest && J.upcoming[f.ym] && J.upcoming[f.ym][g.tag];
  if(u) return `<aside class="next" style="--acc:${u.color||GAME_ACCENT[g.tag]}">
    <div class="next-k">What's next</div>
    <div class="next-in">${u.img?`<div class="next-art${u.icon?" icon":""}">${img(u.img,"",u.name)}</div>`:""}
      <div class="next-tx"><h5>${esc(u.name)}</h5>${u.when?`<p class="next-when">${esc(u.when)}</p>`:""}
        ${(u.text||[]).map(t=>`<p>${esc(t)}</p>`).join("")}${u.question?`<p class="next-q">${esc(u.question)}</p>`:""}
        ${u.src&&u.src.length?`<p class="next-src">Sources: ${u.src.map((s,i)=>`<a href="${esc(s)}" target="_blank" rel="noopener">${i+1}</a>`).join(" · ")}</p>`:""}</div></div></aside>`;
  const nx=(g.next||[]); if(!nx.length) return "";
  return `<aside class="next" style="--acc:${GAME_ACCENT[g.tag]}"><div class="next-k">What came next</div>
    <div class="next-list">${nx.map(b=>`<div class="next-b" style="--acc:${b.color}">
      <div class="next-art${frame(b)}">${pic(b,b.label,{ty:0.42},"zoom")}</div>
      <div><b>${esc(b.label)}</b><small>${b.rerun?"Rerun · ":""}from ${dayStr(b.start)}${b.start.slice(0,4)!==f.ym.slice(0,4)?" "+b.start.slice(0,4):""}</small></div></div>`).join("")}</div></aside>`;
}
const f_pending = ym => !!(J.cache[ym] && J.cache[ym].facts.market && J.cache[ym].facts.market.zl_pending);
function statStrip(g, ym){
  const p=pct(g.jp,g.jp_prev), pc=pct(g.cn,g.cn_prev), hp=histPhrase(g,ym);
  const cells=[];
  if(g.jp) cells.push(`<div><span>Japan${g.jp_src==="banners"?" (banners)":""}</span><b>${fmtG(g.jp)}</b><em class="${p==null?"":p>=0?"up":"dn"}">${p==null?"&nbsp;":pctStr(p)+" m/m"}</em></div>`);
  if(g.jp_rank) cells.push(`<div><span>Japan rank</span><b>${ord(g.jp_rank[0])}</b><em>of ${g.jp_rank[1]} games</em></div>`);
  if(g.cn) cells.push(`<div><span>China iPhone${g.cn_partial?" (partial)":""}</span><b>${fmtUSD(g.cn)}</b><em class="${pc==null?"":pc>=0?"up":"dn"}">${pc==null?"&nbsp;":pctStr(pc)+" m/m"}</em></div>`);
  if(g.cn && fxRate("JPY")) cells.push(`<div title="${esc(BOTH_TIP())}"><span>Japan + China iPhone</span><b>${fmtUSD(bothUSD(g.jp,g.cn))}</b><em>US$ · the month's rate</em></div>`);
  if(g.cn_rank) cells.push(`<div><span>China rank</span><b>${ord(g.cn_rank[0])}</b><em>of ${g.cn_rank[1]} games</em></div>`);
  const latest=J.index.issues[0] && J.index.issues[0].ym===ym, zp=pct(g.zl&&(g.zl.lo+g.zl.hi)/2, g.zl_prev&&(g.zl_prev.lo+g.zl_prev.hi)/2);
  if(SHOW_ZL && g.zl) cells.push(`<div class="zlcell"><span>${esc(g.zl.metric||"总流水")} · all platforms ${lateTag(false)}</span><b>${fmtCNYr(g.zl.lo,g.zl.hi)}</b><em class="${zp==null?"":zp>=0?"up":"dn"}">${zp==null?"&nbsp;":pctStr(zp)+" m/m"}</em></div>`);
  else if(SHOW_ZL && latest && (f_pending(ym))) cells.push(`<div class="zlcell"><span>总流水 · all platforms ${lateTag(true)}</span><b class="mu">Not out yet</b><em>&nbsp;</em></div>`);
  if(g.hist) cells.push(`<div><span>In its history</span><b>${ord(g.hist.rank)}</b><em>of ${g.hist.of} months${hp?" · "+hp.replace(/^its /,""):""}</em></div>`);
  return `<div class="stats">${cells.join("")}</div>`;
}
function statStripGL(g, ym){
  const p=zlPct(g), hp=histPhrase(g,ym), h=g.zl_hist, cells=[];
  const em=x=>`<em class="${x==null?"":x>=0?"up":"dn"}">${x==null?"&nbsp;":pctStr(x)+" m/m"}</em>`;
  cells.push(g.zl ? `<div class="glcell"><span>${GLOBE}Worldwide</span><b>${fmtZ(g.zl)}</b>${em(p)}</div>`
                  : `<div class="glcell"><span>${GLOBE}Worldwide</span><b class="mu">Not listed</b><em>&nbsp;</em></div>`);
  if(g.zl_rank) cells.push(`<div><span>Worldwide rank</span><b>${ord(g.zl_rank[0])}</b><em>of ${g.zl_rank[1]} games</em></div>`);
  if(h) cells.push(`<div><span>In its history</span><b>${ord(h.rank)}</b><em>of ${h.of} ${esc(h.metric||"")} months${hp?" · "+hp.replace(/^its /,""):""}</em></div>`);
  const top=(J.gtop||[]).findIndex(x=>x.tag===g.tag);
  if(top>=0) cells.push(`<div><span>Best banner worldwide</span><b>${ord(top+1)}</b><em>of the month's ${J.gtop.length} banners</em></div>`);
  return `<div class="stats">${cells.join("")}</div>`;
}
// GL: the game's banners by their Global estimate (stable, so banners without one keep their order at the end)
const glView = g => !GL ? g : g.gorder ? {...g, banners:g.gorder.map(i=>g.banners[i])} : {...g, banners:[...g.banners].sort((a,b)=>bz(b)-bz(a))};
function featureHTML(g0, f, notes, n){
  const g=glView(g0), nn=GL ? ((notes&&notes.global)||{}) : (notes||{});
  const w=(nn.games&&nn.games[g.tag])||{};
  // the hero art: the banner the notes name ("hero"), else the month's top earner with art
  const top=(w.hero&&g.banners.find(b=>b.label===w.hero&&b.img))||g.banners.find(b=>b.img||b.art)||g.banners[0];
  const acc=(top&&top.color)||GAME_ACCENT[g.tag];
  // notes are hand-written HTML (trusted); the fallback copy is built from data, so it's escaped
  const body=(w.body&&w.body.length?w.body:(GL?autoBodyGL(g,f.ym):autoBody(g,f.ym)).map(rich)).map(t=>`<p>${t}</p>`).join("");
  const kicker=(GL ? [g.zl_rank?`No. ${g.zl_rank[0]} worldwide`:null]
                   : [g.jp_rank?`No. ${g.jp_rank[0]} in Japan`:null, g.cn_rank?`No. ${g.cn_rank[0]} in China`:null]).filter(Boolean).join(" · ");
  const dek=GL?autoDekGL(g,f.ym):autoDek(g,f.ym);
  const brief=!FEATURED.includes(g.tag);
  return `<article class="feat${brief?" brief":""}" id="g-${g.tag}" style="--acc:${acc};--gacc:${GAME_ACCENT[g.tag]}">
    <header class="feat-hd"><img class="feat-ic" src="${g.icon}" alt=""><div><div class="feat-k">${esc(g.name)}${kicker?` <span>· ${kicker}</span>`:""}</div>
      <h3>${esc(w.headline||autoHeadline(g))}</h3>${w.dek?`<p class="dek">${w.dek}</p>`:dek?`<p class="dek">${esc(dek)}</p>`:""}</div></header>
    ${top&&(top.img||top.art)?`<figure class="feat-art${frame(top)}">${pic(top,top.label,{ty:0.4},"whole")}<figcaption>${esc(top.label)}${top.rerun?" (rerun)":""} · ${dayStr(top.start)} – ${dayStr(top.end)}</figcaption></figure>`:""}
    ${GL?statStripGL(g, f.ym):statStrip(g, f.ym)}
    <div class="copy">${body}${w.pull?`<blockquote>${esc(w.pull)}</blockquote>`:""}</div>
    ${SHOW_NEXT?nextHTML(g, f):""}
    ${bannerList(g)}
  </article>`;
}

// Games run in the order of their best entry in the month's openings; games with no new banner
// that month follow, by Japan revenue.
function gameOrder(f){
  const deb=GL&&J.gopen ? J.gopen.list : f.debuts;
  const at=t=>{ const i=deb.findIndex(d=>d.tag===t); return i<0?Infinity:i; };
  return [...f.games].sort((a,b)=>at(a.tag)-at(b.tag) || (GL ? zmid(b.zl)-zmid(a.zl) : (b.jp||0)-(a.jp||0)));
}
function render(iss, focus){
  const {facts:f, notes}=iss; G_YM=f.ym;
  const st=hasGL(f) ? "out" : f.market&&f.market.zl_pending ? "pending" : "none";
  GL = _ed==="global" && st==="out";
  // the build's Global head-to-heads (build_journal duel_gl: the start-of-month rules on Global)
  J.gtop = GL ? (f.gtop || glTop(f)) : null;
  J.gopen = GL ? (f.gopen ? {list:f.gopen, pair:f.gopen_note && {...f.gopen_note, va:f.gopen_note.a.glob, vb:f.gopen_note.b.glob}} : glOpenings(f)) : null;
  $("#edBar").innerHTML = edBar({ym:f.ym, st});
  document.body.classList.toggle("is-gl", GL);
  const nt = GL ? ((notes&&notes.global)||{}) : (notes||{});
  document.title=`${monthName(f.ym)} · Gacha Tracker Monthly`;
  $("#mastLine").innerHTML=`<span>No. ${f.number}</span><span>${monthName(f.ym)}</span>${GL?`<span class="ml-gl">Global edition</span>`:""}<span>${plural(f.games.length,"game")} · ${plural(f.games.reduce((a,g)=>a+g.banners.length,0),"banner")}</span>`;
  const idx=J.index.issues, at=idx.findIndex(x=>x.ym===f.ym);
  const newer=idx[at-1], older=idx[at+1];
  const c=(GL ? f.gcover||f.cover : f.cover)||{};
  const lines=nt.coverlines||(GL?autoCoverLinesGL(f):autoCoverLines(f));
  const head=nt.headline||(GL ? glHead(f.gcover, f.ym) : c.label?`${c.label} leads the month's openings`:monthName(f.ym));
  const games=gameOrder(f);
  const toc=games.map(g=>`<a href="#${f.ym}/${g.tag}" style="--acc:${GAME_ACCENT[g.tag]}"><img src="${g.icon}" alt=""><span>${esc(SHORT[g.tag])}</span></a>`).join("");
  const letter=(nt.letter||[]).map(t=>`<p>${t}</p>`).join("");
  $("#issue").innerHTML=`
    <section class="cover" style="--acc:${c.color||"#888"}">
      <div class="cover-art${frame(c)}">${pic(c,c.label,{tx:0.7,txm:0.5,ty:0.3},"whole")}</div>
      <div class="cover-tx">
        <div class="cover-k">The ${monthName(f.ym)} issue${GL?` · Global edition`:""}</div>
        <h2>${esc(head)}</h2>
        ${nt.dek?`<p class="cover-dek">${nt.dek}</p>`:""}
        <ul class="coverlines">${lines.map(l=>`<li>${esc(l)}</li>`).join("")}</ul>
        ${c.label?`<p class="cover-cred">On the cover: <b>${esc(c.label)}</b>, ${esc(c.game)}${GL&&c.zl_month?` · ${esc(fmtBZ(c))} worldwide in ${MONTHS[+f.ym.slice(5)-1]} (est.)`:""}</p>`:""}
      </div>
    </section>
    <nav class="toc"><span class="toc-k">In this issue</span>${toc}</nav>
    ${letter?`<section class="letter"><div class="sec-k">From the editor</div>${letter}</section>`:""}
    ${marketHTML(f)}
    ${GL?`<section class="charts"><div class="sec-k">The charts</div><h3 class="sec-h">Who earned the most, worldwide</h3>
      <div class="chartcols gl1">${globalChart(f)}</div></section>`:`<section class="charts"><div class="sec-k">The charts</div><h3 class="sec-h">Who earned the most</h3>
      <div class="chartcols">${rankChart(f,"jp",fmtG,"Japan",`game-i · App Store + Google Play, ${usdOn()?`yen in US$ at ${esc(fxLine())}`:"yen"}`)}${rankChart(f,"cn",fmtUSD,"China iPhone","Qimai · App Store, US$")}${bothChart(f)}</div></section>`}
    ${debutsHTML(f)}
    ${topHTML(f)}
    <div class="feats">${games.map((g,i)=>featureHTML(g,f,nt,i)).join("")}</div>
    <nav class="issnav">${older?`<a href="#${older.ym}">← ${monthName(older.ym)}</a>`:"<span></span>"}<a href="#archive" class="arch">All issues</a>${newer?`<a href="#${newer.ym}">${monthName(newer.ym)} →</a>`:"<span></span>"}</nav>`;
  $("#archive").hidden=true; $("#issue").hidden=false;
  requestAnimationFrame(fitAll);            // art already in cache won't wait for a load event
  if(focus){ const el=document.getElementById("g-"+focus); if(el){ el.scrollIntoView({block:"start"}); return; } }
  scrollTo(0,0);
}
function renderArchive(){
  const by={}; J.index.issues.forEach(x=>(by[x.ym.slice(0,4)]=by[x.ym.slice(0,4)]||[]).push(x));
  const gl=_ed==="global"; GL=false; document.body.classList.toggle("is-gl", gl);
  $("#edBar").innerHTML = edBar({archive:true, n:J.index.issues.filter(x=>x.zl).length, of:J.index.issues.length});
  const card=x=>{ G_YM=x.ym;                       // a US$ figure uses that issue's month rate
    const useGL=gl && x.zl, cv=(useGL ? x.gcover||x.cover : x.cover)||null;
    const head=useGL ? (x.ghead||glHead(x.gcover, x.ym)) : (x.headline||(x.cover?x.cover.label:monthName(x.ym)));
    const tag=!gl ? "" : useGL ? `<em class="agl">${GLOBE}${esc(fmtCNYr(x.zl_total[0], x.zl_total[1]))}</em>`
      : `<em class="agl none">${x.zl_pending?"Global: pending":"No Global edition"}</em>`;
    return `<a class="acard${gl&&!x.zl?" nogl":""}" href="#${x.ym}" style="--acc:${(cv&&cv.color)||"#888"}">
      <div class="aart${frame(cv)}">${pic(cv,"",{ty:0.34,z:1.5},"zoom")}</div><div class="atx"><span>No. ${x.number} · ${MONTHS[+x.ym.slice(5)-1]}</span>
      <b>${esc(head)}</b>${tag}</div></a>`; };
  $("#archive").innerHTML=`<h2 class="arch-h">Every issue${gl?` <span class="arch-gl">Global edition</span>`:""}</h2>${Object.keys(by).sort().reverse().map(y=>`
    <h3 class="arch-y">${y}</h3><div class="agrid">${by[y].map(card).join("")}</div>`).join("")}`;
  $("#issue").hidden=true; $("#archive").hidden=false;
  requestAnimationFrame(fitAll);
  document.title="Archive · Gacha Tracker Monthly";
  $("#mastLine").innerHTML=`<span>${J.index.issues.length} issues</span><span>${monShort(J.index.issues.at(-1).ym)} – ${monShort(J.index.issues[0].ym)}</span>`;
  scrollTo(0,0);
}
async function route(){
  const h=(location.hash||"").replace("#","");
  if(h==="archive") return renderArchive();
  const [ym, focus]=h.split("/");
  const pick=J.index.issues.find(x=>x.ym===ym)||J.index.issues[0];
  try{ render(await loadIssue(pick.ym), focus); }
  catch(e){ $("#issue").innerHTML=`<p class="loading">Couldn't load this issue (${esc(e.message)}).</p>`; }
}
// "How the order is decided": one dialog, used by the openings and every game's banner list
// (both ranked on the month itself). Delegated, since the page's CSP allows no inline handlers.
// "How the order is decided": both rankings are margin-weighted head-to-heads — a game's banners
// on the month's four figures, the month's openings on Compare's measures over equal days.

// The margin weight both rankings use: the log of the ratio, a 2× lead or more = a full point;
// day counts score by rarity: the share of banners from the year around them that sit between the two.
const mwRatio = (a,b) => { const lo=Math.min(a,b), hi=Math.max(a,b); return hi<=0?0 : lo<=0?1 : Math.min(1, Math.log(hi/lo)/Math.LN2); };
const MARGIN_RULE = `<li><b>Bigger wins count more.</b> Each measure is worth up to one point, scaled by how big the win is: revenue and ranks use the ratio between the two (a <b>2× lead or more</b> is the full point, a 10% lead is about 0.14), and day counts (at #1, in the top 3 or 10, the day it left the top 200) use how rare the gap is: the share of banners from the year around them, over the same days, that sit between the two. One day at China's #1 against none is close to a full point, because only about 3 in 100 recent banners get there. One big win isn't outweighed by several hairline ones.</li>`;
const LIFT_RULE = `<li><b>Lifted days.</b> When another banner opens in the middle of a run, the game's rank on the following days is lifted by that launch. Those days still count for the running banner, but at the rank it was on course for (its own pace over the days before), and never toward its peak, days at #1 or in the top 3.</li>`;
function howTable(rows, n){   // a count row may carry its rarity as an 8th field (made-up examples)
  const fmt={yen:v=>fmtG(v/100), usd:fmtUSD, rank:v=>"#"+v, days:v=>String(v), d:v=>v.toFixed(1)+"d", pct:v=>"+"+v+"%/day", drop:v=>v>n?"no drop":"day "+v, txt:v=>v};
  let A=0, B=0, cA=0, cB=0;
  const body=rows.map(([g,l,a,b,f,kind,hi,rar])=>{
    let w=null, pt=0;
    if(kind!=="draw" && a!==b){ w = hi ? (a>b?"a":"b") : (a<b?"a":"b");
      pt = kind==="count" ? (rar!=null ? rar : Math.min(1, Math.abs(a-b)/Math.max(1,n/3))) : mwRatio(a,b);
      if(w==="a"){ A+=pt; cA++; } else { B+=pt; cB++; } }
    const cell=(v,side)=>`<td class="${w===side?"w":""}">${fmt[f](v)}${w===side?` <small>+${pt.toFixed(2)}</small>`:""}</td>`;
    return `<tr><td>${g}</td><td>${l}</td>${cell(a,"a")}${cell(b,"b")}</tr>`; }).join("");
  return {html:`<table class="how-t"><tr><th></th><th></th><th>Banner A</th><th>Banner B</th></tr>${body}</table>`, A, B, cA, cB};
}
const MEDIAN_RULES = `
    <ul>
      <li><b>Japan revenue</b>: game-i's estimate, App Store + Google Play Japan.</li>
      <li><b>China revenue</b>: Qimai's estimate, China's iPhone App Store.</li>
      <li><b>Peaks</b>: the best daily top-grossing rank reached (a lower number is better).</li>
    </ul>`;
function howOpen(){
  // made up: B crushes China, A edges most Japan measures — counting wins and weighing them disagree
  const t=howTable([["Japan revenue","Total",310,295,"yen","ratio",1],["","Best-rank day",64,61,"yen","ratio",1],["","First week",240,232,"yen","ratio",1],
    ["China iPhone","Total",1.1e6,2.4e6,"usd","ratio",1],["","Best-rank day",2.1e5,4.7e5,"usd","ratio",1],["","First week",8e5,1.8e6,"usd","ratio",1],
    ["Japan chart","Peak rank",8,9,"rank","ratio",0],["","Days in top 3",3,2,"days","count",1,0.08],["","Days in top 10",5,4,"days","count",1,0.05],["","Median rank",18,20,"rank","ratio",0],["","Left the top 200",12,12,"drop","draw"],["","Rank decay",15,16,"pct","ratio",0],
    ["China chart","Peak rank",14,5,"rank","ratio",0],["","Days in top 3",0,1,"days","count",1,0.91],["","Days in top 10",0,5,"days","count",1,0.88],["","Median rank",35,16,"rank","ratio",0],["","Left the top 200",9,12,"drop","count",1,0.3],["","Rank decay",13,19,"pct","ratio",0]], 11);
  return `
    <p>Openings start on different days, so comparing whole months isn't fair: one that opened on the 21st has had fewer days than one from the 15th.
      Every opening is played <b>head to head</b> against every other one, over the <b>same number of days</b>, on the measures of the tracker's <b>Compare</b>:</p>
    <p class="how-f">window = the shorter of the two runs inside the month<br>winner = more points over that window, each measure weighted by the size of the win</p>
    <ul>
      <li><b>Revenue</b>: game-i (Japan) and Qimai (China iPhone): the total, the revenue on the best-rank day, and the first week.</li>
      <li><b>Japan and China chart</b>: peak rank, days at #1, in the top 3 and in the top 10, median rank, the day it left the top 200, and <b>rank decay</b>: how fast the rank fell after the peak, as the % its rank number grew a day: peak #3, then #8, #20, #40 is <b>+143%/day</b>, a fast fall; #3, #4, #5, #6 is <b>+25%/day</b>, a slow one. <b>Lower is better</b>. Days below #200 count as #201 in the median; the decay runs from the peak to the day it first fell below #200 (counted at #201), and that day is a measure of its own, for Japan and China.</li>
      ${MARGIN_RULE}
      ${LIFT_RULE}
      <li>A game not sold in China (Umamusume) counts as $0 and below #200 there, and against it the China measures count at <b>half weight</b>: it isn't sold there, so losing them in full would shut it out of every month, while leaving them out would judge it on Japan alone. Sensor Tower and the Global monthly figures aren't used: they only exist for whole months.</li>
      <li>An even score goes to the bigger combined revenue over the window (Japan + China iPhone, the yen in US$ at that month's average rate).</li>
      <li>The order is the number of head-to-heads won. Banners that won <b>the same number</b> are ordered by <b>Japan + China iPhone revenue in US$ over their shared days</b>: the one that earned more ranks higher.</li>
      <li>A banner that opened on a month's last day or two counts as an opening of the <b>next</b> month instead, measured from its first day: one or two days are too few to judge it on.</li>
    </ul>
    <p class="how-ex"><b>Example (made up).</b> Banner A opened on the 10th, Banner B on the 20th, so both are read at <b>day 11</b>. Days at #1 are left out (neither got there); a draw scores nothing:</p>
    ${t.html}
    <p class="how-ex">Counting wins, A leads <b>${t.cA}–${t.cB}</b>, but most of A's wins are by a hair. Weighted by size it's <b>A ${t.A.toFixed(2)}, B ${t.B.toFixed(2)}</b>: Banner B, which more than doubled A in China, wins the head-to-head.</p>`;
}
function howTop(){
  return `<p class="how-lead"><b>Top banners of the month</b> use the same head-to-head as the openings, for every banner on sale that month, new or carried over.
    A carried-over banner is measured on its days <b>inside the month</b> (a banner that ran Sep 24 – Oct 15 is read from Oct 1), so each pair is still compared over the same number of days.</p>`;
}
function howMonth(){
  const t=howTable([["Japan","Revenue",620,410,"yen","ratio",1],["China iPhone","Revenue",1.9e6,2.1e6,"usd","ratio",1],["Japan","Peak rank",3,5,"rank","ratio",0],["China","Peak rank",12,11,"rank","ratio",0]], 30);
  return `
    <p>Inside each game, the month's banners are played <b>head to head</b> against each other on four figures from the days they ran <b>inside this month</b>:</p>
    <p class="how-f">winner = more points on<br>Japan revenue · China revenue · Japan peak · China peak, each weighted by the size of the win</p>
    ${MEDIAN_RULES}
    <ul>
      ${MARGIN_RULE}
      <li>A missing value loses that measure in full; a measure no banner has (China for a game not released there) is left out.</li>
      <li>The order is the number of head-to-heads won. ★ marks the best banner on each single measure.</li>
      <li>A banner that opened late in the month has fewer days here; the copy says how many.</li>
    </ul>
    <p class="how-ex"><b>Example (made up).</b> Banner A and Banner B ran in the same month:</p>
    ${t.html}
    <p class="how-ex">Two wins each, but A's are big (1.5× in Japan, #3 against #5) and B's are slim: <b>A ${t.A.toFixed(2)}, B ${t.B.toFixed(2)}</b>, so Banner A places first.</p>`;
}
function howOpenGL(){
  return `<p>In the <b>Global edition</b> the openings are compared on <b>one measure, Global revenue</b>, still over the <b>same number of days</b>: every opening plays every other one over the shorter of their two runs inside the month.</p>
    <p class="how-f">winner = more Global revenue over that window</p>
    <ul>
      <li><b>Global over a banner's first days</b>: ${GL_SRC} publishes one worldwide figure per game per month, so a banner's days are turned into Global at its game's own ratio that month (the game's worldwide month against its Japan and China iPhone months, averaged). Over its whole month this gives exactly the banner's Global figure on its card.</li>
      <li>The order is the number of head-to-heads won; equal wins go to the bigger Global month.</li>
      <li>Fewer than 3 days in the month, or a game the chart doesn't list: not ranked.</li>
    </ul>`;
}
function showHow(kind){
  const d=$("#howDlg");
  d.querySelector(".how-body").innerHTML = kind==="gopen" ? howOpenGL() : kind==="open" ? howOpen() : kind==="top" ? howTop() + howOpen() : howMonth();
  d.showModal();
}
document.addEventListener("click", e=>{
  const ed=e.target.closest("[data-ed]");
  if(ed){ if(ed.disabled) return; if(ed.dataset.ed!==_ed || !ed.classList.contains("on")){ _ed=ed.dataset.ed; try{ localStorage.setItem("jed",_ed); }catch(x){} route(); } return; }
  const b=e.target.closest(".howbtn"); if(b){ showHow(b.dataset.how); return; }
  if(e.target.id==="howDlg" || e.target.closest(".how-x")) $("#howDlg").close();   // backdrop or ✕
});

async function init(){
  applyTheme(_theme);
  $("#themeBtn").onclick=()=>applyTheme(THEMES[(THEMES.indexOf(_theme)+1)%3]);
  try{ J.fx=await getJSON("data/fx.json"); }catch(e){ J.fx=null; }
  try{ J.fxh=await getJSON("data/fx_history.json"); }catch(e){ J.fxh=null; }
  applyCcy();
  $("#ccyBtn").onclick=()=>{ _ccy=_ccy==="usd"?"native":"usd"; try{ localStorage.setItem("ccy",_ccy); }catch(e){}
    applyCcy(); const y=scrollY; if(J.index) route(); scrollTo(0,y); };
  $("#archBtn").onclick=()=>{ location.hash="archive"; };
  try{ J.index=await getJSON("data/journal/index.json"); }
  catch(e){ $("#issue").innerHTML=`<p class="loading">Couldn't load the journal index.</p>`; return; }
  J.glLast = (J.index.issues.filter(x=>x.zl).map(x=>x.ym).sort().at(-1)) || null;
  try{ J.upcoming=await getJSON("data/journal/upcoming.json"); }catch(e){ J.upcoming={}; }
  try{ J.themes=await getJSON("data/journal/themes.json"); }catch(e){ J.themes={}; }
  addEventListener("hashchange", route);
  route();
}
init();
