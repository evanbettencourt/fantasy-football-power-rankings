export async function onRequestGet(context) {
  const LEAGUE_ID = "1313563024161787904";
  const SEASON = "2026";
  const json = (data, status = 200) => Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" }
  });
  const get = async (url) => {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`${response.status} ${url}`);
    return response.json();
  };
  try {
    const [league, users, rosters] = await Promise.all([
      get(`https://api.sleeper.app/v1/league/${LEAGUE_ID}`),
      get(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/users`),
      get(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/rosters`)
    ]);
    const userById = new Map(users.map(user => [String(user.user_id), user]));
    const managerByRoster = new Map(rosters.map(roster => {
      const user = userById.get(String(roster.owner_id));
      return [Number(roster.roster_id), user?.display_name || user?.username || `Roster ${roster.roster_id}`];
    }));
    const weeks = [];
    for (let week = 1; week <= 14; week++) {
      const matchups = await get(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/matchups/${week}`);
      const byRoster = new Map(matchups.map(row => [Number(row.roster_id), row]));
      if (rosters.some(roster => {
        const row = byRoster.get(Number(roster.roster_id));
        return !row || !Array.isArray(row.starters) || !row.starters.length || !Number.isFinite(Number(row.points)) || Number(row.points) <= 0;
      })) break;
      weeks.push({ week, matchups });
    }

    const results = [];
    const diagnostics = [];
    for (const { week, matchups } of weeks) {
      const projectionData = await get(`https://api.sleeper.com/projections/nfl/${SEASON}/${week}?season_type=regular`);
      const rows = Array.isArray(projectionData) ? projectionData : Object.values(projectionData || {});
      const projectionByPlayer = new Map();
      let usableRows = 0;
      for (const row of rows) {
        const stats = row?.stats || {};
        const playerId = String(row?.player_id ?? row?.playerId ?? row?.id ?? "");
        const value = Number(stats.pts_half_ppr ?? row.pts_half_ppr);
        if (!playerId || !Number.isFinite(value) || row.category && row.category !== "proj") continue;
        projectionByPlayer.set(playerId, value);
        usableRows++;
      }
      let matchedTeams = 0;
      for (const matchup of matchups) {
        const starters = matchup.starters.map(String);
        const missing = starters.filter(id => !projectionByPlayer.has(id));
        const projected = starters.reduce((sum, id) => sum + (projectionByPlayer.get(id) || 0), 0);
        const complete = missing.length === 0;
        if (complete) {
          matchedTeams++;
          results.push({
            week,
            roster_id: Number(matchup.roster_id),
            manager: managerByRoster.get(Number(matchup.roster_id)),
            actual: Number(matchup.points),
            projected: Number(projected),
            error: Number(matchup.points) - projected,
            starter_count: starters.length
          });
        }
        diagnostics.push({
          week, roster_id: Number(matchup.roster_id),
          manager: managerByRoster.get(Number(matchup.roster_id)),
          starter_count: starters.length,
          missing_projection_count: missing.length,
          missing_projection_ids: missing.slice(0, 8),
          actual: Number(matchup.points),
          projected: complete ? Number(projected) : null,
          projection_records: usableRows
        });
      }
    }
    const errors = results.map(row => row.error);
    const n = errors.length;
    const mean = n ? errors.reduce((a, b) => a + b, 0) / n : null;
    const sumSquares = n > 1 ? errors.reduce((sum, value) => sum + (value - mean) ** 2, 0) : null;
    const sampleSd = n > 1 ? Math.sqrt(sumSquares / (n - 1)) : null;
    const populationSd = n ? Math.sqrt(errors.reduce((sum, value) => sum + (value - mean) ** 2, 0) / n) : null;
    return json({
      season: SEASON,
      league_id: LEAGUE_ID,
      completed_weeks: weeks.map(item => item.week),
      teams: rosters.length,
      observations: n,
      mean_error: mean,
      sample_standard_deviation: sampleSd,
      population_standard_deviation: populationSd,
      results,
      diagnostics,
      note: "This endpoint sums Sleeper pts_half_ppr projections for each historical starter. Confirm projection snapshots are pregame/original before treating the SD as calibrated."
    });
  } catch (error) {
    return json({ error: String(error), stack: error?.stack || null }, 502);
  }
}
