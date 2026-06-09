import React, { useState, useEffect, useRef, useCallback } from "react";

/* ------------------------------------------------------------------ */
/*  THE WIRE — a live feed of what you're reading.                    */
/*  Links, YouTube embeds, images, and PDFs. Public to read;          */
/*  only the owner (holding the key) can post or delete.              */
/* ------------------------------------------------------------------ */

const LS_KEY = "wire_key";

// Known sources → [label, accent hue]. Anything else falls back to amber.
const SOURCES = {
  "ft.com": ["FINANCIAL TIMES", "#F4A26B"],
  "bloomberg.com": ["BLOOMBERG", "#FF7A2F"],
  "wsj.com": ["WSJ", "#5BC8E6"],
  "reuters.com": ["REUTERS", "#FF8F4D"],
  "economist.com": ["THE ECONOMIST", "#FF5A52"],
  "nytimes.com": ["NYT", "#D8D8D8"],
  "x.com": ["X", "#E9E9E9"],
  "twitter.com": ["X", "#E9E9E9"],
  "substack.com": ["SUBSTACK", "#FF8A4C"],
  "cnbc.com": ["CNBC", "#73C2A0"],
  "theinformation.com": ["THE INFORMATION", "#F4A26B"],
  "semianalysis.com": ["SEMIANALYSIS", "#FFC24B"],
  "medium.com": ["MEDIUM", "#D8D8D8"],
  "youtube.com": ["YOUTUBE", "#FF6B6B"],
  "youtu.be": ["YOUTUBE", "#FF6B6B"],
  "github.com": ["GITHUB", "#D8D8D8"],
  "arxiv.org": ["ARXIV", "#C58BFF"],
};

const HUE = { image: "#6FD3C0", pdf: "#FF9B5C", video: "#FF6B6B" };

function detectSource(host) {
  const h = host.replace(/^www\./, "");
  if (SOURCES[h]) return SOURCES[h];
  const hit = Object.keys(SOURCES).find((k) => h === k || h.endsWith("." + k));
  if (hit) return SOURCES[hit];
  return [h.toUpperCase(), "#FFB000"];
}

