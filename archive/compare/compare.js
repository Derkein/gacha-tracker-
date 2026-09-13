// ---- Compare: the seven games against each other, and against the CN market ------
//
// Every other view answers "how did THIS game do". Three questions need all seven at
// once, and none of them can be asked from a single game's file:
//
//   * Who was actually #1? The answer changes with the source, and not by a little:
//     Umamusume leads the most months on game-i and almost none on Sensor Tower,
//     because game-i measures Japan and the other two measure the world. A ranking is
//     the one thing that IS comparable across sources with different units.
//   * How big was a launch, measured against the others' launches rather than against
//     the calendar? Aligning every game to its own month 1 is the only way to put a
//     2020 debut next to a 2026 one.
//   * How big are these seven inside their own genre? The CN archive charts every game
//     the ranking ever listed, so the tracked seven can be sized against the rest.
//
// Cross-game monthly figures come from data/compare.json (built by build_compare.py);
// the Sensor Tower and CN layers are read from the files the page already loads.
const CMP_SRC = {
  gamei:{lab:"game-i",       unit:"Japan mobile · yen",            fmt:G},
  st:   {lab:"Sensor Tower", unit:"worldwide mobile · US$",        fmt:fmtUSD},
  cn:   {lab:"CN ranking",   unit:"worldwide all platforms · yuan", fmt:fmtCNY},
};
const cmpSrc = () => CMP_SRC[state.dataSource] || CMP_SRC.gamei;
const nextYm = ym => { let y=+ym.slice(0,4), m=+ym.slice(5)+1; if(m>12){m=1;y++;}
  return y+"-"+String(m).padStart(2,"0"); };
