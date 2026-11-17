export async function onRequestGet(context) {
  const parts = context.params.path || [];
  const upstreamUrl = new URL("https://api.sleeper.app/v1/" + parts.map(encodeURIComponent).join("/"));
  upstreamUrl.search = new URL(context.request.url).search;

  try {
    const upstream = await fetch(upstreamUrl.toString(), {
      headers: { "Accept": "application/json" }
    });
    const headers = new Headers();
    headers.set("Content-Type", upstream.headers.get("Content-Type") || "application/json");
    headers.set("Cache-Control", "public, max-age=30");
    headers.set("Access-Control-Allow-Origin", "*");
    return new Response(upstream.body, {
      status: upstream.status,
      headers
    });
  } catch (error) {
    return Response.json(
      { error: "Sleeper API request failed", detail: String(error) },
      { status: 502 }
    );
  }
}
