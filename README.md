# League Room — Fantasy Football Power Rankings

A lightweight, responsive fantasy football league dashboard powered by the public Sleeper API.

## Features

- Weekly power rankings with rank movement
- Power score blending win rate, all-play rate, total points, and recent form
- Weekly matchup scoreboard and high score
- Cumulative standings, points for, and points against
- Week selector for historical views
- Responsive dark dashboard design

## League configuration

The Sleeper league ID is configured at the top of `app.js`:

```js
const LEAGUE_ID = "1313563024161787904";
```

No API key or server is required. Data is read directly from Sleeper's public API.

## Deploy with Cloudflare Pages

1. Push this repository to GitHub.
2. In the Cloudflare dashboard, go to **Workers & Pages**.
3. Choose **Create application → Pages → Connect to Git**.
4. Select `evanbettencourt/fantasy-football-power-rankings`.
5. Set the framework preset to **None**.
6. Leave the build command blank.
7. Set the build output directory to `/`.
8. Click **Save and Deploy**.

Cloudflare will publish the static site and automatically redeploy when you push changes to the connected branch.

## Power score

The index is a weighted composite:

- 35% — win rate
- 25% — all-play win rate
- 25% — cumulative points scored (normalized to the league leader)
- 15% — recent scoring form (last three available weeks)

The power index is intended as a fun league comparison, not an official Sleeper ranking.
