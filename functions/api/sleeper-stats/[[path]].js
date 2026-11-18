export async function onRequestGet(context) {
  try {
    // Frontend requests /regular/<season>/<week>; Sleeper expects
    // /<season>/<week>?season_type=regular.
    const rawPath = context.params.path;
    const parts = Array.isArray(rawPath)
      ? rawPath
      : typeof rawPath === "string"
        ? rawPath.split("/").filter(Boolean)
        : [];

    let seasonType = "regular";
    let season;
    let week;

    if (parts.length >= 3 && ["regular", "post", "pre", "off"].includes(parts[0])) {
      seasonType = parts[0];
      season = parts[1];
      week = parts[2];
    } else {
      season = parts[0];
      week = parts[1];
    }

    if (!season || !week) {
      return Response.json({ error: "Season and week are required" }, { status: 400 });
    }

    const upstreamUrl = new URL(
      "https://api.sleeper.com/stats/nfl/" +
      encodeURIComponent(season) + "/" + encodeURIComponent(week)
    );
    upstreamUrl.search = new URL(context.request.url).search;
    upstreamUrl.searchParams.set("season_type", seasonType);

    const upstream = await fetch(upstreamUrl.toString(), {
      headers: { "Accept": "application/json" }
    });

    const headers = new Headers();
    headers.set("Content-Type", upstream.headers.get("Content-Type") || "application/json");
    headers.set("Cache-Control", "public, max-age=300");
    headers.set("Access-Control-Allow-Origin", "*");

    return new Response(upstream.body, {
      status: upstream.status,
      headers
    });
  } catch (error) {
    return Response.json(
      { error: "Sleeper stats request failed", detail: String(error) },
      { status: 502 }
    );
  }
}
