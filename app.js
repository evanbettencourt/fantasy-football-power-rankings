const LEAGUE_ID = "1313563024161787904";
const API = "/api/sleeper";
const $ = (id) => document.getElementById(id);
const setTextIfPresent = (id, value) => { const element = $(id); if (element) element.textContent = value; };
const state = { league: null, users: [], rosters: [], weeks: {}, selectedWeek: 1, rankingsByWeek: {}, failedWeeks: [], recoveredWeeks: [], usingCachedCore: false, draftOrder: null, draftSeason: null, nflState: null, currentWeek: 1, matchupWeek: 1, players: null, playersPromise: null, matchupDataByWeek: {} };

const num = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
const fmt = (v) => num(v).toFixed(2);
const MANAGERS = { khogan99:"Kevin", marcd9:"Marc", cjmyers210:"Colby", tajbhall:"Ben", itsdonk:"Brandon", turtmonk:"Evan", pgdoyle5:"Pat", joeysolomon:"Joey", abutta31:"Butta", lee2222:"Lee", dersnation:"Ders", tanzi14:"Tanz" };
const initials = (name) => (name || "?").trim().split(/\s+/).slice(0,2).map(x => x[0]).join("").toUpperCase();
const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function teamFor(rosterId) { return state.teams.get(Number(rosterId)); }
function avatarMarkup(team, sizeClass = "") {
  if (team?.avatar) return `<img class="avatar ${sizeClass}" src="https://sleepercdn.com/avatars/thumbs/${encodeURIComponent(team.avatar)}" alt="" onerror="this.style.display='none'">`;
  return `<span class="avatar-fallback ${sizeClass}">${escapeHtml(initials(team?.name))}</span>`;
}
function teamName(team) { return escapeHtml(team?.name || "Unknown team"); }
function getWeeksToLoad() {
  const playoffStart = num(state.league?.settings?.playoff_week_start) || 15;
  return Math.max(1, Math.min(18, playoffStart + 2));
}
async function fetchJson(path, options = {}) {
  const attempts = Math.max(1, Number(options.attempts) || 3);
  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 12000);
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const requestUrl = path.startsWith("/api/") ? path : API + path;
      const response = await fetch(requestUrl, { signal: controller.signal, headers: { "Accept": "application/json" } });
      if (!response.ok) { const error = new Error("Sleeper API returned " + response.status + " for " + path); error.status = response.status; throw error; }
      return await response.json();
    } catch (error) {
      lastError = error;
      const retryable = error.name === "AbortError" || error instanceof TypeError || !error.status || error.status === 408 || error.status === 429 || error.status >= 500;
      if (!retryable || attempt === attempts) break;
      await new Promise(resolve => setTimeout(resolve, 700 * (2 ** (attempt - 1))));
    } finally { clearTimeout(timeout); }
  }
  throw lastError || new Error("Sleeper request failed for " + path);
}
const STARTUP_CACHE_KEY = "monkey-boys-sleeper-cache-" + LEAGUE_ID;
function readStartupCache() { try { const value = JSON.parse(localStorage.getItem(STARTUP_CACHE_KEY) || "null"); return value && typeof value === "object" ? value : {}; } catch { return {}; } }
function writeStartupCache(patch) { try { const current = readStartupCache(); localStorage.setItem(STARTUP_CACHE_KEY, JSON.stringify({ ...current, ...patch, savedAt: Date.now() })); } catch (error) { console.warn("Unable to save local Sleeper fallback cache", error); } }
function hasCachedCore(cache, key) { return key === "league" ? !!(cache.league && cache.league.league_id) : Array.isArray(cache[key]) && cache[key].length > 0; }
function buildTeams() {
  const userById = new Map(state.users.map(u => [String(u.user_id ?? "").trim(), u]));
  state.teams = new Map();
  for (const roster of state.rosters) {
    const owner = userById.get(String(roster.owner_id ?? "").trim());
    const metadata = owner?.metadata || {};
    const username = String(owner?.username || "").trim().replace(/^@/, "").toLowerCase();
    const displayName = String(owner?.display_name || "").trim().replace(/^@/, "").toLowerCase();
    const name = MANAGERS[username] || MANAGERS[displayName] || `Manager ${roster.roster_id}`;
    state.teams.set(Number(roster.roster_id), {
      id: Number(roster.roster_id), name, owner: "", username,
      avatar: metadata.avatar || owner?.avatar || null, wins: 0, losses: 0, ties: 0,
      pf: 0, pa: 0, allPlayWins: 0, allPlayGames: 0, scores: []
    });
  }
}
function calculateWeek(week) {
  const matchups = state.weeks[week] || [];
  const scores = matchups.map(m => ({ id: Number(m.roster_id), score: num(m.points), matchupId: m.matchup_id }));
  const played = scores.filter(x => x.matchupId != null && x.score > 0);
  const leagueAvg = played.length ? played.reduce((a,b) => a + b.score, 0) / played.length : 0;
  const scoreByRoster = new Map(scores.map(x => [x.id, x.score]));
  const matchupGroups = new Map();
  for (const m of matchups) {
    if (!matchupGroups.has(m.matchup_id)) matchupGroups.set(m.matchup_id, []);
    matchupGroups.get(m.matchup_id).push(m);
  }
  const results = [];
  for (const group of matchupGroups.values()) {
    if (group.length !== 2 || group.some(m => num(m.points) === 0)) continue;
    const [a,b] = group;
    const ta = teamFor(a.roster_id), tb = teamFor(b.roster_id);
    if (!ta || !tb) continue;
    results.push({ a: ta, b: tb, scoreA: num(a.points), scoreB: num(b.points), winner: num(a.points) === num(b.points) ? 0 : num(a.points) > num(b.points) ? 1 : 2 });
  }
  return { results, leagueAvg, scoreByRoster, played: played.length > 0 };
}
function computeRankings(week) {
  const teams = [...state.teams.values()].map(t => ({...t, wins:0,losses:0,ties:0,pf:0,pa:0,allPlayWins:0,allPlayLosses:0,allPlayTies:0,allPlayGames:0,scores:[]}));
  const byId = new Map(teams.map(t => [t.id,t]));
  let completedWeeks = 0;
  for (let w = 1; w <= week; w++) {
    const matchups = state.weeks[w] || [];
    const valid = matchups.filter(m => num(m.points) > 0);
    const weeklyScores = valid.map(m => num(m.points));
    const groups = new Map();
    for (const m of matchups) {
      const t = byId.get(Number(m.roster_id));
      if (!t) continue;
      const score = num(m.points);
      if (score > 0) { t.pf += score; t.scores.push({week:w,score}); }
      if (m.matchup_id == null || score <= 0) continue;
      if (!groups.has(m.matchup_id)) groups.set(m.matchup_id,[]);
      groups.get(m.matchup_id).push(m);
    }
    for (const group of groups.values()) {
      if (group.length !== 2 || group.some(m => num(m.points) <= 0)) continue;
      const [a,b] = group, ta = byId.get(Number(a.roster_id)), tb = byId.get(Number(b.roster_id));
      if (!ta || !tb) continue;
      ta.pa += num(b.points); tb.pa += num(a.points);
      if (num(a.points) > num(b.points)) { ta.wins++; tb.losses++; }
      else if (num(a.points) < num(b.points)) { tb.wins++; ta.losses++; }
      else { ta.ties++; tb.ties++; }
    }
    if (weeklyScores.length) {
      const sorted = [...weeklyScores].sort((a,b)=>a-b);
      if (w <= getWeeksToLoad() && valid.length === teams.length) {
        completedWeeks++;
        const median = (sorted[sorted.length/2-1] + sorted[sorted.length/2]) / 2;
        for (const m of valid) {
        const t = byId.get(Number(m.roster_id));
        if (!t) continue;
        if (num(m.points) > median) t.wins++;
        else if (num(m.points) < median) t.losses++;
        else t.ties++;
        }
      }
      for (const t of teams) {
        const score = matchups.find(m => Number(m.roster_id) === t.id);
        if (!score || num(score.points) <= 0) continue;
        for (const opponent of valid) {
          if (Number(opponent.roster_id) === t.id) continue;
          const opponentScore = num(opponent.points);
          t.allPlayGames++;
          if (num(score.points) > opponentScore) t.allPlayWins++;
          else if (num(score.points) < opponentScore) t.allPlayLosses++;
          else t.allPlayTies++;
        }
      }
    }
  }
  const maxPf = Math.max(1,...teams.map(t=>t.pf));
  const games = Math.max(1,completedWeeks * 2);
  const recentWeeks = [Math.max(1,week-2),Math.max(1,week-1),week];
  const recentAverages = recentWeeks.map(w => {
    const all = (state.weeks[w] || []).filter(m=>num(m.points)>0).map(m=>num(m.points));
    return all.length ? all.reduce((a,b)=>a+b,0)/all.length : 0;
  });
  for (const t of teams) {
    const winRate = (t.wins + .5*t.ties) / games;
    const allPlayRate = t.allPlayGames ? t.allPlayWins/t.allPlayGames : 0;
    const recent = t.scores.filter(s=>recentWeeks.includes(s.week));
    const recentForm = recent.length && recentAverages.some(x=>x>0) ? recent.reduce((sum,s)=>sum + (s.score / (recentAverages[recentWeeks.indexOf(s.week)] || s.score)),0)/recent.length : .5;
    t.power = 100 * (.35*winRate + .25*allPlayRate + .25*(t.pf/maxPf) + .15*Math.min(1.25,recentForm)/1.25);
    t.record = `${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ""}`;
    t.allPlayRate = allPlayRate;
    t.allPlayRecord = `${t.allPlayWins}-${t.allPlayLosses}${t.allPlayTies ? `-${t.allPlayTies}` : ""}`;
  }
  return teams.sort((a,b)=>b.power-a.power || b.pf-a.pf);
}
function calculateMovement(week, rankings) {
  if (week <= 1) return rankings.map((t,i)=>({...t,move:null}));
  const previous = state.rankingsByWeek[week-1] || computeRankings(week-1);
  const previousRanks = new Map(previous.map((t,i)=>[t.id,i+1]));
  return rankings.map((t,i)=>({...t,move:(previousRanks.get(t.id) || i+1)-(i+1)}));
}

