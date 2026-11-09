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
// US$ toggle, shared with the tracker (localStorage "ccy"): yen and yuan at one rate, the latest
// daily one (data/fx.json). Display only — every order on the page was decided on native figures.
let _ccy=(()=>{ try{ return localStorage.getItem("ccy")==="native" ? "native" : "usd"; }catch(e){ return "usd"; } })();
const fxRate = cur => (J.fx && J.fx.per_usd && J.fx.per_usd[cur]) || null;
const usdOn = () => _ccy==="usd" && !!fxRate("JPY") && !!fxRate("CNY");
function fmtG(oku){ if(usdOn()) return fmtUSD((oku>0?oku:0)*1e8/fxRate("JPY"));
  if(!(oku>0)) return "¥0"; const m=oku*100;
  return "¥"+(m>=1000 ? (m/1000).toFixed(2)+"B" : m>=100 ? Math.round(m)+"M" : (Math.round(m*10)/10)+"M"); }
function fmtUSD(v){ if(!(v>0)) return "$0";
  if(v>=1e9) return "$"+(v/1e9).toFixed(2)+"B"; if(v>=1e8) return "$"+Math.round(v/1e6)+"M";
  if(v>=1e7) return "$"+(v/1e6).toFixed(1)+"M"; if(v>=1e6) return "$"+(v/1e6).toFixed(2)+"M";
  if(v>=1e3) return "$"+Math.round(v/1e3)+"K"; return "$"+Math.round(v); }
// Japan + China iPhone as one figure, ALWAYS in US$ (whatever the toggle says): game-i's yen at
// the day's rate + Qimai's dollars. The rate is read when the page opens, so it follows the
// daily refresh of data/fx.json. null without a rate.
const jpUSD = oku => (oku>0 && fxRate("JPY")) ? oku*1e8/fxRate("JPY") : 0;
const bothUSD = (oku, usd) => fxRate("JPY") && (oku>0 || usd>0) ? jpUSD(oku)+(usd||0) : null;
function fxLine(cny){ const f=J.fx; if(!f || !f.per_usd) return "";
  const d=f.date?`${dayStr(f.date)} ${f.date.slice(0,4)}`:"";
  const src=/European Central Bank/.test(f.source||"") ? "ECB reference rate" : (f.source||"").replace(/ \(.*\)$/,"");
  return `$1 = ¥${f.per_usd.JPY}${cny?` = CN¥${f.per_usd.CNY}`:""} (${src}${d?", "+d:""})`; }
const BOTH_TIP = () => `Japan + China iPhone: game-i's yen converted at ${fxLine()}, plus Qimai's China iPhone dollars. One rate for every date, the latest daily one.`;
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
  if(ok) b.title=(on?"Showing yen and yuan in US$":"Show yen and yuan in US$")+` — $1 = ¥${J.fx.per_usd.JPY} = CN¥${J.fx.per_usd.CNY} (${J.fx.source}, ${J.fx.date}). Click to switch.`; }
// ---- theme (shares the tracker's saved choice) ----
const THEMES=["auto","light","dark"], TICON={auto:"◐",light:"☀",dark:"☾"};
let _theme=(()=>{ try{ return localStorage.getItem("theme")||"auto"; }catch(e){ return "auto"; } })();
function applyTheme(t){ _theme=t; const r=document.documentElement;
  if(t==="auto") r.removeAttribute("data-theme"); else r.setAttribute("data-theme",t);
  try{ localStorage.setItem("theme",t); }catch(e){}
  $("#themeBtn").textContent=TICON[t]; $("#themeBtn").title="Theme: "+t; }

