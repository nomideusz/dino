# AGENTS.md

## Cursor Cloud specific instructions

`dino` (zaur.app) is a single product with two dev services plus optional infra.
See `README.md` for the product overview and standard commands; only the
non-obvious dev/runtime caveats are captured here.

### Services & ports

| Service | Dir | Dev command | Port | Required |
|---|---|---|---|---|
| Frontend (Vite/TS) | repo root | `pnpm dev` | 5173 | yes |
| Archive server (Node, editor + SSE + `/article`) | `server/` | `npm start` (or `npm run dev` for `--watch`) | 8080 | yes for stories/SSE/reader |
| Music (Navidrome) | Docker only | n/a | 4533 | no — separate product, not wired into dino |

### Non-obvious caveats

- **Two separate installs.** The root is a **pnpm** project; `server/` is a
  **separate npm** package (its own `package-lock.json`, no pnpm workspace).
  Install both: `pnpm install` at root and `npm install` in `server/`.
- **No lint or test suite exists.** The closest thing to a lint check is
  `pnpm typecheck` (`tsc --noEmit`); `pnpm build` also runs it. There are no
  automated tests.
- **Local end-to-end wiring.** `VITE_ARCHIVE_URL` is a **build-time** Vite var
  and defaults to the production archive (`.env.development` also points there).
  To test the frontend against a **local** archive, start Vite with
  `VITE_ARCHIVE_URL=http://localhost:8080`, and start the server with
  `ALLOWED_ORIGINS` including the dev origin, e.g.
  `PORT=8080 ALLOWED_ORIGINS=http://localhost:5173,http://localhost:4173 npm start`.
  Without the matching `ALLOWED_ORIGINS`, the browser's `/archive` and `/events`
  calls are CORS-blocked.
- **The archive is empty at startup.** Sources fill a candidate pool
  immediately, but the first editorial pass runs only ~3 minutes after the
  server starts (`FIRST_PASS_DELAY_MS` in `server/editor.mjs`), then every ~2h.
  Expect no stories in `GET /archive` until that first pass. There is **no**
  ingest/publish endpoint — stories only appear via the editorial pass.
- **Editor without an API key.** `ANTHROPIC_API_KEY` is optional; without it a
  conservative heuristic picks stories (default path) and reuses feed
  descriptions. Set the key for the Claude editorial pass and dino "thoughts".
- **Network egress required.** The server fetches live feeds (Hacker News, BBC,
  Guardian, USGS, Ars Technica, NASA APOD) and the reader endpoint fetches
  original article pages; without outbound internet the archive stays empty.
- **Node version.** Requires Node >= 20; the VM ships Node 22 and pnpm 10.32.1
  (matches `packageManager`), so Corepack setup is not needed.
