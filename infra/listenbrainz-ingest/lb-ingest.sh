#!/usr/bin/env bash
# Fetch ListenBrainz recommendations for LB_USER, resolve artist/title,
# search YouTube via yt-dlp, and queue audio downloads for mediacms-ingest
# (discover-ingest.sh picks up *.audio_queued within a minute).
#
# Intended to run inside the mediacms-ingest container or on the VPS with the
# same paths (/discover-queue, /data/state, /music).
set -euo pipefail

LB_USER="${LB_USER:-nomideusz}"
LB_USER_AGENT="${LB_USER_AGENT:-zaur-lb-ingest/1.0 (nom@zaur.app)}"
BATCH_SIZE="${BATCH_SIZE:-5}"
QUEUE_DIR="${QUEUE_DIR:-/discover-queue}"
STATE_DIR="${STATE_DIR:-/data/state}"
SEEN_LB="${SEEN_LB:-$STATE_DIR/seen-lb-mbids.txt}"
COOKIES="${COOKIES:-/data/state/cookies.txt}"
LB_API="${LB_API:-https://api.listenbrainz.org/1}"
LB_RADIO_MODE="${LB_RADIO_MODE:-medium}"
LB_RADIO_POP_BEGIN="${LB_RADIO_POP_BEGIN:-0}"
LB_RADIO_POP_END="${LB_RADIO_POP_END:-100}"

mkdir -p "$QUEUE_DIR" "$STATE_DIR"
touch "$SEEN_LB"

ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }

lb_curl() {
	curl -sS -H "User-Agent: $LB_USER_AGENT" "$@"
}

already_seen() {
	grep -qxF "$1" "$SEEN_LB" 2>/dev/null
}

mark_seen() {
	echo "$1" >>"$SEEN_LB"
}

audio_pipeline_busy() {
	local vid="$1"
	local ext
	for ext in audio_queued audio_running audio_progress; do
		[[ -f "$QUEUE_DIR/$vid.$ext" ]] && return 0
	done
	return 1
}

queue_audio() {
	local vid="$1"
	if audio_pipeline_busy "$vid"; then
		return 1
	fi
	touch "$QUEUE_DIR/$vid.audio_queued"
	return 0
}

# --- ListenBrainz: collect recording MBIDs -----------------------------------

fetch_cf_mbids() {
	local body code
	body="$(lb_curl -w $'\n__HTTP__%{http_code}' \
		"$LB_API/cf/recommendation/user/$LB_USER/recording?count=$BATCH_SIZE")"
	code="${body##*__HTTP__}"
	body="${body%__HTTP__*}"

	if [[ "$code" != "200" ]]; then
		return 1
	fi

	echo "$body" | jq -r '.payload.mbids[]?.recording_mbid // empty'
}

fetch_createdfor_mbids() {
	local plists playlist_mbid body
	plists="$(lb_curl "$LB_API/user/$LB_USER/playlists/createdfor?count=5")"
	playlist_mbid="$(echo "$plists" | jq -r '.playlists[0].identifier // empty')"
	[[ -n "$playlist_mbid" ]] || return 1

	body="$(lb_curl "$LB_API/playlist/$playlist_mbid")"
	echo "$body" | jq -r '.playlist.track[]?.identifier // empty' | head -n "$BATCH_SIZE"
}

fetch_radio_mbids() {
	local listens seed body
	listens="$(lb_curl "$LB_API/user/$LB_USER/listens?count=50")"
	seed="$(
		echo "$listens" | jq -r '
			[.payload.listens[]?
				| .track_metadata.mbid_mapping.artist_mbids[0] // empty]
			| map(select(length > 0))
			| unique
			| .[]
		' | shuf -n 1
	)"
	[[ -n "$seed" ]] || return 1

	body="$(lb_curl \
		"$LB_API/lb-radio/artist/$seed?mode=$LB_RADIO_MODE&max_similar_artists=8&max_recordings_per_artist=4&pop_begin=$LB_RADIO_POP_BEGIN&pop_end=$LB_RADIO_POP_END")"
	echo "$body" | jq -r '[.[].[]?.recording_mbid] | unique[]' | head -n "$BATCH_SIZE"
}

