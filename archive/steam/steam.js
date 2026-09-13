// ---- Steam concurrent players ---------------------------------------------------
// A tile beside "JP store rank today", and the only measured number on the page. It
// appears for the games that are on Steam and is simply absent for the rest -- the ⓘ
// dialog carries the reason (HoYoverse never ships to Steam). data/steam_players.json
// holds one reading per UTC day, taken at the same wall-clock time each day.
function steamSpark(days, vals){
  if(vals.length<2) return "";
  const W=120,H=26,mx=Math.max(...vals),mn=Math.min(...vals),rng=Math.max(mx-mn,1);
  const d=vals.map((v,i)=>`${i?"L":"M"}${((i/(vals.length-1))*W).toFixed(1)} ${(2+(1-(v-mn)/rng)*(H-4)).toFixed(1)}`).join("");
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path d="${d}"/></svg>`;
}
function steamTile(){
  const S=state.steam, g=S&&S.games&&S.games[state.tag];
  if(!g || !g.latest) return "";
  const days=Object.keys(g.samples||{}).sort(), vals=days.map(d=>g.samples[d]);
  const n=g.latest.n, fmt=v=>v.toLocaleString("en-US");
  const when=new Date(g.latest.day+"T00:00:00").toLocaleDateString("en",{month:"short",day:"numeric"});
  const sub = days.length>1
    ? `${when} · peak ${fmt(g.peak.n)} · ${days.length} days tracked`
    : `${when} · first reading — the chart fills in daily`;
  const tip = `Players in ${esc(gameName())} on Steam, from Valve's own live count. One reading per day at roughly the same time (~00:30 JST) — a fixed-time slice, not the day's peak. Steam sees only players who launched through Steam, so mobile, PlayStation and standalone-launcher players aren't counted and this is a floor. History starts when the scrape did; Valve publishes no archive.`;
  return `<div class="tile" title="${esc(tip)}"><span class="l">Steam players</span>`+
         `<span class="v">${fmt(n)}</span>`+
         `<span class="n">${esc(sub)}</span>`+
         steamSpark(days, vals)+`</div>`;
}
