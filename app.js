const LEAGUE_ID = "1313563024161787904";
const API = "/api/sleeper";
const $ = (id) => document.getElementById(id);
const state = { league: null, users: [], rosters: [], weeks: {}, selectedWeek: 1, rankingsByWeek: {}, failedWeeks: [], recoveredWeeks: [], usingCachedCore: false, draftOrder: null, draftSeason: null };

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
      const response = await fetch(API + path, { signal: controller.signal, headers: { "Accept": "application/json" } });
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
      { manager: "Ben", note: "Twelve straight wins. That is no longer a hot streak; that's a hostile takeover. Ben has spent the last several weeks making the rest of the league look like they're playing for second, and the latest addition of Jaxon Smith-Njigba only makes the top team tougher to catch. The scary part is that this doesn't feel like a fluky run built on one ridiculous Sunday. The weekly results have been there, the roster has the depth to absorb a bad week, and nobody has found a way to slow him down. At this point, the question is less 'Can Ben be beaten?' and more 'Who is volunteering to try?'" },
      { manager: "Marc", note: "Marc is quietly putting together the kind of season that gets overlooked when somebody else is busy winning twelve straight. He's 15-5, near the top in all-play, and has consistently looked like one of the league's safest bets from week to week. Jonathan Taylor gives him a weekly hammer, and the rest of the roster has enough quality to keep the floor high. There isn't a dramatic crisis or a flashy midseason rescue mission here — just a contender doing contender things. Annoyingly competent, which is usually a good sign." },
      { manager: "Kevin", note: "Kevin still has the league's highest point total, so nobody should mistake the recent injury trouble for a lack of firepower. But losing Puka Nacua at this stage is a major problem, and the timing could not be much worse with the playoff race tightening. The 15-5 record gives him some breathing room, but the next few weeks will test whether that scoring lead can survive without one of its biggest engines. This is the classic fantasy dilemma: the points say powerhouse, the injury report says 'please hold.'" },
      { manager: "Colby", note: "Colby has the ingredients to be a real problem in the playoffs, but the weekly floor has been harder to trust than the talent suggests. The skill-position core can absolutely carry a matchup, yet the unsettled quarterback situation keeps putting a ceiling on how much confidence to place in this team. If that spot stabilizes, Colby has the firepower to make a run. If it doesn't, we're going to spend the next month watching a very good roster try to win games on hard mode." },
      { manager: "Brandon", note: "Brandon might be the league's most frustrating team to play against — and possibly to manage. He's second in points and tied for the best all-play record, yet Week 10 still ended with a loss to Pat. That's the schedule-luck tax: you can put up one of the league's best weekly profiles and still get handed an L when somebody decides to post 140.08. Ja'Marr Chase gives Brandon the kind of weekly ceiling that can flip a matchup by himself. The underlying numbers say contender; the standings haven't always sent the thank-you note." },
      { manager: "Evan", note: "Evan sits in the middle of the pack, but the roster has a higher ceiling than that might suggest. Jahmyr Gibbs and Derrick Henry give him a formidable one-two punch, and Malik Nabers is the kind of difference-maker who can change a week. The problem has been getting the full lineup to show up together often enough. A return from Mike Evans would be a meaningful boost, but this team needs more than a healthier Sunday or two — it needs a stretch where the results finally match the names at the top of the roster." },
      { manager: "Joey", note: "Joey's week was about the trade, and for once the trade actually gives us something fun to talk about. Landing both Tee Higgins and George Pickens is a substantial upgrade, and it gives Joey a much more dangerous group of weekly options. The move raises the ceiling immediately, but it also puts the pressure on the rest of the lineup to keep up. Joey has made his bet; now we get to see whether the new-look roster turns into wins or just a very impressive group chat screenshot." },
      { manager: "Pat", note: "Pat didn't just beat Brandon — he dropped 140.08 and took home the week's top score. That's the sort of Sunday that makes the rest of the league check the app twice. It's a timely reminder that this roster has a legitimate ceiling, especially with Christian McCaffrey leading the way. The big question is whether Pat can get enough consistency around that star power, particularly while Lamar Jackson's recovery remains uncertain. One monster week doesn't erase the concerns, but it does make Pat a much less comfortable matchup than the ranking suggests." },
      { manager: "Lee", note: "Lee has reached the point where the roster needs to stop winning the preseason argument and start winning actual matchups. Bijan Robinson and Justin Jefferson are excellent building blocks, but a 7-13 record leaves very little room for another 'next week will be different.' The schedule hasn't been kind in every spot, but the standings don't hand out style points for having recognizable names. Lee needs a run, and needs it now. The playoff math is getting less friendly by the week." },
      { manager: "Butta", note: "Drake Maye's serious ankle injury is the biggest blow to Butta's outlook this week. A possible fracture and the threat of an extended absence leave a major hole at quarterback, and the uncertainty is especially painful for a team that needs every bit of its weekly firepower. A.J. Brown's situation only adds to the concern. Butta still has talent, but losing Maye changes the equation — and makes the path back up the rankings a lot tougher." },
      
      { manager: "Ders", note: "Ders is running out of runway. At 3-17, the season has become less about projecting what this roster could be and more about finding wins immediately. Josh Allen gives him a weekly path to a big score, but the lineup has not delivered enough complete performances to turn that ceiling into results. The injury situation around key contributors hasn't helped, and every missed opportunity now carries extra weight. There's still time on the calendar, but the standings are starting to look like a countdown clock." },
      { manager: "Tanz", note: "The playoff race is officially over for Tanz, so the mission has changed: avoid finishing last. The three-team trade made that job harder immediately, costing him two wins this week — not exactly the debut you draw up for a roster shake-up. And then there's the parlay situation. As the league's lowest scorer, Tanz has to put together the league's $5 parlay, with every manager contributing one pick. He's already had that responsibility more times than anyone else, and he's tracking toward a record-setting season in the role. At this point, the goal is simple: win some games, climb out of the basement, and maybe give himself a week off from being the league's designated parlay organizer." }
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
  const maxWeek=getWeeksToLoad(),archive=$("pr-archive"),select=$("week-select"),edition=EDITORIAL_EDITIONS[week];
  if(select)select.value=String(week);
  if(archive){
    archive.innerHTML='<button type="button" class="pr-archive-item" data-week="0"><span>Post-Draft</span><small>September 2026</small></button>'+Array.from({length:maxWeek},(_,i)=>maxWeek-i).map(w=>'<button type="button" class="pr-archive-item '+(w===week?'active':'')+'" data-week="'+w+'"><span>Week '+String(w).padStart(2,"0")+'</span><small>'+(EDITORIAL_EDITIONS[w]?.date||'Edition pending')+'</small></button>').join("");
    archive.querySelectorAll("button").forEach(btn=>btn.addEventListener("click",()=>{const w=Number(btn.dataset.week);if(w===0){$("pr-week-title").textContent="Post-Draft";$("pr-edition-label").textContent="SEPTEMBER 2026";$("pr-board").innerHTML='<div class="pr-empty"><strong>POST-DRAFT RANKINGS</strong><p>The post-draft editorial edition has not been added yet.</p></div>';$("pr-rank-count").textContent="POST-DRAFT";archive.querySelectorAll("button").forEach(x=>x.classList.toggle("active",x===btn));const b=$("pr-reveal");if(b)b.hidden=true;}else renderPowerRankings(w);}));
  }
  $("pr-week-title").textContent="Week "+week;
  $("pr-edition-label").textContent=edition?.date||"EDITION PENDING";
  const stats=computeRankings(week),byName=new Map(stats.map(t=>[t.name,t])),previous=EDITORIAL_EDITIONS[week-1]?.rankings||[],priorRanks=new Map(previous.map((r,i)=>[r.manager,i+1])),hasEdition=Boolean(edition?.rankings?.length);
  const palette=["#5B21B6","#F4C13E","#F74193","#39A7E3","#E4002B","#EE6A5B","#17B8A6","#034694","#6FC24A","#EF8E3C","#B499D3","#909090"];
  const teamOrder=[...state.teams.keys()];
  const colorFor=t=>t?.color||palette[Math.max(0,teamOrder.indexOf(t?.id))%palette.length];
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
  $("pr-rank-count").textContent=hasEdition?edition.rankings.length+" / 12 RANKED":"12 MANAGERS";
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
  $("pr-standings-body").innerHTML=standings.map((t,i)=>{
    const color=colorFor(t),rank=editorialRanks.get(t.name),record=t.record.split("-");
    return '<tr class="'+(i===6?"pr-cut":"")+'"><th scope="row" class="c-team"><span class="sd">'+(i+1)+'</span><span class="nm" style="color:'+color+'">'+escapeHtml(t.name)+'</span></th>'+
      '<td class="c-rec"><span class="w">'+(record[0]||0)+'</span><span class="dash">-</span><span class="l">'+(record[1]||0)+'</span>'+(record[2]?'<span class="dash">-</span><span>'+record[2]+'</span>':'')+'</td>'+
      '<td class="num">'+fmt(t.pf)+'</td><td class="num">'+fmt(t.pa)+'</td><td class="num">'+escapeHtml(t.allPlayRecord)+'</td>'+
      '<td><span class="pr-pr">'+(rank||"—")+'</span></td></tr>';
  }).join("");
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
  const weekData=calculateWeek(week);
  const scores=(state.weeks[week]||[]).filter(m=>num(m.points)>0);
  const high=scores.sort((a,b)=>num(b.points)-num(a.points))[0];
  const average=scores.length?scores.reduce((s,m)=>s+num(m.points),0)/scores.length:0;
  $("top-team").textContent=rankings[0]?.name||"—";
  $("top-team-foot").textContent=rankings[0]? `RANKED #1 · ${Math.round(rankings[0].power)} POWER`:"POWER INDEX LEADER";
  $("weekly-high").textContent=high?fmt(high.points):"—";
  $("weekly-high-foot").textContent=high?teamFor(high.roster_id)?.name||"WEEKLY HIGH":"NO SCORES YET";
  $("biggest-riser").textContent="—";$("biggest-riser-foot").textContent="NO MOVEMENT DATA";
  const riser=rankings.filter(t=>t.move>0).sort((a,b)=>b.move-a.move)[0];
  if(riser){$("biggest-riser").textContent=riser.name;$("biggest-riser-foot").textContent=`UP ${riser.move} ${riser.move===1?"SPOT":"SPOTS"}`;}
  $("league-average").textContent=average?fmt(average):"—";
  if(!average)$("league-average").textContent="—";
  if(weekData.played && rankings.length){
    const best=rankings[0],worst=rankings[rankings.length-1];
    const topScore=high?fmt(high.points):"";
    const rankMove=riser?`${riser.name} made the biggest move, climbing ${riser.move} place${riser.move===1?"":"s"}.`:"The power rankings held relatively steady this week.";
    $("takeaway").textContent=`${best.name} sits atop the Power Index, while ${worst.name} has work to do from the bottom. ${rankMove} The week's high score was ${topScore} by ${teamFor(high.roster_id)?.name || "a league team"}.`;
  } else $("takeaway").textContent="The league story will take shape once this week's matchups are complete. Check back after the scores are in.";
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
    const completed = Array.from({ length: maxWeek }, (_, index) => index + 1).filter(week => (state.weeks[week] || []).some(match => num(match.points) > 0));
    const defaultWeek = completed.length ? Math.max(...completed) : 1;
    const select = $("week-select");
    select.innerHTML = Array.from({ length: maxWeek }, (_, index) => `<option value="${index + 1}">WEEK ${index + 1}</option>`).join("");
    select.addEventListener("change", () => renderPowerRankings(Number(select.value)));
    renderWeek(defaultWeek); renderPowerRankings(defaultWeek);
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
function renderSchedule() {
  const rows = [];
  for (let week=1; week<=getWeeksToLoad(); week++) {
    const games = calculateWeek(week).results;
    for (const game of games) rows.push(`<div class="schedule-row"><span class="schedule-week">W${week}</span><span>${teamName(game.a)} <small>${escapeHtml(game.a.owner)}</small></span><strong>${fmt(game.scoreA)} – ${fmt(game.scoreB)}</strong><span>${teamName(game.b)} <small>${escapeHtml(game.b.owner)}</small></span></div>`);
  }
  $("schedule-content").innerHTML = rows.length ? rows.join("") : '<p class="empty-note">No completed schedule data yet.</p>';
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
    ["Miscellaneous league rules",
      '<h3>Rule changes</h3><ul><li>All league rules are open to be changed from the end of the fantasy football season until draft night of the following fantasy football season.</li><li>If a league member proposes a new rule, a Sleeper poll will be created to cast votes for the proposal. A simple majority (&gt;50%) of league members must vote in favor of a proposed change for it to occur.</li><li>Exception for rules related to buy in or payout, where a supermajority (&gt;2/3) of league members must vote in favor of a proposed change for it to occur.</li></ul><h3>Buy in</h3><ul><li>$50 per person</li><li>Must be paid to league commissioner by draft day</li></ul><h3>Payout</h3><ul><li>First place playoffs: $300 (50% of pot)</li><li>Second place playoffs: $180 (30% of pot)</li><li>First place regular season: $120 (20% of pot)</li></ul><h3>Last place punishment</h3><ul><li>Last place punishment for the season will be agreed upon by all league mates prior to the draft</li><li>The team that finishes last place in the regular season is considered last place</li><li>Punishment must be completed prior to the next season’s draft lottery date. If it is not, that league mate will automatically be assigned last position in the draft lottery AND forfeit their first round draft pick</li></ul>'],
    ["General settings",
      '<ul><li>League type: Redraft</li><li>Teams: 12</li><li>Lineup type: Classic</li><li>Waiver order: FAAB</li><li>Waiver budget: 100</li><li>Minimum bid: 0</li><li>Show FAAB suggestions: Off</li><li>After games waivers clear: 3 AM Wednesday</li><li>Time players are on waivers after drop: 1 day</li><li>Allow custom daily waivers: On — Monday: Free agency; Tuesday: Locked; Wednesday, Thursday, Friday, and Saturday: Waivers; Sunday: Free agency</li><li>Time to review pending trades: None</li><li>Trade deadline: None (in app) — Once a given team is mathematically eliminated from the playoffs, they are only allowed to trade with other mathematically eliminated teams.</li><li>Player auto-subs: 1</li><li>Require auto-sub to not play before starter: On</li><li>Lock auto-sub if starter active: Off</li><li>Allow draft pick trading: Off</li><li>Extra game each week against league median: On</li><li>Prevent bench players from being dropped after game starts: Off</li></ul>'],
    ["Roster",
      '<h3>Starters</h3><ul><li>1 QB</li><li>2 RB</li><li>2 WR</li><li>1 TE</li><li>1 Flex (RB/WR/TE)</li><li>1 Superflex (QB/RB/WR/TE)</li></ul><ul><li>6 bench</li><li>2 injured reserve</li></ul><h3>Injured reserve eligibility</h3><p>Players eligible for injured reserve include IR, PUP, and OUT. All other players are ineligible, including COVID players, Out players, Suspended players, NA players, DNR/Holdout players, and Doubtful players.</p>'],
    ["Draft",
      '<ul><li>Draft start time: TBD by league determination</li><li>Autostart draft: Enabled</li><li>Draft type: Snake</li><li>Available players to draft: All players</li><li>Time per pick: 1.5 minutes</li><li>CPU Autopick: Enabled</li></ul><h3>Draft order determination</h3><ul><li>Random wheel spinner creates an “order” of league members</li><li>League members select draft spot in that order starting ~2 weeks before the draft day, giving each league member ~1 day to make their decision</li></ul>'],
    ["Playoffs",
      '<ul><li>Playoff weeks: 15, 16, 17</li><li>Playoff teams: 6</li><li>Playoff seed tiebreaker: Points forced</li><li>Playoff weeks per round: One week per round</li><li>Playoff seeding rules: Re-seed</li><li>Playoffs lower bracket type: Toilet bowl</li><li>Playoff matchup tiebreaker: Higher seed advances</li></ul>'],
    ["Scoring",
      '<h3>Passing</h3><div class="rule-kicker">Active measures</div><ul><li>Passing yards: 1 point every 25 yards (+0.04 per yard)</li><li>Passing TD: 4</li><li>2-Pt conversion: 2</li><li>Pass intercepted: -2</li></ul><div class="rule-kicker">Inactive measures</div><ul><li>Passing 1st down</li><li>Pick 6 thrown</li><li>Pass completed</li><li>Incomplete pass</li><li>Pass attempts</li><li>QB sacked</li><li>40+ yard completion bonus</li><li>40+ yard pass TD bonus</li><li>50+ yard pass TD bonus</li></ul><h3>Rushing</h3><div class="rule-kicker">Active measures</div><ul><li>Rushing yards: 1 point every 10 yards (+0.1 per yard)</li><li>Rushing TD: 6</li><li>2-Pt conversion: 2</li></ul><div class="rule-kicker">Inactive measures</div><ul><li>Rushing 1st down</li><li>Rush attempts</li><li>40+ yard rush bonus</li><li>40+ yard rush TD bonus</li><li>50+ yard rush TD bonus</li></ul><h3>Receiving</h3><div class="rule-kicker">Active measures</div><ul><li>Reception: 0.5</li><li>Receiving yards: 1 point every 10 yards (+0.1 per yard)</li><li>Receiving TD: 6</li><li>2-Pt conversion: 2</li></ul><div class="rule-kicker">Inactive measures</div><ul><li>Receiving 1st down</li><li>0-4 yard reception bonus</li><li>5-9 yard reception bonus</li><li>10-19 yard reception bonus</li><li>20-29 yard reception bonus</li><li>30-39 yard reception bonus</li><li>40+ yard reception bonus</li><li>40+ yard reception TD bonus</li><li>50+ yard reception TD bonus</li><li>Reception bonus - RB</li><li>Reception bonus - WR</li><li>Reception bonus - TE</li></ul><h3>Kicking</h3><div class="rule-kicker">Active measures</div><ul><li>FG made: 3</li><li>PAT made: 1</li></ul><div class="rule-kicker">Inactive measures</div><ul><li>FG made (0-19 yards)</li><li>FG made (20-29 yards)</li><li>FG made (30-39 yards)</li><li>FG made (40-49 yards)</li><li>FG made (50-59 yards)</li><li>FG made (50+ yards)</li><li>FG made (60+ yards)</li><li>Points per FG yard</li><li>Points per FG yard over 30</li><li>FG missed</li><li>FG missed (0-19 yards)</li><li>FG missed (20-29 yards)</li><li>FG missed (30-39 yards)</li><li>FG missed (40-49 yards)</li><li>FG missed (50-59 yards)</li><li>FG missed (50+ yards)</li><li>FG missed (60+ yards)</li><li>PAT missed</li></ul><h3>Team Defense</h3><p>Scoring settings are unnecessary since team defenses are not on the current league roster settings.</p><h3>Special Teams</h3><p>Scoring settings are unnecessary since team defenses are not on the current league roster settings.</p><h3>Special Teams Player</h3><div class="rule-kicker">Inactive measures</div><ul><li>Special teams player TD</li><li>Special teams player forced fumble</li><li>Special teams player fumble recovery</li><li>Special teams player solo tackle</li><li>Player punt return yards</li><li>Player kick return yards</li></ul><h3>Miscellaneous</h3><div class="rule-kicker">Active measures</div><ul><li>Fumble lost: -2</li><li>Fumble recovery TD: 6</li></ul><div class="rule-kicker">Inactive measures</div><ul><li>Fumble</li></ul><h3>Bonuses</h3><div class="rule-kicker">Inactive measures</div><ul><li>100-199 yard rushing game</li><li>200+ yard rushing game</li><li>100-199 yard receiving game</li><li>200+ yard receiving game</li><li>300-399 yard passing game</li><li>400+ yard passing game</li><li>100-199 combined rush + rec yards</li><li>200+ combined rush + rec yards</li><li>25+ pass completions</li><li>20+ carries</li><li>1st down bonus - RB</li><li>1st down bonus - WR</li><li>1st down bonus - TE</li><li>1st down bonus - QB</li></ul><h3>IDP</h3><p>Scoring settings are unnecessary since IDP are not on the current league roster settings.</p>'],
    ["Divisions",'<ul><li>Number of divisions: 0</li></ul>']
  ];
  target.innerHTML=sections.map((section,index)=>'<details class="rule-group" '+(index===0?'open':'')+'><summary>'+section[0]+'</summary><div class="rule-body">'+section[1]+'</div></details>').join("");
  target.dataset.ready="yes";
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
    if (target === "lottery") renderLotteryHistory();
    if (target === "rankings") renderPowerRankings(state.selectedWeek);
    window.scrollTo({top:0,behavior:"smooth"});
  }));
}
setupNavigation();

init();