const ymLab = ym => `${MONTHS[+ym.slice(5,7)-1]} ${ym.slice(0,4)}`;
function cmpGames(){ return (state.compare&&state.compare.games)||[]; }
// {ym -> value} for one game on one source, zero/missing months dropped. game-i comes
// from the prebuilt cross-game series (each game's own file only carries game-i's last
// ~3 years of monthlies, far too short to compare launches).
function cmpMonths(tag, src){
  src = src || state.dataSource;
  const out = {};
  if(src==="st"){ const m=extGameMonths(tag); for(const k in m) if(m[k].rev>0) out[k]=m[k].rev; return out; }
  if(src==="cn"){ const m=cnGameMonths(tag); for(const k in m){ const v=cnMid(m[k]); if(v>0) out[k]=v; } return out; }
  const s=(state.compare&&state.compare.gamei[tag])||{};
  for(const k in s) if(s[k]>0) out[k]=s[k];
  return out;
}
// The calendar month in progress: game-i's newest month is only counted up to today, so
// it is a fraction of a real month. It stays visible (it's the freshest data there is)
// but is labelled, and left out of anything cumulative.
function cmpPartial(){
  const g=(state.compare&&state.compare.gamei)||{};
  let mx=null; for(const t in g) for(const ym in g[t]) if(mx==null||ym>mx) mx=ym;
  return mx;
}
// Months each game finished #1 on a given source, plus the per-month winners.
function cmpLeaders(src){
  const per={}; cmpGames().forEach(g=>per[g.tag]=cmpMonths(g.tag,src));
  const months=[...new Set([].concat(...Object.values(per).map(Object.keys)))].sort();
  const wins={}, rows=[];
  for(const ym of months){
    let best=null;
    for(const t in per) if(per[t][ym]!=null && (best==null || per[t][ym]>per[best][ym])) best=t;
    if(best){ wins[best]=(wins[best]||0)+1; rows.push({ym, tag:best, v:per[best][ym]}); }
  }
  return {wins, rows, months:rows.length};
}
// One row per month: every game that earned that month, largest first, as shares of the
// month's seven-game total.
function cmpStackRows(){
  const gs=cmpGames(), per={}; gs.forEach(g=>per[g.tag]=cmpMonths(g.tag));
  const months=[...new Set([].concat(...Object.values(per).map(Object.keys)))].sort().reverse();
  return months.map(ym=>{
    const parts=gs.map(g=>({tag:g.tag, name:g.name, v:per[g.tag][ym]||0}))
                  .filter(p=>p.v>0).sort((a,b)=>b.v-a.v);
    return {ym, parts, tot:parts.reduce((a,p)=>a+p.v,0)};
  }).filter(r=>r.tot>0);
}
// Cumulative revenue by month-since-launch, so a 2020 debut can sit beside a 2026 one.
// A game whose launch month predates the source's coverage is reported separately rather
// than drawn from wherever the source happens to start -- its curve would begin partway
// up and read as a slow launch.
function cmpLaunchRace(){
  const partial=cmpPartial(), lines=[], late=[];
  for(const g of cmpGames()){
    const mm=cmpMonths(g.tag), ks=Object.keys(mm).sort();
    if(!ks.length) continue;
    const launch=g.first_month||ks[0];
    if(ks[0]>launch){ late.push({...g, from:ks[0]}); continue; }
    const pts=[]; let cum=0, ym=launch;
    for(let i=0; ym<=ks[ks.length-1]; i++, ym=nextYm(ym)){
      if(ym===partial) break;                       // a half-counted month bends the curve
      cum += mm[ym]||0;
      pts.push({m:i+1, ym, cum, v:mm[ym]||0});
    }
    if(pts.length) lines.push({tag:g.tag, name:g.name, launch, pts});
  }
  lines.sort((a,b)=>b.pts[b.pts.length-1].cum-a.pts[a.pts.length-1].cum);
  return {lines, late};
}
// Where each tracked game sits in the CN chart, and how much of the chart's top 15 it is.
function cmpMarket(){
  const M=state.compare&&state.compare.market; if(!M) return null;
  const byTag={}, months=Object.keys(M.months).sort();
  M.board.forEach(b=>{ if(b.tag) byTag[b.tag]=b; });
  const rows=cmpGames().map(g=>{
    const rk=M.rank[g.tag]; if(!rk) return null;
    const ks=Object.keys(rk).sort(), b=byTag[g.tag]||{months:{}};
    const share=ym=>{ const v=b.months[ym], t=M.months[ym]&&M.months[ym].top15;
      return (v&&t)?100*v/t:null; };
    const hist=ks.map(ym=>({ym, rank:rk[ym], share:share(ym), n:M.months[ym].n}));
    const best=hist.reduce((a,c)=>c.rank<a.rank?c:a);
    const peak=hist.reduce((a,c)=>(c.share||0)>(a.share||0)?c:a);
    return {tag:g.tag, name:g.name, hist, now:hist[hist.length-1], best, peak};
  }).filter(Boolean).sort((a,b)=>a.now.rank-b.now.rank);
  return {M, months, last:months[months.length-1], rows};
}
// Tiny share-over-time sparkline for a market row (share of the chart's top 15).
function cmpSpark(hist, months){
  const pts=months.map(ym=>{ const h=hist.find(x=>x.ym===ym); return h?h.share:null; });
  const mx=Math.max(...pts.filter(v=>v!=null), 1), W=90, H=22;
  let d="", pen=false;
  pts.forEach((v,i)=>{ if(v==null){ pen=false; return; }
    const x=(i/Math.max(pts.length-1,1))*W, y=H-1-(v/mx)*(H-2);
    d+=`${pen?"L":"M"}${x.toFixed(1)} ${y.toFixed(1)}`; pen=true; });
  return `<svg class="cmp-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path d="${d}"/></svg>`;
}

