// /api/feed  — the dispatch list, stored as one JSON blob in KV.
// GET is public (anyone can read). POST/DELETE require the owner key.
// Fails closed: if WIRE_KEY isn't set, all writes are rejected.

const KEY = "feed:v1";
const MAX = 500;

function authed(env, request) {
  return !!env.WIRE_KEY && request.headers.get("x-wire-key") === env.WIRE_KEY;
}

async function read(env) {
  if (!env.WIRE_KV) return [];
  const raw = await env.WIRE_KV.get(KEY);
  return raw ? JSON.parse(raw) : [];
}

async function write(env, data) {
  if (!env.WIRE_KV) throw new Error("WIRE_KV binding is missing");
  await env.WIRE_KV.put(KEY, JSON.stringify(data));
}

// GET /api/feed → [ ...dispatches ]  (public)
export async function onRequestGet({ env }) {
  try {
    return Response.json(await read(env));
  } catch {
    return Response.json([]);
  }
}

// POST /api/feed  (owner only)
export async function onRequestPost({ env, request }) {
  if (!authed(env, request))
    return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    const b = await request.json();
    if (!b || !b.type)
      return Response.json({ error: "type required" }, { status: 400 });
    const feed = await read(env);
    const entry = {
      id: b.id || crypto.randomUUID(),
      type: String(b.type),
      title: String(b.title || ""),
      note: String(b.note || ""),
      label: String(b.label || ""),
      hue: String(b.hue || "#FFB000"),
      ts: b.ts || new Date().toISOString(),
      url: b.url ? String(b.url) : undefined,
      host: b.host ? String(b.host) : undefined,
      videoId: b.videoId ? String(b.videoId) : undefined,
      src: b.src ? String(b.src) : undefined,
      name: b.name ? String(b.name) : undefined,
    };
    Object.keys(entry).forEach((k) => entry[k] === undefined && delete entry[k]);
    const next = [entry, ...feed.filter((e) => e.id !== entry.id)].slice(0, MAX);
    await write(env, next);
    return Response.json(entry);
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

// DELETE /api/feed  { id }  (owner only) — also clears the uploaded blob, if any
export async function onRequestDelete({ env, request }) {
  if (!authed(env, request))
    return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    const { id } = await request.json();
    const feed = await read(env);
    const entry = feed.find((e) => e.id === id);
    if (entry && entry.src && entry.src.startsWith("/api/file/") && env.WIRE_KV) {
      const fid = entry.src.replace("/api/file/", "");
      try {
        await env.WIRE_KV.delete("file:" + fid);
      } catch {
        /* ignore */
      }
    }
    await write(env, feed.filter((e) => e.id !== id));
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