const EDITORIAL_EDITIONS = {
  10: {
    date: "NOVEMBER 17, 2026",
    rankings: [
      { manager: "Ben", note: "Twelve straight wins. Ben has turned this into a hostile takeover, and adding Jaxon Smith-Njigba only makes the league's deepest team tougher to catch. This isn't a fluky streak — the weekly production has been relentless. At this point, the question is who can finally slow him down." },
      { manager: "Marc", note: "Marc is quietly having the kind of season that gets overshadowed by a twelve-game winning streak. At 15-5 with one of the league's best all-play records, he's been a steady contender all year. Jonathan Taylor gives him a weekly hammer, and the rest of the roster keeps the floor high. Annoyingly competent." },
      { manager: "Kevin", note: "Kevin still leads the league in points, but losing Puka Nacua is a major blow at the worst possible time. His 15-5 record gives him some breathing room, yet the next few weeks will show whether that scoring firepower can hold up without one of its biggest engines." },
      { manager: "Colby", note: "Colby has the talent to make a playoff run, but the weekly floor has been tough to trust. The skill-position group can carry a matchup; the unsettled quarterback spot keeps getting in the way. If that position stabilizes, this roster can be a real problem." },
      { manager: "Brandon", note: "Brandon is second in points and tied for the league's best all-play record, yet Week 10 still brought a loss to Pat's 140.08. That's the schedule-luck tax. Ja'Marr Chase gives him a massive weekly ceiling, and the underlying numbers still say contender — even if the standings haven't cooperated." },
      { manager: "Evan", note: "Evan's middle-of-the-pack record hides a higher ceiling. Jahmyr Gibbs and Derrick Henry are a formidable duo, and Malik Nabers can swing a week. The issue is getting the full lineup to show up together. A healthy Mike Evans would help, but this team needs a more consistent stretch." },
      { manager: "Joey", note: "Joey's trade for Tee Higgins and George Pickens gives him a much more dangerous set of weekly options. The ceiling is higher immediately, but now the rest of the lineup has to keep pace. Joey made his bet; we'll see whether it turns into wins or just a very impressive group chat screenshot." },
      { manager: "Pat", note: "Pat dropped 140.08 to beat Brandon and take the week's top score — a Sunday that makes the rest of the league check the app twice. Christian McCaffrey gives him real upside, but consistency around that star power remains the question, especially with Lamar Jackson's recovery uncertain." },
      { manager: "Lee", note: "Lee needs the roster to start winning actual matchups. Bijan Robinson and Justin Jefferson are excellent building blocks, but a 7-13 record leaves little room for another 'next week will be different.' The schedule hasn't always been kind, but the playoff math is getting less friendly by the week." },
      { manager: "Butta", note: "Drake Maye's serious ankle injury is the biggest hit to Butta's outlook, with a possible fracture and extended absence threatening a major hole at quarterback. A.J. Brown's situation adds to the concern. Butta still has talent, but losing Maye changes the equation." },
      
      { manager: "Ders", note: "Ders is running out of runway. At 3-17, he needs wins now, not just the occasional big week from Josh Allen. Injuries haven't helped, but the lineup needs more complete performances to turn its potential into results. The standings are starting to look like a countdown clock." },
      { manager: "Tanz", note: "Tanz is officially out of playoff contention, so the mission is now avoiding the last-place punishment — and escaping parlay duty. The three-team deal that sent George Pickens away cost him two wins this week, a brutal start for the roster shake-up. Another finish at the bottom means another week organizing the league's $5 parlay, so there's still plenty on the line." }
    ],
    headline: "Twelve straight for Ben, and the rest of the league is running out of answers",
    feature: "Week 10 had a little bit of everything: Ben kept the winning streak rolling, Pat posted the league\u2019s top score at 140.08, and Brandon took another frustrating hit despite having one of the league\u2019s strongest scoring profiles. The three-team trade also changed the outlook for Joey, Ben, and Tanz. The biggest takeaway? The top of the rankings is being driven by sustained production, while the teams chasing them need to turn good rosters and near-misses into actual wins.",
    notes: [
      "Top score: Pat — 140.08 points",
      "Schedule gut-punch: Brandon owns one of the league\u2019s best all-play records but still lost to Pat\u2019s 140.08-point week",
      "Closest median result: Tanz finished 1.21 points below the median",
      "Trade impact: Joey added Tee Higgins and George Pickens; Ben added Jaxon Smith-Njigba; Tanz added Tony Pollard",
      "Injury watch: Kevin\u2019s loss of Puka Nacua is a major test for the league\u2019s highest-scoring team"
    ]
  }
};
function renderPowerRankings(week) {
  state.selectedWeek=week;
  const completedWeeks=Object.keys(state.weeks).map(Number).filter(w=>(state.weeks[w]||[]).filter(match=>num(match.points)>0).length>=state.teams.size);
  const publishedWeeks=Object.keys(EDITORIAL_EDITIONS).map(Number);
  const maxWeek=Math.min(getWeeksToLoad(),Math.max(1,...completedWeeks,...publishedWeeks)),archive=$("pr-archive"),select=$("week-select"),edition=EDITORIAL_EDITIONS[week];
  if(select)select.value=String(week);
  if(archive){
    archive.innerHTML=Array.from({length:maxWeek},(_,i)=>maxWeek-i).map(w=>'<button type="button" class="pr-archive-item '+(w===week?'active':'')+'" data-week="'+w+'"><span>Week '+String(w).padStart(2,"0")+'</span><small>'+(EDITORIAL_EDITIONS[w]?.date||'Edition pending')+'</small></button>').join("")+'<button type="button" class="pr-archive-item" data-week="0"><span>Post-Draft</span><small>September 2026</small></button>';
    archive.querySelectorAll("button").forEach(btn=>btn.addEventListener("click",()=>{const w=Number(btn.dataset.week);if(w===0){$("pr-week-title").textContent="Post-Draft";$("pr-edition-label").textContent="SEPTEMBER 2026";$("pr-board").innerHTML='<div class="pr-empty"><strong>POST-DRAFT RANKINGS</strong><p>The post-draft editorial edition has not been added yet.</p></div>';$("pr-rank-count").textContent="POST-DRAFT";archive.querySelectorAll("button").forEach(x=>x.classList.toggle("active",x===btn));const b=$("pr-reveal");if(b)b.hidden=true;}else renderPowerRankings(w);}));
  }
  $("pr-week-title").textContent="Week "+week;
  $("pr-edition-label").textContent=edition?.date||"EDITION PENDING";
  const stats=computeRankings(week),byName=new Map(stats.map(t=>[t.name,t])),previous=EDITORIAL_EDITIONS[week-1]?.rankings||[],priorRanks=new Map(previous.map((r,i)=>[r.manager,i+1])),hasEdition=Boolean(edition?.rankings?.length);
  const palette=["#67D9F2","#FF8A7A","#C3A0FF","#F4D06F","#7FE0B5","#FF9BCB","#83B5FF","#FFB36B","#C2DF72","#D4B4F0","#63D6C8","#F28FA3"];
  const teamOrder=[...state.teams.keys()];
  const colorFor=t=>palette[Math.max(0,teamOrder.indexOf(t?.id))%palette.length];
  const ordinal=n=>n%100>=11&&n%100<=13?n+"th":n%10===1?n+"st":n%10===2?n+"nd":n%10===3?n+"rd":n+"th";
  const pfRanks=new Map([...stats].sort((a,b)=>b.pf-a.pf).map((t,i)=>[t.name,i+1]));
  const paRanks=new Map([...stats].sort((a,b)=>b.pa-a.pa).map((t,i)=>[t.name,i+1]));
  if(!hasEdition)$("pr-board").innerHTML='<div class="pr-empty"><strong>THIS EDITION HAS NOT BEEN PUBLISHED.</strong><p>Power Rankings are editorial, not an automated sort of the standings. The live scoring picture and standings are shown below; this edition’s ranked order and written analysis have not been entered yet.</p></div>';
  else $("pr-board").innerHTML=edition.rankings.map((entry,i)=>{
    const t=byName.get(entry.manager);if(!t)return "";
    const rank=i+1,prior=priorRanks.get(entry.manager),move=prior==null?0:prior-rank;
    const txt=prior==null?"—":move>0?"▲"+move:move<0?"▼"+Math.abs(move):"—";
    const cls=move>0?"up":move<0?"dn":"ev",dir=move>0?"up":move<0?"dn":"ev",color=colorFor(t);
    return '<article class="pr-card" style="--tc:'+color+';--sp:'+color+'" data-prev="'+(prior||rank)+'" data-final="'+rank+'" data-move="'+move+'" data-dir="'+dir+'">'+
      '<div class="pr-rank"><div class="pr-num"><span class="v prev">'+(prior||rank)+'</span><span class="v final">'+rank+'</span></div><span class="pr-mv '+cls+'">'+txt+'</span></div>'+
      '<div class="pr-mid"><div class="pr-nmrow"><span class="nm">'+escapeHtml(entry.manager)+'</span><span class="pr-meta"><span class="rec"><span class="w">'+t.wins+'</span><span class="dash">-</span><span class="l">'+t.losses+'</span></span><span class="dot">·</span><span class="pf">PF '+fmt(t.pf)+' ('+pfRanks.get(t.name)+'th)</span><span class="dot">·</span><span class="pa">PA '+fmt(t.pa)+' ('+paRanks.get(t.name)+'th)</span></span></div>'+
      '<div class="bl-wrap"><div class="bl">'+(entry.note?escapeHtml(entry.note):'<span class="pr-note-pending">Commentary pending.</span>')+'</div></div></div></article>';
  }).join("");
  setTextIfPresent("pr-rank-count",hasEdition?edition.rankings.length+" / 12 RANKED":"12 MANAGERS");
  const reveal=$("pr-reveal");if(reveal){reveal.hidden=!hasEdition;reveal.textContent="REVEAL RANKINGS";window.initPowerRankingsReveal?.();}
  const scores=(state.weeks[week]||[]).filter(m=>num(m.points)>0).sort((a,b)=>num(b.points)-num(a.points));
  const matchupResults=calculateWeek(week).results,outcomeByRoster=new Map();
  for(const matchup of matchupResults){
    if(matchup.winner===1){outcomeByRoster.set(matchup.a.id,"win");outcomeByRoster.set(matchup.b.id,"loss");}
    else if(matchup.winner===2){outcomeByRoster.set(matchup.a.id,"loss");outcomeByRoster.set(matchup.b.id,"win");}
    else {outcomeByRoster.set(matchup.a.id,"even");outcomeByRoster.set(matchup.b.id,"even");}
  }
  $("weekly-chart-bars").innerHTML=scores.length?scores.map((m,index)=>{
    const t=teamFor(m.roster_id),score=num(m.points),height=Math.max(10,Math.round(score/(num(scores[0]?.points)||1)*118)),result=outcomeByRoster.get(Number(m.roster_id))||"even";
    return '<div class="pr-chart-bar-item" title="'+escapeHtml(t?.name||"Manager")+': '+fmt(score)+' · '+(result==="win"?"WIN":result==="loss"?"LOSS":"TIE")+'"><span>'+fmt(score)+'</span><i class="'+result+'" style="height:'+height+'px"></i><b>'+escapeHtml(t?.name||"—")+'</b></div>'+(index===5?'<div class="pr-chart-median-divider" aria-label="Median cutoff"></div>':"");
  }).join(""):'<div class="pr-empty">No completed scoring data for this week.</div>';
  const standings=[...stats].sort((a,b)=>b.wins-a.wins||b.pf-a.pf),editorialRanks=new Map((edition?.rankings||[]).map((r,i)=>[r.manager,i+1]));
  const playoffStart=num(state.league?.settings?.playoff_week_start)||15;
  const remainingWeeks=Math.max(0,playoffStart-week-1);
  const cutoffWins=standings[5]?.wins??Infinity;
  const standingRows=standings.map((t,i)=>{
    const color=colorFor(t),rank=editorialRanks.get(t.name),record=t.record.split("-");
    const eliminated=i>=6&&t.wins+(2*remainingWeeks)<cutoffWins;
    return '<tr><th scope="row" class="c-team"><span class="sd">'+(i+1)+'</span><span class="nm" style="color:'+color+'">'+escapeHtml(t.name)+(eliminated?'<span class="pr-eliminated">ELIMINATED</span>':'')+'</span></th>'+
      '<td class="c-rec"><span class="w">'+(record[0]||0)+'</span><span class="dash">-</span><span class="l">'+(record[1]||0)+'</span>'+(record[2]?'<span class="dash">-</span><span>'+record[2]+'</span>':'')+'</td>'+
      '<td class="num">'+fmt(t.pf)+'</td><td class="num">'+fmt(t.pa)+'</td><td class="num">'+escapeHtml(t.allPlayRecord)+'</td>'+
      '<td><span class="pr-pr">'+(rank||"—")+'</span></td></tr>';
  });
  const playoffLine='<tr class="pr-cut" aria-label="Playoff cutoff"><td colspan="6"></td></tr>';
  $("pr-standings-body").innerHTML=standingRows.slice(0,6).join("")+playoffLine+standingRows.slice(6).join("");
}