// Gridline values on a 1/2/2.5/5 step, so the axis reads ¥50B / ¥100B rather than
// even fractions of whatever the tallest curve happens to reach.
// Gridline labels only. The value formatters keep fixed decimals on purpose -- that is
// what stops two nearby months printing identically -- but a gridline is a round number,
// so "CN¥20.000B" is just noise. Trailing zeros are trimmed here and nowhere else.
const cmpAxis = v => cmpSrc().fmt(v).replace(/(\.\d*?)0+(?=[A-Z]?$)/,"$1").replace(/\.(?=[A-Z]?$)/,"");
function cmpTicks(max){
  const raw=max/4, mag=Math.pow(10,Math.floor(Math.log10(raw)));
  const step=[1,2,2.5,5,10].map(m=>m*mag).find(v=>v>=raw)||mag*10;
  const n=Math.ceil(max/step - 1e-9);            // the top tick must clear the peak,
  return Array.from({length:n+1},(_,i)=>i*step); // or the tallest curve leaves the box
}

// data/compare.json is ~50KB and only this view reads it, so it is fetched on the first
// visit here instead of on every page load. The fetch re-renders itself when it lands.
let _cmpLoad=null;
function loadCompare(){
  if(state.compare || _cmpLoad) return _cmpLoad;
  return (_cmpLoad = getJSON("data/compare.json")
    .then(d=>{ state.compare=d; state.compareErr=null; })
    .catch(e=>{ state.compareErr=e; })
    .then(()=>{ if(state.mode==="compare" && !state.table) render(); }));
}

