# Deploy and Host Dino on Railway

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/dino?utm_medium=integration&utm_source=button&utm_campaign=dino)

[Dino](https://github.com/nomideusz/dino) is a quiet page of important news. No feed, no ads, no sign-in, no infinite scroll — a few times a day, a story that actually matters appears as a calm block of text, and Zaur, a tiny pixel dinosaur, walks between the stories and keeps you company.

## About Hosting Dino

Two small Railway services: the static frontend (a Vite app served by a dependency-free Node file server) and the archive (an editor + story archive with an SSE stream that polls a handful of quality RSS sources — BBC, Guardian, NPR, Hacker News, USGS). Your instance starts as an empty world and builds its own two-day story history on a small volume. **No database, no accounts, no required secrets.** Add an `ANTHROPIC_API_KEY` and Claude becomes the editor, choosing stories and writing calm summaries; without one, a built-in heuristic editor does the picking — dino works either way. The frontend learns its archive's URL at build time via a Docker build arg, wired automatically.

## Common Use Cases

- A personal, quiet alternative to doomscrolling — open it like a window, not an app
- A calm dashboard for a spare screen, kiosk, or new-tab page
- A tiny self-hosted example of an AI-curated (but AI-optional) content pipeline

## Dependencies for Dino Hosting

- None required. All news sources are keyless public RSS.
- Optional: an Anthropic API key for the Claude editor.

### Deployment Dependencies

- [Dino source on GitHub](https://github.com/nomideusz/dino)

### Implementation Details

**Your Dino is the `frontend` service's domain.** It starts empty on purpose — stories appear as the editor publishes them, and each persists for two days.

| Service | Role |
|---|---|
| frontend | Static Vite app + pixel dinosaur, public domain |
| archive | Editor, RSS pollers, story archive + SSE stream; snapshot on a volume at `/data` |

Notes:

- `ANTHROPIC_API_KEY` (archive service, optional): with it, Claude Haiku reads the day's sources and writes the summaries; without it, a heuristic editor selects stories. Add or remove it anytime.
- Stories persist across redeploys via the volume snapshot (`ARCHIVE_PERSIST_PATH`).
- The frontend's `VITE_ARCHIVE_URL` is baked at build time — if you change the archive's domain, redeploy the frontend.

## Why Deploy Dino on Railway?

Railway is a singular platform to deploy your infrastructure stack. Railway will host your infrastructure so you don't have to deal with configuration, while allowing you to vertically and horizontally scale it.

By deploying Dino on Railway, you get a quiet corner of the internet that is entirely yours — one step closer to a calmer web.