// ---- written-from-the-facts copy, used wherever notes don't supply it ----
function histPhrase(g, ym){
  const h=g.hist; if(!h) return "";
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
function verdict(b){
  const ps=[b.alltime,b.cn_alltime].filter(x=>x&&x[1]>=6).map(([r,n])=>(r-1)/(n-1));
  if(!ps.length) return null;
  const v=ps.length===2?(ps[0]+ps[1])/2:ps[0];
  const tier = v<=.15?"top": v<=.34?"strong": v>=.85?"bottom": v>=.66?"weak":"mid";
  return {v, tier, final:!b.ongoing || v<=.34};          // b.ongoing: still running today, so its run isn't final
}
const weakRun = b => { const v=verdict(b); return v && v.final && (v.tier==="weak"||v.tier==="bottom"); };
const TIER = { top:"one of the game's strongest runs", strong:"in the top third of the game's banners", mid:"around the middle of the pack",
  weak:"an underwhelming run, in the game's bottom third", bottom:"one of the game's weakest runs" };
// the month's other new (non-rerun) banners, and the first of them whose finished run was weak
// (a banner that opened in the month's last days belongs to next month's story, not this one's)
const rivals = g => g.banners.slice(1).filter(b=>b.new && !b.rerun && (+b.start.slice(8)<=20 || b.rev_month>=b.rev_total/2));
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
          .replace(/\{(L|R|G|Gp|p)\}/g, (_, k) => v[k]==null ? "" : v[k]);
}
// a character-themed line (themes.json: "tag:Name" -> {good:[...], bad:[...]}) beats the generic bank
function themed(g, b, mood){ const t=b && J.themes[`${g.tag}:${b.label}`]; return t && t[mood] && t[mood].length ? t[mood] : null; }
function autoHeadline(g){
  const lead=g.banners[0]; if(!lead) return `${g.name}'s month`;
  const fl=flopOf(g), nb=rivals(g)[0], p=pct(g.jp,g.jp_prev), v=verdict(lead), G=SHORT[g.tag];
  const vars={L:lead.label, R:(fl||nb||{}).label, G, Gp:poss(G), p:p==null?"":Math.abs(p).toFixed(0)};
  const say=(sit, arr)=>fill(pick(g.tag+sit, arr), vars);
  if(fl) return say("fl", themed(g,fl,"flop") || BANK[lead.new?"flopNew":"flopOld"]);
  if(nb && !lead.new) return say("ro", BANK.rivalOld);
  if(g.hist && g.hist.rank===g.hist.of && g.hist.of>=4) return say("bt", BANK.bottom);
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
      <span class="val">${fmt(g[key])}</span><span class="chg ${p==null?"":p>=0?"up":"dn"}">${pctStr(p)}</span></li>`; }).join("")}</ol></div>`;
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
// ---- the month in totals: every tracked game added up, per source, plus Japan vs China ----
const pctOf = m => m && m.same_prev>0 ? (m.same/m.same_prev-1)*100 : null;
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
  return `<section class="market"><div class="sec-k">The month in totals</div><h3 class="sec-h">Every tracked gacha, added up</h3>
    <div class="mtiles">${mk.jp?tile("jp","Japan",`game-i · App Store + Google Play${usdOn()?` · at ${esc(fxLine())}`:""}`,fmtG(mk.jp.total),mk.jp):""}${mk.cn?tile("cn","China iPhone","Qimai · App Store",fmtUSD(mk.cn.total),mk.cn):""}${zlTile}</div>
    <div class="mcopy">${marketCopy(f).map(t=>`<p>${rich(t)}</p>`).join("")}</div>
    <div class="mcols">${col(mk.jp,"Japan, game by game")}${col(mk.cn,"China iPhone, game by game")}${zl?col(zl,`China 总流水, game by game ${lateTag(false)}`):""}</div>
    <p class="mnote">Changes compare the games present in both months, so a launch doesn't count as growth. Japan${SHOW_ZL?", China iPhone and 总流水 are":" and China iPhone are"} different measurements of different stores; they are added together only in the <b>Japan + China iPhone</b> figures, in US$ with the yen at ${esc(fxLine())}, one rate for every month.</p></section>`;
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
  const win=k=>many && b.mranks && b.mranks[k]===1 && b[k] ? " win" : "";
  const bar=(x,m)=>`<i class="bc-bar"><i style="width:${m>0&&x>0?Math.max(2,x/m*100).toFixed(1):0}%"></i></i>`;
  const tier=r=>r==null?"":r<=10?" t1":r<=50?" t2":"";
  const cell=(k,label,val,extra)=>`<div class="m${win(k)}"><span class="k">${label}</span><b>${val}</b>${extra||""}</div>`;
  const nx=MONTHS[+nextYm(G_YM).slice(5)-1].slice(0,3), mo=MONTHS[+G_YM.slice(5)-1].slice(0,3);
  const chips=[ctx.game?`<span class="chip game" style="--gacc:${GAME_ACCENT[b.tag]}">${esc(SHORT[b.tag])}</span>`:"",
    b.new&&!b.rerun?`<span class="chip new">New</span>`:"", b.rerun?`<span class="chip">Rerun</span>`:"", runsOn(b,G_YM)?`<span class="chip live">Runs into ${nx}</span>`:"",
    v&&v.final&&v.tier==="top"?`<span class="chip good">Top run</span>`:"", v&&v.final&&v.tier==="bottom"?`<span class="chip bad">Weak run</span>`:""].join("");
  const pctl=b.alltime&&b.alltime[1]>1?(1-(b.alltime[0]-1)/(b.alltime[1]-1))*100:null;
  const daysTxt=b.days?` · ${plural(b.days,"day")} in ${mo}${b.rev_month>0&&b.days?` · ${fmtG(b.rev_month/b.days)}/day`:""}`:"";
  return `<li class="bc${ctx.compact?" compact":""}" style="--acc:${b.color}">
    <div class="bc-pos"><span class="${i<3?"m"+(i+1):""}">${i+1}</span></div>
    <div class="bc-art${frame(b)}">${pic(b,b.label,{ty:0.42},"zoom")}</div>
    <div class="bc-body">
      <div class="bc-hd"><span class="bav">${b.icons&&b.icons[0]?img(b.icons[0]):img(b.img,"","",{face:b.face,ty:0.5})}</span>
        <div class="bc-nm"><b>${ctx.game?`<a href="#${G_YM}/${b.tag}">${esc(b.label)}</a>`:esc(b.label)}</b><small>${dayStr(b.start)} – ${dayStr(b.end)}${daysTxt}</small></div><div class="chips">${chips}</div></div>
      <div class="bc-m">
        ${cell("rev_month","Japan",b.rev_month>0?fmtG(b.rev_month):'<span class="mu">below #200</span>',bar(b.rev_month,ctx.maxJ))}
        ${ctx.hasCN?cell("cn_month","China iPhone",b.cn_month>0?fmtUSD(b.cn_month):'<span class="mu">—</span>',bar(b.cn_month,ctx.maxC)):""}
        ${ctx.hasCN&&fxRate("JPY")?`<div class="m both" title="${esc(BOTH_TIP())}"><span class="k">Japan + China</span><b>${b.cn_month>0||b.rev_month>0?fmtUSD(bothUSD(b.rev_month,b.cn_month)):'<span class="mu">—</span>'}</b></div>`:""}
        ${cell("jp_peak","Peak JP",`<span class="pk${tier(b.jp_peak)}">${rk(b.jp_peak)}</span>`)}
        ${ctx.hasCN?cell("cn_peak","Peak CN",`<span class="pk${tier(b.cn_peak)}">${rk(b.cn_peak)}</span>`):""}
        ${ctx.game?"":`<div class="m"><span class="k">All-time${b.ongoing?" (so far)":""}</span><b>${b.alltime?`${ord(b.alltime[0])}<small> of ${b.alltime[1]}</small>`:"—"}</b>${pctl!=null?`<i class="bc-bar pct"><i style="width:${pctl.toFixed(1)}%"></i></i>`:""}</div>`}
      </div>
    </div></li>`;
}
function cardCtx(list, extra){
  const mx=k=>Math.max(0,...list.map(b=>b[k]||0));
  return {n:list.length, maxJ:mx("rev_month"), maxC:mx("cn_month"), hasCN:list.some(b=>b.cn_month>0||b.cn_peak), ...extra};
}
// The month's banners as ranked cards. Order = median rank across every measure; each measure
// shows its value, a bar against the month's best, and a star on the banner that won it.
function bannerList(g){
  if(!g.banners.length) return "";
  const ctx=cardCtx(g.banners);
  return `<div class="blist-hd"><span>The month's banners</span><small>★ = best on that measure · <button class="howbtn" type="button" data-how="month">How the order is decided</button></small></div>
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
  if(g.cn && fxRate("JPY")) cells.push(`<div title="${esc(BOTH_TIP())}"><span>Japan + China iPhone</span><b>${fmtUSD(bothUSD(g.jp,g.cn))}</b><em>US$ · today's rate</em></div>`);
  if(g.cn_rank) cells.push(`<div><span>China rank</span><b>${ord(g.cn_rank[0])}</b><em>of ${g.cn_rank[1]} games</em></div>`);
  const latest=J.index.issues[0] && J.index.issues[0].ym===ym, zp=pct(g.zl&&(g.zl.lo+g.zl.hi)/2, g.zl_prev&&(g.zl_prev.lo+g.zl_prev.hi)/2);
  if(SHOW_ZL && g.zl) cells.push(`<div class="zlcell"><span>${esc(g.zl.metric||"总流水")} · all platforms ${lateTag(false)}</span><b>${fmtCNYr(g.zl.lo,g.zl.hi)}</b><em class="${zp==null?"":zp>=0?"up":"dn"}">${zp==null?"&nbsp;":pctStr(zp)+" m/m"}</em></div>`);
  else if(SHOW_ZL && latest && (f_pending(ym))) cells.push(`<div class="zlcell"><span>总流水 · all platforms ${lateTag(true)}</span><b class="mu">Not out yet</b><em>&nbsp;</em></div>`);
  if(g.hist) cells.push(`<div><span>In its history</span><b>${ord(g.hist.rank)}</b><em>of ${g.hist.of} months${hp?" · "+hp.replace(/^its /,""):""}</em></div>`);
  return `<div class="stats">${cells.join("")}</div>`;
}
function featureHTML(g, f, notes, n){
  const w=(notes&&notes.games&&notes.games[g.tag])||{};
  // the hero art: the banner the notes name ("hero"), else the month's top earner with art
  const top=(w.hero&&g.banners.find(b=>b.label===w.hero&&b.img))||g.banners.find(b=>b.img||b.art)||g.banners[0];
  const acc=(top&&top.color)||GAME_ACCENT[g.tag];
  // notes are hand-written HTML (trusted); the fallback copy is built from data, so it's escaped
  const body=(w.body&&w.body.length?w.body:autoBody(g,f.ym).map(rich)).map(t=>`<p>${t}</p>`).join("");
  const kicker=[g.jp_rank?`No. ${g.jp_rank[0]} in Japan`:null, g.cn_rank?`No. ${g.cn_rank[0]} in China`:null].filter(Boolean).join(" · ");
  const brief=!FEATURED.includes(g.tag);
  return `<article class="feat${brief?" brief":""}" id="g-${g.tag}" style="--acc:${acc};--gacc:${GAME_ACCENT[g.tag]}">
    <header class="feat-hd"><img class="feat-ic" src="${g.icon}" alt=""><div><div class="feat-k">${esc(g.name)}${kicker?` <span>· ${kicker}</span>`:""}</div>
      <h3>${esc(w.headline||autoHeadline(g))}</h3>${w.dek?`<p class="dek">${w.dek}</p>`:autoDek(g,f.ym)?`<p class="dek">${esc(autoDek(g,f.ym))}</p>`:""}</div></header>
    ${top&&(top.img||top.art)?`<figure class="feat-art${frame(top)}">${pic(top,top.label,{ty:0.4},"whole")}<figcaption>${esc(top.label)}${top.rerun?" (rerun)":""} · ${dayStr(top.start)} – ${dayStr(top.end)}</figcaption></figure>`:""}
    ${statStrip(g, f.ym)}
    <div class="copy">${body}${w.pull?`<blockquote>${esc(w.pull)}</blockquote>`:""}</div>
    ${SHOW_NEXT?nextHTML(g, f):""}
    ${bannerList(g)}
  </article>`;
}

