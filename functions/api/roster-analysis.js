const LEAGUE_ID = "1313563024161787904";
const MANAGERS = {
  1: "Evan", 2: "Tanz", 3: "Ben", 4: "Colby",
  5: "Marc", 6: "Joey", 7: "Lee", 8: "Pat",
  9: "Butta", 10: "Kevin", 11: "Ders", 12: "Brandon"
};

export async function onRequestGet() {
  try {
    const base = "https://api.sleeper.app/v1";
    const [rostersResponse, playersResponse, statsResponses] = await Promise.all([
      fetch(`${base}/league/${LEAGUE_ID}/rosters`),
      fetch(`${base}/players/nfl`),
      Promise.all(Array.from({ length: 10 }, (_, i) =>
        fetch(`${base}/stats/nfl/regular/2026/${i + 1}`)
      ))
    ]);

    if (!rostersResponse.ok || !playersResponse.ok || statsResponses.some(r => !r.ok)) {
      return Response.json({ error: "Sleeper data request failed" }, { status: 502 });
    }

    const [rosters, players, weeklyStats] = await Promise.all([
      rostersResponse.json(),
      playersResponse.json(),
      Promise.all(statsResponses.map(r => r.json()))
    ]);

    const statsById = new Map();
    weeklyStats.forEach((week, index) => {
      for (const [playerId, stats] of Object.entries(week || {})) {
        if (!statsById.has(playerId)) statsById.set(playerId, []);
        statsById.get(playerId).push({
          week: index + 1,
          points: Number(stats.pts_half_ppr ?? 0),
          games: Number(stats.gp ?? 0)
        });
      }
    });

    const result = rosters.map(roster => {
      const starters = new Set((roster.starters || []).filter(id => id !== "0"));
      const playerIds = roster.players || [];
      const rosterPlayers = playerIds.map(id => {
        const p = players[id] || {};
        const weekly = statsById.get(id) || [];
        const points = weekly.reduce((sum, w) => sum + w.points, 0);
        const games = weekly.reduce((sum, w) => sum + w.games, 0);
        const lastFour = weekly.filter(w => w.week >= 7 && w.week <= 10);
        const lastFourPoints = lastFour.reduce((sum, w) => sum + w.points, 0);
        const lastFourGames = lastFour.reduce((sum, w) => sum + w.games, 0);
        return {
          player_id: id,
          name: [p.first_name, p.last_name].filter(Boolean).join(" ") || p.full_name || id,
          position: p.position || null,
          team: p.team || null,
          status: p.injury_status || null,
          roster_status: starters.has(id) ? "starter" : (roster.reserve || []).includes(id) ? "reserve" : (roster.taxi || []).includes(id) ? "taxi" : "bench",
          season_points_half_ppr: Number(points.toFixed(2)),
          games_played: games,
          points_per_game: Number((games ? points / games : 0).toFixed(2)),
          weeks_7_to_10_points: Number(lastFourPoints.toFixed(2)),
          weeks_7_to_10_games: lastFourGames,
          weekly_points: weekly.map(w => ({ week: w.week, points: Number(w.points.toFixed(2)) }))
        };
      }).sort((a, b) => b.season_points_half_ppr - a.season_points_half_ppr);

      return {
        manager: MANAGERS[roster.roster_id] || `Roster ${roster.roster_id}`,
        roster_id: roster.roster_id,
        record: `${roster.settings.wins}-${roster.settings.losses}`,
        points_for: Number((Number(roster.settings.fpts || 0) + Number(roster.settings.fpts_decimal || 0) / 100).toFixed(2)),
        starters: rosterPlayers.filter(p => p.roster_status === "starter"),
        bench: rosterPlayers.filter(p => p.roster_status === "bench"),
        reserve: rosterPlayers.filter(p => p.roster_status === "reserve"),
        players: rosterPlayers
      };
    });

    return Response.json({
      league: "Monkey Boys",
      season: 2026,
      through_week: 10,
      scoring_basis: "Sleeper pts_half_ppr",
      recent_window: "Weeks 7-10",
      teams: result
    }, {
      headers: {
        "Cache-Control": "public, max-age=300",
        "Access-Control-Allow-Origin": "*"
      }
    });
  } catch (error) {
    return Response.json({ error: "Roster analysis data failed", detail: String(error) }, { status: 502 });
  }
}
