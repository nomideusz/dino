#!/bin/bash
# Remove stale mirror staging files from $TMP. Successful uploads delete
# immediately; this catches failed/partial downloads left behind.
set -u

TMP="${TMP:-/data/state/tmp}"
PRUNE_DAYS="${PRUNE_DAYS:-7}"

ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }

[ -d "$TMP" ] || exit 0

deleted=0
while IFS= read -r -d '' f; do
	rm -f "$f"
	deleted=$((deleted + 1))
done < <(find "$TMP" -type f -mtime +"$PRUNE_DAYS" -print0 2>/dev/null)

find "$TMP" -mindepth 1 -type d -empty -delete 2>/dev/null || true

echo "[prune-tmp $(ts)] removed $deleted file(s) older than ${PRUNE_DAYS}d from $TMP"
