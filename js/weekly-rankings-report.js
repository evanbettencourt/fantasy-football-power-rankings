(function () {
  "use strict";

  const LEAGUE_ID = "1313563024161787904";
  const API = "/api/sleeper";
  const MANAGERS = {
    khogan99: "Kevin", marcd9: "Marc", cjmyers210: "Colby",
    tajbhall: "Ben", itsdonk: "Brandon", turtmonk: "Evan",
    pgdoyle5: "Pat", joeysolomon: "Joey", abutta31: "Butta",
    lee2222: "Lee", dersnation: "Ders", tanzi14: "Tanz"
  };
  const $ = id => document.getElementById(id);
  const fmt = value => (Number(value) || 0).toFixed(2);

  let league, users = [], rosters = [], players = {}, teams = new Map();
  let maxWeek = 17, reportReady = false;

  async function get(path) {
    const response = await fetch(API + path);
    if (!response.ok) throw new Error("Sleeper API " + response.status + " (" + path + ")");
    return response.json();
  }

  function managerName(user) {
    const username = String(user && user.username || "").replace(/^@/, "").toLowerCase();
    const display = String(user && user.display_name || "").replace(/^@/, "").toLowerCase();
    return MANAGERS[username] || MANAGERS[display] || (user && (user.display_name || user.username)) || "Unknown manager";
  }

  function playerName(id) {
    const player = players[String(id)] || {};
    return player.full_name || [player.first_name, player.last_name].filter(Boolean).join(" ") || "Player " + id;
  }

  function playerTag(id) {
    const player = players[String(id)] || {};
    const bits = [player.position, player.team].filter(Boolean);
    if (player.injury_status) bits.push("INJURY: " + player.injury_status);
    if (player.status && !["Active", ""].includes(player.status)) bits.push("STATUS: " + player.status);
    return bits.length ? " (" + bits.join(" · ") + ")" : "";
  }

  function setStatus(message, error) {
    const node = $("pr-report-status");
    if (!node) return;
    node.textContent = message;
    node.classList.toggle("error", Boolean(error));
  }

  async function loadPlayerDatabase() {
    const cacheKey = "mb-sleeper-players-nfl-v2";
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        players = JSON.parse(cached);
        return;
      }
    } catch (_) {}
    setStatus("Loading player names and injury designations from Sleeper…");
    const data = await get("/players/nfl");
    if (!data || typeof data !== "object") throw new Error("Sleeper player directory was unavailable.");
    players = data;
    try { sessionStorage.setItem(cacheKey, JSON.stringify(data)); } catch (_) {}
  }

  async function loadBaseData() {
    const values = await Promise.all([
      get("/league/" + LEAGUE_ID),
      get("/league/" + LEAGUE_ID + "/users"),
      get("/league/" + LEAGUE_ID + "/rosters")
    ]);
    league = values[0];
    users = values[1] || [];
    rosters = values[2] || [];
    const byUser = new Map(users.map(user => [String(user.user_id), user]));
    teams = new Map();
    rosters.forEach(roster => {
      const user = byUser.get(String(roster.owner_id));
      teams.set(Number(roster.roster_id), {
        id: Number(roster.roster_id),
        name: managerName(user),
        roster: roster
      });
    });
    maxWeek = Math.max(1, Math.min(18, Number(league.settings && league.settings.playoff_week_start) + 2 || 17));
  }

  function buildStandings(weekData) {
    const rows = [...teams.values()].map(team => ({
      id: team.id, name: team.name, wins: 0, losses: 0, ties: 0,
      pf: 0, pa: 0, allWins: 0, allLosses: 0, allTies: 0
    }));
    const byId = new Map(rows.map(row => [row.id, row]));
    for (let week = 1; week <= weekData.length; week++) {
      const games = weekData[week - 1] || [];
      const valid = games.filter(game => Number(game.points) > 0);
      if (valid.length !== rows.length) continue;
      const scores = valid.map(game => Number(game.points)).sort((a,b) => a-b);
      const median = (scores[scores.length / 2 - 1] + scores[scores.length / 2]) / 2;
      const groups = new Map();
      valid.forEach(game => {
        const row = byId.get(Number(game.roster_id));
        if (!row) return;
        row.pf += Number(game.points);
        if (!groups.has(game.matchup_id)) groups.set(game.matchup_id, []);
        groups.get(game.matchup_id).push(game);
        valid.forEach(other => {
          if (Number(other.roster_id) === row.id) return;
          if (Number(game.points) > Number(other.points)) row.allWins++;
          else if (Number(game.points) < Number(other.points)) row.allLosses++;
          else row.allTies++;
        });
        if (Number(game.points) > median) row.wins++;
        else if (Number(game.points) < median) row.losses++;
        else row.ties++;
      });
      groups.forEach(group => {
        if (group.length !== 2) return;
        const a = byId.get(Number(group[0].roster_id));
        const b = byId.get(Number(group[1].roster_id));
        if (!a || !b) return;
        a.pa += Number(group[1].points);
        b.pa += Number(group[0].points);
        if (Number(group[0].points) > Number(group[1].points)) { a.wins++; b.losses++; }
        else if (Number(group[0].points) < Number(group[1].points)) { b.wins++; a.losses++; }
        else { a.ties++; b.ties++; }
      });
    }
    return rows.sort((a,b) => b.wins-a.wins || b.pf-a.pf);
  }

  function injuryLines() {
    const entries = [];
    const seen = new Set();
    [...teams.values()].forEach(team => {
      const ids = (team.roster && team.roster.players || []).map(String);
      ids.forEach(id => {
        if (seen.has(id)) return;
        seen.add(id);
        const player = players[id] || {};
        const status = String(player.injury_status || "").trim();
        const bodyPart = String(player.injury_body_part || "").trim();
        const startDate = String(player.injury_start_date || "").trim();
        const practice = String(player.practice_participation || "").trim();
        const practiceDescription = String(player.practice_description || "").trim();
        const notes = String(player.injury_notes || "").trim();
        const hasInjuryInfo = status && !/^active$/i.test(status) ||
          bodyPart || startDate || practice || practiceDescription || notes;
        if (!hasInjuryInfo) return;
        const details = [];
        if (status) details.push("Status: " + status);
        if (bodyPart) details.push("Injury: " + bodyPart);
        if (startDate) details.push("Since: " + startDate);
        if (practice) details.push("Practice: " + practice);
        if (practiceDescription) details.push("Practice detail: " + practiceDescription);
        if (notes) details.push("Notes: " + notes);
        entries.push({
          manager: team.name,
          name: playerName(id),
          position: player.position || "",
          team: player.team || "",
          details
        });
      });
    });
    entries.sort((a,b) => a.manager.localeCompare(b.manager) || a.name.localeCompare(b.name));
    if (!entries.length) return [
      "  Sleeper did not return injury or practice details for players on the current rosters.",
      "  This does not confirm that every player is healthy; check team reports for late-breaking news."
    ];
    return entries.map(entry =>
      "  " + entry.manager + " — " + entry.name +
      (entry.position || entry.team ? " (" + [entry.position, entry.team].filter(Boolean).join(" · ") + ")" : "") +
      "\\n    " + entry.details.join(" | ")
    );
  }

  async function fetchPlayerNews(id) {
    const cacheKey = "mb-sleeper-player-news-v1-" + id;
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.savedAt && Date.now() - parsed.savedAt < 15 * 60 * 1000) return parsed.news || [];
      }
    } catch (_) {}

    const response = await fetch("/api/sleeper-news?player_id=" + encodeURIComponent(id) + "&limit=5");
    if (!response.ok) throw new Error("Player news request failed (" + response.status + ")");
    const payload = await response.json();
    const news = Array.isArray(payload.news) ? payload.news : [];
    try { sessionStorage.setItem(cacheKey, JSON.stringify({ savedAt: Date.now(), news })); } catch (_) {}
    return news;
  }

  async function playerNewsLines() {
    const injured = new Map();
    [...teams.values()].forEach(team => {
      (team.roster && team.roster.players || []).map(String).forEach(id => {
        const player = players[id] || {};
        const status = String(player.injury_status || "").trim();
        const hasDetails = status && !/^active$/i.test(status) ||
          player.injury_body_part || player.injury_notes || player.practice_participation ||
          player.practice_description;
        if (hasDetails && !injured.has(id)) injured.set(id, playerName(id));
      });
    });

    const ids = [...injured.keys()];
    if (!ids.length) return ["  No rostered players currently have injury information in Sleeper's player directory."];

    const results = [];
    const failures = [];
    let cursor = 0;
    async function worker() {
      while (cursor < ids.length) {
        const id = ids[cursor++];
        try {
          const news = await fetchPlayerNews(id);
          results.push({ id, name: injured.get(id), news });
        } catch (error) {
          failures.push(injured.get(id) + ": " + error.message);
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(5, ids.length) }, worker));

    const lines = [];
    results.sort((a,b) => a.name.localeCompare(b.name)).forEach(result => {
      if (!result.news.length) return;
      const seen = new Set();
      const items = result.news
        .slice()
        .sort((a,b) => Number(b.published || 0) - Number(a.published || 0))
        .filter(item => {
          const meta = item.metadata && typeof item.metadata === "object" ? item.metadata : {};
          const key = [item.source, item.published, meta.title].join("|");
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, 3);
      if (!items.length) return;
      lines.push("  " + result.name + ":");
      items.forEach(item => {
        const meta = item.metadata && typeof item.metadata === "object" ? item.metadata : {};
        const date = Number(item.published) ? new Date(Number(item.published)).toLocaleString() : "Date unavailable";
        const source = String(item.source || "Sleeper news").replace(/_/g, " ");
        if (meta.title) lines.push("    [" + date + " · " + source + "] " + meta.title);
        if (meta.description) lines.push("      " + meta.description);
        if (meta.analysis) lines.push("      Analysis: " + meta.analysis);
        if (meta.url) lines.push("      Article: " + meta.url);
      });
    });

    if (!lines.length) lines.push("  Sleeper's player-news feed returned no news items for the rostered players with injury designations.");
    if (failures.length) lines.push("  News lookup errors: " + failures.join("; "));
    return lines;
  }

  function rosterLines(team) {
    const roster = team.roster || {};
    const starters = (roster.starters || []).map(String);
    const starterSet = new Set(starters);
    const playerIds = (roster.players || []).map(String);
    const reserve = new Set((roster.reserve || []).map(String));
    const taxi = new Set((roster.taxi || []).map(String));
    const ordered = starters.filter(id => playerIds.includes(id));
    const rest = playerIds.filter(id => !starterSet.has(id)).sort((a,b) => {
      const pa = players[a] || {}, pb = players[b] || {};
      return String(pa.position || "").localeCompare(String(pb.position || "")) ||
        playerName(a).localeCompare(playerName(b));
    });
    const lines = [];
    if (ordered.length) {
      lines.push("  STARTERS");
      ordered.forEach(id => lines.push("    " + playerName(id) + playerTag(id)));
    }
    if (rest.length) {
      lines.push("  BENCH / RESERVES");
      rest.forEach(id => lines.push("    " + playerName(id) + playerTag(id) +
        (reserve.has(id) ? " [IR]" : taxi.has(id) ? " [TAXI]" : "")));
    }
    return lines.length ? lines : ["  No roster players returned."];
  }

  function transactionDescription(tx) {
    const rosterIds = (tx.roster_ids || []).map(Number);
    const teamNames = rosterIds.map(id => teams.get(id)?.name || "Roster " + id);
    const changes = [];
    Object.entries(tx.adds || {}).forEach(([playerId, rosterId]) => {
      changes.push((teams.get(Number(rosterId))?.name || "Roster " + rosterId) + " added " + playerName(playerId));
    });
    Object.entries(tx.drops || {}).forEach(([playerId, rosterId]) => {
      changes.push((teams.get(Number(rosterId))?.name || "Roster " + rosterId) + " dropped " + playerName(playerId));
    });
    const picks = (tx.draft_picks || []).map(pick => {
      const from = teams.get(Number(pick.owner_id))?.name || "Unknown";
      const to = teams.get(Number(pick.previous_owner_id))?.name || "Unknown";
      return "draft pick " + pick.season + " round " + pick.round + " (" + from + " / " + to + ")";
    });
    const type = String(tx.type || "transaction").toUpperCase();
    const teamsLabel = teamNames.length ? " — " + teamNames.join(" / ") : "";
    return "  " + type + teamsLabel + (changes.length ? "\n    " + changes.join("\n    ") : "") +
      (picks.length ? "\n    " + picks.join("\n    ") : "");
  }

  async function generateReport() {
    const week = Number($("pr-report-week").value);
    if (!week) return;
    const generate = $("pr-report-generate");
    const copy = $("pr-report-copy");
    generate.disabled = true;
    copy.disabled = true;
    setStatus("Retrieving Week " + week + " scores, standings, transactions, and roster details…");
    try {
      const weekNumbers = Array.from({length: week}, (_, i) => i + 1);
      const [weekData, transactions] = await Promise.all([
        Promise.all(weekNumbers.map(w => get("/league/" + LEAGUE_ID + "/matchups/" + w))),
        get("/league/" + LEAGUE_ID + "/transactions/" + week).catch(() => [])
      ]);
      setStatus("Loading Sleeper player news and injury outlook…");
      const newsLines = await playerNewsLines();
      const standings = buildStandings(weekData);
      const currentGames = weekData[week - 1] || [];
      const scoreMap = new Map(currentGames.map(game => [Number(game.roster_id), Number(game.points) || 0]));
      const completedScores = currentGames.filter(game => Number(game.points) > 0).map(game => Number(game.points)).sort((a,b) => a-b);
      const median = completedScores.length === 12 ? (completedScores[5] + completedScores[6]) / 2 : null;
      const grouped = new Map();
      currentGames.forEach(game => {
        if (!grouped.has(game.matchup_id)) grouped.set(game.matchup_id, []);
        grouped.get(game.matchup_id).push(game);
      });
      const matchups = [...grouped.values()].filter(group => group.length === 2).map(group => ({
        a: teams.get(Number(group[0].roster_id))?.name || "Roster " + group[0].roster_id,
        b: teams.get(Number(group[1].roster_id))?.name || "Roster " + group[1].roster_id,
        sa: Number(group[0].points) || 0, sb: Number(group[1].points) || 0
      })).sort((a,b) => (b.sa+b.sb) - (a.sa+a.sb));

      const lines = [];
      const section = title => { lines.push(""); lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"); lines.push(title); lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"); };
      lines.push("MONKEY BOYS  /  WEEK " + week + " POWER RANKINGS");
      lines.push("2026 SEASON  •  GENERATED " + new Date().toLocaleString());
      lines.push("12 TEAMS  ·  HALF-PPR  ·  4-PT PASSING TD  ·  H2H + LEAGUE MEDIAN");
      lines.push("");
      lines.push("DATA NOTE  Scores and standings cover Weeks 1–" + week + ". Rosters are the CURRENT Sleeper snapshot, not historical rosters from Week " + week + ".");
      section("01  /  LEAGUE STANDINGS — THROUGH WEEK " + week);
      lines.push("Rank | Manager | Record | PF | PA | All-Play");
      standings.forEach((row, index) => {
        const allGames = row.allWins + row.allLosses + row.allTies;
        lines.push((index+1) + " | " + row.name + " | " + row.wins + "-" + row.losses + (row.ties ? "-" + row.ties : "") +
          " | " + fmt(row.pf) + " | " + fmt(row.pa) + " | " + row.allWins + "-" + row.allLosses +
          (row.allTies ? "-" + row.allTies : "") + " (" + allGames + ")");
      });
      section("02  /  WEEK " + week + " SCORES & MATCHUPS");
      lines.push("League median: " + (median == null ? "Not available / week incomplete" : fmt(median)));
      if (median != null) {
        const above = [...scoreMap.entries()].filter(entry => entry[1] > median).map(entry => teams.get(entry[0])?.name).filter(Boolean);
        const below = [...scoreMap.entries()].filter(entry => entry[1] < median).map(entry => teams.get(entry[0])?.name).filter(Boolean);
        lines.push("Above median: " + above.join(", "));
        lines.push("Below median: " + below.join(", "));
      }
      matchups.forEach(game => {
        const result = game.sa > game.sb ? game.a + " won" : game.sb > game.sa ? game.b + " won" : "Tied";
        lines.push("  " + game.a + " " + fmt(game.sa) + " vs " + game.b + " " + fmt(game.sb) + " — " + result);
      });
      section("03  /  COMPLETED TRANSACTIONS — WEEK " + week);
      const completedTransactions = Array.isArray(transactions)
        ? transactions.filter(tx => tx.status === "complete" || tx.status === "completed")
        : [];
      if (!completedTransactions.length) lines.push("  No completed transactions returned for this week.");
      else completedTransactions.sort((a,b) => Number(a.created||0)-Number(b.created||0))
        .forEach(tx => lines.push(transactionDescription(tx)));
      section("04  /  CURRENT ROSTERS — SLEEPER SNAPSHOT");
      [...teams.values()].sort((a,b) => a.name.localeCompare(b.name)).forEach(team => {
        lines.push(team.name + ":");
        lines.push(...rosterLines(team));
      });
      section("05  /  INJURY & PRACTICE REPORT — CURRENT ROSTERS");
      lines.push(...injuryLines());
      lines.push("  Sleeper player-directory fields only; designations and practice information may lag breaking news.");
      section("06  /  PLAYER NEWS & INJURY OUTLOOK — SLEEPER NEWS FEED");
      lines.push(...newsLines);
      lines.push("  News is supplied by Sleeper's linked providers; publication dates and source labels are shown where available.");
      section("07  /  EDITORIAL NOTES TO ADD");
      lines.push("• Injuries, expected return timelines, or role changes not reflected accurately by Sleeper:");
      lines.push("• Major league context, manager tendencies, trade evaluations, or other notes:");
      $("pr-report-output").value = lines.join("\n");
      copy.disabled = false;
      reportReady = true;
      setStatus("Report generated. Review it, then copy and paste it into this chat.");
    } catch (error) {
      console.error("Weekly rankings report failed", error);
      setStatus("Could not generate report: " + error.message, true);
    } finally {
      generate.disabled = false;
    }
  }

  function init() {
    if (!$("pr-report-generate")) return;
    $("pr-report-generate").addEventListener("click", generateReport);
    $("pr-report-week").addEventListener("change", () => {
      $("pr-report-copy").disabled = true;
      $("pr-report-output").value = "";
      reportReady = false;
    });
    $("pr-report-copy").addEventListener("click", async () => {
      if (!reportReady) return;
      try {
        await navigator.clipboard.writeText($("pr-report-output").value);
        setStatus("Copied. Paste the report into this chat.");
      } catch (_) {
        $("pr-report-output").focus();
        $("pr-report-output").select();
        setStatus("Clipboard access was blocked. The report is selected — press Ctrl+C to copy.");
      }
    });
    (async () => {
      try {
        await loadBaseData();
        $("pr-report-week").innerHTML = Array.from({length:maxWeek}, (_, i) =>
          '<option value="' + (i+1) + '">Week ' + (i+1) + '</option>').join("");
        await loadPlayerDatabase();
        const recent = await Promise.all(Array.from({length:maxWeek}, (_, i) => i + 1)
          .map(week => get("/league/" + LEAGUE_ID + "/matchups/" + week)
            .then(data => ({week, data})).catch(() => ({week, data:[]}))));
        const latest = recent.filter(item => item.data.some(game => Number(game.points) > 0))
          .reduce((max, item) => Math.max(max, item.week), 1);
        $("pr-report-week").value = String(latest);
        setStatus("Ready. Choose a week and generate your report.");
        $("pr-report-generate").disabled = false;
      } catch (error) {
        console.error("Weekly rankings report setup failed", error);
        setStatus("Report setup failed: " + error.message, true);
        $("pr-report-generate").disabled = true;
      }
    })();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();