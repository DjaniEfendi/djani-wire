# DJANI ⁄⁄ THE WIRE

A live feed of what you're reading. Drag a link onto the page (or paste one),
add your take, and it posts as a "dispatch". Everything runs on Cloudflare —
no separate database service, no API key.

- **Front-end:** React + Vite (static)
- **Feed storage:** Cloudflare KV (via `/api/feed`)
- **Link auto-fill:** a Cloudflare Pages Function that reads the page's own
  Open Graph tags server-side (via `/api/preview`) — title + description,
  free, works on most pages including many paywalled ones.

---

## Deploy — the easy way (GitHub → Cloudflare Pages, no tooling on your machine)

You don't even need Node installed locally; Cloudflare builds it for you.

### 1. Put this folder in a GitHub repo
Create a new repo on github.com and upload these files (you can literally
drag the folder contents into the GitHub web uploader), or from a terminal:
```
git init
git add .
git commit -m "the wire"
git branch -M main
git remote add origin https://github.com/<you>/djani-wire.git
git push -u origin main
```

### 2. Create a KV namespace
In the Cloudflare dashboard (same place you registered the domain):
**Storage & databases → KV → Create a namespace.** Call it `wire-kv`.

### 3. Create the Pages project
**Compute → Workers & Pages → Create → Pages → Connect to Git.**
Pick your repo, then set:

| Setting              | Value           |
|----------------------|-----------------|
| Framework preset     | Vite            |
| Build command        | `npm run build` |
| Build output directory | `dist`        |

Click **Save and Deploy**. First build takes ~1–2 min.

### 4. Bind the KV namespace
In the new Pages project: **Settings → Bindings → Add → KV namespace.**
- Variable name: `WIRE_KV`  (exactly this)
- KV namespace: `wire-kv`

Then **redeploy** (Deployments → … → Retry deployment) so the binding takes effect.

### 5. Connect your domain
In the Pages project: **Custom domains → Set up a custom domain → `djaniefendi.com`**
(and add `www.djaniefendi.com` if you want). Because your DNS already lives on
Cloudflare, this is one click — it wires up the records automatically. HTTPS is
issued for you within a few minutes.

Done. Every push to `main` now auto-redeploys.

---

## Deploy — the CLI way (if you prefer Wrangler)
```
npm install
npx wrangler login
# create the KV namespace and copy the printed id into wrangler.toml:
npx wrangler kv namespace create WIRE_KV
npm run build
npx wrangler pages deploy dist --project-name djani-wire
```
Then bind KV + add the custom domain in the dashboard as in steps 4–5 above.

---

## Run it locally
```
npm install
npm run cf:dev      # builds, then serves with Functions + a local KV at http://localhost:8788
```
`npm run dev` alone runs only the front-end (Vite) — the `/api/*` routes won't
work without Wrangler, so use `npm run cf:dev` to test the full thing.

---

## Make it yours
- **Name / brand:** edit the `brand` block near the bottom of `src/App.jsx`
  (`DJANI`, `THE WIRE`) and the tagline just below it.
- **Source colours:** the `SOURCES` map at the top of `src/App.jsx` — add any
  publication with `"domain.com": ["LABEL", "#hexcolour"]`.
- **Default ticker** (shown when the feed is empty): the `tickerText` fallback
  in `src/App.jsx`.
- **Want AI summaries instead of plain OG descriptions later?** Add an
  Anthropic API key as a Pages secret and have `/api/preview` call the Messages
  API. The OG-tag version needs no key, so start there.

## Notes
- The feed is a single shared list — everyone who visits sees the same wire.
  That's the point (a public "what I'm reading"), but it also means anyone who
  finds the page can post/delete via the API. If you want it locked to just
  you later, put the site behind **Cloudflare Access** (Zero Trust → free for a
  handful of users) so only your email can load it.
- KV free tier (1k writes/day, 100k reads/day) is far more than a personal feed
  needs.