const faviconURL = (host) =>
  `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;

function normalizeUrl(raw) {
  let s = (raw || "").trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  try {
    const u = new URL(s);
    if (!u.hostname.includes(".")) return null;
    return u;
  } catch {
    return null;
  }
}

function extractYouTubeId(u) {
  const h = u.hostname.replace(/^www\./, "");
  if (h === "youtu.be") return u.pathname.slice(1).split("/")[0] || null;
  if (h === "youtube.com" || h.endsWith(".youtube.com")) {
    if (u.pathname === "/watch") return u.searchParams.get("v");
    const m = u.pathname.match(/^\/(embed|shorts|v)\/([^/?]+)/);
    if (m) return m[2];
  }
  return null;
}

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Date.now() + "-" + Math.random().toString(36).slice(2);

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h ago";
  const d = Math.floor(h / 24);
  return d + "d ago";
}

function FavIcon({ host }) {
  const [bad, setBad] = useState(false);
  if (bad || !host) return <span className="fav-fallback">◍</span>;
  return (
    <img
      className="fav"
      src={faviconURL(host)}
      alt=""
      onError={() => setBad(true)}
      loading="lazy"
    />
  );
}

export default function App() {
  const [feed, setFeed] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [now, setNow] = useState(new Date());

  // owner state
  const [ownerKey, setOwnerKey] = useState(() => {
    try {
      return localStorage.getItem(LS_KEY);
    } catch {
      return null;
    }
  });
  const isOwner = !!ownerKey;
  const ownerKeyRef = useRef(ownerKey);
  useEffect(() => {
    ownerKeyRef.current = ownerKey;
  }, [ownerKey]);

  const [unlockOpen, setUnlockOpen] = useState(false);
  const [unlockInput, setUnlockInput] = useState("");
  const [unlockErr, setUnlockErr] = useState(false);

  // composer
  const [draft, setDraft] = useState("");
  const [urlErr, setUrlErr] = useState(false);
  const [comp, setComp] = useState(null);
  const [fetching, setFetching] = useState(false);
  const [fetchErr, setFetchErr] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState("");

  const dragDepth = useRef(0);
  const fileInputRef = useRef(null);

  const flash = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2600);
  };

  /* clock */
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  /* load feed */
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/feed");
        if (r.ok) setFeed(await r.json());
      } catch {
        /* offline */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  /* ---- composer openers ---- */
  const openFromUrl = useCallback((u) => {
    const host = u.hostname.replace(/^www\./, "");
    const vid = extractYouTubeId(u);
    setFetchErr(false);
    if (vid) {
      setComp({
        type: "video",
        url: u.href,
        host,
        videoId: vid,
        title: "",
        note: "",
        label: "YOUTUBE",
        hue: HUE.video,
      });
    } else {
      const [label, hue] = detectSource(u.hostname);
      setComp({ type: "link", url: u.href, host, title: "", note: "", label, hue });
    }
  }, []);

  const handleFiles = useCallback(async (files) => {
    const key = ownerKeyRef.current;
    if (!key) return;
    const file = files && files[0];
    if (!file) return;
    const isImg = (file.type || "").startsWith("image/");
    const isPdf = file.type === "application/pdf";
    if (!isImg && !isPdf) {
      flash("only images and PDFs");
      return;
    }
    if (file.size > 24 * 1024 * 1024) {
      flash("file too large (max 24 MB)");
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/upload", {
        method: "POST",
        headers: { "x-wire-key": key },
        body: fd,
      });
      if (!r.ok) throw new Error();
      const d = await r.json();
      if (isImg) {
        setComp({
          type: "image",
          src: d.src,
          name: d.name,
          title: "",
          note: "",
          label: "IMAGE",
          hue: HUE.image,
        });
      } else {
        setComp({
          type: "pdf",
          src: d.src,
          name: d.name,
          title: d.name,
          note: "",
          label: "PDF",
          hue: HUE.pdf,
        });
      }
    } catch {
      flash("upload failed");
    } finally {
      setUploading(false);
    }
  }, []);

  const captureDraft = () => {
    const u = normalizeUrl(draft);
    if (!u) {
      setUrlErr(true);
      setTimeout(() => setUrlErr(false), 1400);
      return;
    }
    openFromUrl(u);
    setDraft("");
  };

  const pickFile = () => fileInputRef.current && fileInputRef.current.click();

  /* ---- drag & drop (links OR files), owner only ---- */
  useEffect(() => {
    const onEnter = (e) => {
      e.preventDefault();
      if (!ownerKeyRef.current) return;
      dragDepth.current += 1;
      setDragging(true);
    };
    const onOver = (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onLeave = (e) => {
      e.preventDefault();
      dragDepth.current -= 1;
      if (dragDepth.current <= 0) {
        dragDepth.current = 0;
        setDragging(false);
      }
    };
    const onDrop = (e) => {
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      if (!ownerKeyRef.current) return;
      const dt = e.dataTransfer;
      if (dt && dt.files && dt.files.length) {
        handleFiles(dt.files);
        return;
      }
      const raw =
        (dt && (dt.getData("text/uri-list") || dt.getData("text/plain"))) || "";
      const u = normalizeUrl(raw.split("\n")[0]);
      if (u) openFromUrl(u);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [openFromUrl, handleFiles]);

  /* ---- global paste of a URL (owner only, ignored while typing) ---- */
  useEffect(() => {
    const onPaste = (e) => {
      if (!ownerKeyRef.current) return;
      const tag = document.activeElement && document.activeElement.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const txt = (e.clipboardData && e.clipboardData.getData("text")) || "";
      const u = normalizeUrl(txt);
      if (u) openFromUrl(u);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [openFromUrl]);

  /* ---- auto-fill from Open Graph tags (links & videos) ---- */
  const autofill = async () => {
    if (!comp || (comp.type !== "link" && comp.type !== "video")) return;
    setFetching(true);
    setFetchErr(false);
    try {
      const r = await fetch("/api/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: comp.url }),
      });
      const m = await r.json();
      if (!m || (!m.title && !m.summary)) setFetchErr(true);
      setComp((c) =>
        c
          ? {
              ...c,
              title: m.title || c.title,
              note: c.note || m.summary || "",
              label:
                c.label === (c.host || "").toUpperCase() && m.source
                  ? m.source.toUpperCase()
                  : c.label,
            }
          : c
      );
    } catch {
      setFetchErr(true);
    } finally {
      setFetching(false);
    }
  };

  /* ---- post / remove (owner only) ---- */
  const post = async () => {
    if (!comp) return;
    const base = {
      id: uid(),
      type: comp.type,
      title: comp.title.trim(),
      note: comp.note.trim(),
      label: comp.label,
      hue: comp.hue,
      ts: new Date().toISOString(),
    };
    let entry;
    if (comp.type === "link")
      entry = { ...base, url: comp.url, host: comp.host, title: base.title || comp.host };
    else if (comp.type === "video")
      entry = {
        ...base,
        url: comp.url,
        host: comp.host,
        videoId: comp.videoId,
        title: base.title || "YouTube video",
      };
    else if (comp.type === "image")
      entry = { ...base, src: comp.src, name: comp.name };
    else entry = { ...base, src: comp.src, name: comp.name, title: base.title || comp.name };

    setFeed((f) => [entry, ...f]);
    setComp(null);
    try {
      const r = await fetch("/api/feed", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-wire-key": ownerKeyRef.current || "",
        },
        body: JSON.stringify(entry),
      });
      if (!r.ok) throw new Error();
    } catch {
      setFeed((f) => f.filter((e) => e.id !== entry.id));
      flash("couldn't save — check you're unlocked");
    }
  };

  const remove = async (id) => {
    const prev = feed;
    setFeed((f) => f.filter((e) => e.id !== id));
    try {
      const r = await fetch("/api/feed", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "x-wire-key": ownerKeyRef.current || "",
        },
        body: JSON.stringify({ id }),
      });
      if (!r.ok) throw new Error();
    } catch {
      setFeed(prev);
      flash("couldn't delete");
    }
  };

  /* ---- owner unlock / lock ---- */
  const unlock = async () => {
    const k = unlockInput.trim();
    if (!k) return;
    try {
      const r = await fetch("/api/auth", { headers: { "x-wire-key": k } });
      if (r.ok) {
        try {
          localStorage.setItem(LS_KEY, k);
        } catch {
          /* ignore */
        }
        setOwnerKey(k);
        setUnlockOpen(false);
        setUnlockInput("");
        setUnlockErr(false);
      } else {
        setUnlockErr(true);
      }
    } catch {
      setUnlockErr(true);
    }
  };

  const lock = () => {
    try {
      localStorage.removeItem(LS_KEY);
    } catch {
      /* ignore */
    }
    setOwnerKey(null);
    setComp(null);
  };

  /* ---- ticker ---- */
  const counts = feed.reduce((a, e) => ((a[e.label] = (a[e.label] || 0) + 1), a), {});
  const items = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const tickerText =
    items.length > 0
      ? items.map(([l, n]) => `${l} \u00d7${n}`).join("    \u2022    ")
      : "MARKETS    \u2022    AI    \u2022    SEMICONDUCTORS    \u2022    CRYPTO    \u2022    GEOPOLITICS";

  const clock = now.toLocaleTimeString("en-GB", { hour12: false });
  const date = now
    .toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" })
    .toUpperCase();

  return (
    <div className="wire-root">
      <style>{CSS}</style>

      {/* drop overlay */}
      <div className={"drop-overlay" + (dragging ? " on" : "")}>
        <div className="drop-inner">
          <div className="drop-ring">{"\u21a7"}</div>
          <div className="drop-label">DROP LINK OR FILE TO ADD</div>
        </div>
      </div>

      {/* toast */}
      {toast && <div className="toast">{toast}</div>}

      {/* header */}
      <header className="wire-head">
        <div className="head-inner">
          <div className="brand">
            <span className="brand-mark">DJANI</span>
            <span className="brand-slash">{"\u2044\u2044"}</span>
            <span className="brand-name">THE WIRE</span>
          </div>
          <div className="head-meta">
            <span className="live">
              <span className="dot" /> LIVE
            </span>
            <span className="sep">{"\u00b7"}</span>
            <span>{feed.length} DISPATCHES</span>
            <span className="sep">{"\u00b7"}</span>
            <span className="clock">
              {date} {clock}
            </span>
            <span className="sep">{"\u00b7"}</span>
            {isOwner ? (
              <button className="ownerbtn on" onClick={lock} title="click to lock">
                {"\u25cf"} OWNER
              </button>
            ) : (
              <button
                className="ownerbtn"
                onClick={() => setUnlockOpen((v) => !v)}
                title="owner sign-in"
              >
                {"\u25cb"} UNLOCK
              </button>
            )}
          </div>
        </div>

        {/* unlock bar */}
        {unlockOpen && !isOwner && (
          <div className={"unlockbar" + (unlockErr ? " err" : "")}>
            <span className="ub-glyph">{"\u26bf"}</span>
            <input
              className="ub-input"
              type="password"
              placeholder="owner key"
              value={unlockInput}
              autoFocus
              onChange={(e) => {
                setUnlockInput(e.target.value);
                setUnlockErr(false);
              }}
              onKeyDown={(e) => e.key === "Enter" && unlock()}
            />
            <button className="btn post" onClick={unlock}>
              unlock
            </button>
            {unlockErr && <span className="ub-err">wrong key</span>}
          </div>
        )}

        <div className="ticker">
          <div className="ticker-track">
            <span>{tickerText}</span>
            <span aria-hidden="true">{tickerText}</span>
          </div>
        </div>
        <p className="tagline">
          a live feed of what i'm reading — markets, machines &amp; everything between
        </p>
      </header>

      <main className="wire-main">
        {/* composer (owner only) */}
        {isOwner && (
          <>
            <input
              type="file"
              accept="image/*,application/pdf"
              ref={fileInputRef}
              style={{ display: "none" }}
              onChange={(e) => {
                if (e.target.files && e.target.files.length) handleFiles(e.target.files);
                e.target.value = "";
              }}
            />

            {uploading ? (
              <div className="composer idle">
                <span className="spin" />
                <span className="upmsg">uploading…</span>
              </div>
            ) : !comp ? (
              <div className={"composer idle" + (urlErr ? " err" : "")}>
                <span className="compose-glyph">{"\u21b3"}</span>
                <input
                  className="compose-input"
                  placeholder="drop a link or file · or paste a URL ↵"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && captureDraft()}
                  spellCheck={false}
                />
                <button className="btn ghost" onClick={pickFile}>
                  {"\u2295"} file
                </button>
                <button className="btn ghost" onClick={captureDraft}>
                  capture
                </button>
              </div>
            ) : (
              <div className="composer active" style={{ ["--src"]: comp.hue }}>
                <div className="comp-top">
                  {comp.type === "link" || comp.type === "video" ? (
                    <FavIcon host={comp.host} />
                  ) : (
                    <span className="comp-typetag">{comp.label}</span>
                  )}
                  <span className="comp-src">{comp.label}</span>
                  {comp.url ? (
                    <a className="comp-url" href={comp.url} target="_blank" rel="noreferrer">
                      {comp.url.replace(/^https?:\/\//, "")}
                    </a>
                  ) : (
                    <span className="comp-url">{comp.name}</span>
                  )}
                  <button className="x" onClick={() => setComp(null)} title="discard">
                    {"\u2715"}
                  </button>
                </div>

                {/* media preview */}
                {comp.type === "video" && (
                  <img
                    className="comp-thumb"
                    src={`https://img.youtube.com/vi/${comp.videoId}/hqdefault.jpg`}
                    alt=""
                  />
                )}
                {comp.type === "image" && (
                  <img className="comp-thumb" src={comp.src} alt="" />
                )}
                {comp.type === "pdf" && (
                  <div className="comp-pdf">{"\u25a4"} {comp.name}</div>
                )}

                <input
                  className="comp-title"
                  placeholder={
                    comp.type === "link" || comp.type === "video"
                      ? "headline (or hit auto-fill)"
                      : "title (optional)"
                  }
                  value={comp.title}
                  onChange={(e) => setComp({ ...comp, title: e.target.value })}
                />
                <textarea
                  className="comp-note"
                  placeholder="your take — why is this worth it?"
                  value={comp.note}
                  rows={2}
                  onChange={(e) => setComp({ ...comp, note: e.target.value })}
                />
                <div className="comp-actions">
                  {(comp.type === "link" || comp.type === "video") && (
                    <button className="btn magic" onClick={autofill} disabled={fetching}>
                      {fetching ? (
                        <>
                          <span className="spin" /> fetching…
                        </>
                      ) : (
                        <>{"\u2726"} auto-fill</>
                      )}
                    </button>
                  )}
                  {fetchErr && <span className="summ-err">couldn't read it — type it in</span>}
                  <button className="btn post" onClick={post}>
                    file dispatch {"\u2192"}
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* feed */}
        {loading ? (
          <div className="empty">loading the wire…</div>
        ) : feed.length === 0 ? (
          <div className="empty">
            <div className="empty-big">— wire is quiet —</div>
            <div className="empty-sub">
              {isOwner
                ? "drop a link or file, or paste a URL above, to file your first dispatch"
                : "nothing filed yet"}
            </div>
          </div>
        ) : (
          <ol className="feed">
            {feed.map((e, i) => (
              <li
                key={e.id}
                className="dispatch"
                style={{ ["--src"]: e.hue, animationDelay: Math.min(i * 55, 600) + "ms" }}
              >
                <div className="d-rail">
                  <span className="d-time">{timeAgo(e.ts)}</span>
                </div>
                <div className="d-body">
                  <div className="d-head">
                    {e.type === "link" || e.type === "video" ? (
                      <FavIcon host={e.host} />
                    ) : null}
                    <span className="d-src">{e.label}</span>
                    {e.host && <span className="d-host">{e.host}</span>}
                    {isOwner && (
                      <button className="d-del" onClick={() => remove(e.id)} title="remove">
                        {"\u2715"}
                      </button>
                    )}
                  </div>

                  {e.type === "link" ? (
                    <a className="d-title" href={e.url} target="_blank" rel="noreferrer">
                      {e.title}
                      <span className="d-arrow">{"\u2197"}</span>
                    </a>
                  ) : e.title ? (
                    <div className="d-title-static">{e.title}</div>
                  ) : null}

                  {e.type === "video" && (
                    <div className="d-embed">
                      <iframe
                        src={`https://www.youtube.com/embed/${e.videoId}`}
                        title={e.title || "video"}
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                        loading="lazy"
                      />
                    </div>
                  )}

                  {e.type === "image" && (
                    <a className="d-img-link" href={e.src} target="_blank" rel="noreferrer">
                      <img className="d-img" src={e.src} alt={e.title || ""} loading="lazy" />
                    </a>
                  )}

                  {e.type === "pdf" && (
                    <div className="d-pdf">
                      <a className="d-pdf-bar" href={e.src} target="_blank" rel="noreferrer">
                        <span className="d-pdf-ico">{"\u25a4"} PDF</span>
                        <span className="d-pdf-name">{e.name}</span>
                        <span className="d-arrow">open {"\u2197"}</span>
                      </a>
                      <iframe className="d-pdf-frame" src={e.src} title={e.name} loading="lazy" />
                    </div>
                  )}

                  {e.note && <p className="d-note">{e.note}</p>}
                </div>
              </li>
            ))}
          </ol>
        )}
      </main>

      <footer className="wire-foot">
        <span>{feed.length} filed</span>
        <span className="sep">{"\u00b7"}</span>
        <span>links · video · images · pdfs</span>
        <span className="sep">{"\u00b7"}</span>
        <span>djaniefendi.com</span>
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Newsreader:ital,opsz,wght@0,16..72,400;0,16..72,500;1,16..72,400;1,16..72,500&display=swap');

