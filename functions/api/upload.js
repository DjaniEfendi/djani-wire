// /api/upload  — owner-only. Accepts a single image or PDF via multipart
// FormData (field name "file") and stores the bytes in KV under file:<id>,
// with the content-type kept in metadata. Returns { id, src, name }.

const MAX_BYTES = 24 * 1024 * 1024; // 24 MB (KV value limit is 25 MB)

function json(obj, status = 200) {
  return Response.json(obj, { status });
}

export async function onRequestPost({ env, request }) {
  if (!env.WIRE_KEY || request.headers.get("x-wire-key") !== env.WIRE_KEY)
    return json({ error: "unauthorized" }, 401);
  if (!env.WIRE_KV) return json({ error: "storage not configured" }, 500);

  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "expected multipart form data" }, 400);
  }

  const file = form.get("file");
  if (!file || typeof file === "string")
    return json({ error: "no file provided" }, 400);

  const type = file.type || "application/octet-stream";
  const allowed = type.startsWith("image/") || type === "application/pdf";
  if (!allowed) return json({ error: "only images and PDFs are allowed" }, 415);

  const buf = await file.arrayBuffer();
  if (buf.byteLength > MAX_BYTES)
    return json({ error: "file too large (max 24 MB)" }, 413);

  const id = crypto.randomUUID();
  const name = (file.name || "file").slice(0, 200);
  try {
    await env.WIRE_KV.put("file:" + id, buf, {
      metadata: { contentType: type, name },
    });
  } catch (e) {
    return json({ error: "upload failed: " + String(e) }, 500);
  }

  return json({ id, src: "/api/file/" + id, name, contentType: type });
}
