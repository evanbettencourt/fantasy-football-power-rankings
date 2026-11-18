export async function onRequestGet(context) {
  try {
    const rawPath = context.params.path;
    const parts = Array.isArray(rawPath)
      ? rawPath
      : typeof rawPath === "string"
        ? rawPath.split("/").filter(Boolean)
        : [];

    const upstreamUrl = new URL(
      "https://api.sleeper.com/projections/nfl/" +
      parts.map(part => encodeURIComponent(part)).join("/")
    );
    upstreamUrl.search = new URL(context.request.url).search;

    const upstream = await fetch(upstreamUrl.toString(), {
      headers: { "Accept": "application/json" }
    });

    const headers = new Headers();
    headers.set("Content-Type", upstream.headers.get("Content-Type") || "application/json");
    headers.set("Cache-Control", "public, max-age=120");
    headers.set("Access-Control-Allow-Origin", "*");

    return new Response(upstream.body, {
      status: upstream.status,
      headers
    });
  } catch (error) {
    return Response.json(
      { error: "Sleeper projections request failed", detail: String(error) },
      { status: 502 }
    );
  }
}
