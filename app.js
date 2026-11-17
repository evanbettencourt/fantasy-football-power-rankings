const LEAGUE_ID = "1313563024161787904";
const API = "/api/sleeper";
const $ = (id) => document.getElementById(id);
const state = { league: null, users: [], rosters: [], weeks: {}, selectedWeek: 1, rankingsByWeek: {}, failedWeeks: [], draftOrder: null, draftSeason: null };

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
async function fetchJson(path) {
  const response = await fetch(`${API}${path}`);
  if (!response.ok) throw new Error(`Sleeper API returned ${response.status} for ${path}`);
  return response.json();
}
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
      { manager: "Ben", note: "Ben takes over the top spot. He's second in the league in all-play record and has scored more points than anyone except Kevin and Brandon. The addition of Jaxon Smith-Njigba makes an already loaded roster even more dangerous, joining Saquon Barkley, James Cook, and Jameson Williams. There are some questions at quarterback and tight end, particularly with Kyler Murray out and Travis Kelce dealing with an ankle issue, but the overall talent and depth are hard to argue against. Ben looks like one of the most complete teams in the league." },
      { manager: "Marc", note: "Marc remains firmly in the championship conversation. He's tied for the league's best record and all-play mark, and his roster has a strong combination of established stars and depth. Jonathan Taylor, Nico Collins, Garrett Wilson, and Trey McBride provide an excellent foundation, while Kenneth Walker's expected return could give the running back group another major boost. Marc has been consistently good all season, and there's little reason to move him down." },
      { manager: "Kevin", note: "Kevin still has the league's best record and highest point total, but the injury situation has become difficult to ignore. Puka Nacua's absence until at least mid-December is a major blow, while Malik Willis is expected to miss at least three more games and could require surgery. David Montgomery is also dealing with an injury, although a Week 11 return is possible. The core of Breece Hall, CeeDee Lamb, Jordan Love, and George Kittle keeps Kevin among the league's best, but the roster is no longer as intimidating as it was a few weeks ago." },
      { manager: "Colby", note: "Colby has one of the strongest collections of skill-position talent in the league. Kyren Williams, Ashton Jeanty, Amon-Ra St. Brown, and Tetairoa McMillan give him plenty of firepower. The biggest concern remains quarterback, with Drew Lock currently in the lineup and Geno Smith and Sam Darnold both dealing with injuries. Geno could return as soon as Week 11, while Darnold is targeting Week 12. If either can provide consistent production, Colby has the pieces to make a serious run." },
      { manager: "Brandon", note: "Brandon continues to put together one of the league's best statistical seasons. He's second in points scored and tied for the best all-play record. Ja'Marr Chase, Chris Olave, and Chris Godwin give him an excellent group of receivers, while Dak Prescott provides stability at quarterback. T.J. Hockenson's potential return and the eventual availability of some injured depth pieces could help down the stretch. The loss to Pat in Week 10 was disappointing, but Brandon remains a very dangerous team." },
      { manager: "Evan", note: "Evan has a strong foundation with Jahmyr Gibbs, Derrick Henry, and Malik Nabers leading the way. The addition of Aaron Jones gives the running back group another option, while Jared Goff and Brock Purdy provide a solid quarterback combination. Mike Evans' potential return from his Achilles injury could be a major boost, although his timeline remains uncertain. Alec Pierce's lack of a clear return timeline is another concern. There's enough talent here to compete with the top teams, but the roster needs to stay healthy and produce more consistently." },
      { manager: "Joey", note: "Joey might be one of the biggest beneficiaries of the trade market this week. Acquiring Tee Higgins and George Pickens gives him a much stronger receiving group alongside Patrick Mahomes and Bo Nix. The biggest question is running back depth, but the addition of Kaleb Johnson and the possibility of Rhamondre Stevenson contributing give him some options. Joey still has work to do in the standings, but his roster looks considerably more competitive after the trade." },
      { manager: "Pat", note: "Pat delivered the biggest performance of Week 10, scoring 140.08 points and taking down Brandon. Christian McCaffrey and Chase Brown give him an excellent running back foundation, and Lamar Jackson could provide a huge boost if he manages to return for the fantasy playoffs. Unfortunately, Lamar's 6–10 week recovery timeline makes that far from certain. Ladd McConkey is also dealing with a back injury, and the receiving group has some question marks. Pat has upside, but needs more consistency from the rest of the roster." },
      { manager: "Butta", note: "Butta has plenty of talent, but injuries are making it difficult to put the best lineup on the field. Joe Burrow, Rashee Rice, Jaylen Waddle, A.J. Brown, and Sam LaPorta give the roster a high ceiling. However, Waddle's concussion situation, A.J. Brown's hamstring injury, Drake Maye's ankle injury, and Woody Marks' concussion create a lot of uncertainty. There's enough talent here to climb the rankings, but the team needs a healthier stretch to take advantage of it." },
      { manager: "Lee", note: "Lee might have one of the most frustrating rosters in the league. Bijan Robinson, Justin Jefferson, Alvin Kamara, Jayden Daniels, Davante Adams, and DeVonta Smith provide plenty of recognizable talent. Drake London has also cleared concussion protocol and should be available after the bye. The problem is that the results haven't matched the roster's potential. Davante Adams is targeting a Week 12 return, while DeVonta Smith's availability remains uncertain. Lee still has enough talent to be dangerous, but the season-long results make it difficult to rank him much higher." },
      { manager: "Ders", note: "Ders has some legitimate star power, including Josh Allen, Josh Jacobs, Drake London, DK Metcalf, and Brock Bowers. Jacobs has a realistic chance to return around Week 12, while Bowers is dealing with an ankle injury that could affect his availability. London has cleared concussion protocol, which is encouraging. There's more upside here than the record suggests, but a 3-17 record and 36-74 all-play mark are difficult to overlook. Ders needs a major turnaround to climb out of the bottom two." },
      { manager: "Tanz", note: "Tanz remains at the bottom, but the roster has undergone a significant transformation. The recent trades brought in Tony Pollard, Omarion Hampton, and Kenny Gainwell, among others. The three-team deal with Joey and Ben is particularly interesting because of what it could have meant for Week 10. Tanz finished just 1.21 points below the median and lost his matchup against Ben. Keeping George Pickens instead of acquiring Pollard could potentially have changed both results. The season is essentially beyond repair, but the roster is beginning to look different from the team that produced such a difficult first half." }
    ],
    headline: "Ben takes over No. 1 as injuries reshape the contender picture",
    feature: "The three-team trade involving Joey, Ben, and Tanz could have major implications for the rest of the season. Joey acquired Tee Higgins and George Pickens, giving him a major upgrade at receiver. Ben added Jaxon Smith-Njigba to an already deep roster. Tanz acquired Tony Pollard, but the immediate impact is especially interesting: he finished just 1.21 points below the league median and lost his matchup against Ben. Keeping Pickens instead of acquiring Pollard could have changed the outcome of his week, although the exact counterfactual depends on the lineup and player scores.",
    notes: [
      "Best weekly performance: Pat — 140.08 points",
      "Biggest win: Pat over Brandon",
      "Closest call: Tanz finished just 1.21 points below the median",
      "Biggest roster upgrade: Joey acquiring Tee Higgins and George Pickens",
      "Biggest ranking change: Ben takes over the No. 1 spot",
      "Team to watch: Kevin, as injuries to key players test the depth of the league's highest-scoring team"
    ]
  }
};
function renderPowerRankings(week) {
  state.selectedWeek=week;
  const maxWeek=getWeeksToLoad(),archive=$("pr-archive"),select=$("week-select"),edition=EDITORIAL_EDITIONS[week];
  if(select)select.value=String(week);
  if(archive){
    archive.innerHTML='<button type="button" class="pr-archive-item" data-week="0"><span>POST-DRAFT</span><small>WEEK 00</small></button>'+Array.from({length:maxWeek},(_,i)=>maxWeek-i).map(w=>'<button type="button" class="pr-archive-item '+(w===week?'active':'')+'" data-week="'+w+'"><span>WEEK '+w+'</span><small>'+(EDITORIAL_EDITIONS[w]?.date||'EDITION PENDING')+'</small></button>').join("");
    archive.querySelectorAll("button").forEach(btn=>btn.addEventListener("click",()=>{const w=Number(btn.dataset.week);if(w===0){$("pr-edition-label").textContent="POST-DRAFT · WEEK 00";$("pr-board").innerHTML='<div class="pr-empty"><strong>POST-DRAFT RANKINGS</strong><p>The post-draft editorial edition has not been added yet.</p></div>';$("pr-rank-count").textContent="POST-DRAFT";archive.querySelectorAll("button").forEach(x=>x.classList.toggle("active",x===btn));const b=$("pr-reveal");if(b)b.hidden=true;}else renderPowerRankings(w);}));
  }
  $("pr-edition-label").textContent=edition?.date?("WEEK "+week+" · "+edition.date):("WEEK "+week+" · EDITION");
  const stats=computeRankings(week),byName=new Map(stats.map(t=>[t.name,t])),previous=EDITORIAL_EDITIONS[week-1]?.rankings||[],priorRanks=new Map(previous.map((r,i)=>[r.manager,i+1])),hasEdition=Boolean(edition?.rankings?.length);
  if(!hasEdition)$("pr-board").innerHTML='<div class="pr-empty"><strong>THIS EDITION HAS NOT BEEN PUBLISHED.</strong><p>Power Rankings are editorial, not an automated sort of the standings. The live scoring picture and standings are shown below; this edition’s ranked order and written analysis have not been entered yet.</p></div>';
  else $("pr-board").innerHTML=edition.rankings.map((entry,i)=>{const t=byName.get(entry.manager);if(!t)return "";const rank=i+1,prior=priorRanks.get(entry.manager),move=prior==null?0:prior-rank,txt=prior==null?"—":move>0?"▲ "+move:move<0?"▼ "+Math.abs(move):"—",cls=move>0?"up":move<0?"down":"same";return '<article class="pr-card" data-prev="'+(prior||rank)+'" data-final="'+rank+'" data-move="'+move+'"><div class="pr-rank"><span>RANK</span><strong class="pr-roll">'+String(rank).padStart(2,"0")+'</strong><small class="pr-mv '+cls+'">'+txt+'</small></div><div class="pr-card-body"><div class="pr-card-head"><h3>'+escapeHtml(entry.manager)+'</h3><span class="pr-meta">'+escapeHtml(t.record)+' · '+fmt(t.pf)+' PF</span></div><div class="bl-wrap"><p>'+(entry.note?escapeHtml(entry.note):'<span class="pr-note-pending">Commentary pending.</span>')+'</p></div></div></article>';}).join("") + (edition?.headline ? '<section class="pr-editorial-feature"><div class="pr-feature-kicker">WEEK '+week+' · THE BIG STORY</div><h3>'+escapeHtml(edition.headline)+'</h3><p>'+escapeHtml(edition.feature||"")+'</p>'+(edition.notes?.length?'<div class="pr-feature-notes"><strong>WEEKLY NOTES</strong><ul>'+edition.notes.map(note=>'<li>'+escapeHtml(note)+'</li>').join("")+'</ul></div>':"")+'</section>' : "");
  $("pr-rank-count").textContent=hasEdition?edition.rankings.length+" / 12 RANKED":"12 MANAGERS";
  const reveal=$("pr-reveal");if(reveal){reveal.hidden=!hasEdition;reveal.textContent="REVEAL RANKINGS";window.initPowerRankingsReveal?.();}
  const scores=(state.weeks[week]||[]).filter(m=>num(m.points)>0).sort((a,b)=>num(b.points)-num(a.points));
  const matchupResults=calculateWeek(week).results,outcomeByRoster=new Map();
  for(const matchup of matchupResults){
    if(matchup.winner===1){outcomeByRoster.set(matchup.a.id,"win");outcomeByRoster.set(matchup.b.id,"loss");}
    else if(matchup.winner===2){outcomeByRoster.set(matchup.a.id,"loss");outcomeByRoster.set(matchup.b.id,"win");}
    else {outcomeByRoster.set(matchup.a.id,"even");outcomeByRoster.set(matchup.b.id,"even");}
  }
  $("weekly-chart-bars").innerHTML=scores.length?scores.map((m,index)=>{const t=teamFor(m.roster_id),score=num(m.points),height=Math.max(10,Math.round(score/(num(scores[0]?.points)||1)*118)),result=outcomeByRoster.get(Number(m.roster_id))||"even";return '<div class="pr-chart-bar-item" title="'+escapeHtml(t?.name||"Manager")+': '+fmt(score)+' · '+(result==="win"?"WIN":result==="loss"?"LOSS":"TIE")+'"><span>'+fmt(score)+'</span><i class="'+result+'" style="height:'+height+'px"></i><b>'+escapeHtml(t?.name||"—")+'</b></div>'+(index===5?'<div class="pr-chart-median-divider" aria-label="Median cutoff"></div>':"");}).join(""):'<div class="pr-empty">No completed scoring data for this week.</div>';
  const standings=[...stats].sort((a,b)=>b.wins-a.wins||b.pf-a.pf),editorialRanks=new Map((edition?.rankings||[]).map((r,i)=>[r.manager,i+1]));
  $("pr-standings-body").innerHTML=standings.map((t,i)=>'<tr class="'+(i===6?"playoff-divider":"")+'"><td>'+String(i+1).padStart(2,"0")+'</td><td>'+escapeHtml(t.name)+'</td><td>'+escapeHtml(t.record)+'</td><td>'+fmt(t.pf)+'</td><td>'+fmt(t.pa)+'</td><td>'+escapeHtml(t.allPlayRecord)+'</td><td>'+(editorialRanks.get(t.name)||"—")+'</td></tr>').join("");
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
  $("status").textContent=state.failedWeeks.length ? `CONNECTED · ${state.teams.size} TEAMS · SOME WEEKLY DATA UNAVAILABLE (${state.failedWeeks.join(", ")})` : `CONNECTED · ${state.teams.size} TEAMS · DATA THROUGH WEEK ${week}`;
}
async function init() {
  try {
    const [league,users,rosters]=await Promise.all([
      fetchJson(`/league/${LEAGUE_ID}`),fetchJson(`/league/${LEAGUE_ID}/users`),fetchJson(`/league/${LEAGUE_ID}/rosters`)
    ]);
    state.league=league;state.users=users;state.rosters=rosters;buildTeams();
    renderLotteryHistory();
    loadActualDraftOrder();
    const season=league.season||String(new Date().getFullYear());
    $("season-label").textContent=`${season} SLEEPER LEAGUE · EST. 2017`;
    $("season-tag").textContent=`${season} SEASON · EST. 2017`;
    const rankingsSeasonTag = $("season-tag-rankings");
    if (rankingsSeasonTag) rankingsSeasonTag.textContent = `${season} SEASON · EST. 2017`;
    const maxWeek=getWeeksToLoad();
    // Load each week independently so one failed matchup request cannot block the page.
    const weekResults=await Promise.all(Array.from({length:maxWeek},(_,i)=>i+1).map(async w=>{
      try { return [w,await fetchJson(`/league/${LEAGUE_ID}/matchups/${w}`),true]; }
      catch(error) { console.warn(`Could not load Sleeper week ${w}`,error); return [w,[],false]; }
    }));
    const failedWeeks=weekResults.filter(item=>!item[2]).map(item=>item[0]);
    state.failedWeeks=failedWeeks;
    for(const [week,data] of weekResults) state.weeks[week]=data;
    const completed=Array.from({length:maxWeek},(_,i)=>i+1).filter(w=>(state.weeks[w]||[]).some(m=>num(m.points)>0));
    const defaultWeek=completed.length?Math.max(...completed):1;
    const select=$("week-select");
    select.innerHTML=Array.from({length:maxWeek},(_,i)=>`<option value="${i+1}">WEEK ${i+1}</option>`).join("");
    select.addEventListener("change",()=>renderPowerRankings(Number(select.value)));
    renderWeek(defaultWeek);
    renderPowerRankings(defaultWeek);
    $("updated-at").textContent="SLEEPER API · PUBLIC LEAGUE DATA";
  } catch(error) {
    console.error(error);
    $("status").textContent="COULD NOT LOAD LEAGUE DATA · PLEASE REFRESH";
    $("status").classList.add("error");
    $("pr-board").innerHTML='<div class="pr-empty">Unable to connect to Sleeper. Please refresh.</div>';
    const standings = $("standings-list");
    if (standings) standings.innerHTML = '<div class="empty-note">Standings unavailable. Please refresh.</div>';
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