function renderScoreboard(week) {
  const {results} = calculateWeek(week);
  const el = $("scoreboard");
  // The current League page does not include a weekly scoreboard element.
  // Keep this renderer optional so a missing section cannot abort dashboard startup.
  if (!el) return;
  if (!results.length) { el.innerHTML = '<div class="empty-note">No completed matchups found for this week yet.</div>'; return; }
  el.innerHTML = results.sort((a,b)=>Math.max(b.scoreA,b.scoreB)-Math.max(a.scoreA,a.scoreB)).map(m=>`
    <div class="matchup">
      <div class="match-team"><span class="match-team-name">${teamName(m.a)} <small>${escapeHtml(m.a.owner)}</small></span></div>
      <div class="match-score ${m.winner===1?'winner':''}">${fmt(m.scoreA)} <span class="versus">—</span> <span class="${m.winner===2?'winner':''}">${fmt(m.scoreB)}</span></div>
      <div class="match-team"><span class="match-team-name">${teamName(m.b)} <small>${escapeHtml(m.b.owner)}</small></span></div>
    </div>`).join("");
}
function renderStandings(week) {
 const teams=[...state.teams.values()].map(t=>({...t,wins:0,losses:0,ties:0,pf:0,pa:0}));
 const map=new Map(teams.map(t=>[t.id,t]));
 for(let w=1;w<=week;w++){
  const groups=new Map();
  for(const m of state.weeks[w]||[]){if(!groups.has(m.matchup_id))groups.set(m.matchup_id,[]);groups.get(m.matchup_id).push(m);}
  for(const g of groups.values()){if(g.length!==2||g.some(m=>num(m.points)<=0))continue;const [a,b]=g,ta=map.get(Number(a.roster_id)),tb=map.get(Number(b.roster_id));if(!ta||!tb)continue;ta.pf+=num(a.points);tb.pf+=num(b.points);ta.pa+=num(b.points);tb.pa+=num(a.points);if(num(a.points)>num(b.points)){ta.wins++;tb.losses++;}else if(num(a.points)<num(b.points)){tb.wins++;ta.losses++;}else{ta.ties++;tb.ties++;}}
  const scores=(state.weeks[w]||[]).filter(m=>num(m.points)>0).map(m=>num(m.points)).sort((x,y)=>x-y);
  if(scores.length===teams.length){const med=(scores[5]+scores[6])/2;for(const m of state.weeks[w]){const t=map.get(Number(m.roster_id));if(!t||num(m.points)<=0)continue;if(num(m.points)>med)t.wins++;else if(num(m.points)<med)t.losses++;else t.ties++;}}
 }
 teams.sort((x,y)=>y.wins-x.wins||y.pf-x.pf);
 const colors=["#ff4d91","#26b9d5","#9a68ff","#e8b83d","#50c99a","#f0784f","#b5a0ff","#5dc4ee","#e47eb4","#a7d86c","#f1a34c","#8d9cf5"];
 const playoffStart=num(state.league?.settings?.playoff_week_start)||15;
 const remainingWeeks=Math.max(0,playoffStart-week-1);
 const cutoffWins=teams[5]?.wins ?? Infinity;
 const row=(t,i)=>{const eliminated=i>=6 && t.wins+(2*remainingWeeks)<cutoffWins;return `<div class="league-team-row ${i===6?"playoff-divider":""}"><span class="team-rank">${String(i+1).padStart(2,"0")}</span><div class="league-team-identity"><strong>${teamName(t)}${eliminated?` <span class="eliminated-label">ELIMINATED</span>`:""}</strong></div><span class="league-team-record">${t.wins}-${t.losses}${t.ties?"-"+t.ties:""}</span></div>`;};
 $("standings-list").innerHTML=teams.map(row).join("");
}
function renderLeagueStatus(week){
 const max=getWeeksToLoad(),label=$("current-week-label"),phase=$("league-phase"),buttons=$("league-week-buttons");
 if(label)label.textContent="WEEK "+week;
 const leagueStatus=state.league?.status;
 const playoffStart=num(state.league?.settings?.playoff_week_start)||15;
 const phaseIndex=leagueStatus==="pre_draft"?0:leagueStatus==="drafting"?1:(week>=playoffStart||leagueStatus==="complete")?3:2;
 const phaseNames=["PRE-DRAFT","DRAFT","REGULAR SEASON","PLAYOFFS"];
 if(phase)phase.textContent=phaseNames[phaseIndex];
 document.querySelectorAll(".phase-track span").forEach((bar,i)=>bar.classList.toggle("phase-done",i<=phaseIndex));
 if(buttons){buttons.innerHTML=Array.from({length:max},(_,i)=>i+1).map(w=>'<button type="button" class="week-chip '+(w===week?'active':'')+'" data-week="'+w+'">'+w+'</button>').join("");buttons.querySelectorAll("button").forEach(btn=>btn.addEventListener("click",()=>renderWeek(Number(btn.dataset.week))));}
}
function renderStats(week, rankings) {
  // Legacy dashboard statistic cards are not part of the current page layout.
  // Update them only when the corresponding optional element exists.
  const weekData = calculateWeek(week);
  const scores = (state.weeks[week] || []).filter(m => num(m.points) > 0);
  const high = scores.sort((a,b) => num(b.points) - num(a.points))[0];
  const average = scores.length ? scores.reduce((sum,m) => sum + num(m.points), 0) / scores.length : 0;
  setTextIfPresent("top-team", rankings[0]?.name || "—");
  setTextIfPresent("top-team-foot", rankings[0] ? `RANKED #1 · ${Math.round(rankings[0].power)} POWER` : "POWER INDEX LEADER");
  setTextIfPresent("weekly-high", high ? fmt(high.points) : "—");
  setTextIfPresent("weekly-high-foot", high ? teamFor(high.roster_id)?.name || "WEEKLY HIGH" : "NO SCORES YET");
  const riser = rankings.filter(t => t.move > 0).sort((a,b) => b.move - a.move)[0];
  setTextIfPresent("biggest-riser", riser ? riser.name : "—");
  setTextIfPresent("biggest-riser-foot", riser ? `UP ${riser.move} ${riser.move === 1 ? "SPOT" : "SPOTS"}` : "NO MOVEMENT DATA");
  setTextIfPresent("league-average", average ? fmt(average) : "—");
  if (weekData.played && rankings.length) {
    const best = rankings[0], worst = rankings[rankings.length - 1];
    const topScore = high ? fmt(high.points) : "";
    const rankMove = riser ? `${riser.name} made the biggest move, climbing ${riser.move} place${riser.move === 1 ? "" : "s"}.` : "The power rankings held relatively steady this week.";
    setTextIfPresent("takeaway", `${best.name} sits atop the Power Index, while ${worst.name} has work to do from the bottom. ${rankMove} The week's high score was ${topScore} by ${teamFor(high.roster_id)?.name || "a league team"}.`);
  } else {
    setTextIfPresent("takeaway", "The league story will take shape once this week's matchups are complete. Check back after the scores are in.");
  }
}
function renderWeek(week) {
  state.selectedWeek=week;
  renderScoreboard(week);
  renderStandings(week);
  renderLeagueStatus(week);
  $("week-select").value=String(week);
  const statusParts = ["CONNECTED · " + state.teams.size + " TEAMS", "DATA THROUGH WEEK " + week];
  if (state.usingCachedCore) statusParts.push("SAVED LEAGUE DETAILS IN USE");
  if (state.recoveredWeeks.length) statusParts.push("SAVED WEEK DATA: " + state.recoveredWeeks.join(", "));
  if (state.failedWeeks.length) statusParts.push("WEEKS UNAVAILABLE: " + state.failedWeeks.join(", "));
  $("status").textContent = statusParts.join(" · ");
  $("status").classList.toggle("error", state.failedWeeks.length > 0);
}
async function init() {
  const cache = readStartupCache();
  const requests = [["league", "/league/" + LEAGUE_ID], ["users", "/league/" + LEAGUE_ID + "/users"], ["rosters", "/league/" + LEAGUE_ID + "/rosters"]];
  try {
    // Load each required resource independently; reuse its last good copy if Sleeper is temporarily unavailable.
    const results = await Promise.all(requests.map(async ([key, path]) => {
      try {
        const value = await fetchJson(path);
        const valid = key === "league" ? value && value.league_id : Array.isArray(value) && value.length > 0;
        if (!valid) throw new Error("Sleeper returned invalid " + key + " data.");
        writeStartupCache({ [key]: value });
        return { key, value, cached: false };
      } catch (error) {
        console.warn("Sleeper " + key + " request failed after retries", error);
        return hasCachedCore(cache, key) ? { key, value: cache[key], cached: true } : { key, value: null, error };
      }
    }));
    const missing = results.filter(item => !item.value);
    if (missing.length) throw new Error("Required data unavailable (" + missing.map(item => item.key + ": " + (item.error?.message || "no saved copy")).join("; ") + ").");
    const core = Object.fromEntries(results.map(item => [item.key, item.value]));
    state.league = core.league; state.users = core.users; state.rosters = core.rosters;
    state.usingCachedCore = results.some(item => item.cached);
    buildTeams(); renderLotteryHistory(); loadActualDraftOrder();
    const season = core.league.season || String(new Date().getFullYear());
    $("season-label").textContent = season + " SLEEPER LEAGUE · EST. 2017";
    $("season-tag").textContent = season + " SEASON · EST. 2017";
    const rankingsSeasonTag = $("season-tag-rankings");
    if (rankingsSeasonTag) rankingsSeasonTag.textContent = season + " SEASON · EST. 2017";
    const maxWeek = getWeeksToLoad();
    const weekResults = await Promise.all(Array.from({ length: maxWeek }, (_, index) => index + 1).map(async week => {
      const key = String(week);
      try {
        const data = await fetchJson("/league/" + LEAGUE_ID + "/matchups/" + week);
        if (!Array.isArray(data)) throw new Error("Invalid matchup data for week " + week);
        const saved = readStartupCache().weeks || {};
        writeStartupCache({ weeks: { ...saved, [key]: data } });
        return { week, data, source: "live" };
      } catch (error) {
        console.warn("Week " + week + " failed after retries", error);
        const saved = readStartupCache().weeks || cache.weeks || {};
        return Array.isArray(saved[key]) ? { week, data: saved[key], source: "cache" } : { week, data: [], source: "missing" };
      }
    }));
    state.failedWeeks = weekResults.filter(item => item.source === "missing").map(item => item.week);
    state.recoveredWeeks = weekResults.filter(item => item.source === "cache").map(item => item.week);
    weekResults.forEach(item => { state.weeks[item.week] = item.data; });
    try { state.nflState = await fetchJson("/state/nfl", { attempts: 1, timeoutMs: 8000 }); } catch (error) { state.nflState = null; }
    const completed = Array.from({ length: maxWeek }, (_, index) => index + 1).filter(week => (state.weeks[week] || []).some(match => num(match.points) > 0));
    const latestCompletedWeek = completed.length ? Math.max(...completed) : 1;
    const currentWeek = Math.max(1, Math.min(14, num(state.nflState?.week) || latestCompletedWeek));
    state.currentWeek = currentWeek;
    state.matchupWeek = currentWeek;
    const defaultWeek = latestCompletedWeek;
    const select = $("week-select");
    select.innerHTML = Array.from({ length: defaultWeek }, (_, index) => `<option value="${index + 1}">WEEK ${index + 1}</option>`).join("");
    select.addEventListener("change", () => renderPowerRankings(Number(select.value)));
    renderWeek(defaultWeek); renderPowerRankings(defaultWeek);
    renderSchedule();
    renderMatchups(state.matchupWeek);
    $("updated-at").textContent = state.usingCachedCore || state.recoveredWeeks.length ? "SLEEPER API · SAVED DATA USED WHERE NEEDED" : "SLEEPER API · PUBLIC LEAGUE DATA";
  } catch (error) {
    console.error("League startup failed", error);
    $("status").textContent = "LEAGUE DATA ERROR · " + (error?.message || "Unknown startup error");
    $("status").classList.add("error");
    $("pr-board").innerHTML = '<div class="pr-empty">League data could not be refreshed. No saved fallback was available; please try again shortly.</div>';
    const standings = $("standings-list");
    if (standings) standings.innerHTML = '<div class="empty-note">Standings unavailable. Please try again shortly.</div>';
  }
}
function matchupNormalCdf(z) {
  const x = Math.abs(z) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429*t - 1.453152027)*t) + 1.421413741)*t - 0.284496736)*t + 0.254829592)*t*Math.exp(-x*x);
  return 0.5 * (1 + (z < 0 ? -erf : erf));
}
function normalizeSleeperRows(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.entries(value).map(([id,row]) => ({ player_id: String(row?.player_id ?? id), ...row }));
  return [];
}
async function loadMatchupWeekData(week) {
  if (state.matchupDataByWeek[week]?.loaded || state.matchupDataByWeek[week]?.loading) return;
  state.matchupDataByWeek[week] = { loading: true };
  const season = state.league?.season || String(new Date().getFullYear());
  const playersTask = state.players
    ? Promise.resolve(state.players)
    : (state.playersPromise ||= fetchJson("/players/nfl?active=true", { attempts: 1, timeoutMs: 25000 })
        .then(value => { state.players = value && typeof value === "object" ? value : {}; return state.players; })
        .catch(error => { console.warn("Sleeper player directory unavailable", error); state.players = {}; return state.players; }));
  const projectionsPath = "/api/sleeper-projections/" + season + "/" + week +
    "?season_type=regular&position[]=QB&position[]=RB&position[]=WR&position[]=TE&position[]=K&position[]=DEF&order_by=pts_half_ppr";
  const statsPath = "/api/sleeper-stats/regular/" + season + "/" + week;
  const [players, projectionsResult, statsResult] = await Promise.all([
    playersTask,
    fetchJson(projectionsPath, { attempts: 1, timeoutMs: 18000 }).catch(error => { console.warn("Sleeper projections unavailable for week " + week, error); return null; }),
    fetchJson(statsPath, { attempts: 1, timeoutMs: 18000 }).catch(error => { console.warn("Sleeper live stats unavailable for week " + week, error); return null; })
  ]);
  state.matchupDataByWeek[week] = {
    loaded: true,
    players: players || {},
    projections: normalizeSleeperRows(projectionsResult),
    stats: statsResult && typeof statsResult === "object" ? statsResult : {}
  };
  if (state.matchupWeek === week) renderMatchups(week, true);
}
function renderMatchups(week = state.matchupWeek, dataReady = false) {
  const target = $("matchups-content");
  const picker = $("matchups-week-select");
  if (!target || !state.teams?.size) return;
  const regularWeeks = Math.max(1, (num(state.league?.settings?.playoff_week_start) || 15) - 1);
  week = Math.max(1, Math.min(regularWeeks, Number(week) || 1));
  state.matchupWeek = week;
  const season = state.league?.season || new Date().getFullYear();
  setTextIfPresent("matchups-season", season);
  if (picker) {
    if (!picker.options.length) {
      picker.innerHTML = Array.from({ length: regularWeeks }, (_, i) => '<option value="' + (i+1) + '">WEEK ' + String(i+1).padStart(2,"0") + '</option>').join("");
      picker.addEventListener("change", () => renderMatchups(Number(picker.value)));
    }
    picker.value = String(week);
  }
  const source = state.weeks[week] || [];
  const groups = new Map();
  source.forEach(match => {
    if (match.matchup_id == null) return;
    const key = String(match.matchup_id);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(match);
  });
  const games = [...groups.values()].filter(group => group.length === 2).map(group => {
    const a = group[0], b = group[1], teamA = teamFor(a.roster_id), teamB = teamFor(b.roster_id);
    return teamA && teamB ? { a, b, teamA, teamB } : null;
  }).filter(Boolean);
  if (!games.length) {
    const message = state.failedWeeks.includes(week) ? "Sleeper matchup data is unavailable for this week." : "Sleeper has not posted matchups for this week yet.";
    target.innerHTML = '<div class="mu-empty">' + escapeHtml(message) + '</div>';
    if (!dataReady) loadMatchupWeekData(week);
    return;
  }

  const data = state.matchupDataByWeek[week] || {};
  const players = data.players || state.players || {};
  const projectionRows = data.projections || [];
  const projections = new Map(projectionRows.map(row => [String(row.player_id ?? row.player?.player_id ?? ""), row]).filter(([id]) => id));
  const stats = data.stats || {};
  const currentWeek = Math.max(1, Math.min(regularWeeks, num(state.currentWeek) || state.matchupWeek));
  const isPast = week < currentWeek;
  const recordRows = week > 1 ? computeRankings(week - 1) : computeRankings(0);
  const recordById = new Map(recordRows.map(team => [team.id, team]));
  const publishedWeek = Object.keys(EDITORIAL_EDITIONS).map(Number).filter(w => w < week && EDITORIAL_EDITIONS[w]?.rankings?.length).sort((a,b) => b-a)[0];
  const powerRanks = new Map((publishedWeek ? EDITORIAL_EDITIONS[publishedWeek].rankings : []).map((entry,index) => [entry.manager, index+1]));
  games.sort((left,right) => {
    const leftRanks = [powerRanks.get(left.teamA.name) || Infinity, powerRanks.get(left.teamB.name) || Infinity].sort((a,b)=>a-b);
    const rightRanks = [powerRanks.get(right.teamA.name) || Infinity, powerRanks.get(right.teamB.name) || Infinity].sort((a,b)=>a-b);
    return leftRanks[0]-rightRanks[0] || leftRanks[1]-rightRanks[1];
  });
  const hasProjectionData = projections.size > 0;

  const positionClass = position => ({
    QB:"qb", RB:"rb", WR:"wr", TE:"te", FLEX:"flex", WRRB_FLEX:"flex", REC_FLEX:"flex",
    SUPER_FLEX:"sflx", SFLX:"sflx"
  }[String(position || "").toUpperCase()] || "other");
  const positionLabel = position => {
    const key = String(position || "").toUpperCase();
    if (["WRRB_FLEX","REC_FLEX"].includes(key)) return "FLEX";
    if (["SUPER_FLEX","SFLX"].includes(key)) return "SFLX";
    return key || "—";
  };
  const playerRow = (playerId, matchup, isStarter, slotPosition = null) => {
    const id = String(playerId);
    const player = players[id] || {};
    const name = player.full_name || [player.first_name, player.last_name].filter(Boolean).join(" ") || (id ? "Player " + id : "Empty slot");
    const position = slotPosition || player.position || player.fantasy_positions?.[0] || "—";
    const label = positionLabel(position);
    const actualStat = stats[id];
    const matchupPoints = matchup.players_points && matchup.players_points[id];
    const actual = actualStat?.pts_half_ppr != null ? num(actualStat.pts_half_ppr) : num(matchupPoints);
    const projection = num(projections.get(id)?.stats?.pts_half_ppr);
    const hasProjection = projections.get(id)?.stats?.pts_half_ppr != null;
    return '<div class="mu-player-row ' + (isStarter ? "starter" : "bench") + '">' +
      '<span class="mu-player-pos ' + positionClass(position) + '">' + escapeHtml(label) + '</span>' +
      '<span class="mu-player-name">' + escapeHtml(name) + (player.team ? '<small>' + escapeHtml(player.team) + '</small>' : '') + '</span>' +
      '<span class="mu-player-points">' + (actualStat || num(matchupPoints) > 0 ? fmt(actual) : "—") + '</span>' +
      '<span class="mu-player-proj">' + (hasProjection ? fmt(projection) : "—") + '</span>' +
    '</div>';
  };
  const rosterMarkup = (team, matchup, showBench = false) => {
    const allPlayers = Array.isArray(matchup.players) ? matchup.players.map(String) : [];
    const starters = Array.isArray(matchup.starters) ? matchup.starters.map(String).filter(id => id && id !== "0") : [];
    const starterSet = new Set(starters);
    const bench = allPlayers.filter(id => !starterSet.has(id));
    const slots = Array.isArray(state.league?.roster_positions) ? state.league.roster_positions : [];
    const rows = (showBench ? bench : starters).map(id => {
      const slotPosition = showBench ? null : slots[starters.indexOf(id)];
      return playerRow(id, matchup, !showBench, slotPosition);
    }).join("");
    return '<section class="mu-roster-team"><h4 style="color:' + lotteryColor(team.name) + '">' + escapeHtml(team.name) + '</h4>' +
      '<div class="mu-player-head"><span>POS</span><span>PLAYER</span><span>PTS</span><span>PROJ</span></div>' +
      (rows || '<p class="mu-empty">' + (showBench ? "No bench players listed." : "Starter data unavailable.") + '</p>') +
    '</section>';
  };
  const projectionFor = (team, matchup) => {
    const starters = Array.isArray(matchup.starters) ? matchup.starters.map(String).filter(id => id && id !== "0") : [];
    let originalTotal = 0, liveTotal = 0, found = false;
    for (const id of starters) {
      const stat = stats[id];
      const matchupPoints = matchup.players_points && matchup.players_points[id];
      const actual = stat?.pts_half_ppr != null ? num(stat.pts_half_ppr) : num(matchupPoints);
      const projection = projections.get(id)?.stats?.pts_half_ppr;
      if (projection != null && Number.isFinite(Number(projection))) {
        const original = Number(projection);
        originalTotal += original;
        liveTotal += stat || num(matchupPoints) > 0 ? actual : original;
        found = true;
      } else if (stat || matchupPoints != null) {
        liveTotal += actual;
      }
    }
    const actualTeamScore = num(matchup.points);
    if (isPast) return { value: actualTeamScore, original: null, available: true };
    return {
      value: Math.max(actualTeamScore, liveTotal),
      original: originalTotal,
      available: hasProjectionData && found
    };
  };
  const teamSummary = (team, matchup) => {
    const record = recordById.get(team.id);
    const powerRank = powerRanks.get(team.name);
    const projected = projectionFor(team, matchup);
    return { record: record?.record || "0-0", powerRank, projected, score: num(matchup.points), color: lotteryColor(team.name) };
  };
  const probability = (a, b) => {
    if (isPast) {
      if (a.score === b.score) return 50;
      return a.score > b.score ? 100 : 0;
    }
    if (!a.projected.available || !b.projected.available) return null;
    return Math.max(1, Math.min(99, Math.round(matchupNormalCdf((a.projected.value - b.projected.value) / 22) * 100)));
  };
  const cards = games.map((game,index) => {
    const a = teamSummary(game.teamA, game.a), b = teamSummary(game.teamB, game.b);
    const probA = probability(a,b), probB = probA == null ? null : 100 - probA;
    const status = isPast ? "FINAL" : (a.score > 0 || b.score > 0 ? "LIVE" : "UPCOMING");
    const side = (team, summary, winChance) => {
      const projectionDelta = summary.projected.available && summary.projected.original != null
        ? summary.projected.value - summary.projected.original : 0;
      const projectionClass = projectionDelta > 0.005 ? "up" : projectionDelta < -0.005 ? "down" : "even";
      const probabilityClass = winChance == null ? "" : winChance > 50 ? "favored" : winChance < 50 ? "underdog" : "even";
      return '<div class="mu-side">' +
        '<div class="mu-manager"><span class="mu-rank">' + (summary.powerRank ? "#" + summary.powerRank : "—") + '</span>' +
          '<div class="mu-manager-copy"><strong style="color:' + summary.color + '">' + escapeHtml(team.name) + '</strong>' +
          '<small>' + escapeHtml(summary.record) + ' · POWER RANK</small></div></div>' +
        '<div class="mu-score-line"><strong>' + fmt(summary.score) + '</strong></div>' +
        '<div class="mu-projection-line ' + projectionClass + '">' + (summary.projected.available ? '<span>PROJECTION</span><b>' + fmt(summary.projected.value) + '</b>' : '<span>PROJECTION</span><b>—</b>') + '</div>' +
        '<div class="mu-win-line"><span>WIN PROBABILITY</span><b class="' + probabilityClass + '">' + (winChance == null ? "—" : winChance + "%") + '</b></div>' +
      '</div>';
    };
    const bar = probA == null ? '<div class="mu-prob-track unavailable"></div>' :
      '<div class="mu-prob-track" style="background:linear-gradient(90deg,' +
        (probA >= 50 ? '#35C878 0%,#35C878 ' + probA + '%,#FF4F91 ' + probA + '%,#FF4F91 100%' :
          '#FF4F91 0%,#FF4F91 ' + probA + '%,#35C878 ' + probA + '%,#35C878 100%') + ')"></div>';
    return '<article class="mu-card">' +
      '<div class="mu-card-head"><span>MATCHUP ' + String(index+1).padStart(2,"0") + '</span><span class="mu-live-tag ' + status.toLowerCase() + '">' + status + '</span></div>' +
      '<div class="mu-faceoff">' + side(game.teamA,a,probA) + '<div class="mu-versus">VS</div>' + side(game.teamB,b,probB) + '</div>' +
      '<div class="mu-prob-wrap">' + bar + '</div>' +
      '<details class="mu-rosters"><summary><span>SHOW LINEUPS</span><span class="mu-expand-mark">+</span></summary>' +
        '<div class="mu-roster-grid">' + rosterMarkup(game.teamA,game.a,false) + rosterMarkup(game.teamB,game.b,false) + '</div>' +
        '<details class="mu-bench-details"><summary><span>SHOW BENCH</span><span class="mu-expand-mark">+</span></summary>' +
          '<div class="mu-roster-grid">' + rosterMarkup(game.teamA,game.a,true) + rosterMarkup(game.teamB,game.b,true) + '</div>' +
        '</details>' +
      '</details>' +
    '</article>';
  });
  target.innerHTML = cards.join("");
  if (!data.loaded && !data.loading) loadMatchupWeekData(week);
}

