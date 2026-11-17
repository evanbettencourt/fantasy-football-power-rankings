const LEAGUE_ID = "1313563024161787904";
const API = "https://api.sleeper.app/v1";
const $ = (id) => document.getElementById(id);
const state = { league: null, users: [], rosters: [], weeks: {}, selectedWeek: 1, rankingsByWeek: {} };

const num = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
const fmt = (v) => num(v).toFixed(2);
const MANAGERS = { khogan99:"Kevin", marcd9:"Marc", cjmyers210:"Colby", tajibhall:"Ben", itsdonk:"Brandon", turtmonk:"Evan", pgdoyle5:"Pat", joeysolomon:"Joey", abutta31:"Butta", lee2222:"Lee", dersnation:"Ders", tanzi14:"Tanz" };
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
    const username = owner?.username || "";
    const name = metadata.team_name || owner?.display_name || username || `Team ${roster.roster_id}`;
    state.teams.set(Number(roster.roster_id), {
      id: Number(roster.roster_id), name, owner: MANAGERS[username] || owner?.display_name || username, username,
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
          else if (num(score.points) === opponentScore) t.allPlayWins += .5;
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
 const row=(t,i)=>'<div class="league-team-row"><span class="team-rank">'+String(i+1).padStart(2,"0")+'</span><span class="team-color" style="--team-color:'+colors[i%colors.length]+'"></span><div class="league-team-identity"><strong>'+teamName(t)+'</strong><small>'+escapeHtml(t.owner)+'</small></div><span class="league-team-record">'+t.wins+'-'+t.losses+(t.ties?'-'+t.ties:'')+'</span></div>';
 $("playoff-standings").innerHTML=teams.slice(0,6).map(row).join("");
 $("bubble-standings").innerHTML=teams.slice(6).map((t,i)=>row(t,i+6)).join("");
}
function renderLeagueStatus(week){
 const max=getWeeksToLoad(),label=$("current-week-label"),phase=$("league-phase"),buttons=$("league-week-buttons");
 if(label)label.textContent="WEEK "+week;
 if(phase)phase.textContent=week>=15?"PLAYOFFS":"REGULAR SEASON";
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
  renderStandings(week);
  renderLeagueStatus(week);
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
    $("rankings-body").classList.add("rankings-hidden");
    $("updated-at").textContent="SLEEPER API · PUBLIC LEAGUE DATA";
  } catch(error) {
    console.error(error);
    $("status").textContent="COULD NOT LOAD LEAGUE DATA · PLEASE REFRESH";
    $("status").classList.add("error");
    $("rankings-body").innerHTML='<tr><td colspan="7" class="loading-cell">Unable to connect to Sleeper. Check the league ID and try again.</td></tr>';
    $("scoreboard").innerHTML='<div class="empty-note">Matchups unavailable.</div>';
    const standingsBody = $("standings-body");
    if (standingsBody) standingsBody.innerHTML='<tr><td colspan="5" class="loading-cell">Standings unavailable.</td></tr>';
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
    if (target === "rankings") { const rankings=renderRankings(state.selectedWeek); renderEditorial(state.selectedWeek,rankings); }
    window.scrollTo({top:0,behavior:"smooth"});
  }));
}
setupNavigation();
const reveal=$("reveal-button");
if(reveal) reveal.addEventListener("click",()=>{const body=$("rankings-body");const hidden=body.classList.toggle("rankings-hidden");reveal.textContent=hidden?"REVEAL RANKINGS":"HIDE RANKINGS";});

init();