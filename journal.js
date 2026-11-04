// Gacha Tracker Monthly — renders one issue from data/journal/YYYY-MM.json (facts, built by
// scripts/build_journal.py from the tracker's own numbers) plus the written layer:
// data/journal/notes/YYYY-MM.json (headline, letter, per-game copy) and
// data/journal/stories.json (character stories, keyed "tag:Name"). Wherever no copy has been
// written yet, the page writes plain sentences from the facts, so every month has an issue.
const GAME_ACCENT = { zzz:"#e0a400", hsr:"#8a7bd8", wuwa:"#2fb6c0", genshin:"#d8a24a", endfield:"#e07b3a",
  nte:"#d94f8a", uma:"#3fb98f", stellasora:"#5aa9e6", czn:"#d2463c", lads:"#b87ee6" };
const SHORT = { genshin:"Genshin", hsr:"Star Rail", zzz:"ZZZ", wuwa:"Wuthering Waves", nte:"NTE", endfield:"Endfield",
  uma:"Umamusume", czn:"Chaos Zero Nightmare", stellasora:"Stella Sora", lads:"Love and Deepspace" };
// the six the audience follows get full spreads; the rest run as shorter "in brief" pieces
const FEATURED = ["genshin","hsr","zzz","wuwa","endfield","nte"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const $ = s => document.querySelector(s);
const esc = s => String(s==null?"":s).replace(/[&<>"'`]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;","`":"&#96;"}[c]));
const J = { index:null, stories:{}, art:{}, cache:{} };

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
const prevYm = ym => { let y=+ym.slice(0,4), m=+ym.slice(5)-1; if(!m){m=12;y--;} return y+"-"+String(m).padStart(2,"0"); };