collect_mbids() {
	local -a mbids=()
	local source="" line

	while IFS= read -r line; do
		[[ -n "$line" ]] && mbids+=("$line")
	done < <(fetch_cf_mbids 2>/dev/null || true)

	if ((${#mbids[@]} > 0)); then
		source="cf-recommendations"
	else
		while IFS= read -r line; do
			[[ -n "$line" ]] && mbids+=("$line")
		done < <(fetch_createdfor_mbids 2>/dev/null || true)
		if ((${#mbids[@]} > 0)); then
			source="createdfor-playlist"
		else
			while IFS= read -r line; do
				[[ -n "$line" ]] && mbids+=("$line")
			done < <(fetch_radio_mbids 2>/dev/null || true)
			source="lb-radio"
		fi
	fi

	if ((${#mbids[@]} == 0)); then
		echo "[lb-ingest $(ts)] no recording mbids from ListenBrainz (user=$LB_USER)" >&2
		exit 0
	fi

	echo "[lb-ingest $(ts)] source=$source count=${#mbids[@]} user=$LB_USER" >&2

	local mbid
	for mbid in "${mbids[@]}"; do
		echo "$mbid"
	done
}

# --- Metadata + YouTube --------------------------------------------------------

track_search_query() {
	local mbid="$1"
	local meta
	meta="$(lb_curl "$LB_API/metadata/recording/?recording_mbids=$mbid&inc=artist+release")"
	echo "$meta" | jq -r --arg m "$mbid" '
		.[$m].recording.name as $title
		| .[$m].artist.name as $artist
		| if ($title | length) > 0 and ($artist | length) > 0
			then "\($artist) \($title)"
			else empty
			end
	'
}

ytsearch_video_id() {
	local query="$1"
	local -a cmd=(
		yt-dlp
		"ytsearch1:$query"
		--dump-json
		--flat-playlist
		--no-download
		--no-warnings
		--remote-components ejs:github
		--extractor-args "youtube:player_client=mweb"
	)
	local result=""

	if [[ -f "$COOKIES" ]]; then
		cmd+=(--cookies "$COOKIES")
	fi

	result="$("${cmd[@]}" 2>/dev/null | jq -r '.id // empty' | head -n 1 || true)"
	echo "$result"
}

# --- Main ----------------------------------------------------------------------

main() {
	local queued=0 skipped=0 failed=0 processed=0
	local mbid query vid

	while IFS= read -r mbid; do
		[[ -n "$mbid" ]] || continue

		if already_seen "$mbid"; then
			skipped=$((skipped + 1))
			continue
		fi

		if ((processed >= BATCH_SIZE)); then
			break
		fi
		processed=$((processed + 1))

		query="$(track_search_query "$mbid")"
		if [[ -z "$query" ]]; then
			echo "[lb-ingest $(ts)] no metadata for $mbid" >&2
			failed=$((failed + 1))
			continue
		fi

		vid="$(ytsearch_video_id "$query")"
		if [[ -z "$vid" ]]; then
			echo "[lb-ingest $(ts)] no YouTube match: $query" >&2
			failed=$((failed + 1))
			continue
		fi

		if queue_audio "$vid"; then
			mark_seen "$mbid"
			queued=$((queued + 1))
			echo "[lb-ingest $(ts)] queued $vid — $query"
		else
			skipped=$((skipped + 1))
			echo "[lb-ingest $(ts)] already queued/running: $vid — $query"
		fi

		sleep 2
	done < <(collect_mbids)

	echo "[lb-ingest $(ts)] done queued=$queued skipped=$skipped failed=$failed"
}

main "$@"