// Games run in the order of their best entry in the month's openings; games with no new banner
// that month follow, by Japan revenue.
function gameOrder(f){
  const at=t=>{ const i=f.debuts.findIndex(d=>d.tag===t); return i<0?Infinity:i; };
  return [...f.games].sort((a,b)=>at(a.tag)-at(b.tag) || (b.jp||0)-(a.jp||0));
}
function render(iss, focus){
  const {facts:f, notes}=iss, nt=notes||{}; G_YM=f.ym;
  document.title=`${monthName(f.ym)} · Gacha Tracker Monthly`;
  $("#mastLine").innerHTML=`<span>No. ${f.number}</span><span>${monthName(f.ym)}</span><span>${plural(f.games.length,"game")} · ${plural(f.games.reduce((a,g)=>a+g.banners.length,0),"banner")}</span>`;
  const idx=J.index.issues, at=idx.findIndex(x=>x.ym===f.ym);
  const newer=idx[at-1], older=idx[at+1];
  const c=f.cover||{};
  const lines=nt.coverlines||autoCoverLines(f);
  const head=nt.headline||(c.label?`${c.label} leads the month's openings`:monthName(f.ym));
  const games=gameOrder(f);
  const toc=games.map(g=>`<a href="#${f.ym}/${g.tag}" style="--acc:${GAME_ACCENT[g.tag]}"><img src="${g.icon}" alt=""><span>${esc(SHORT[g.tag])}</span></a>`).join("");
  const letter=(nt.letter||[]).map(t=>`<p>${t}</p>`).join("");
  $("#issue").innerHTML=`
    <section class="cover" style="--acc:${c.color||"#888"}">
      <div class="cover-art${frame(c)}">${pic(c,c.label,{tx:0.7,txm:0.5,ty:0.3},"whole")}</div>
      <div class="cover-tx">
        <div class="cover-k">The ${monthName(f.ym)} issue</div>
        <h2>${esc(head)}</h2>
        ${nt.dek?`<p class="cover-dek">${nt.dek}</p>`:""}
        <ul class="coverlines">${lines.map(l=>`<li>${esc(l)}</li>`).join("")}</ul>
        ${c.label?`<p class="cover-cred">On the cover: <b>${esc(c.label)}</b>, ${esc(c.game)}</p>`:""}
      </div>
    </section>
    <nav class="toc"><span class="toc-k">In this issue</span>${toc}</nav>
    ${letter?`<section class="letter"><div class="sec-k">From the editor</div>${letter}</section>`:""}
    ${marketHTML(f)}
    <section class="charts"><div class="sec-k">The charts</div><h3 class="sec-h">Who earned the most</h3>
      <div class="chartcols">${rankChart(f,"jp",fmtG,"Japan",`game-i · App Store + Google Play, ${usdOn()?`yen in US$ at ${esc(fxLine())}`:"yen"}`)}${rankChart(f,"cn",fmtUSD,"China iPhone","Qimai · App Store, US$")}${bothChart(f)}</div></section>
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
  $("#archive").innerHTML=`<h2 class="arch-h">Every issue</h2>${Object.keys(by).sort().reverse().map(y=>`
    <h3 class="arch-y">${y}</h3><div class="agrid">${by[y].map(x=>`<a class="acard" href="#${x.ym}" style="--acc:${(x.cover&&x.cover.color)||"#888"}">
      <div class="aart${frame(x.cover)}">${pic(x.cover,"",{ty:0.34,z:1.5},"zoom")}</div><div class="atx"><span>No. ${x.number} · ${MONTHS[+x.ym.slice(5)-1]}</span>
      <b>${esc(x.headline||(x.cover?x.cover.label:monthName(x.ym)))}</b></div></a>`).join("")}</div>`).join("")}`;
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
      <li><b>Japan and China chart</b>: peak rank, days at #1, in the top 3 and in the top 10, median rank, the day it left the top 200, and <b>rank decay</b>: how fast the rank fell after the peak, as the % its rank number grew a day (+15%/day takes #10 to #11.5), so <b>lower is better</b>. Days below #200 count as #201, in the median and the decay alike; the day it first fell below #200 is a measure of its own, for Japan and China.</li>
      ${MARGIN_RULE}
      ${LIFT_RULE}
      <li>A game not sold in China (Umamusume) counts as $0 and below #200 there, and against it the China measures count at <b>half weight</b>: it isn't sold there, so losing them in full would shut it out of every month, while leaving them out would judge it on Japan alone. Sensor Tower and the CN monthly figures aren't used: they only exist for whole months.</li>
      <li>An even score goes to the bigger combined revenue over the window (Japan yen + China iPhone dollars at ¥150 per $1).</li>
      <li>The order is the number of head-to-heads won.</li>
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
function showHow(kind){
  const d=$("#howDlg");
  d.querySelector(".how-body").innerHTML = kind==="open" ? howOpen() : kind==="top" ? howTop() + howOpen() : howMonth();
  d.showModal();
}
document.addEventListener("click", e=>{
  const b=e.target.closest(".howbtn"); if(b){ showHow(b.dataset.how); return; }
  if(e.target.id==="howDlg" || e.target.closest(".how-x")) $("#howDlg").close();   // backdrop or ✕
});

async function init(){
  applyTheme(_theme);
  $("#themeBtn").onclick=()=>applyTheme(THEMES[(THEMES.indexOf(_theme)+1)%3]);
  try{ J.fx=await getJSON("data/fx.json"); }catch(e){ J.fx=null; }
  applyCcy();
  $("#ccyBtn").onclick=()=>{ _ccy=_ccy==="usd"?"native":"usd"; try{ localStorage.setItem("ccy",_ccy); }catch(e){}
    applyCcy(); const y=scrollY; if(J.index) route(); scrollTo(0,y); };
  $("#archBtn").onclick=()=>{ location.hash="archive"; };
  try{ J.index=await getJSON("data/journal/index.json"); }
  catch(e){ $("#issue").innerHTML=`<p class="loading">Couldn't load the journal index.</p>`; return; }
  try{ J.upcoming=await getJSON("data/journal/upcoming.json"); }catch(e){ J.upcoming={}; }
  try{ J.themes=await getJSON("data/journal/themes.json"); }catch(e){ J.themes={}; }
  addEventListener("hashchange", route);
  route();
}
init();
