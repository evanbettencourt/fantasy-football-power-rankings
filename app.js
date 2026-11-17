const LEAGUE_ID = "1313563024161787904";
const API = "https://api.sleeper.app/v1";
const $ = (id) => document.getElementById(id);
const state = { league: null, users: [], rosters: [], weeks: {}, selectedWeek: 1, rankingsByWeek: {} };

const num = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
const fmt = (v) => num(v).toFixed(1);
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
  return Math.max(1, Math.min(18, playoffStart - 1));
}
async function fetchJson(path) {
  const response = await fetch(`${API}${path}`);
  if (!response.ok) throw new Error(`Sleeper API returned ${response.status} for ${path}`);
  return response.json();
}
function buildTeams() {
  const userById = new Map(state.users.map(u => [u.user_id, u]));
  state.teams = new Map();
  for (const roster of state.rosters) {
    const owner = userById.get(roster.owner_id);
    const metadata = owner?.metadata || {};
    const name = metadata.team_name || owner?.display_name || owner?.username || `Team ${roster.roster_id}`;
    state.teams.set(Number(roster.roster_id), {
      id: Number(roster.roster_id), name, owner: owner?.display_name || owner?.username || "",
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
  const teams = [...state.teams.values()].map(t => ({...t, wins:0,losses:0,ties:0,pf:0,pa:0,allPlayWins:0,allPlayGames:0,scores:[]}));
  const byId = new Map(teams.map(t => [t.id,t]));
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
      for (const t of teams) {
        const score = matchups.find(m => Number(m.roster_id) === t.id);
        if (!score || num(score.points) <= 0) continue;
        for (const opponent of valid) {
          if (Number(opponent.roster_id) === t.id) continue;
          const opponentScore = num(opponent.points);
          t.allPlayGames++;
          if (num(score.points) > opponentScore) t.allPlayWins++;
          else if (num(score.points) === opponentScore) t.allPlayWins += .5;
        }
      }
    }
  }
  const maxPf = Math.max(1,...teams.map(t=>t.pf));
  const games = Math.max(1,week);
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
  }
  return teams.sort((a,b)=>b.power-a.power || b.pf-a.pf);
}
function calculateMovement(week, rankings) {
  if (week <= 1) return rankings.map((t,i)=>({...t,move:null}));
  const previous = state.rankingsByWeek[week-1] || computeRankings(week-1);
  const previousRanks = new Map(previous.map((t,i)=>[t.id,i+1]));
  return rankings.map((t,i)=>({...t,move:(previousRanks.get(t.id) || i+1)-(i+1)}));
}
function renderRankings(week) {
  const rankings = calculateMovement(week, state.rankingsByWeek[week] || computeRankings(week));
  state.rankingsByWeek[week] = rankings;
  $("rankings-body").innerHTML = rankings.map((t,i)=>{
    const move = t.move == null ? "—" : t.move > 0 ? `↑ ${t.move}` : t.move < 0 ? `↓ ${Math.abs(t.move)}` : "—";
    const moveClass = t.move > 0 ? "up" : t.move < 0 ? "down" : "same";
    return `<tr><td class="rank-number">${String(i+1).padStart(2,"0")}</td><td><div class="team-cell">${avatarMarkup(t)}<div><span class="team-name">${teamName(t)}</span><span class="sub-name">${escapeHtml(t.owner)}</span></div></div></td><td class="record">${t.record}</td><td class="points">${fmt(t.pf)}</td><td class="allplay">${Math.round(t.allPlayRate*100)}%</td><td class="power-cell"><div class="power-line"><span class="power-value">${Math.round(t.power)}</span><span class="bar"><span style="width:${Math.max(0,Math.min(100,t.power))}%"></span></span></div></td><td class="movement ${moveClass}">${move}</td></tr>`;
  }).join("");
  return rankings;
}
function renderScoreboard(week) {
  const {results} = calculateWeek(week);
  const el = $("scoreboard");
  if (!results.length) { el.innerHTML = '<div class="empty-note">No completed matchups found for this week yet.</div>'; return; }
  el.innerHTML = results.sort((a,b)=>Math.max(b.scoreA,b.scoreB)-Math.max(a.scoreA,a.scoreB)).map(m=>`
    <div class="matchup">
      <div class="match-team">${avatarMarkup(m.a)}<span class="match-team-name">${teamName(m.a)}</span></div>
      <div class="match-score ${m.winner===1?'winner':''}">${fmt(m.scoreA)} <span class="versus">—</span> <span class="${m.winner===2?'winner':''}">${fmt(m.scoreB)}</span></div>
      <div class="match-team">${avatarMarkup(m.b)}<span class="match-team-name">${teamName(m.b)}</span></div>
    </div>`).join("");
}
function renderStandings(week) {
  const standings = [...state.teams.values()].map(t=>({...t,wins:0,losses:0,ties:0,pf:0,pa:0}));
  const map = new Map(standings.map(t=>[t.id,t]));
  for (let w=1;w<=week;w++) {
    const groups = new Map();
    for (const m of state.weeks[w] || []) {
      if (!groups.has(m.matchup_id)) groups.set(m.matchup_id,[]);
      groups.get(m.matchup_id).push(m);
    }
    for (const group of groups.values()) {
      if (group.length!==2 || group.some(m=>num(m.points)<=0)) continue;
      const [a,b]=group,ta=map.get(Number(a.roster_id)),tb=map.get(Number(b.roster_id));
      if (!ta||!tb) continue;
      ta.pf+=num(a.points);tb.pf+=num(b.points);ta.pa+=num(b.points);tb.pa+=num(a.points);
      if(num(a.points)>num(b.points)){ta.wins++;tb.losses++}else if(num(a.points)<num(b.points)){tb.wins++;ta.losses++}else{ta.ties++;tb.ties++}
    }
  }
  standings.sort((a,b)=>b.wins-a.wins || b.pf-a.pf);
  $("standings-body").innerHTML=standings.map((t,i)=>`<tr><td>${i+1}</td><td class="standings-team">${teamName(t)}</td><td>${t.wins}-${t.losses}${t.ties?`-${t.ties}`:""}</td><td>${fmt(t.pf)}</td><td>${fmt(t.pa)}</td></tr>`).join("");
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
  const rankings=renderRankings(week);
  renderScoreboard(week);
  renderStandings(week);
  renderStats(week,rankings);
  $("week-select").value=String(week);
  $("status").textContent=`CONNECTED · ${state.teams.size} TEAMS · DATA THROUGH WEEK ${week}`;
}
async function init() {
  try {
    const [league,users,rosters]=await Promise.all([
      fetchJson(`/league/${LEAGUE_ID}`),fetchJson(`/league/${LEAGUE_ID}/users`),fetchJson(`/league/${LEAGUE_ID}/rosters`)
    ]);
    state.league=league;state.users=users;state.rosters=rosters;buildTeams();
    const season=league.season||"2026";
    $("season-label").textContent=`${season} SLEEPER LEAGUE`;
    $("season-tag").textContent=`${season} SEASON`;
    const maxWeek=getWeeksToLoad();
    const weeks=await Promise.all(Array.from({length:maxWeek},(_,i)=>i+1).map(async w=>[w,await fetchJson(`/league/${LEAGUE_ID}/matchups/${w}`)]));
    for(const [week,data] of weeks) state.weeks[week]=data;
    const completed=Array.from({length:maxWeek},(_,i)=>i+1).filter(w=>(state.weeks[w]||[]).some(m=>num(m.points)>0));
    const defaultWeek=completed.length?Math.max(...completed):1;
    const select=$("week-select");
    select.innerHTML=Array.from({length:maxWeek},(_,i)=>`<option value="${i+1}">WEEK ${i+1}</option>`).join("");
    select.addEventListener("change",()=>renderWeek(Number(select.value)));
    renderWeek(defaultWeek);
    $("updated-at").textContent="SLEEPER API · PUBLIC LEAGUE DATA";
  } catch(error) {
    console.error(error);
    $("status").textContent="COULD NOT LOAD LEAGUE DATA · PLEASE REFRESH";
    $("status").classList.add("error");
    $("rankings-body").innerHTML='<tr><td colspan="7" class="loading-cell">Unable to connect to Sleeper. Check the league ID and try again.</td></tr>';
    $("scoreboard").innerHTML='<div class="empty-note">Matchups unavailable.</div>';
    $("standings-body").innerHTML='<tr><td colspan="5" class="loading-cell">Standings unavailable.</td></tr>';
  }
}
init();