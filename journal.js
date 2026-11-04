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
function fmtG(oku){ if(!(oku>0)) return "¥0"; const m=oku*100;
  return "¥"+(m>=1000 ? (m/1000).toFixed(2)+"B" : m>=100 ? Math.round(m)+"M" : (Math.round(m*10)/10)+"M"); }
function fmtUSD(v){ if(!(v>0)) return "$0";
  if(v>=1e9) return "$"+(v/1e9).toFixed(2)+"B"; if(v>=1e8) return "$"+Math.round(v/1e6)+"M";
  if(v>=1e7) return "$"+(v/1e6).toFixed(1)+"M"; if(v>=1e6) return "$"+(v/1e6).toFixed(2)+"M";
  if(v>=1e3) return "$"+Math.round(v/1e3)+"K"; return "$"+Math.round(v); }
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
const MEASURE = { rev_month:"Japan revenue", cn_month:"China revenue", jp_peak:"Japan peak rank", cn_peak:"China peak rank" };
const poss = n => n+(/s$/.test(n)?"'":"'s");                        // Wuthering Waves' / Genshin's
const vb = (lbl, one, many) => / & /.test(lbl) ? many : one;          // "Lucy & Rebecca post", "Pearl posts"
// still running when the month closed (ongoing = running TODAY, which only fits the latest issue)
const runsOn = (b, ym) => b.end > ym+"-31";
const andList = a => a.length<2 ? (a[0]||"") : a.slice(0,-1).join(", ")+" and "+a.at(-1);
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
  const amt = b.rev_month>0 ? `${lead?"led the month with":"took"} ${fmtG(b.rev_month)} in Japan` : "stayed below Japan's top 200";
  const pk = [b.jp_peak?`#${b.jp_peak} in Japan`:null, b.cn_peak?`#${b.cn_peak} on China's iPhone chart`:null].filter(Boolean);
  const cn = b.cn_month>0 ? ` and ${fmtUSD(b.cn_month)} in China` : "";
  return `${b.label} ${when}${amt}${cn}${pk.length?`, peaking at ${pk.join(" and ")}`:""}.`;
}
function headToHead(g){
  const [a,b]=g.banners; if(!a||!b||!a.mranks) return "";
  const ms=(g.measures||[]).filter(k=>a.mranks[k]!==b.mranks[k]);
  const won=ms.filter(k=>a.mranks[k]<b.mranks[k]).map(k=>MEASURE[k]), lost=ms.filter(k=>a.mranks[k]>b.mranks[k]).map(k=>MEASURE[k]);
  if(!won.length) return "";
  if(!lost.length) return `It finished ahead of ${b.label} on every measure.`;
  return `It beat ${b.label} on ${andList(won)}; only ${andList(lost)} went ${b.label}'s way.`;
}
// The month's leader vs the runner-up, counting how many days each actually had in the month:
// a banner that opened on the 28th and still won has to be read against a full-month rival.
const sum = a => a.reduce((x,y)=>x+(y||0),0);
function daysEdge(g){
  const [a,b]=g.banners; if(!a||!b||!a.days||!b.days||!(a.rev_month>0)||!(b.rev_month>0)) return "";
  const perDay=x=>fmtG(x.rev_month/x.days);
  if(a.days <= b.days*0.6){
    const N=a.days, out=[];
    if(a.day0===0 && !b.ongoing && b.rev_total>0 && a.rev_month>=b.rev_total*0.6){
      const r=a.rev_month/b.rev_total;
      out.push(`${a.label} needed only ${plural(N,"day")} to make ${r>=1?"more than":Math.round(r*100)+"% of"} what ${b.label} made in its entire ${b.run_days}-day run.`);
    } else out.push(`${a.label} did it in ${plural(N,"day")}, against ${poss(b.label)} ${b.days}: ${perDay(a)} a day to ${perDay(b)}.`);
    if(a.day0===0 && b.jp_daily && b.jp_daily.length>=N){
      const w=sum(b.jp_daily.slice(0,N)), wc=b.cn_daily&&b.cn_daily.length>=N?sum(b.cn_daily.slice(0,N)):0;
      if(w>0) out.push(`Over its own first ${plural(N,"day")}, ${b.label} had only ${fmtG(w)}${wc>0?` and ${fmtUSD(wc)}`:""}, against ${fmtG(a.rev_month)}${a.cn_month>0?` and ${fmtUSD(a.cn_month)}`:""}.`);
    }
    return out.join(" ");
  }
  if(b.days <= a.days*0.6 && b.rev_month/b.days > a.rev_month/a.days)
    return `Per day, though, ${b.label} was faster: ${perDay(b)} a day over ${plural(b.days,"day")}, against ${poss(a.label)} ${perDay(a)} over ${a.days}.`;
  return "";
}
function runSentence(b, G){
  const v=verdict(b); if(!v) return "";
  const where=[b.alltime&&`${ord(b.alltime[0])} of ${b.alltime[1]} in Japan`, b.cn_alltime&&`${ord(b.cn_alltime[0])} of ${b.cn_alltime[1]} in China`].filter(Boolean);
  const judge = v.final ? `: ${TIER[v.tier]}` : ", with the run still going";
  return `${b.label}'s run ${b.ongoing?"so far ":""}ranks ${andList(where)} among ${G} banners${judge}.`;
}
function autoBody(g, ym){
  const out=[], p=pct(g.jp,g.jp_prev), hp=histPhrase(g,ym);
  if(g.jp){
    let s=`${g.name} took ${fmtG(g.jp)} in Japan in ${MONTHS[+ym.slice(5)-1]}`;
    if(p!=null) s+=`, ${p>=0?"up":"down"} ${Math.abs(p).toFixed(0)}% on ${MONTHS[+prevYm(ym).slice(5)-1]}`;
    if(hp) s+=` — ${hp}`;
    if(g.jp_rank && g.jp_rank[1]>1) s+=`. That made it ${g.jp_rank[0]===1?"the top earner":"No. "+g.jp_rank[0]} of the ${g.jp_rank[1]} games tracked`;
    s+=".";
    if(g.cn){ const pc=pct(g.cn,g.cn_prev);
      s+=` On China's iPhone store it made ${fmtUSD(g.cn)}${pc!=null?` (${pctStr(pc)})`:""}${g.cn_rank&&g.cn_rank[1]>1?`, No. ${g.cn_rank[0]} of ${g.cn_rank[1]}`:""}.`; }
    out.push(s);
  }
  const bs=g.banners.filter(b=>b.rev_month>0||b.cn_month>0);
  if(!bs.length){ if(g.banners.length) out.push(`No banner reached Japan's top 200 this month.`); return out; }
  out.push([bannerSentence(bs[0],true), headToHead(g), daysEdge(g)].filter(Boolean).join(" "));
  if(bs.length>1) out.push(bs.slice(1,3).map(b=>bannerSentence(b,false)).join(" "));
  const runs=g.banners.filter(b=>b.new).map(b=>runSentence(b,SHORT[g.tag])).filter(Boolean);
  if(runs.length) out.push(runs.join(" "));
  return out;
}
function autoCoverLines(f){
  const lines=[], feat=f.games.filter(g=>FEATURED.includes(g.tag));
  const d=f.debuts[0]; if(d) lines.push(`${d.label} is the month's best opening (${SHORT[d.tag]})`);
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
  o&&o.face?` data-fx="${o.face[0]}" data-fy="${o.face[1]}"${o.tx!=null?` data-tx="${o.tx}"`:""}${o.ty!=null?` data-ty="${o.ty}"`:""}${o.txm!=null?` data-txm="${o.txm}"`:""}`:""}>` : "";
// Place an object-fit:cover crop so the face sits at (tx,ty) of the frame, clamped so the art
// still covers it. Works for wide banners and for tall character sheets (CZN) alike.
function fitFace(im){
  const fx=parseFloat(im.dataset.fx), fy=parseFloat(im.dataset.fy);
  const iw=im.naturalWidth, ih=im.naturalHeight, cw=im.clientWidth, ch=im.clientHeight;
  if(isNaN(fx)||!iw||!cw||!ch) return;
  const s=Math.max(cw/iw, ch/ih), dw=iw*s, dh=ih*s;
  const tx=parseFloat((innerWidth<760&&im.dataset.txm)||im.dataset.tx||"0.5")*cw, ty=parseFloat(im.dataset.ty||"0.38")*ch;
  const ox=Math.min(0, Math.max(cw-dw, tx-fx/100*dw)), oy=Math.min(0, Math.max(ch-dh, ty-fy/100*dh));
  im.style.objectPosition=`${ox.toFixed(1)}px ${oy.toFixed(1)}px`;
}
const fitAll = () => document.querySelectorAll("img[data-fx]").forEach(i=>{ if(i.complete) fitFace(i); });
document.addEventListener("load", e=>{ if(e.target.tagName==="IMG" && e.target.dataset.fx) fitFace(e.target); }, true);
let _fitT; addEventListener("resize", ()=>{ clearTimeout(_fitT); _fitT=setTimeout(fitAll, 120); });
// a dead CDN link hides itself (delegated: the page's CSP allows no inline handlers)
document.addEventListener("error", e=>{ if(e.target.tagName==="IMG") e.target.classList.add("broken"); }, true);
function rankChart(f, key, fmt, title, sub){
  const rows=f.games.filter(g=>g[key]>0).sort((a,b)=>b[key]-a[key]); if(!rows.length) return "";
  const max=rows[0][key];
  return `<div class="chartcol"><h4>${title}</h4><p class="sub">${sub}</p><ol class="rchart">${rows.map((g,i)=>{
    const p=pct(g[key], g[key+"_prev"]);
    return `<li style="--acc:${GAME_ACCENT[g.tag]}"><span class="pos">${i+1}</span>
      <img class="gic" src="${g.icon}" alt=""><a class="nm" href="#${f.ym}/${g.tag}">${esc(SHORT[g.tag])}</a>
      <span class="bar"><i style="width:${(g[key]/max*100).toFixed(1)}%"></i></span>
      <span class="val">${fmt(g[key])}</span><span class="chg ${p==null?"":p>=0?"up":"dn"}">${pctStr(p)}</span></li>`; }).join("")}</ol></div>`;
}
const DEBUT_CARDS = 10;
function debutsHTML(f){
  if(!f.debuts.length) return "";
  return `<section class="debuts"><div class="sec-k">New this month</div><h3 class="sec-h">The month's openings</h3>
    <p class="sec-sub"><button class="howbtn" type="button" data-how="run">How the order is decided</button></p>
    <div class="dgrid">${f.debuts.slice(0,DEBUT_CARDS).map((d,i)=>`<a class="dcard" href="#${f.ym}/${d.tag}" style="--acc:${d.color||GAME_ACCENT[d.tag]}">
      <div class="dart">${img(d.img,"","",{face:d.face})}<span class="dno">${i+1}</span></div>
      <div class="dtx"><span class="dg">${esc(SHORT[d.tag])}${d.rerun?" · rerun":""}</span><b>${esc(d.label)}</b>
      <span class="dm">${fmtG(d.rev_total)} · peak ${rk(d.jp_peak_run)} JP${d.cn_peak_run?` · ${rk(d.cn_peak_run)} CN`:""}</span></div></a>`).join("")}</div>
    ${f.debuts.length>DEBUT_CARDS?`<p class="dmore"><b>Also opened:</b> ${f.debuts.slice(DEBUT_CARDS).map((d,i)=>`<a href="#${f.ym}/${d.tag}">${DEBUT_CARDS+i+1}. ${esc(d.label)}</a> <span class="mu">(${esc(SHORT[d.tag])}${d.rerun?", rerun":""}, ${fmtG(d.rev_total)})</span>`).join(" · ")}</p>`:""}</section>`;
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
    <div class="bc-pos">${i+1}</div>
    <div class="bc-art">${b.img?img(b.img,"",b.label,{face:b.face,ty:0.42}):""}</div>
    <div class="bc-body">
      <div class="bc-hd"><span class="bav">${b.icons&&b.icons[0]?img(b.icons[0]):img(b.img,"","",{face:b.face,ty:0.5})}</span>
        <div class="bc-nm"><b>${ctx.game?`<a href="#${G_YM}/${b.tag}">${esc(b.label)}</a>`:esc(b.label)}</b><small>${dayStr(b.start)} – ${dayStr(b.end)}${daysTxt}</small></div><div class="chips">${chips}</div></div>
      <div class="bc-m">
        ${cell("rev_month","Japan",b.rev_month>0?fmtG(b.rev_month):'<span class="mu">below #200</span>',bar(b.rev_month,ctx.maxJ))}
        ${ctx.hasCN?cell("cn_month","China iPhone",b.cn_month>0?fmtUSD(b.cn_month):'<span class="mu">—</span>',bar(b.cn_month,ctx.maxC)):""}
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
const SHOW_TOP = false;                    // hidden for now (user, 2026-11-03); the data is still built
function topHTML(f){
  const t=f.top||[]; if(!t.length) return "";
  const nNew=t.filter(b=>b.new&&!b.rerun).length, bestNew=t.findIndex(b=>b.new&&!b.rerun);
  const debut=f.debuts.find(d=>!d.rerun);
  const verdictLine = bestNew===0 ? `A newcomer took the top spot: ${t[0].label}.`
    : bestNew>0 ? `The best newcomer, ${t[bestNew].label}, placed ${ord(bestNew+1)}; ${t[0].label} ${t[0].new?"":"(not new) "}topped the month.`
    : debut ? `No new banner made the top ${t.length}${debut?`; the best opening, ${debut.label}, missed the cut`:""}.` : "";
  return `<section class="topm"><div class="sec-k">Top of the month</div><h3 class="sec-h">Every banner on sale, ranked</h3>
    <p class="sec-sub">All banners running in ${MONTHS[+f.ym.slice(5)-1]}, from every game, by the median of their places on Japan and China revenue and peak rank within the month. ${plural(nNew,"new banner")} in the top ${t.length}. ${esc(verdictLine)}</p>
    <ol class="blist">${t.map((b,i)=>bannerCard(b,i,cardCtx(t,{game:true,compact:true}))).join("")}</ol></section>`;
}
// What's next: for the latest issue, the announced next banner (upcoming.json); for older
// issues, the banners that actually came next.
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
      <div class="next-art">${img(b.img,"",b.label,{face:b.face,ty:0.42})}</div>
      <div><b>${esc(b.label)}</b><small>${b.rerun?"Rerun · ":""}from ${dayStr(b.start)}${b.start.slice(0,4)!==f.ym.slice(0,4)?" "+b.start.slice(0,4):""}</small></div></div>`).join("")}</div></aside>`;
}
function statStrip(g, ym){
  const p=pct(g.jp,g.jp_prev), pc=pct(g.cn,g.cn_prev), hp=histPhrase(g,ym);
  const cells=[];
  if(g.jp) cells.push(`<div><span>Japan${g.jp_src==="banners"?" (banners)":""}</span><b>${fmtG(g.jp)}</b><em class="${p==null?"":p>=0?"up":"dn"}">${p==null?"&nbsp;":pctStr(p)+" m/m"}</em></div>`);
  if(g.jp_rank) cells.push(`<div><span>Japan rank</span><b>${ord(g.jp_rank[0])}</b><em>of ${g.jp_rank[1]} games</em></div>`);
  if(g.cn) cells.push(`<div><span>China iPhone${g.cn_partial?" (partial)":""}</span><b>${fmtUSD(g.cn)}</b><em class="${pc==null?"":pc>=0?"up":"dn"}">${pc==null?"&nbsp;":pctStr(pc)+" m/m"}</em></div>`);
  if(g.cn_rank) cells.push(`<div><span>China rank</span><b>${ord(g.cn_rank[0])}</b><em>of ${g.cn_rank[1]} games</em></div>`);
  if(g.hist) cells.push(`<div><span>In its history</span><b>${ord(g.hist.rank)}</b><em>of ${g.hist.of} months${hp?" · "+hp.replace(/^its /,""):""}</em></div>`);
  return `<div class="stats">${cells.join("")}</div>`;
}
function featureHTML(g, f, notes, n){
  const w=(notes&&notes.games&&notes.games[g.tag])||{};
  // the hero art: the banner the notes name ("hero"), else the month's top earner with art
  const top=(w.hero&&g.banners.find(b=>b.label===w.hero&&b.img))||g.banners.find(b=>b.img)||g.banners[0];
  const acc=(top&&top.color)||GAME_ACCENT[g.tag];
  // notes are hand-written HTML (trusted); the fallback copy is built from data, so it's escaped
  const body=(w.body&&w.body.length?w.body:autoBody(g,f.ym).map(esc)).map(t=>`<p>${t}</p>`).join("");
  const kicker=[g.jp_rank?`No. ${g.jp_rank[0]} in Japan`:null, g.cn_rank?`No. ${g.cn_rank[0]} in China`:null].filter(Boolean).join(" · ");
  const brief=!FEATURED.includes(g.tag);
  return `${brief&&n===f.games.findIndex(x=>!FEATURED.includes(x.tag))?`<div class="sec-k brief-k">In brief · the other games</div>`:""}
  <article class="feat${brief?" brief":""}" id="g-${g.tag}" style="--acc:${acc};--gacc:${GAME_ACCENT[g.tag]}">
    <header class="feat-hd"><img class="feat-ic" src="${g.icon}" alt=""><div><div class="feat-k">${esc(g.name)}${kicker?` <span>· ${kicker}</span>`:""}</div>
      <h3>${esc(w.headline||autoHeadline(g))}</h3>${w.dek?`<p class="dek">${w.dek}</p>`:autoDek(g,f.ym)?`<p class="dek">${esc(autoDek(g,f.ym))}</p>`:""}</div></header>
    ${top&&top.img?`<figure class="feat-art">${img(top.img,"",top.label,{face:top.face,ty:0.4})}<figcaption>${esc(top.label)}${top.rerun?" (rerun)":""} · ${dayStr(top.start)} – ${dayStr(top.end)}</figcaption></figure>`:""}
    ${statStrip(g, f.ym)}
    <div class="copy">${body}${w.pull?`<blockquote>${esc(w.pull)}</blockquote>`:""}</div>
    ${nextHTML(g, f)}
    ${bannerList(g)}
  </article>`;
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
  const toc=f.games.map(g=>`<a href="#${f.ym}/${g.tag}" style="--acc:${GAME_ACCENT[g.tag]}"><img src="${g.icon}" alt=""><span>${esc(SHORT[g.tag])}</span></a>`).join("");
  const letter=(nt.letter||[]).map(t=>`<p>${t}</p>`).join("");
  $("#issue").innerHTML=`
    <section class="cover" style="--acc:${c.color||"#888"}">
      <div class="cover-art">${img(c.img,"",c.label,{face:c.face,tx:0.7,txm:0.5,ty:0.3})}</div>
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
    <section class="charts"><div class="sec-k">The charts</div><h3 class="sec-h">Who earned the most</h3>
      <div class="chartcols">${rankChart(f,"jp",fmtG,"Japan","game-i · App Store + Google Play, yen")}${rankChart(f,"cn",fmtUSD,"China iPhone","Qimai · App Store, US$")}</div></section>
    ${debutsHTML(f)}
    ${SHOW_TOP?topHTML(f):""}
    <div class="feats">${f.games.map((g,i)=>featureHTML(g,f,nt,i)).join("")}</div>
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
      <div class="aart">${img(x.cover&&x.cover.img,"","",{face:x.cover&&x.cover.face,ty:0.32})}</div><div class="atx"><span>No. ${x.number} · ${MONTHS[+x.ym.slice(5)-1]}</span>
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
// "How the order is decided": one dialog, two flavours — a game's banners (inside the month)
// and the month's openings (whole run). Delegated, since the page's CSP allows no inline handlers.
const HOW = {
  month: ["the month", "Revenue and peak ranks count only the days the banner ran inside this month."],
  run:   ["the whole run", "Openings are compared on each banner's whole run so far, since one that opens on the 28th has only a few days in the month."],
};
function showHow(kind){
  const [scope, note]=HOW[kind]||HOW.month, d=$("#howDlg");
  d.querySelector(".how-body").innerHTML=`
    <p>Each banner is ranked on four measures over ${scope}, and its place is the <b>median</b> of those four ranks:</p>
    <p class="how-f">place = median of the ranks on<br>Japan revenue · China revenue · Japan peak · China peak</p>
    <ul>
      <li><b>Japan revenue</b>: game-i's estimate, App Store + Google Play Japan.</li>
      <li><b>China revenue</b>: Qimai's estimate, China's iPhone App Store.</li>
      <li><b>Peaks</b>: the best daily top-grossing rank reached (a lower number is better).</li>
      <li>Rank 1 is the best on each measure. With four ranks, the median is the average of the middle two.</li>
      <li>A measure no banner has (China for a game not released there) is left out. A banner missing a value goes last on that measure.</li>
      <li>Ties go to the better average rank, then to Japan revenue.</li>
    </ul>
    <p>${note}</p>
    <p class="how-ex"><b>Example, Star Rail, September 2026.</b> Aventurine • Waveflair won Japan revenue, but Pearl won China revenue and both peaks:
      Pearl's ranks 2, 1, 1, 1 have a median of <b>1</b>; Aventurine's 1, 2, 2, 2 have a median of <b>2</b>. Pearl places first.</p>`;
  d.showModal();
}
document.addEventListener("click", e=>{
  const b=e.target.closest(".howbtn"); if(b){ showHow(b.dataset.how); return; }
  if(e.target.id==="howDlg" || e.target.closest(".how-x")) $("#howDlg").close();   // backdrop or ✕
});

async function init(){
  applyTheme(_theme);
  $("#themeBtn").onclick=()=>applyTheme(THEMES[(THEMES.indexOf(_theme)+1)%3]);
  $("#archBtn").onclick=()=>{ location.hash="archive"; };
  try{ J.index=await getJSON("data/journal/index.json"); }
  catch(e){ $("#issue").innerHTML=`<p class="loading">Couldn't load the journal index.</p>`; return; }
  try{ J.upcoming=await getJSON("data/journal/upcoming.json"); }catch(e){ J.upcoming={}; }
  try{ J.themes=await getJSON("data/journal/themes.json"); }catch(e){ J.themes={}; }
  addEventListener("hashchange", route);
  route();
}
init();