*{ margin:0; padding:0; box-sizing:border-box; }
html,body,#root{ min-height:100%; }
body{ background:#0b0b0e; }

.wire-root{
  --bg:#0b0b0e; --bg2:#121217; --card:#15151b; --card2:#1a1a21;
  --ink:#ECEAE3; --dim:#8b8b82; --faint:#5c5c57;
  --amber:#FFB000; --line:rgba(255,255,255,.08);
  --mono:'IBM Plex Mono',ui-monospace,SFMono-Regular,Menlo,monospace;
  --serif:'Newsreader',Georgia,'Times New Roman',serif;
  position:relative; min-height:100vh; background:var(--bg);
  color:var(--ink); font-family:var(--mono); overflow-x:hidden;
}
.wire-root *{ box-sizing:border-box; }

.wire-root::before{
  content:""; position:fixed; inset:0; pointer-events:none; z-index:0;
  background:
    radial-gradient(120% 80% at 50% -10%, rgba(255,176,0,.06), transparent 55%),
    radial-gradient(140% 120% at 50% 120%, rgba(0,0,0,.55), transparent 60%);
}
.wire-root::after{
  content:""; position:fixed; inset:0; pointer-events:none; z-index:0; opacity:.05;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
}
.wire-head, .wire-main, .wire-foot{ position:relative; z-index:1; }

.wire-head{ border-bottom:1px solid var(--line); background:linear-gradient(180deg,rgba(20,20,26,.6),transparent); }
.head-inner{ max-width:760px; margin:0 auto; padding:20px 22px 12px; display:flex; align-items:baseline; justify-content:space-between; gap:16px; flex-wrap:wrap; }
.brand{ display:flex; align-items:baseline; gap:9px; letter-spacing:.04em; }
.brand-mark{ font-weight:600; font-size:19px; color:var(--ink); letter-spacing:.16em; }
.brand-slash{ color:var(--amber); font-size:15px; }
.brand-name{ font-weight:500; font-size:13px; color:var(--amber); letter-spacing:.34em; }
.head-meta{ display:flex; align-items:center; gap:9px; font-size:10.5px; color:var(--dim); letter-spacing:.12em; flex-wrap:wrap; }
.live{ display:inline-flex; align-items:center; gap:6px; color:var(--ink); }
.dot{ width:7px; height:7px; border-radius:50%; background:var(--amber); box-shadow:0 0 9px var(--amber); animation:pulse 1.8s ease-in-out infinite; }
.sep{ color:var(--faint); }
.clock{ font-variant-numeric:tabular-nums; }
.ownerbtn{ font-family:var(--mono); font-size:10.5px; letter-spacing:.14em; background:none; border:1px solid var(--line); color:var(--dim); border-radius:3px; padding:3px 8px; cursor:pointer; transition:all .15s; }
.ownerbtn:hover{ border-color:var(--amber); color:var(--amber); }
.ownerbtn.on{ color:var(--amber); border-color:color-mix(in srgb, var(--amber) 40%, transparent); }

.unlockbar{ max-width:760px; margin:10px auto 0; padding:0 22px; display:flex; align-items:center; gap:10px; }
.unlockbar.err .ub-input{ border-color:#c0563f; }
.ub-glyph{ color:var(--amber); }
.ub-input{ flex:1; max-width:280px; background:rgba(0,0,0,.3); border:1px solid var(--line); border-radius:3px; padding:8px 11px; color:var(--ink); font-family:var(--mono); font-size:13px; outline:0; }
.ub-input:focus{ border-color:rgba(255,176,0,.45); }
.ub-err{ font-size:10.5px; color:#e0856b; letter-spacing:.06em; }

.ticker{ overflow:hidden; border-top:1px solid var(--line); border-bottom:1px solid var(--line); background:rgba(0,0,0,.25); margin-top:14px; }
.ticker-track{ display:inline-flex; white-space:nowrap; animation:marquee 38s linear infinite; padding:7px 0; }
.ticker-track span{ font-size:10.5px; letter-spacing:.22em; color:var(--faint); padding:0 24px; }
.tagline{ max-width:760px; margin:0 auto; padding:13px 22px 18px; font-family:var(--serif); font-style:italic; font-size:15px; color:var(--dim); }

.wire-main{ max-width:760px; margin:0 auto; padding:8px 22px 60px; }

.composer{ border:1px solid var(--line); border-radius:4px; background:var(--card); margin:14px 0 30px; }
.composer.idle{ display:flex; align-items:center; gap:10px; padding:13px 14px; transition:border-color .2s, box-shadow .2s; }
.composer.idle:focus-within{ border-color:rgba(255,176,0,.45); box-shadow:0 0 0 1px rgba(255,176,0,.15); }
.composer.idle.err{ border-color:#c0563f; animation:shake .35s; }
.compose-glyph{ color:var(--amber); font-size:15px; }
.compose-input{ flex:1; background:transparent; border:0; outline:0; color:var(--ink); font-family:var(--mono); font-size:13.5px; }
.compose-input::placeholder{ color:var(--faint); }
.upmsg{ color:var(--dim); font-size:13px; }

.btn{ font-family:var(--mono); font-size:11.5px; letter-spacing:.08em; border-radius:3px; padding:8px 13px; cursor:pointer; border:1px solid var(--line); background:transparent; color:var(--ink); transition:all .16s; white-space:nowrap; }
.btn:hover{ border-color:var(--amber); color:var(--amber); }
.btn.ghost{ color:var(--dim); }
.btn:disabled{ opacity:.6; cursor:wait; }

.composer.active{ padding:16px; border-color:color-mix(in srgb, var(--src) 35%, var(--line)); }
.comp-top{ display:flex; align-items:center; gap:9px; margin-bottom:13px; }
.comp-typetag{ font-size:9px; letter-spacing:.16em; color:var(--src); border:1px solid color-mix(in srgb, var(--src) 35%, transparent); padding:2px 6px; border-radius:3px; }
.comp-src{ font-size:10.5px; letter-spacing:.18em; color:var(--src); font-weight:500; }
.comp-url{ flex:1; font-size:11.5px; color:var(--dim); text-decoration:none; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.comp-url:hover{ color:var(--ink); }
.x, .d-del{ background:none; border:0; color:var(--faint); cursor:pointer; font-size:12px; padding:2px 5px; border-radius:3px; }
.x:hover, .d-del:hover{ color:#e0856b; background:rgba(224,133,107,.1); }
.comp-thumb{ width:100%; max-height:220px; object-fit:cover; border-radius:4px; border:1px solid var(--line); margin-bottom:11px; display:block; }
.comp-pdf{ font-size:13px; color:var(--src); padding:14px; border:1px dashed color-mix(in srgb, var(--src) 35%, transparent); border-radius:4px; margin-bottom:11px; }

.comp-title{ width:100%; background:rgba(0,0,0,.22); border:1px solid var(--line); border-radius:3px; padding:10px 11px; color:var(--ink); font-family:var(--serif); font-size:18px; outline:0; margin-bottom:9px; }
.comp-title::placeholder{ color:var(--faint); font-style:italic; }
.comp-note{ width:100%; background:rgba(0,0,0,.22); border:1px solid var(--line); border-radius:3px; padding:10px 11px; color:var(--ink); font-family:var(--serif); font-size:15px; font-style:italic; outline:0; resize:vertical; line-height:1.5; }
.comp-note::placeholder{ color:var(--faint); }
.comp-title:focus, .comp-note:focus{ border-color:color-mix(in srgb, var(--src) 50%, transparent); }

.comp-actions{ display:flex; align-items:center; gap:11px; margin-top:13px; }
.btn.magic{ border-color:color-mix(in srgb, var(--amber) 40%, var(--line)); color:var(--amber); display:inline-flex; align-items:center; gap:7px; }
.btn.magic:hover{ background:rgba(255,176,0,.08); }
.btn.post{ margin-left:auto; background:var(--amber); color:#10100a; border-color:var(--amber); font-weight:600; }
.btn.post:hover{ filter:brightness(1.08); color:#10100a; }
.summ-err{ font-size:10.5px; color:#e0856b; letter-spacing:.04em; }
.spin{ width:11px; height:11px; border:1.5px solid rgba(255,176,0,.3); border-top-color:var(--amber); border-radius:50%; display:inline-block; animation:spin .7s linear infinite; }

.fav{ width:17px; height:17px; border-radius:3px; flex:none; background:#222; }
.fav-fallback{ font-size:14px; color:var(--dim); width:17px; text-align:center; flex:none; }

.feed{ list-style:none; margin:0; padding:0; }
.dispatch{ display:grid; grid-template-columns:74px 1fr; gap:0; border-top:1px solid var(--line); padding:20px 0; animation:fadeUp .5s both cubic-bezier(.2,.7,.2,1); }
.dispatch:hover .d-title{ color:var(--src); }
.d-rail{ padding-top:2px; }
.d-time{ font-size:10px; letter-spacing:.1em; color:var(--faint); text-transform:uppercase; }
.d-body{ min-width:0; }
.d-head{ display:flex; align-items:center; gap:8px; margin-bottom:9px; }
.d-src{ font-size:10px; letter-spacing:.18em; font-weight:500; color:var(--src); border:1px solid color-mix(in srgb, var(--src) 32%, transparent); background:color-mix(in srgb, var(--src) 11%, transparent); padding:2px 7px; border-radius:3px; }
.d-host{ font-size:11px; color:var(--faint); }
.d-del{ margin-left:auto; opacity:0; transition:opacity .15s; }
.dispatch:hover .d-del{ opacity:1; }
.d-title{ font-family:var(--serif); font-size:21px; line-height:1.3; color:var(--ink); text-decoration:none; display:inline; transition:color .18s; font-weight:400; }
.d-title-static{ font-family:var(--serif); font-size:21px; line-height:1.3; color:var(--ink); font-weight:400; margin-bottom:2px; }
.d-arrow{ font-family:var(--mono); font-size:13px; color:var(--src); margin-left:7px; opacity:.7; }
.d-note{ font-family:var(--serif); font-style:italic; font-size:15.5px; line-height:1.55; color:var(--dim); margin:10px 0 0; padding-left:13px; border-left:2px solid color-mix(in srgb, var(--src) 40%, transparent); }

.d-embed{ position:relative; padding-top:56.25%; margin-top:12px; border-radius:7px; overflow:hidden; border:1px solid var(--line); background:#000; }
.d-embed iframe{ position:absolute; inset:0; width:100%; height:100%; border:0; }
.d-img-link{ display:block; margin-top:12px; }
.d-img{ max-width:100%; border-radius:7px; display:block; border:1px solid var(--line); }
.d-pdf{ margin-top:12px; }
.d-pdf-bar{ display:flex; align-items:center; gap:10px; padding:11px 13px; border:1px solid color-mix(in srgb, var(--src) 30%, var(--line)); background:color-mix(in srgb, var(--src) 7%, transparent); border-radius:6px; text-decoration:none; }
.d-pdf-ico{ font-size:10px; letter-spacing:.14em; color:var(--src); white-space:nowrap; }
.d-pdf-name{ flex:1; font-size:12.5px; color:var(--ink); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.d-pdf-frame{ width:100%; height:520px; border:1px solid var(--line); border-radius:7px; margin-top:10px; background:#fff; }

.empty{ text-align:center; padding:70px 20px; color:var(--faint); }
.empty-big{ font-size:13px; letter-spacing:.3em; color:var(--dim); margin-bottom:12px; }
.empty-sub{ font-family:var(--serif); font-style:italic; font-size:15px; max-width:360px; margin:0 auto; line-height:1.55; }

.wire-foot{ max-width:760px; margin:0 auto; padding:22px; border-top:1px solid var(--line); display:flex; gap:9px; flex-wrap:wrap; font-size:10px; letter-spacing:.12em; color:var(--faint); }

.drop-overlay{ position:fixed; inset:0; z-index:50; display:flex; align-items:center; justify-content:center; pointer-events:none; opacity:0; transition:opacity .2s; background:rgba(11,11,14,.82); backdrop-filter:blur(3px); }
.drop-overlay.on{ opacity:1; }
.drop-inner{ display:flex; flex-direction:column; align-items:center; gap:18px; transform:scale(.96); transition:transform .2s; }
.drop-overlay.on .drop-inner{ transform:scale(1); }
.drop-ring{ width:96px; height:96px; border:2px dashed var(--amber); border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:34px; color:var(--amber); box-shadow:0 0 40px rgba(255,176,0,.25); animation:float 1.6s ease-in-out infinite; }
.drop-label{ font-size:12px; letter-spacing:.3em; color:var(--amber); }

.toast{ position:fixed; bottom:24px; left:50%; transform:translateX(-50%); z-index:60; background:#1a1a21; border:1px solid var(--line); color:var(--ink); font-size:12px; letter-spacing:.04em; padding:10px 16px; border-radius:5px; box-shadow:0 8px 30px rgba(0,0,0,.5); animation:fadeUp .3s both; }

@keyframes pulse{ 0%,100%{opacity:1} 50%{opacity:.35} }
@keyframes spin{ to{transform:rotate(360deg)} }
@keyframes marquee{ from{transform:translateX(0)} to{transform:translateX(-50%)} }
@keyframes fadeUp{ from{opacity:0; transform:translateY(14px)} to{opacity:1; transform:translateY(0)} }
@keyframes shake{ 0%,100%{transform:translateX(0)} 25%{transform:translateX(-5px)} 75%{transform:translateX(5px)} }
@keyframes float{ 0%,100%{transform:translateY(0)} 50%{transform:translateY(-7px)} }

@media (max-width:560px){
  .head-inner{ flex-direction:column; gap:7px; align-items:flex-start; }
  .dispatch{ grid-template-columns:1fr; gap:7px; }
  .d-rail{ padding-top:0; }
  .d-title, .d-title-static{ font-size:19px; }
  .tagline{ font-size:14px; }
  .comp-actions{ flex-wrap:wrap; }
  .btn.post{ margin-left:0; }
  .d-pdf-frame{ height:360px; }
}
`;
