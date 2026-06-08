// /api/feed  — stores the whole feed as one JSON blob in Cloudflare KV.
// Binding required: WIRE_KV  (set in the Pages dashboard or wrangler.toml)

const KEY = "feed:v1";
const MAX = 500;

async function read(env) {
  if (!env.WIRE_KV) return [];
  const raw = await env.WIRE_KV.get(KEY);
  return raw ? JSON.parse(raw) : [];
}

async function write(env, data) {
  if (!env.WIRE_KV) throw new Error("WIRE_KV binding is missing");
  await env.WIRE_KV.put(KEY, JSON.stringify(data));
}

// GET /api/feed → [ ...dispatches ]
export async function onRequestGet({ env }) {
  try {
    return Response.json(await read(env));
  } catch {
    return Response.json([]); // never hard-fail the page load
  }
}

// POST /api/feed  { id, url, host, title, note, label, hue, ts }
export async function onRequestPost({ env, request }) {
  try {
    const b = await request.json();
    if (!b || !b.url) return Response.json({ error: "url required" }, { status: 400 });
    const feed = await read(env);
    const entry = {
      id: b.id || crypto.randomUUID(),
      url: String(b.url),
      host: String(b.host || ""),
      title: String(b.title || b.host || ""),
      note: String(b.note || ""),
      label: String(b.label || ""),
      hue: String(b.hue || "#FFB000"),
      ts: b.ts || new Date().toISOString(),
    };
    const next = [entry, ...feed.filter((e) => e.id !== entry.id)].slice(0, MAX);
    await write(env, next);
    return Response.json(entry);
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

// DELETE /api/feed  { id }
export async function onRequestDelete({ env, request }) {
  try {
    const { id } = await request.json();
    const feed = await read(env);
    await write(env, feed.filter((e) => e.id !== id));
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
