# ListenBrainz → Navidrome ingest

Scripts that turn [ListenBrainz](https://listenbrainz.org/) recommendations into
audio downloads on the Zaur VPS, reusing the existing **mediacms-ingest** pipeline.

## How it fits

Production on **zaur-vps** (Contabo, `38.242.141.113`):

| Component | Role |
|-----------|------|
| **`lb-ingest.sh`** (this folder) | ListenBrainz → YouTube search → queue |
| **`mediacms-ingest`** | `discover-ingest.sh` runs every minute, calls `download-audio.py` |
| **`/mnt/remote-music`** | rclone mount; Navidrome reads it at `music.zaur.app` |
| **Discover** | Manual search/save UI; shares the same queue and music dir |

```
ListenBrainz (nomideusz)
    → lb-ingest.sh (ytsearch + queue)
    → /srv/mediacms-discover-queue/*.audio_queued
    → discover-ingest.sh / download-audio.py (yt-dlp → mp3)
    → /mnt/remote-music
    → Navidrome → dino radio
```

## Recommendation sources (in order)

1. **Collaborative filtering** — `GET /1/cf/recommendation/user/{user}/recording`
   (returns HTTP 204 until enough listen history exists)
2. **Created-for-you playlists** — weekly ListenBrainz playlists when available
3. **LB Radio** — similar artists to a seed from recent listens (fallback today for
   [nomideusz](https://listenbrainz.org/user/nomideusz/) while CF is warming up)

Processed recording MBIDs are tracked in `seen-lb-mbids.txt` so the same track is
not queued twice.

## Deploy on zaur-vps

The live ingest stack lives at `/srv/mediacms-ingest/` (Docker Compose, not CapRover).

```sh
# From your machine (monorepo root)
scp infra/listenbrainz-ingest/lb-ingest.sh contabo:/srv/mediacms-ingest/scripts/
ssh contabo 'chmod +x /srv/mediacms-ingest/scripts/lb-ingest.sh'
```

Optional env file (copy from `.env.example` and edit `LB_USER_AGENT`):

```sh
scp infra/listenbrainz-ingest/.env.example contabo:/srv/mediacms-ingest/lb-ingest.env
# Add to docker-compose.yml under ingest.environment or ingest.env_file
```

Add the cron line from `crontab.snippet` to `/srv/mediacms-ingest/crontab`, then
restart the container:

```sh
ssh contabo 'cd /srv/mediacms-ingest && docker compose restart ingest'
```

### One-off test (inside the ingest container)

```sh
ssh contabo 'docker exec mediacms-ingest /scripts/lb-ingest.sh'
```

Watch the queue:

```sh
ssh contabo 'ls -la /srv/mediacms-discover-queue/'
docker logs -f mediacms-ingest
```

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `LB_USER` | `nomideusz` | ListenBrainz username |
| `LB_USER_AGENT` | — | **Required** — set a real contact string |
| `BATCH_SIZE` | `5` | Max new tracks to queue per run |
| `QUEUE_DIR` | `/discover-queue` | Shared with Discover |
| `STATE_DIR` | `/data/state` | Cookies, archives, seen MBIDs |
| `COOKIES` | `/data/state/cookies.txt` | YouTube cookies (same as mirror/discover) |

## Related

- Navidrome + Syncthing: `apps/dinosaurus/navidrome/`, deploy via `pnpm deploy:music`
- Dino radio proxy: `apps/dinosaurus/server/server.mjs` (`NAVIDROME_*` env vars)
- Discover app: CapRover `discover` (manual YouTube → audio/video save)
