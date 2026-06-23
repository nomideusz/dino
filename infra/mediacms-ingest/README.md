# MediaCMS ingest scripts

Versioned copies of scripts deployed to `/srv/mediacms-ingest/scripts/` on
**zaur-vps / Contabo** (`38.242.141.113`). The live stack is Docker Compose
(`mediacms-ingest` container), not CapRover.

Other scripts (`mirror.sh`, `discover-ingest.sh`, `download-audio.py`, …) still
live only on the VPS until migrated here.

## Scripts in this folder

| Script | Role |
|--------|------|
| `upload.sh` | POST video to MediaCMS; truncates title; **reassigns owner to channel user** |
| `cleanup.sh` | API retention — keep `KEEP_PER_CHANNEL` (default 10) newest videos per channel |
| `prune-tmp.sh` | Delete staging files in `/data/state/tmp` older than `PRUNE_DAYS` (default 7) |
| `reassign-channel-owners.py` | One-off: move existing uploads from `nom` → per-channel users |
| `crontab` | Full supercronic schedule |

Related: `infra/listenbrainz-ingest/lb-ingest.sh` → audio queue → storage-vps.

## Storage layout

| Path | Disk | Content |
|------|------|---------|
| `/srv/mediacms/media_files` | Contabo local | MediaCMS library (~24 GB) |
| `/srv/mediacms-ingest/state/tmp` | Contabo local | Mirror staging (should stay near empty) |
| `/mnt/remote-music` | storage-vps via rclone | Navidrome mp3s |

## Deploy

```sh
scp infra/mediacms-ingest/{upload,prune-tmp,cleanup}.sh contabo:/srv/mediacms-ingest/scripts/
scp infra/listenbrainz-ingest/lb-ingest.sh contabo:/srv/mediacms-ingest/scripts/
scp infra/mediacms-ingest/crontab contabo:/srv/mediacms-ingest/crontab
ssh contabo 'chmod +x /srv/mediacms-ingest/scripts/{upload,prune-tmp,cleanup,lb-ingest}.sh'
ssh contabo 'cd /srv/mediacms-ingest && docker compose restart ingest'
```

## Manual ops

```sh
# Fix existing videos still owned by nom (run on VPS)
ssh contabo 'docker exec -i mediacms-web-1 python3 -' < infra/mediacms-ingest/reassign-channel-owners.py

# Run MediaCMS retention now
docker exec mediacms-ingest /scripts/cleanup.sh

# Clear staging older than 7 days
docker exec mediacms-ingest /scripts/prune-tmp.sh
```
