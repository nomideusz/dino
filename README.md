# 🦖 dino — a quiet page of important news

Dino lives in his world, which starts empty. There is no prompt, no feed, no
sign-in, no ads — just a minimal radio in the corner and, a few times a day,
a story that actually matters. A server-side editor reads a handful of
quality sources and publishes only the important ones, each with a short calm
summary. Published stories persist for two days as scattered text blocks;
Zaur, a tiny pixel dinosaur, walks between them, stands on them, and keeps
you company without interrupting.

Built with **Vite + TypeScript**, no bundled images, and any API keys it
needs stay server-side. Production runs as three CapRover apps on the Contabo
VPS:

- `dino` ([dino.zaur.app](https://dino.zaur.app)): the static Vite app served
  by `static-server.mjs`.
- `dino-archive` ([dino-archive.zaur.app](https://dino-archive.zaur.app)):
  the editor + story archive with an SSE stream, served from
  `server/server.mjs`.
- `music` ([music.zaur.app](https://music.zaur.app)): a custom Navidrome +
  Syncthing image (`Dockerfile.navidrome` + `navidrome/entrypoint.sh`) that
  hosts the music library on a shared volume.

> This used to live in the `zaur` monorepo at `apps/dinosaurus`. It is now a
> standalone repo. The pixel-art frames (formerly the shared `@zaur/sprite`
> package) are vendored into `src/spriteFrames.ts`.

## Quick start

```bash
pnpm install
pnpm dev      # http://localhost:5173
```

Build a static bundle:

```bash
pnpm build    # outputs to ./dist
pnpm preview  # serve ./dist locally
```

Run the archive service locally in another terminal (it's a standalone npm
package):

```bash
cd server
npm install
npm start     # http://localhost:8080
```

## How the editor works

1. **Sources** poll on their own schedules and fill a candidate pool:
   - **tech** — Hacker News front page (with points/comments as signals)
   - **world** — BBC World RSS + major earthquakes (M6.5+, USGS)
   - **ukraine** — The Guardian's Ukraine section + BBC's "War in Ukraine" topic
   - **science** — Ars Technica Science RSS + NASA's Astronomy Picture of the Day
2. **An editorial pass** runs every ~2 hours (`server/editor.mjs`). With
   `ANTHROPIC_API_KEY` set, Claude Haiku acts as editor-in-chief: it rates
   each candidate's importance (1–10) and writes a 2–3 sentence summary,
   strictly from the feed text it is given. Stories below importance 6 don't
   run, and picking nothing is normal. Without a key, a conservative
   heuristic (HN points, feed position, recency, live-blog demotion) picks at
   most one story per category per pass and reuses the feed's own description.
3. **Budgets** keep the page quiet: at most 4 stories per category per day,
   at most 2 per category per pass.
4. **Published stories persist 48 hours** in the archive (optionally
   snapshotted to disk via `ARCHIVE_PERSIST_PATH`) and stream to every
   visitor over SSE — a `snapshot` on connect, then `add` / `expire` deltas.
   Everyone sees the same world.

On the client, stories render as text blocks in even masonry columns (title,
summary, source) that double as physical terrain — Zaur has gravity and
stands on their top edges. Clicking a block opens a reading modal: the server
fetches the original page and extracts the readable paragraphs
(`server/reader.mjs`, exposed as `GET /article/<id>` for published stories
only), with the original link as fallback. The **archive** button in the
bottom bar lists everything from the last two days. Category toggles filter
what's shown (persisted per-visitor in `localStorage`).

Zaur himself is split into a body and a mind. The body (`src/dino.ts`) knows
how to walk (horizontal only — gravity owns the vertical), hop onto surfaces
with a real jump arc, nap, and stargaze. The mind (`src/dinoMind.ts`) strings
those into routines weighted by time of day: reading (walk under an unread
story, hop on top — climbing a column via a lower block when the target is
too high), patrolling the ground, returning to his home spot bottom-left,
napping there (long naps at night), and stargazing. New stories jump the
reading queue; opening the reading modal makes him wander over and keep you
company; clicks and pokes put the mind on hold so it never fights the user.

## Configuration

Frontend build-time variable:

- `VITE_ARCHIVE_URL`: public base URL for the archive service. In production
  this is `https://dino-archive.zaur.app`.

Archive runtime variables:

- `PORT`: HTTP port. CapRover sets this automatically.
- `ALLOWED_ORIGINS`: comma-separated browser origins allowed to call
  `/archive` and `/events`, for example
  `https://dino.zaur.app,http://localhost:5173,http://localhost:5174,http://localhost:4173`.
- `ARCHIVE_PERSIST_PATH`: optional snapshot path (e.g. `/data/stories.json`
  on a CapRover persistent volume) so the archive survives redeploys. Unset
  = in-memory only.
- `ANTHROPIC_API_KEY`: optional but strongly recommended; enables the Claude
  editorial pass (importance + summaries) and the dino's occasional
  thoughts. Without it the heuristic editor and a hand-written thought pool
  take over.
- `NASA_API_KEY`: optional; APOD works on `DEMO_KEY` but a real key is polite.

Navidrome service runtime variables (the bundled image):

- `ND_PORT`, `ND_MUSICFOLDER`, `ND_DATAFOLDER`: standard Navidrome — all paths
  live on the shared CapRover volume.
- `SYNCTHING_USER` (default `admin`), `SYNCTHING_PASSWORD`: required on first
  boot to seed the Syncthing GUI on `:8384` with bcrypted credentials.

The frontend reads `VITE_ARCHIVE_URL` at build time, so changing it requires a
new frontend build/deploy.

## Dino radio

The radio widget (top-left) embeds our real station, **Radio Bartek**, via
AzuraCast's public embed iframe (`radiobartek.com/public/radio_bartek/embed`).
The station and its library are managed in AzuraCast; dino just hosts the widget.

> The previous custom radio — an archive-server `/radio/*` Subsonic proxy in
> front of Navidrome, with per-channel playlists and pace — has been removed.
> `music.zaur.app` (Navidrome) is still a live, independently-used music server;
> it is simply no longer wired into dino's radio.

## Dino thoughts (speech bubble)

Zaur is the soul of the page, not a commentator. Every ~5–10 minutes the
server broadcasts a small `dino_thought` over SSE, driven by
`server/sources/musings.mjs` (Claude Haiku when `ANTHROPIC_API_KEY` is set,
hand-written fallback pool otherwise), quietly grounded in whatever the
editor recently published. The client renders it as a brief speech bubble
anchored above the dino's head (`src/dinoBubble.ts`), then fades out — no
card, no archive entry.

## What's inside

```
src/
├── main.ts            # entry point + dino/terrain orchestration + SSE
├── world.ts           # animated sky, sun/moon, clouds, weather particles
├── dino.ts            # the body: movement verbs, gravity, frames
├── dinoMind.ts        # the mind: day-rhythm routines (read/patrol/home/nap)
├── dinoBubble.ts      # ephemeral speech bubble for dino_thought events
├── sprite.ts          # canvas rendering for the dino frames
├── spriteFrames.ts    # programmatic pixel-art frames (vendored, no image files)
├── textTerrain.ts     # story blocks in even masonry columns (= platforms)
├── storyReader.ts     # full-article modal + two-day archive panel
├── weather.ts         # per-visitor weather + ambient sky state
└── services/
    └── content.ts     # the shared Story model + categories

server/                # standalone npm package (@anthropic-ai/sdk)
├── server.mjs         # story archive, SSE stream, /article reader endpoint
├── editor.mjs         # candidate pool, editorial pass (Claude or heuristic)
├── reader.mjs         # readable-paragraph extraction for the story modal
└── sources/           # tech (HN), world (BBC+USGS), ukraine, science, rss, musings

navidrome/
└── entrypoint.sh      # boots Syncthing in the background and Navidrome up front

Dockerfile.frontend    # → dino        (static Vite app)
Dockerfile.archive     # → dino-archive (server/)
Dockerfile.navidrome   # → music        (Navidrome + Syncthing)
deploy/                # caprover.sh + the three captain-definitions
infra/                 # listenbrainz-ingest + mediacms-ingest (music pipeline)
```

## Adding a new category or source

Add a source module under `server/sources/` and register it in
`server/server.mjs`:

```js
export const MarsWeather = {
  name: "mars-weather",
  refreshEveryMs: 30 * 60_000,
  async fetchCandidates(signal) {
    // fetch + map to { id, category, title, description, href,
    //                  sourceName, publishedAt, signal, meta? }
  },
};
```

If you introduce a new category, also add it to `CATEGORIES` in
`src/services/content.ts` and `server/server.mjs`, and give it an accent
color in `src/styles.css` (`.terrain-block.kind-…`). The editor's budgets
and the client's channel toggles pick it up automatically.

## Deploy

Production runs on CapRover (`captain.zaur.app` on the Contabo VPS). From this
repo root (requires `caprover login`):

```bash
pnpm deploy:dino           # frontend → dino.zaur.app
pnpm deploy:dino-archive   # API → dino-archive.zaur.app
pnpm deploy:music          # Navidrome → music.zaur.app
```

Captain definitions live in `deploy/` (`dino.captain-definition`,
`dino-archive.captain-definition`, `music.captain-definition`); the deploy
script is `deploy/caprover.sh`.

## Credits

- Tech: [Hacker News API](https://github.com/HackerNews/API)
- World: [BBC News RSS](https://www.bbc.co.uk/news/10628494) and the
  [USGS](https://earthquake.usgs.gov/fdsnws/event/1/) earthquake feed
- Ukraine: [The Guardian RSS](https://www.theguardian.com/world/ukraine) and
  BBC's War in Ukraine topic feed
- Science: [Ars Technica RSS](https://arstechnica.com/) and [NASA APOD](https://api.nasa.gov/)
- Weather: [Open-Meteo](https://open-meteo.com/) (no API key required)
- Approximate location: [ipapi.co](https://ipapi.co/) (falls back to London)
- Editor & musings: [Anthropic Claude](https://www.anthropic.com/) (Haiku) — optional
- Radio: [Radio Bartek](https://radiobartek.com/) on [AzuraCast](https://www.azuracast.com/) (embedded widget)

## License

MIT
