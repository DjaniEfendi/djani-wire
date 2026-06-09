// /api/file/<id>  — public. Serves a stored image/PDF from KV with its
// original content-type and a long cache so repeat views don't re-hit KV.

export async function onRequestGet({ env, params }) {
  if (!env.WIRE_KV) return new Response("not found", { status: 404 });
  const id = String(params.id || "");
  if (!id) return new Response("not found", { status: 404 });

  const { value, metadata } = await env.WIRE_KV.getWithMetadata("file:" + id, {
    type: "arrayBuffer",
  });
  if (!value) return new Response("not found", { status: 404 });

  const contentType =
    (metadata && metadata.contentType) || "application/octet-stream";

  return new Response(value, {
    headers: {
      "content-type": contentType,
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