let selectedScheduleTeam = null;
function renderSchedule() {
  const pickTarget = $("schedule-team-picks");
  const contentTarget = $("schedule-content");
  if (!pickTarget || !contentTarget || !state.teams?.size) return;

  const teams = [...state.teams.values()].sort((a,b)=>a.name.localeCompare(b.name));
  const season = state.league?.season || new Date().getFullYear();
  const seasonLabel = $("schedule-season");
  if (seasonLabel) seasonLabel.textContent = season;

  const teamColor = team => lotteryColor(team.name);
  pickTarget.innerHTML = teams.map(team => {
    const color = teamColor(team);
    const active = selectedScheduleTeam === team.name;
    return '<button type="button" class="sch-pick '+(active?'active':'')+'" data-schedule-team="'+escapeHtml(team.name)+'" aria-pressed="'+(active?'true':'false')+'" style="color:'+color+'">'+escapeHtml(team.name)+'</button>';
  }).join("");

  const cards = [];
  for (let week=1; week<=14; week++) {
    const source = state.weeks[week] || [];
    const groups = new Map();
    source.forEach(match => {
      if (match.matchup_id == null) return;
      const id = String(match.matchup_id);
      if (!groups.has(id)) groups.set(id,[]);
      groups.get(id).push(match);
    });
    const games = [...groups.values()].filter(group=>group.length===2).map(group=>{
      const a=teamFor(group[0].roster_id), b=teamFor(group[1].roster_id);
      return a&&b?{a,b}:null;
    }).filter(Boolean);
    const rematch = week>=12;
    const rows = games.map(game=>{
      const aSelected = game.a.name===selectedScheduleTeam;
      const bSelected = game.b.name===selectedScheduleTeam;
      return '<div class="sch-game '+(selectedScheduleTeam?(aSelected||bSelected?'on':'off'):'')+'" data-a="'+escapeHtml(game.a.name)+'" data-b="'+escapeHtml(game.b.name)+'">'+
        '<span class="sch-nm '+(aSelected?'selected':'')+'" data-name="'+escapeHtml(game.a.name)+'">'+escapeHtml(game.a.name)+'</span>'+
        '<span class="vs">vs</span>'+
        '<span class="sch-nm '+(bSelected?'selected':'')+'" data-name="'+escapeHtml(game.b.name)+'">'+escapeHtml(game.b.name)+'</span>'+
      '</div>';
    }).join("");
    const empty = state.failedWeeks.includes(week) ? "Sleeper schedule data is unavailable for this week." : "Matchups have not been posted by Sleeper yet.";
    const tag = "Regular Season";
    cards.push('<article class="sch-wk">'+
      '<div class="sch-wk-hd"><span class="sch-wk-n">Week '+week+'</span><span class="sch-wk-tag regular">'+tag+'</span></div>'+
      '<div class="sch-games">'+(rows||'<p class="sch-empty">'+empty+'</p>')+'</div>'+
    '</article>');
  }
  contentTarget.classList.toggle("has-selection",!!selectedScheduleTeam);
  contentTarget.innerHTML = cards.join("");
  pickTarget.querySelectorAll("[data-schedule-team]").forEach(button=>button.addEventListener("click",()=>{
    selectedScheduleTeam=selectedScheduleTeam===button.dataset.scheduleTeam?null:button.dataset.scheduleTeam;
    renderSchedule();
  }));
}
function renderEditorial(week, rankings) {
  const scores=(state.weeks[week]||[]).filter(m=>num(m.points)>0).sort((a,b)=>num(b.points)-num(a.points));
  const chart=$("weekly-chart-bars");
  if(chart) chart.innerHTML=scores.map(m=>{
    const t=teamFor(m.roster_id), pct=Math.max(5,Math.round(num(m.points)/(num(scores[0]&&scores[0].points)||1)*100));
    return '<div class="chart-bar-item" title="'+teamName(t)+': '+fmt(m.points)+'"><span class="chart-bar-value">'+fmt(m.points)+'</span><div class="chart-bar" style="height:'+pct+'px"></div><span class="chart-bar-label">'+escapeHtml(t&&t.owner||"")+'</span></div>';
  }).join("");
  const notes=$("team-notes");
  if(notes) notes.innerHTML=rankings.map((t,i)=>{
    const movement=t.move>0?"up "+t.move+" place"+(t.move===1?"":"s"):t.move<0?"down "+Math.abs(t.move)+" place"+(t.move===-1?"":"s"):"holding position";
    const score=t.scores&&t.scores.length?t.scores[t.scores.length-1].score:0;
    const sentence=score?"Scored "+fmt(score)+" this week and is "+movement+" in the Power Index. The season profile currently shows "+t.record+" with "+fmt(t.pf)+" points for.":"No completed scoring data is available yet. The team is currently "+movement+" in the Power Index.";
    return '<article class="team-note"><div class="team-note-head"><strong>'+String(i+1).padStart(2,"0")+' — '+teamName(t)+'</strong><span>'+Math.round(t.power)+' POWER</span></div><p>'+sentence+'</p></article>';
  }).join("");
}
function renderRules() {
  const target=$("rules-content");
  if(!target||target.dataset.ready==="yes") return;
  const sections=[
    {id:"rules-league",title:"League policies",body:'<h3>Rule changes</h3><ul><li>All league rules are open to be changed from the end of the fantasy football season until draft night of the following fantasy football season.</li><li>If a league member proposes a new rule, a Sleeper poll will be created to cast votes for the proposal. A simple majority (&gt;50%) of league members must vote in favor of a proposed change for it to occur.</li><li>Exception for rules related to buy in or payout, where a supermajority (&gt;2/3) of league members must vote in favor of a proposed change for it to occur.</li></ul><h3>Buy in</h3><ul><li>$50 per person</li><li>Must be paid to league commissioner by draft day</li></ul><h3>Payout</h3><ul><li>First place playoffs: $300 (50% of pot)</li><li>Second place playoffs: $180 (30% of pot)</li><li>First place regular season: $120 (20% of pot)</li></ul><h3>Last place punishment</h3><ul><li>Last place punishment for the season will be agreed upon by all league mates prior to the draft</li><li>The team that finishes last place in the regular season is considered last place</li><li>Punishment must be completed prior to the next season’s draft lottery date. If it is not, that league mate will automatically be assigned last position in the draft lottery AND forfeit their first round draft pick</li></ul>'},
    {id:"rules-draft",title:"Draft",body:'<ul><li>Draft start time: TBD by league determination</li><li>Autostart draft: Enabled</li><li>Draft type: Snake</li><li>Available players to draft: All players</li><li>Time per pick: 1.5 minutes</li><li>CPU Autopick: Enabled</li></ul><h3>Draft order determination</h3><p>A computer-generated duck race determines the order in which league members select their draft position. Starting approximately two weeks before draft day, managers select their draft spot in that order, with each league member receiving approximately one day to make their decision.</p>'},
    {id:"rules-lineup",title:"Lineup",body:'<div class="rules-visual rules-roster-visual"><div class="rules-visual-title">STARTING LINEUP <span>8 SLOTS</span></div><div class="rules-slot-grid"><span>QB <b>1</b></span><span>RB <b>2</b></span><span>WR <b>2</b></span><span>TE <b>1</b></span><span>FLEX <b>1</b></span><span>SUPERFLEX <b>1</b></span></div><div class="rules-depth"><span>BENCH <b>6</b></span><span>INJURED RESERVE <b>2</b></span></div></div><h3>Lineup lock</h3><p>Players lock individually when their game kicks off. A player whose game has started cannot be moved into or out of your lineup; players whose games have not yet started remain free to swap.</p><h3>You set your own lineup</h3><p>Each manager is solely responsible for setting a valid, active lineup every week. The Commissioner does not set, fix, adjust, or retroactively change any manager’s lineup — not for a forgotten start, a player left in on a bye, an injury, or a late inactive. Empty or invalid starting slots score zero, and there are no makeups. Aside from the lock rule above, managers are free to set their lineups however they wish.</p><h3>Player AutoSubs</h3><p>Each team may designate one AutoSub per week. If a starter is ruled inactive before kickoff, the designated substitute automatically moves into the lineup. If the starter is active and plays, the substitute does not replace them. The substitute must be eligible for the starter’s lineup position and must have a game scheduled to start at the same time as or after the starter’s game. Both players must be unstarted when the pairing is set, and the pairing locks as soon as either player’s game kicks off. AutoSubs are configured in the Sleeper mobile app.</p><p class="rules-source-note">See <a href="https://support.sleeper.com/en/articles/9731991-how-does-player-autosubs-work" target="_blank" rel="noopener">Sleeper’s AutoSubs guide</a> for the feature details.</p><h3>Injured reserve eligibility</h3><p>Players eligible for injured reserve include IR, PUP, and OUT. The following statuses are ineligible: Suspended, NA, DNR/Holdout, and Doubtful.</p>'},
    {id:"rules-scoring",title:"Scoring",body:'<h3>Weekly matchup format</h3><p>In addition to the head-to-head matchup, every team plays an extra game against the league median each week. Teams earn two wins, two losses, or one win and one loss each week.</p><h3>Passing</h3><ul><li>Passing yards: 1 point every 25 yards (+0.04 per yard)</li><li>Passing TD: 4</li><li>2-Pt conversion: 2</li><li>Pass intercepted: -2</li></ul><h3>Rushing</h3><ul><li>Rushing yards: 1 point every 10 yards (+0.1 per yard)</li><li>Rushing TD: 6</li><li>2-Pt conversion: 2</li></ul><h3>Receiving</h3><ul><li>Reception: 0.5</li><li>Receiving yards: 1 point every 10 yards (+0.1 per yard)</li><li>Receiving TD: 6</li><li>2-Pt conversion: 2</li></ul><h3>Kicking</h3><ul><li>FG made: 3</li><li>PAT made: 1</li></ul><h3>Miscellaneous</h3><ul><li>Fumble lost: -2</li><li>Fumble recovery TD: 6</li></ul>'},
    {id:"rules-waivers",title:"Waivers & Free Agency",body:'<p><strong>TLDR:</strong> Every team receives a $100 FAAB budget at the start of the season. Waivers run Wednesday through Saturday, with claims processed at 3 AM Eastern. Sunday and Monday are instant free-agency days, while Tuesday is locked.</p><h3>What is FAAB?</h3><p>FAAB (Free Agent Acquisition Budget) gives each team a set budget to bid on free agents throughout the season using a blind bidding system. When waivers process, the team with the highest bid wins the player. Other managers cannot see your bid before it processes.</p><p>Each team starts the season with $100 in FAAB. A $0 bid is allowed and wins if no other bids are made, or if the only other bids are also $0 and your waiver priority wins the tiebreaker. FAAB may also be included in trades.</p><p class="rules-source-note">For more detail, see <a href="https://support.sleeper.com/en/articles/1876040-how-does-faab-bidding-work" target="_blank" rel="noopener">Sleeper’s guide to FAAB bidding</a>.</p><h3>Adding Players</h3><p>At any moment, an un-rostered player is in one of two states:</p><ul><li><strong>On waivers —</strong> submit a blind FAAB bid. Claims are awarded when waivers process, with the highest bid winning.</li><li><strong>Free agent —</strong> first-come, first-served. Add an eligible player instantly without a bid. This is open on Sundays and Mondays. Tuesday is locked.</li></ul><div class="rules-visual rules-waiver-visual"><div class="rules-visual-title">WEEKLY WAIVER CYCLE <span>LEAGUE SETTINGS</span></div><div class="rules-week-grid"><div class="free"><b>MON</b><span class="rules-day-icon" aria-hidden="true">⚡</span><strong>FREE AGENTS</strong></div><div class="locked"><b>TUE</b><span class="rules-day-icon" aria-hidden="true">🔒</span><strong>LOCKED</strong></div><div class="waiver"><b>WED</b><span class="rules-day-icon" aria-hidden="true">💵</span><strong>WAIVERS</strong></div><div class="waiver"><b>THU</b><span class="rules-day-icon" aria-hidden="true">💵</span><strong>WAIVERS</strong></div><div class="waiver"><b>FRI</b><span class="rules-day-icon" aria-hidden="true">💵</span><strong>WAIVERS</strong></div><div class="waiver"><b>SAT</b><span class="rules-day-icon" aria-hidden="true">💵</span><strong>WAIVERS</strong></div><div class="free"><b>SUN</b><span class="rules-day-icon" aria-hidden="true">⚡</span><strong>FREE AGENTS</strong></div></div><p class="rules-chart-caption">Waivers process at 3 AM Eastern, Wednesday through Saturday.</p></div><h3>The weekly schedule</h3><p>Waivers run Wednesday through Saturday, processing each night at 3 AM Eastern. Sundays and Mondays are instant free-agent days. Tuesday is locked.</p><h3>Players after kickoff</h3><p>Any player who appears in a game stays on waivers until the next scheduled waiver processing period. Under our league settings, waivers clear Wednesday at 3 AM Eastern.</p><h3>Dropped players</h3><p>A player you drop stays on waivers for 1 day before he can become a free agent. This prevents dropping a player and instantly re-adding him to dodge a bid. He is biddable during that window, then opens up.</p><p><strong>Bench-player drop setting:</strong> Prevent bench players from being dropped after their game starts is Off. Bench players can be dropped even after their game has started.</p><h3>Tied Bids</h3><p>If two teams bid the same amount on a player, the tie goes to the team with the better waiver order that week. Winning any claim sends you to the back of the waiver order, so priority constantly rotates. Sleeper handles this automatically.</p><h3>$0 bids</h3><p>You may bid $0. A $0 bid wins if no one else bids on that player, or if another $0 bid loses the tiebreaker to a team with better waiver priority. Once a player is a Sunday or Monday free agent, no bid is needed.</p><h3>FAAB in trades</h3><p>FAAB may be included in trades and does not have to be balanced (see the Trades section). You can effectively buy or sell budget FAAB via trades.</p><h3>The TNF Limitation</h3><p>Because players who play midweek during Thursday, Friday, or Saturday games are on waivers rather than instant free agency, you cannot add and start a player for a Thursday night game if you place your bid that same Thursday. Plan that add ahead and place your bid on Wednesday so the player is added when waivers run at 3 AM Eastern Thursday morning.</p>'},
    {id:"rules-trades",title:"Trades",body:'<h3>Commissioner oversight &amp; collusion</h3><p>Trades process instantly in Sleeper once accepted. There is no routine commissioner review or veto period. The Commissioner may veto a trade only if the league identifies clear collusion.</p><p>Collusion means an agreement with no legitimate competitive purpose for one side, intended to funnel value to another team without a genuine exchange. A lopsided or objectively bad trade is not, by itself, collusion.</p><h3>Player trades</h3><ul><li><strong>Use Sleeper when possible.</strong> Trades should be entered and processed in Sleeper whenever the platform can represent the agreed exchange, including players and FAAB.</li><li><strong>League-approved exception.</strong> The league may agree to trade conditions or considerations that Sleeper cannot represent. For example, a manager may trade a player in exchange for another manager agreeing not to bid on a particular player on waivers. Any such condition must be clearly agreed to by everyone involved.</li><li><strong>No temporary trades or rentals.</strong> You may not trade a player under an arrangement to return that player afterward.</li><li><strong>Trades are final and as-is.</strong> Once processed, a trade cannot be reversed because of injury, suspension, or underperformance. You trade a player’s future, risk included.</li><li><strong>Roster and FAAB legality.</strong> A trade cannot leave a team over the roster limit or with negative FAAB. The receiving team must clear roster room for the trade to process and cannot include FAAB it does not have.</li></ul><h3>Trade eligibility</h3><p>There is no official trade deadline. However, once a team is eliminated from playoff contention, it may trade only with other teams that are also eliminated. Eliminated teams may continue trading with one another, including to improve their chances of avoiding the last-place punishment.</p>'},
    {id:"rules-playoffs",title:"Playoffs",body:'<div class="rules-playoff-bracket"><img src="playoff-bracket.svg" alt="Six-team playoff bracket. Seeds 3 and 6, and seeds 4 and 5, play in Week 15; seeds 1 and 2 receive byes. In Week 16, seed 1 plays the lowest-seeded Round 1 winner and seed 2 plays the highest-seeded Round 1 winner. The Week 17 champion receives $300 and the runner-up receives $180. The regular-season champion receives $120."/></div>'},
  ];
  const nav=sections.map(section=>'<a href="#'+section.id+'">'+section.title+'</a>').join("");
  const content=sections.map((section,index)=>{const visual=section.id==="rules-scoring"?'<div class="rules-visual rules-scoring-visual"><div><strong>0.5</strong><span>POINTS PER RECEPTION</span></div><div><strong>4</strong><span>PASSING TD</span></div><div><strong>6</strong><span>RUSH / REC TD</span></div><div><strong>−2</strong><span>INT / FUMBLE LOST</span></div></div>':"";return '<section class="rules-section" id="'+section.id+'"><div class="rules-section-head"><span class="rules-index">'+String(index+1).padStart(2,"0")+'</span><h3>'+section.title+'</h3></div><div class="rules-section-body">'+visual+section.body+'</div></section>';}).join("");
  target.innerHTML='<div class="rules-overview"><div class="rules-overview-head"><span class="rule-kicker">THE LEAGUE AT A GLANCE</span><span class="rules-season">MONKEY BOYS FANTASY FOOTBALL</span></div><div class="rules-stat-grid"><div><span>BUY-IN</span><strong>$50</strong><small>per manager</small></div><div><span>LEAGUE SIZE</span><strong>12</strong><small>teams</small></div><div><span>PLAYOFF FIELD</span><strong>6</strong><small>teams qualify</small></div><div><span>RECEPTION</span><strong>½ PPR</strong><small>per catch</small></div></div><div class="rules-payout"><div class="rules-payout-copy"><span class="rule-kicker">THE $600 POT</span><strong>How the money is split</strong></div><div class="rules-payout-bar"><span class="rules-payout-first"></span><span class="rules-payout-second"></span><span class="rules-payout-third"></span></div><div class="rules-payout-legend"><span><i class="first"></i>1st place <b>$300</b></span><span><i class="second"></i>2nd place <b>$180</b></span><span><i class="third"></i>Regular season <b>$120</b></span></div></div></div><div class="rules-layout"><aside class="rules-toc"><div class="rules-toc-title">ON THIS PAGE</div>'+nav+'</aside><div class="rules-article">'+content+'</div></div>';
  target.dataset.ready="yes";
  const links=[...target.querySelectorAll(".rules-toc a")],sectionsEls=[...target.querySelectorAll(".rules-section")];
  links.forEach(link=>link.addEventListener("click",()=>links.forEach(item=>item.classList.toggle("active",item===link))));
  if("IntersectionObserver" in window){const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){const active=links.find(link=>link.getAttribute("href")==="#"+entry.target.id);if(active)links.forEach(link=>link.classList.toggle("active",link===active));}}),{rootMargin:"-18% 0px -68% 0px"});sectionsEls.forEach(section=>observer.observe(section));}
}

