export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const playerId = String(url.searchParams.get("player_id") || "").trim();
  const limit = Math.max(1, Math.min(10, Number(url.searchParams.get("limit")) || 5));

  if (!/^\d{1,8}$/.test(playerId)) {
    return Response.json({ error: "A valid Sleeper player_id is required." }, { status: 400 });
  }

  try {
    const query = `query get_player_news_for_ids {
      news: get_player_news(sport: "nfl", player_id: "${playerId}", limit: ${limit}) {
        player_id
        source
        published
        metadata
      }
    }`;

    const upstream = await fetch("https://sleeper.com/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; MonkeyBoysFantasy/1.0)"
      },
      body: JSON.stringify({ operationName: "get_player_news_for_ids", query, variables: {} })
    });

    const payload = await upstream.json();
    if (!upstream.ok || payload.errors?.length) {
      return Response.json({
        error: "Sleeper player news request failed.",
        status: upstream.status,
        details: payload.errors || payload
      }, { status: upstream.ok ? 502 : upstream.status });
    }

    const news = payload?.data?.news;
    if (!Array.isArray(news)) {
      return Response.json({ error: "Sleeper returned an unexpected player-news response." }, { status: 502 });
    }

    return Response.json({ player_id: playerId, news }, {
      headers: { "Cache-Control": "public, max-age=300" }
    });
  } catch (error) {
    return Response.json(
      { error: "Could not retrieve Sleeper player news.", detail: String(error) },
      { status: 502 }
    );
  }
}
