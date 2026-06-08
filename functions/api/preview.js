// /api/preview  — fetches a URL server-side and pulls its Open Graph /
// meta tags (title, description, site name) using Workers' HTMLRewriter.
// No API key, no external service. Works on most pages — including many
// paywalled ones, since publishers expose og: tags for link previews.

export async function onRequestPost({ request }) {
  let url;
  try {
    ({ url } = await request.json());
  } catch {
    return Response.json({}, { status: 400 });
  }
  if (!url || !/^https?:\/\//i.test(url)) return Response.json({});

  try {
    const upstream = await fetch(url, {
      headers: {
        // some sites serve a fuller page to a browser-like UA
        "User-Agent":
          "Mozilla/5.0 (compatible; WireBot/1.0; +https://djaniefendi.com)",
        Accept: "text/html,application/xhtml+xml",
      },
      cf: { cacheTtl: 300, cacheEverything: true },
    });
    if (!upstream.ok) return Response.json({});

    const meta = { title: "", summary: "", source: "" };
    let titleBuf = "";

    const rewriter = new HTMLRewriter()
      .on("meta", {
        element(el) {
          const prop =
            el.getAttribute("property") || el.getAttribute("name") || "";
          const content = el.getAttribute("content") || "";
          if (!content) return;
          const p = prop.toLowerCase();
          if ((p === "og:title" || p === "twitter:title") && !meta.title)
            meta.title = content;
          if (
            (p === "og:description" ||
              p === "twitter:description" ||
              p === "description") &&
            !meta.summary
          )
            meta.summary = content;
          if (p === "og:site_name" && !meta.source) meta.source = content;
        },
      })
      .on("title", {
        text(t) {
          titleBuf += t.text;
        },
      });

    // consuming the transformed body is what drives the parser
    await rewriter.transform(upstream).arrayBuffer();

    if (!meta.title && titleBuf.trim()) meta.title = titleBuf.trim();

    // tidy up
    meta.title = collapse(meta.title);
    meta.summary = collapse(meta.summary);
    if (meta.summary.length > 220) meta.summary = meta.summary.slice(0, 217).trim() + "…";

    return Response.json(meta);
  } catch {
    return Response.json({});
  }
}

function collapse(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}