const LOTTERY_HISTORY = {
  2021: ["Tanz","Kev","Colb","Lee","Ben","Joey","Evan","Butta","Pat","Marc"],
  2022: ["Schmeef","Ben","Pat","Butta","Lee","Marc","Colb","Ders","Evan","Tanz","Kev","Joey"],
  2023: ["Kev","Marc","Tanz","Pat","Schmeef","Ders","Ben","Lee","Evan","Colb","Joey","Butta"],
  2024: ["Butta","Ders","Evan","Kev","Marc","Colb","Ben","Tanz","Joey","Pat","Lee","Schmeef"],
  2025: ["Marc","Butta","Colb","Brandon","Tanz","Pat","Kev","Evan","Joey","Ders","Ben","Lee"],
  2026: ["Pat","Evan","Ben","Lee","Ders","Marc","Brandon","Tanz","Colb","Butta","Joey","Kev"]
};
const LOTTERY_NAMES = { Kev:"Kevin", Colb:"Colby" };
function lotteryName(name) { return LOTTERY_NAMES[name] || name; }
function lotteryLuck(position, fieldSize) { return (fieldSize + 1) / 2 - position; }
const LOTTERY_MANAGER_COLORS = ["#20b9d7","#ff4f91","#9a68ff","#e8b83d","#50c99a","#f0784f","#b5a0ff","#5dc4ee","#e47eb4","#a7d86c","#f1a34c","#8d9cf5"];
function lotteryColor(name) {
  const names = [...new Set(Object.values(LOTTERY_HISTORY).flat().map(lotteryName))].sort();
  return LOTTERY_MANAGER_COLORS[Math.max(0,names.indexOf(lotteryName(name))) % LOTTERY_MANAGER_COLORS.length];
}
function renderLotteryHistory() {
  const years=Object.keys(LOTTERY_HISTORY).map(Number).sort((a,b)=>b-a);
  const current=LOTTERY_HISTORY[2026];
  const draftSlots=state.actualDraftSlots || new Map();
  const fieldSize=current.length;
  const currentRows=current.map((name,index)=>{
    const manager=lotteryName(name);
    const luck=lotteryLuck(index+1,fieldSize);
    const slot=draftSlots.get(manager);
    const luckClass=luck>0?"up":luck<0?"dn":"even";
    const luckLabel=luck>0?"▲ "+Math.round(luck):luck<0?"▼ "+Math.abs(Math.round(luck)):"—";
    return '<div class="ds-row"><span class="ds-pk">'+(index===0?'🏆':String(index+1))+'</span><span class="ds-tm"><span class="ds-dot" style="background:'+lotteryColor(manager)+'"></span><span style="color:'+lotteryColor(manager)+'">'+escapeHtml(manager)+'</span></span><span class="ds-mv '+luckClass+'">'+luckLabel+'</span><span class="ds-slot"><span class="pill">'+(slot?'#'+slot:'—')+'</span></span></div>';
  }).join("");
  $("lottery-current-results").innerHTML=currentRows;

  const totals=new Map();
  for(const [year,draw] of Object.entries(LOTTERY_HISTORY)){
    draw.forEach((name,index)=>{
      const manager=lotteryName(name);
      // Schmeef remains in the historical results but is excluded
      // from the current league's luck leaderboard.
      if(manager==="Schmeef") return;
      const entry=totals.get(manager)||{name:manager,years:0,luck:0};
      entry.years++;
      entry.luck+=lotteryLuck(index+1,draw.length);
      totals.set(manager,entry);
    });
  }
  const leaderboard=[...totals.values()].sort((a,b)=>b.luck-a.luck||a.name.localeCompare(b.name));
  const maxAbs=Math.max(1,...leaderboard.map(entry=>Math.abs(entry.luck)));
  $("lottery-luck-list").innerHTML=leaderboard.map(entry=>{
    const positive=entry.luck>=0;
    const width=Math.abs(entry.luck)/maxAbs*46;
    const fill=entry.luck>0
      ? '<span class="ls-fill up" style="left:50%;width:'+width+'%"></span>'
      : entry.luck<0
        ? '<span class="ls-fill dn" style="right:50%;width:'+width+'%"></span>'
        : '';
    return '<div class="ls-luck"><span class="ls-lnm" style="color:'+lotteryColor(entry.name)+'">'+escapeHtml(entry.name)+'</span><span class="ls-track"><span class="ls-axis"></span>'+fill+'</span><span class="ls-lval '+(positive?'up':'dn')+'">'+(entry.luck>0?'+':'')+entry.luck.toFixed(1)+'</span></div>';
  }).join("");

  $("lottery-history").innerHTML=years.map(year=>{
    const draw=LOTTERY_HISTORY[year];
    return '<article class="lottery-year-card"><div class="lottery-year-heading"><strong>'+year+'</strong><span>'+draw.length+' MANAGERS</span></div>'+draw.map((name,index)=>{
      const luck=lotteryLuck(index+1,draw.length);
      return '<div class="lottery-history-row"><span>'+String(index+1).padStart(2,"0")+'</span><strong>'+escapeHtml(lotteryName(name))+'</strong><small class="'+(luck>0?'luck-positive':luck<0?'luck-negative':'')+'">'+(luck>0?'+':'')+luck.toFixed(1)+'</small></div>';
    }).join("")+'</article>';
  }).join("");
}
async function loadActualDraftOrder() {
  const target=$("actual-draft-order");
  try {
    const drafts=await fetchJson('/league/'+LEAGUE_ID+'/drafts');
    if(!Array.isArray(drafts)||!drafts.length) throw new Error("No Sleeper draft found for this league.");
    const draft=[...drafts].sort((a,b)=>Number(b.season||0)-Number(a.season||0))[0];
    state.draftSeason=draft.season||"CURRENT";
    let ordered=[];
    if(draft.draft_order && typeof draft.draft_order==="object"){
      const usersById=new Map(state.users.map(user=>[String(user.user_id),user]));
      ordered=Object.entries(draft.draft_order).map(([userId,slot])=>{
        const user=usersById.get(String(userId));
        const username=String(user?.username||"").toLowerCase();
        const displayName=String(user?.display_name||"").toLowerCase();
        const manager=MANAGERS[username]||MANAGERS[displayName]||user?.display_name||user?.username||"Manager";
        return {slot:Number(slot),manager};
      }).filter(item=>Number.isFinite(item.slot)).sort((a,b)=>a.slot-b.slot);
    }
    if(!ordered.length && draft.slot_to_roster_id){
      ordered=Object.entries(draft.slot_to_roster_id).map(([slot,rosterId])=>({slot:Number(slot),manager:state.teams.get(Number(rosterId))?.name||"Manager"})).sort((a,b)=>a.slot-b.slot);
    }
    if(!ordered.length && draft.draft_id){
      const picks=await fetchJson('/draft/'+draft.draft_id+'/picks');
      const firstRound=picks.filter(p=>Number(p.round)===1).sort((a,b)=>Number(a.pick_no)-Number(b.pick_no));
      ordered=firstRound.map((pick,index)=>({slot:index+1,manager:state.teams.get(Number(pick.roster_id))?.name||"Manager"}));
    }
    if(!ordered.length) throw new Error("Sleeper did not return a draft-slot order.");
    state.actualDraftSlots=new Map(ordered.map(item=>[lotteryName(item.manager),item.slot]));
    $("draft-order-season").textContent=String(state.draftSeason)+" SLEEPER DRAFT";
    $("draft-order-count").textContent=ordered.length+" / 12";
    target.innerHTML=ordered.map(item=>'<div class="dob-slot"><span class="dob-n">#'+item.slot+'</span><span class="dob-dot" style="background:'+lotteryColor(item.manager)+'"></span><span class="dob-nm" style="color:'+lotteryColor(item.manager)+'">'+escapeHtml(item.manager)+'</span></div>').join("");
    renderLotteryHistory();
  } catch(error) {
    console.warn("Unable to load Sleeper draft order",error);
    $("draft-order-count").textContent="— / 12";
    target.innerHTML='<div class="lottery-empty">Draft order is not available from Sleeper yet.</div>';
    renderLotteryHistory();
  }
}

function setupNavigation() {
  const tabs = [...document.querySelectorAll(".nav-tab")];
  const panels = [...document.querySelectorAll(".tab-panel")];
  tabs.forEach(tab => tab.addEventListener("click", () => {
    const target = tab.dataset.tab;
    tabs.forEach(item => item.classList.toggle("active", item === tab));
    panels.forEach(panel => {
      const visible = panel.dataset.panel === target;
      panel.hidden = !visible;
    });
    if (target === "rules") renderRules();
    if (target === "schedule") renderSchedule();
    if (target === "matchups") renderMatchups(state.matchupWeek);
    if (target === "lottery") renderLotteryHistory();
    if (target === "rankings") renderPowerRankings(state.selectedWeek);
    window.scrollTo({top:0,behavior:"smooth"});
  }));
}
setupNavigation();

init();