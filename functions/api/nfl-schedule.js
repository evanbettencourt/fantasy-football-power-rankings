export async function onRequestGet(context) {
  try {
    const incoming = new URL(context.request.url);
    const upstreamUrl = new URL("https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard");
    for (const key of ["seasontype", "week", "year", "limit"]) {
      const value = incoming.searchParams.get(key);
      if (value) upstreamUrl.searchParams.set(key, value);
    }

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
      { error: "NFL schedule request failed", detail: String(error) },
      { status: 502 }
    );
  }
}