async function getJSON(u){ const r=await fetch(u,{cache:"no-cache"}); if(!r.ok) throw new Error(u+" "+r.status); return r.json(); }
async function loadIssue(ym){
  if(J.cache[ym]) return J.cache[ym];
  const facts = await getJSON(`data/journal/${ym}.json`);
  let notes = null; try{ notes = await getJSON(`data/journal/notes/${ym}.json`); }catch(e){}
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
function autoHeadline(g){
  const top=g.banners[0]; if(!top) return `${g.name}'s month`;
  const p=pct(g.jp,g.jp_prev);
  if(g.jp_rank && g.jp_rank[0]===1) return `${top.label} puts ${SHORT[g.tag]} on top`;
  if(top.new && !top.rerun) return p!=null&&p>15 ? `${top.label} lifts ${SHORT[g.tag]}` : `${top.label} arrives`;
  if(top.rerun) return `The ${top.label} rerun leads`;
  return p!=null&&p<-15 ? `A quieter month, led by ${top.label}` : `${top.label} carries the month`;
}
function bannerSentence(b, lead){
  const when = b.new ? `opened on ${dayStr(b.start)}${b.rerun?" (a rerun)":""} and ` : (b.rerun?"(rerun) ":"");
  const amt = b.rev_month>0 ? `${lead?"led the month with":"took"} ${fmtG(b.rev_month)} in Japan` : "stayed below Japan's top 200";
  const pk = [b.jp_peak?`#${b.jp_peak} in Japan`:null, b.cn_peak?`#${b.cn_peak} on China's iPhone chart`:null].filter(Boolean);
  const cn = b.cn_month>0 ? ` and ${fmtUSD(b.cn_month)} in China` : "";
  return `${b.label} ${when}${amt}${cn}${pk.length?`, peaking at ${pk.join(" and ")}`:""}.`;
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
  if(bs.length){
    out.push(bs.slice(0,3).map((b,i)=>bannerSentence(b,i===0)).join(" "));
    const nb=bs.find(b=>b.new && b.alltime && b.alltime[1]>=5);
    if(nb) out.push(`${nb.label}'s run ${nb.ongoing?"so far ":""}ranks No. ${nb.alltime[0]} of the ${nb.alltime[1]} ${SHORT[g.tag]} banners tracked in Japan${nb.cn_alltime?` and No. ${nb.cn_alltime[0]} of ${nb.cn_alltime[1]} in China`:""}${nb.ongoing?"; it was still running at the end of the month":""}.`);
  } else if(g.banners.length) out.push(`No banner reached Japan's top 200 this month.`);
  return out;
}
function autoCoverLines(f){
  const lines=[];
  const top=[...f.games].filter(g=>g.jp_rank).sort((a,b)=>a.jp_rank[0]-b.jp_rank[0])[0];
  if(top) lines.push(`${SHORT[top.tag]} tops Japan with ${fmtG(top.jp)}`);
  const cn=[...f.games].filter(g=>g.cn_rank).sort((a,b)=>a.cn_rank[0]-b.cn_rank[0])[0];
  if(cn && f.games.filter(g=>g.cn).length>1) lines.push(`${SHORT[cn.tag]} leads China's iPhone store`);
  f.debuts.slice(0,2).forEach(d=>lines.push(`${d.label}: ${d.rerun?"the rerun":"the debut"}, peaking at ${rk(d.jp_peak_run)} in Japan`));
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
// a story image: the local copy scripts/journal_art.py made, else the source URL
const artSrc = u => u ? ((J.art[u]&&J.art[u].file)||u) : "";
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
    <p class="sec-sub">Every banner that started in ${MONTHS[+f.ym.slice(5)-1]}, by its whole run's Japan revenue${f.debuts.some(d=>d.ongoing)?" so far":""}.</p>
    <div class="dgrid">${f.debuts.slice(0,DEBUT_CARDS).map((d,i)=>`<a class="dcard" href="#${f.ym}/${d.tag}" style="--acc:${d.color||GAME_ACCENT[d.tag]}">
      <div class="dart">${img(d.img,"","",{face:d.face})}<span class="dno">${i+1}</span></div>
      <div class="dtx"><span class="dg">${esc(SHORT[d.tag])}${d.rerun?" · rerun":""}</span><b>${esc(d.label)}</b>
      <span class="dm">${fmtG(d.rev_total)} · peak ${rk(d.jp_peak_run)} JP${d.cn_peak_run?` · ${rk(d.cn_peak_run)} CN`:""}</span></div></a>`).join("")}</div>
    ${f.debuts.length>DEBUT_CARDS?`<p class="dmore"><b>Also opened:</b> ${f.debuts.slice(DEBUT_CARDS).map((d,i)=>`<a href="#${f.ym}/${d.tag}">${DEBUT_CARDS+i+1}. ${esc(d.label)}</a> <span class="mu">(${esc(SHORT[d.tag])}${d.rerun?", rerun":""}, ${fmtG(d.rev_total)})</span>`).join(" · ")}</p>`:""}</section>`;
}
function bannerTable(g){
  if(!g.banners.length) return "";
  const hasCN=g.banners.some(b=>b.cn_month>0||b.cn_peak);
  return `<table class="btab"><thead><tr><th class="l">Banner</th><th>Japan</th>${hasCN?"<th>China iPhone</th>":""}
    <th title="Best daily top-grossing rank this month">Peak JP</th>${hasCN?'<th title="Best daily top-grossing rank this month">Peak CN</th>':""}
    <th title="Whole-run Japan revenue, ranked against every banner of the game">All-time</th></tr></thead><tbody>${g.banners.map(b=>`
    <tr style="--acc:${b.color}"><td class="l"><div class="bcell"><span class="bav">${b.icons[0]?img(b.icons[0]):img(b.img,"","",{face:b.face,ty:0.5})}</span>
      <span class="bnm"><b>${esc(b.label)}</b><small>${b.new?(b.rerun?"rerun · ":"new · "):""}${dayStr(b.start)} – ${dayStr(b.end)}</small></span></div></td>
      <td>${b.rev_month>0?fmtG(b.rev_month):'<span class="mu">below #200</span>'}</td>
      ${hasCN?`<td>${b.cn_month>0?fmtUSD(b.cn_month):'<span class="mu">—</span>'}</td>`:""}
      <td>${rk(b.jp_peak)}</td>${hasCN?`<td>${rk(b.cn_peak)}</td>`:""}
      <td>${b.alltime?`${b.alltime[0]}<span class="mu"> / ${b.alltime[1]}</span>`:"—"}</td></tr>`).join("")}</tbody></table>`;
}
// "From the story": a full-width band per new character — a portrait (the whole render, or the
// banner art cropped to the face when no render was found), the note, and a story image below.
function storyCards(g, ym){
  const seen=new Set(), out=[];
  g.banners.forEach(b=>{ (b.agents.length?b.agents:[b.label]).forEach(n=>{
    const s=J.stories[`${g.tag}:${n}`]; if(!s || seen.has(n) || !(b.new || s.months&&s.months.includes(ym))) return; seen.add(n);
    const a=s.art||{}, txt=Array.isArray(s.text)?s.text:[s.text];
    const port = a.portrait ? `<figure class="story-port whole">${img(artSrc(a.portrait),"",n)}</figure>`
      : b.img ? `<figure class="story-port">${img(b.img,"",n,{face:b.face,ty:0.3})}</figure>` : "";
    out.push(`<section class="story${port?"":" noport"}" style="--acc:${b.color}">
      ${port}
      <div class="story-tx"><div class="story-k">From the story</div>
        <h4>${esc(n)}</h4>${s.title?`<p class="story-t">${esc(s.title)}</p>`:""}
        ${txt.map(t=>`<p>${esc(t)}</p>`).join("")}
        ${s.src&&s.src.length?`<p class="story-src">Sources: ${s.src.map((u,i)=>`<a href="${esc(u)}" target="_blank" rel="noopener">${i+1}</a>`).join(" · ")}</p>`:""}</div>
      ${a.scene?`<figure class="story-scene">${img(artSrc(a.scene),"",a.scene_caption||n)}${a.scene_caption?`<figcaption>${esc(a.scene_caption)}</figcaption>`:""}</figure>`:""}
    </section>`); }); });
  return out.join("");
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
      <h3>${esc(w.headline||autoHeadline(g))}</h3>${w.dek?`<p class="dek">${w.dek}</p>`:""}</div></header>
    ${top&&top.img?`<figure class="feat-art">${img(top.img,"",top.label,{face:top.face,ty:0.4})}<figcaption>${esc(top.label)}${top.rerun?" (rerun)":""} · ${dayStr(top.start)} – ${dayStr(top.end)}</figcaption></figure>`:""}
    ${statStrip(g, f.ym)}
    <div class="copy">${body}${w.pull?`<blockquote>${esc(w.pull)}</blockquote>`:""}</div>
    ${storyCards(g, f.ym)}
    ${bannerTable(g)}
  </article>`;
}

function render(iss, focus){
  const {facts:f, notes}=iss, nt=notes||{};
  document.title=`${monthName(f.ym)} · Gacha Tracker Monthly`;
  $("#mastLine").innerHTML=`<span>No. ${f.number}</span><span>${monthName(f.ym)}</span><span>${plural(f.games.length,"game")} · ${plural(f.games.reduce((a,g)=>a+g.banners.length,0),"banner")}</span>`;
  const idx=J.index.issues, at=idx.findIndex(x=>x.ym===f.ym);
  const newer=idx[at-1], older=idx[at+1];
  const c=f.cover||{};
  const lines=nt.coverlines||autoCoverLines(f);
  const head=nt.headline||(c.label?`${c.label} takes the cover`:monthName(f.ym));
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
async function init(){
  applyTheme(_theme);
  $("#themeBtn").onclick=()=>applyTheme(THEMES[(THEMES.indexOf(_theme)+1)%3]);
  $("#archBtn").onclick=()=>{ location.hash="archive"; };
  try{ J.index=await getJSON("data/journal/index.json"); }
  catch(e){ $("#issue").innerHTML=`<p class="loading">Couldn't load the journal index.</p>`; return; }
  try{ J.stories=await getJSON("data/journal/stories.json"); }catch(e){ J.stories={}; }
  try{ J.art=await getJSON("data/journal/art.json"); }catch(e){ J.art={}; }
  addEventListener("hashchange", route);
  route();
}
init();