function renderCompare(){
  if(state.compareErr){
    showError(state.compareErr, ()=>{ state.compareErr=null; _cmpLoad=null; render(); });
    return;
  }
  if(!state.compare){ $("#chart").innerHTML=`<div class="loading">Loading the cross-game data…</div>`; return; }
  const S=cmpSrc(), fmt=S.fmt, partial=cmpPartial();
  const gs=cmpGames(), NAMEOF={}; gs.forEach(g=>NAMEOF[g.tag]=g.name);
  const dot=t=>`<span class="cmp-dot" style="background:${GAME_ACCENT[t]||"#888"}"></span>`;
  const gname=t=>`<span class="cmp-gname${t===state.tag?" me":""}" data-tag="${t}">${dot(t)}${esc(NAMEOF[t]||t)}</span>`;

  // ---- who led each month, on each source -------------------------------------
  const lead=["gamei","st","cn"].map(k=>({k, ...CMP_SRC[k], L:cmpLeaders(k)})).filter(x=>x.L.months);
  // How often the three actually name the same winner, over the months all three cover.
  // The point of the podium is that they disagree; this says by how much, in one number.
  const byMo={}; lead.forEach(x=>x.L.rows.forEach(r=>{ (byMo[r.ym]=byMo[r.ym]||{})[x.k]=r.tag; }));
  const shared=Object.keys(byMo).filter(ym=>Object.keys(byMo[ym]).length===lead.length);
  const same=shared.filter(ym=>new Set(Object.values(byMo[ym])).size===1).length;
  const verdict=lead.length>1 && shared.length
    ? `<div class="cmp-verdict">Over the <b>${shared.length}</b> months all ${lead.length} sources cover, they name the same #1 game in <b>${same}</b> of them — <b>${Math.round(100*(shared.length-same)/shared.length)}%</b> of months have a different winner depending on which source you ask.</div>`
    : "";
  const podium=`<div class="cmp-pods">`+lead.map(x=>{
    const order=Object.entries(x.L.wins).sort((a,b)=>b[1]-a[1]);
    const top=order[0];
    return `<div class="cmp-pod${x.k===state.dataSource?" on":""}">
      <div class="cmp-podhd">${esc(x.lab)}<span class="cmp-podu">${esc(x.unit)}</span></div>
      <div class="cmp-podwin">${gname(top[0])}<b>${top[1]}</b><span class="cmp-podn">of ${x.L.months} months at&nbsp;#1</span></div>
      <div class="cmp-podrest">${order.slice(1).map(([t,n])=>
        `<span class="cmp-podr" title="${esc(NAMEOF[t]||t)} led ${n} month${n!==1?"s":""} on ${esc(x.lab)}">${dot(t)}${n}</span>`).join("")}</div>
    </div>`;}).join("")+`</div>`;

  // ---- month-by-month, all seven stacked --------------------------------------
  let rows=cmpStackRows();
  if(state.reverse) rows=[...rows].reverse();
  const stack=rows.map(r=>{
    const segs=r.parts.map(p=>{
      const pc=100*p.v/r.tot;
      return `<span class="cmp-seg${p.tag===state.tag?" me":""}" style="width:${pc.toFixed(2)}%;background:${GAME_ACCENT[p.tag]||"#888"}" data-tag="${p.tag}" title="${esc(NAMEOF[p.tag])} · ${ymLab(r.ym)} — ${fmt(p.v)}, ${pc.toFixed(1)}% of the seven-game total"></span>`;
    }).join("");
    const win=r.parts[0];
    return `<div class="cmp-row">
      <div class="cmp-mo">${ymLab(r.ym)}${r.ym===partial?`<span class="cmp-part" title="This calendar month is still running — counted only up to today">partial</span>`:""}</div>
      <div class="cmp-bar">${segs}</div>
      <div class="cmp-tot"><b>${fmt(r.tot)}</b><span class="cmp-win" title="Biggest of the seven this month">${dot(win.tag)}${(100*win.v/r.tot).toFixed(0)}%</span></div>
    </div>`;}).join("");

  // ---- launch race -------------------------------------------------------------
  const race=cmpLaunchRace();
  const maxM=Math.max(1,...race.lines.map(l=>l.pts.length));
  const peakV=Math.max(1,...race.lines.map(l=>l.pts[l.pts.length-1].cum));
  const maxV=(t=>t[t.length-1])(cmpTicks(peakV));
  const W=760, H=300, PL=64, PB=26, PT=8, PR=10;
  const px=m=>PL+((m-1)/Math.max(maxM-1,1))*(W-PL-PR);
  const py=v=>PT+(1-v/maxV)*(H-PT-PB);
  const xt=[1,6,12,18,24,36,48,60,72].filter(m=>m<=maxM);
  const yt=cmpTicks(maxV);
  const paths=race.lines.map(l=>{
    const d=l.pts.map((p,i)=>`${i?"L":"M"}${px(p.m).toFixed(1)} ${py(p.cum).toFixed(1)}`).join("");
    const last=l.pts[l.pts.length-1];
    return `<g class="cmp-line${l.tag===state.tag?" me":""}" style="--c:${GAME_ACCENT[l.tag]||"#888"}">
      <path d="${d}"/>
      <circle cx="${px(last.m).toFixed(1)}" cy="${py(last.cum).toFixed(1)}" r="3"/>
      <title>${esc(l.name)} — launched ${ymLab(l.launch)}; ${fmt(last.cum)} in its first ${last.m} month${last.m!==1?"s":""}</title></g>`;
  }).join("");
  const marks=[3,6,12,24].filter(m=>m<=maxM);
  const table=race.lines.map(l=>{
    const at=m=>{ const p=l.pts[m-1]; return p?fmt(p.cum):"—"; };
    return `<tr${l.tag===state.tag?' class="me"':""}><td>${gname(l.tag)}</td><td class="cmp-num">${ymLab(l.launch)}</td>
      ${marks.map(m=>`<td class="cmp-num">${at(m)}</td>`).join("")}
      <td class="cmp-num"><b>${fmt(l.pts[l.pts.length-1].cum)}</b><span class="cmp-sub">${l.pts.length} mo</span></td></tr>`;}).join("");
  const lateNote=race.late.length
    ? `<div class="cmp-note">${race.late.map(g=>esc(g.name)).join(" and ")} ${race.late.length>1?"are":"is"} left out here: ${race.late.length>1?"they":"it"} launched before ${esc(S.lab)}'s coverage begins (${race.late.map(g=>ymLab(g.from)).join(", ")}), so ${race.late.length>1?"their":"its"} opening months aren't in this source at all.</div>`
    : "";

  // ---- do reruns hold up? ------------------------------------------------------
  // Two ratios, because one of them lies. "vs its own debut" is the intuitive
  // number and it is mostly a measurement of the game's own trajectory: a 2026
  // Genshin rerun makes 16% of a 2021 debut largely because Genshin is a fraction
  // of its 2021 size, not because the rerun underperformed. "vs a new banner then"
  // divides by what a fresh banner earned in the same months, which is the question
  // people actually mean -- and it reverses the conclusion for Genshin.
  const RR=(state.compare.reruns)||null;
  let rerun="";
  if(RR){
    const withRows=RR.games.filter(r=>r.rows.length);
    const none=RR.games.filter(r=>!r.rows.length);
    const pctCell=(v,tip)=>v==null
      ? `<td class="cmp-num cmp-na" title="${esc(tip||"")}">—</td>`
      : `<td class="cmp-num"${tip?` title="${esc(tip)}"`:""}><b>${Math.round(v)}%</b></td>`;
    const blocks=withRows.map(r=>{
      // the chip reports coverage only -- a game with one rerun that matched cleanly
      // is 100% covered, and flagging it would confuse "thin coverage" with "few rows"
      const thin=r.coverage!=null && r.coverage<0.25;
      const head=`<div class="cmp-rrhd">${gname(r.tag)}
        <span class="cmp-rrsum">${r.med_peer!=null
          ? `median rerun = <b>${r.med_peer}%</b> of a new banner running at the same time <span class="cmp-rrown">— but they run ${r.peer_lo}%–${r.peer_hi}% across the ${r.peer_rows} rows that had one to compare against, so read the median loosely</span>`
          : `too few comparable reruns to summarise — the rows are shown as they are`}</span>
        <span class="cmp-rrcov${thin?" warn":""}" title="${esc(`${r.rows.length} of this game's ${r.returning} returning-character banners could be compared. ${r.mixed} also introduced someone new, and ${r.shared} replayed a character whose own debut banner was shared with others, so no figure belongs to them alone.`)}">${r.rows.length} of ${r.returning} usable</span></div>`;
      const body=r.rows.map(x=>{
        const own=x.debut?100*x.rev/x.debut:null;
        const peer=x.peer?100*x.rev/x.peer:null;
        return `<tr><td>${ymLab(x.start.slice(0,7))}</td>
          <td class="cmp-rrc">${esc(x.chars.join(" + "))}${x.chars.length>1?`<span class="cmp-sub">one banner, ${x.chars.length} characters</span>`:""}</td>
          <td class="cmp-num">${G(x.rev)}</td>
          ${pctCell(own, `${G(x.rev)} against ${G(x.debut)} — what ${x.chars.length>1?"these characters":"this character"} earned on debut (${x.debut_at.map(d=>ymLab(d.slice(0,7))).join(", ")}). Across a gap this long the game's own size has changed, so read the next column instead.`)}
          ${pctCell(peer, x.peer
            ? `${G(x.rev)} against ${G(x.peer)} — the median banner introducing only new characters within ${RR.window_days} days either side (${x.peer_n} of them).`
            : `Fewer than ${RR.min_peers} banners introducing only new characters ran within ${RR.window_days} days of this one, so there is nothing contemporary to compare it against.`)}
        </tr>`;}).join("");
      return `<div class="cmp-rrgame">${head}
        <div class="cmp-tw"><table class="cmp-t">
          <thead><tr><th>Rerun</th><th>Character(s) replayed</th><th class="cmp-num">Made</th><th class="cmp-num">vs its own debut</th><th class="cmp-num">vs a new banner then</th></tr></thead>
          <tbody>${body}</tbody></table></div></div>`;
    }).join("");
    const noneTxt=none.length
      ? `<div class="cmp-note"><b>No usable rows at all for ${none.map(r=>esc(r.name)).join(", ")}.</b> ${none.map(r=>
          `${esc(r.name)} — ${r.returning?`${r.returning} of its banners replay a character, but none survived the matching`:"no character has come back yet"}`).join("; ")}.</div>`
      : "";
    rerun=`<h3 class="cmp-h">Do reruns hold up? <span class="cmp-hs">what a character earns the second time round · game-i ¥, Japan</span></h3>
      <div class="cmp-note"><b>This one is inconsistent, and the two columns show why.</b> “vs its own debut” is the obvious comparison and it is largely a measurement of <i>the game</i>, not of the rerun: a 2026 Genshin rerun makes 16% of a 2021 debut mostly because Genshin now earns a fraction of what it did in 2021. “vs a new banner then” divides by what a <b>brand-new</b> banner made in the same months, and for Genshin it reverses the answer entirely — its reruns hold up nearly as well as its debuts <i>today</i>, while Star Rail's make about a third of one. Trust the second column; the first is here to show the trap.</div>
      <div class="cmp-note">A character counts as returning the second time they appear in the banner list — the same rule in every game. The per-banner <b>↻ rerun</b> tag you see elsewhere on the site is <b>not</b> used here: it's derived three different ways depending on the game, and is empty for the ones whose banners are named after an event. Even so the coverage is thin and uneven. game-i bundles reruns — one row can replay three characters at once — so those rows are compared against the <b>sum</b> of those characters' debuts rather than an invented split, and a row is dropped when it also introduces someone new, or when a returning character's own debut banner was shared and no figure belongs to them alone. The “usable” chip on each game says how much survived. <b>These are per-game readings, not a league table:</b> the games differ in how often they rerun, how many characters they bundle per banner, and how much of their history we can match at all.</div>
      ${blocks}${noneTxt}`;
  }

  // ---- CN market position ------------------------------------------------------
  const mk=cmpMarket();
  let market="";
  if(mk){
    const lastN=mk.M.months[mk.last].n;
    const pos=mk.rows.map(r=>`<tr${r.tag===state.tag?' class="me"':""}>
      <td>${gname(r.tag)}</td>
      <td class="cmp-num"><b>#${r.now.rank}</b><span class="cmp-sub">of ${r.now.n}</span></td>
      <td class="cmp-num">#${r.best.rank}<span class="cmp-sub">${ymLab(r.best.ym)}</span></td>
      <td class="cmp-num">${r.now.share!=null?r.now.share.toFixed(1)+"%":"—"}</td>
      <td class="cmp-num">${r.peak.share!=null?r.peak.share.toFixed(1)+"%":"—"}<span class="cmp-sub">${ymLab(r.peak.ym)}</span></td>
      <td class="cmp-sparkc" style="--c:${GAME_ACCENT[r.tag]||"#888"}" title="Share of the CN chart's top 15, ${ymLab(mk.months[0])} → ${ymLab(mk.last)}">${cmpSpark(r.hist, mk.months)}</td></tr>`).join("");

    const board=mk.M.board.map(b=>({...b, v:b.months[mk.last]})).filter(b=>b.v>0)
      .sort((a,c)=>c.v-a.v);
    const bmax=board.length?board[0].v:1;
    const bList=board.map((b,i)=>`<div class="cmp-mrow${b.tag?" tracked":""}${b.tag===state.tag?" me":""}"${b.tag?` data-tag="${b.tag}" style="--c:${GAME_ACCENT[b.tag]||"#888"}"`:""}>
      <span class="cmp-mrank">${i+1}</span>
      <span class="cmp-mname">${b.tag?dot(b.tag)+esc(NAMEOF[b.tag]):esc(b.name)}${b.tag?`<span class="cmp-mtag">tracked here</span>`:(b.cn&&b.cn!==b.name?`<span class="cmp-mcn">${esc(b.cn)}</span>`:"")}</span>
      <span class="cmp-mbar"><span style="width:${(100*b.v/bmax).toFixed(1)}%"></span></span>
      <span class="cmp-mval">${fmtCNY(b.v)}</span></div>`).join("");
    // denominator is every game the chart listed that month, which is what
    // market.months[ym].total holds -- not the sum of the rows drawn below, which
    // would quietly inflate the share by leaving out the tail.
    const trackedShare=board.filter(b=>b.tag).reduce((a,b)=>a+b.v,0);
    const allShare=mk.M.months[mk.last].total;

    market=`<h3 class="cmp-h">Inside the CN chart <span class="cmp-hs">where the seven sit among every game the ranking lists · CN¥</span></h3>
      <div class="cmp-note">The CN source ranks the whole genre, not just the games tracked here — ${lastN} of them in ${ymLab(mk.last)}. That makes it the one place these seven can be sized against everything else. Chart depth grew from 15 rows in ${ymLab(mk.months[0])} to ${lastN} today, so <b>share is measured against the top 15</b>, which every month has; a share of "everything charted" would drift upward purely because the chart got longer. miHoYo rows are ranges, and their midpoint is used for ranking and share.</div>
      <div class="cmp-tw"><table class="cmp-t">
        <thead><tr><th>Game</th><th class="cmp-num">Rank now</th><th class="cmp-num">Best ever</th><th class="cmp-num">Share now</th><th class="cmp-num">Peak share</th><th>Share over time</th></tr></thead>
        <tbody>${pos}</tbody></table></div>
      <div class="cmp-sub2">Every game the chart listed in ${ymLab(mk.last)}, all ${board.length} of them — the seven tracked here made <b>${(100*trackedShare/allShare).toFixed(0)}%</b> of the total.</div>
      <div class="cmp-market">${bList}</div>`;
  }

  $("#chart").innerHTML=`
    <div class="yr-note"><b>Seven games, three sources that disagree about who is winning.</b> The three layers measure different territories — game-i is <b>Japan mobile</b>, Sensor Tower is <b>worldwide mobile</b>, the CN ranking is <b>worldwide across every platform</b> — so their totals are never added. But <i>which game was biggest</i> is a ranking, and rankings compare fine across units. That is what the cards below count, and they do not agree.</div>
    ${podium}
    ${verdict}
    <div class="cmp-note">The next two sections follow the <b>${esc(S.lab)}</b> toggle above (${esc(S.unit)}). The two after them don't: reruns need <b>per-banner</b> figures, which only game-i publishes, and the CN chart is by definition the CN source.</div>

    <h3 class="cmp-h">Month by month <span class="cmp-hs">each month split between the seven</span></h3>
    <div class="cmp-head"><div class="cmp-mo">Month</div><div class="cmp-bar">Share of the seven-game total</div><div class="cmp-tot">Combined</div></div>
    <div class="cmp-list">${stack||`<div class="loading">No ${esc(S.lab)} months to compare.</div>`}</div>

    <h3 class="cmp-h">The launch race <span class="cmp-hs">every game aligned to its own month 1</span></h3>
    <div class="cmp-note">Cumulative revenue from each game's launch month, so a 2020 debut and a 2026 one start from the same place. The calendar month in progress is left off every curve.</div>
    ${lateNote}
    <div class="cmp-racewrap"><svg class="cmp-race" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
      ${yt.map(v=>`<g class="cmp-grid"><line x1="${PL}" y1="${py(v).toFixed(1)}" x2="${W-PR}" y2="${py(v).toFixed(1)}"/><text x="${PL-6}" y="${(py(v)+3.5).toFixed(1)}">${cmpAxis(v)}</text></g>`).join("")}
      ${xt.map(m=>`<text class="cmp-xt" x="${px(m).toFixed(1)}" y="${H-8}">${m}</text>`).join("")}
      <text class="cmp-xl" x="${(PL+W-PR)/2}" y="${H-0.5}">months since launch</text>
      ${paths}
    </svg></div>
    <div class="cmp-tw"><table class="cmp-t">
      <thead><tr><th>Game</th><th class="cmp-num">Launched</th>${marks.map(m=>`<th class="cmp-num">by month ${m}</th>`).join("")}<th class="cmp-num">to date</th></tr></thead>
      <tbody>${table}</tbody></table></div>

    ${rerun}
    ${market}`;

  $("#chart").querySelectorAll("[data-tag]").forEach(el=>{
    const t=el.dataset.tag;
    if(!t || t===state.tag) return;
    el.classList.add("cmp-clk");
    el.onclick=e=>{ e.stopPropagation(); selectGame(t); };
  });
}
