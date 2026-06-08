import React, { useState, useEffect, useRef, useCallback } from "react";

/* ------------------------------------------------------------------ */
/*  THE WIRE — a live feed of what you're reading                     */
/*  Talks to /api/feed (KV-backed) and /api/preview (OG-tag fetch).   */
/* ------------------------------------------------------------------ */

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
  if (bad) return <span className="fav-fallback">◍</span>;
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

  const [draft, setDraft] = useState("");
  const [urlErr, setUrlErr] = useState(false);

  const [comp, setComp] = useState(null); // {url, host, title, note, label, hue}
  const [fetching, setFetching] = useState(false);
  const [fetchErr, setFetchErr] = useState(false);

  const dragDepth = useRef(0);

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
        /* offline / api not ready */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const openComposer = useCallback((u) => {
    const host = u.hostname.replace(/^www\./, "");
    const [label, hue] = detectSource(u.hostname);
    setFetchErr(false);
    setComp({ url: u.href, host, title: "", note: "", label, hue });
  }, []);

  const captureDraft = () => {
    const u = normalizeUrl(draft);
    if (!u) {
      setUrlErr(true);
      setTimeout(() => setUrlErr(false), 1400);
      return;
    }
    openComposer(u);
    setDraft("");
  };

  /* drag & drop of links, anywhere on the page */
  useEffect(() => {
    const onEnter = (e) => {
      e.preventDefault();
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
      const dt = e.dataTransfer;
      const raw =
        (dt && (dt.getData("text/uri-list") || dt.getData("text/plain"))) || "";
      const u = normalizeUrl(raw.split("\n")[0]);
      if (u) openComposer(u);
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
  }, [openComposer]);

  /* global paste of a URL (ignored while typing in a field) */
  useEffect(() => {
    const onPaste = (e) => {
      const tag = document.activeElement && document.activeElement.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const txt = (e.clipboardData && e.clipboardData.getData("text")) || "";
      const u = normalizeUrl(txt);
      if (u) openComposer(u);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [openComposer]);

  /* auto-fill from the link's Open Graph tags (server-side fetch) */
  const autofill = async () => {
    if (!comp) return;
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
                c.label === c.host.toUpperCase() && m.source
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

  /* post (optimistic) */
  const post = async () => {
    if (!comp) return;
    const entry = {
      id: uid(),
      url: comp.url,
      host: comp.host,
      title: comp.title.trim() || comp.host,
      note: comp.note.trim(),
      label: comp.label,
      hue: comp.hue,
      ts: new Date().toISOString(),
    };
    setFeed((f) => [entry, ...f]);
    setComp(null);
    try {
      const r = await fetch("/api/feed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry),
      });
      if (!r.ok) throw new Error("post failed");
    } catch {
      setFeed((f) => f.filter((e) => e.id !== entry.id)); // rollback
    }
  };

  /* remove (optimistic) */
  const remove = async (id) => {
    const prev = feed;
    setFeed((f) => f.filter((e) => e.id !== id));
    try {
      await fetch("/api/feed", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
    } catch {
      setFeed(prev);
    }
  };

  /* ticker */
  const sourceCounts = feed.reduce((acc, e) => {
    acc[e.label] = (acc[e.label] || 0) + 1;
    return acc;
  }, {});
  const tickerItems = Object.entries(sourceCounts).sort((a, b) => b[1] - a[1]);
  const tickerText =
    tickerItems.length > 0
      ? tickerItems.map(([l, n]) => `${l} ×${n}`).join("    •    ")
      : "MARKETS    •    AI    •    SEMICONDUCTORS    •    CRYPTO    •    GEOPOLITICS";

  const clock = now.toLocaleTimeString("en-GB", { hour12: false });
  const date = now
    .toLocaleDateString("en-GB", {
      weekday: "short",
      day: "2-digit",
      month: "short",
    })
    .toUpperCase();

  return (
    <div className="wire-root">
      <style>{CSS}</style>

      <div className={"drop-overlay" + (dragging ? " on" : "")}>
        <div className="drop-inner">
          <div className="drop-ring">↧</div>
          <div className="drop-label">RELEASE TO FILE DISPATCH</div>
        </div>
      </div>

      <header className="wire-head">
        <div className="head-inner">
          <div className="brand">
            <span className="brand-mark">DJANI</span>
            <span className="brand-slash">⁄⁄</span>
            <span className="brand-name">THE WIRE</span>
          </div>
          <div className="head-meta">
            <span className="live">
              <span className="dot" /> LIVE
            </span>
            <span className="sep">·</span>
            <span>{feed.length} DISPATCHES</span>
            <span className="sep">·</span>
            <span className="clock">
              {date} {clock}
            </span>
          </div>
        </div>
        <div className="ticker">
          <div className="ticker-track">
            <span>{tickerText}</span>
            <span aria-hidden="true">{tickerText}</span>
          </div>
        </div>
        <p className="tagline">
          a live feed of what i'm reading — markets, machines &amp; everything
          between
        </p>
      </header>

      <main className="wire-main">
        {!comp ? (
          <div className={"composer idle" + (urlErr ? " err" : "")}>
            <span className="compose-glyph">↳</span>
            <input
              className="compose-input"
              placeholder="drop a link anywhere · or paste a URL here ↵"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && captureDraft()}
              spellCheck={false}
            />
            <button className="btn ghost" onClick={captureDraft}>
              capture
            </button>
          </div>
        ) : (
          <div className="composer active" style={{ ["--src"]: comp.hue }}>
            <div className="comp-top">
              <FavIcon host={comp.host} />
              <span className="comp-src">{comp.label}</span>
              <a
                className="comp-url"
                href={comp.url}
                target="_blank"
                rel="noreferrer"
              >
                {comp.url.replace(/^https?:\/\//, "")}
              </a>
              <button className="x" onClick={() => setComp(null)} title="discard">
                ✕
              </button>
            </div>
            <input
              className="comp-title"
              placeholder="headline (or hit auto-fill)"
              value={comp.title}
              onChange={(e) => setComp({ ...comp, title: e.target.value })}
            />
            <textarea
              className="comp-note"
              placeholder="your take — why is this worth reading?"
              value={comp.note}
              rows={2}
              onChange={(e) => setComp({ ...comp, note: e.target.value })}
            />
            <div className="comp-actions">
              <button className="btn magic" onClick={autofill} disabled={fetching}>
                {fetching ? (
                  <>
                    <span className="spin" /> fetching…
                  </>
                ) : (
                  <>✦ auto-fill</>
                )}
              </button>
              {fetchErr && (
                <span className="summ-err">couldn't read it — type it in</span>
              )}
              <button className="btn post" onClick={post}>
                file dispatch →
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="empty">loading the wire…</div>
        ) : feed.length === 0 ? (
          <div className="empty">
            <div className="empty-big">— wire is quiet —</div>
            <div className="empty-sub">
              drag a link onto this page, or paste one above, to file your first
              dispatch
            </div>
          </div>
        ) : (
          <ol className="feed">
            {feed.map((e, i) => (
              <li
                key={e.id}
                className="dispatch"
                style={{
                  ["--src"]: e.hue,
                  animationDelay: Math.min(i * 55, 600) + "ms",
                }}
              >
                <div className="d-rail">
                  <span className="d-time">{timeAgo(e.ts)}</span>
                </div>
                <div className="d-body">
                  <div className="d-head">
                    <FavIcon host={e.host} />
                    <span className="d-src">{e.label}</span>
                    <span className="d-host">{e.host}</span>
                    <button
                      className="d-del"
                      onClick={() => remove(e.id)}
                      title="remove"
                    >
                      ✕
                    </button>
                  </div>
                  <a
                    className="d-title"
                    href={e.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {e.title}
                    <span className="d-arrow">↗</span>
                  </a>
                  {e.note && <p className="d-note">{e.note}</p>}
                </div>
              </li>
            ))}
          </ol>
        )}
      </main>

      <footer className="wire-foot">
        <span>{feed.length} filed</span>
        <span className="sep">·</span>
        <span>drag · paste · auto-fill · file</span>
        <span className="sep">·</span>
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
.head-meta{ display:flex; align-items:center; gap:9px; font-size:10.5px; color:var(--dim); letter-spacing:.12em; }
.live{ display:inline-flex; align-items:center; gap:6px; color:var(--ink); }
.dot{ width:7px; height:7px; border-radius:50%; background:var(--amber); box-shadow:0 0 9px var(--amber); animation:pulse 1.8s ease-in-out infinite; }
.sep{ color:var(--faint); }
.clock{ font-variant-numeric:tabular-nums; }

.ticker{ overflow:hidden; border-top:1px solid var(--line); border-bottom:1px solid var(--line); background:rgba(0,0,0,.25); }
.ticker-track{ display:inline-flex; white-space:nowrap; animation:marquee 38s linear infinite; padding:7px 0; }
.ticker-track span{ font-size:10.5px; letter-spacing:.22em; color:var(--faint); padding:0 24px; }
.tagline{ max-width:760px; margin:0 auto; padding:13px 22px 18px; font-family:var(--serif); font-style:italic; font-size:15px; color:var(--dim); }

.wire-main{ max-width:760px; margin:0 auto; padding:8px 22px 60px; }

.composer{ border:1px solid var(--line); border-radius:4px; background:var(--card); margin:14px 0 30px; }
.composer.idle{ display:flex; align-items:center; gap:10px; padding:13px 14px; transition:border-color .2s, box-shadow .2s; }
.composer.idle:focus-within{ border-color:rgba(255,176,0,.45); box-shadow:0 0 0 1px rgba(255,176,0,.15); }
.composer.idle.err{ border-color:#c0563f; animation:shake .35s; }
.compose-glyph{ color:var(--amber); font-size:15px; }
.compose-input{ flex:1; background:transparent; border:0; outline:0; color:var(--ink); font-family:var(--mono); font-size:13.5px; letter-spacing:.01em; }
.compose-input::placeholder{ color:var(--faint); }

.btn{ font-family:var(--mono); font-size:11.5px; letter-spacing:.08em; border-radius:3px; padding:8px 13px; cursor:pointer; border:1px solid var(--line); background:transparent; color:var(--ink); transition:all .16s; }
.btn:hover{ border-color:var(--amber); color:var(--amber); }
.btn.ghost{ color:var(--dim); }
.btn:disabled{ opacity:.6; cursor:wait; }

.composer.active{ padding:16px; border-color:color-mix(in srgb, var(--src) 35%, var(--line)); }
.comp-top{ display:flex; align-items:center; gap:9px; margin-bottom:13px; }
.comp-src{ font-size:10.5px; letter-spacing:.18em; color:var(--src); font-weight:500; }
.comp-url{ flex:1; font-size:11.5px; color:var(--dim); text-decoration:none; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.comp-url:hover{ color:var(--ink); }
.x, .d-del{ background:none; border:0; color:var(--faint); cursor:pointer; font-size:12px; padding:2px 5px; border-radius:3px; }
.x:hover, .d-del:hover{ color:#e0856b; background:rgba(224,133,107,.1); }

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
.d-arrow{ font-family:var(--mono); font-size:13px; color:var(--src); margin-left:7px; opacity:.7; }
.d-note{ font-family:var(--serif); font-style:italic; font-size:15.5px; line-height:1.55; color:var(--dim); margin:10px 0 0; padding-left:13px; border-left:2px solid color-mix(in srgb, var(--src) 40%, transparent); }

.empty{ text-align:center; padding:70px 20px; color:var(--faint); }
.empty-big{ font-size:13px; letter-spacing:.3em; color:var(--dim); margin-bottom:12px; }
.empty-sub{ font-family:var(--serif); font-style:italic; font-size:15px; max-width:340px; margin:0 auto; line-height:1.55; }

.wire-foot{ max-width:760px; margin:0 auto; padding:22px; border-top:1px solid var(--line); display:flex; gap:9px; flex-wrap:wrap; font-size:10px; letter-spacing:.12em; color:var(--faint); }

.drop-overlay{ position:fixed; inset:0; z-index:50; display:flex; align-items:center; justify-content:center; pointer-events:none; opacity:0; transition:opacity .2s; background:rgba(11,11,14,.82); backdrop-filter:blur(3px); }
.drop-overlay.on{ opacity:1; }
.drop-inner{ display:flex; flex-direction:column; align-items:center; gap:18px; transform:scale(.96); transition:transform .2s; }
.drop-overlay.on .drop-inner{ transform:scale(1); }
.drop-ring{ width:96px; height:96px; border:2px dashed var(--amber); border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:34px; color:var(--amber); box-shadow:0 0 40px rgba(255,176,0,.25); animation:float 1.6s ease-in-out infinite; }
.drop-label{ font-size:12px; letter-spacing:.34em; color:var(--amber); }

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
  .d-title{ font-size:19px; }
  .tagline{ font-size:14px; }
  .comp-actions{ flex-wrap:wrap; }
  .btn.post{ margin-left:0; }
}
`;
