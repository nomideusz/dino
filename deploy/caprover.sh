#!/usr/bin/env bash
set -euo pipefail

# Deploy one of dino's three CapRover apps from this repo root.
#   dino          → frontend (static Vite app)        → dino.zaur.app
#   dino-archive  → archive API / realtime / radio     → dino-archive.zaur.app
#   music         → Navidrome + Syncthing image        → music.zaur.app
#
# Requires `caprover login` (caproverName "captain").

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

APP="${1:-}"
if [[ "$APP" != "dino" && "$APP" != "dino-archive" && "$APP" != "music" ]]; then
	echo "Usage: $0 dino|dino-archive|music" >&2
	exit 1
fi

cleanup() {
	rm -f captain-definition deploy.tar
}
trap cleanup EXIT

case "$APP" in
dino)
	CAPROVER_APP=dino
	cp deploy/dino.captain-definition captain-definition
	tar -cf deploy.tar \
		captain-definition Dockerfile.frontend \
		package.json pnpm-lock.yaml .npmrc \
		vite.config.ts tsconfig.json index.html static-server.mjs \
		src public
	;;
dino-archive)
	CAPROVER_APP=dino-archive
	cp deploy/dino-archive.captain-definition captain-definition
	tar -cf deploy.tar \
		--exclude=node_modules \
		captain-definition Dockerfile.archive server
	;;
music)
	CAPROVER_APP=music
	cp deploy/music.captain-definition captain-definition
	tar -cf deploy.tar \
		captain-definition Dockerfile.navidrome navidrome
	;;
esac

exec caprover deploy --caproverName captain -a "$CAPROVER_APP" -t deploy.tar
