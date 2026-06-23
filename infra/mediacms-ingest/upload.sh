#!/bin/bash
# Uploads one video file (with sidecar .info.json) to MediaCMS via the REST API,
# tagging it with the channel name so cleanup can find it later. Deletes local
# files on success.
#
# MediaCMS always sets the API token user as owner on POST. We reassign to a
# per-channel user (username = chan_tag) immediately after upload.
set -u

file="$1"
[ -f "$file" ] || { echo "[upload] no file: $file"; exit 1; }

base="${file%.*}"
info="$base.info.json"
thumb="$base.jpg"

if [ -f "$info" ]; then
    title=$(jq -r '.title // "Untitled"' "$info")
    description=$(jq -r '.description // ""' "$info")
    uploader=$(jq -r '.uploader // ""' "$info")
    video_id=$(jq -r '.id // ""' "$info")
    webpage_url=$(jq -r '.webpage_url // ""' "$info")
    upload_date=$(jq -r '.upload_date // ""' "$info")
else
    title=$(basename "$file" | sed 's/\.[^.]*$//')
    description=""
    uploader=""
    video_id=""
    webpage_url=""
    upload_date=""
fi

# MediaCMS rejects titles longer than 100 characters (HTTP 400).
title=$(printf '%s' "$title" | head -c 100)

# truncate description; MediaCMS handles huge text but keep API payload lean
description=$(printf '%s' "$description" | head -c 4000)
desc_full=$(printf '%s\n\nSource: %s\nChannel: %s\nUploaded: %s' "$description" "$webpage_url" "$uploader" "$upload_date")

# Tag with the channel slug so cleanup can group videos. Slugify: lowercase,
# spaces->dashes, drop non-alnum.
chan_tag=$(printf '%s' "$uploader" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd 'a-z0-9-')
if [ -n "$chan_tag" ]; then
    tags_field="$chan_tag,youtube-mirror"
else
    tags_field="youtube-mirror"
fi

mc_api() {
    curl -sS --max-time 120 \
        -H "Authorization: Token $MEDIACMS_TOKEN" \
        "$@"
}

ensure_channel_user() {
    local username="$1"
    local display_name="$2"
    local body code

    [ -n "$username" ] || return 1

    body=$(mc_api "${MEDIACMS_URL%/}/api/v1/users/$username")
    if printf '%s' "$body" | jq -e '.username' >/dev/null 2>&1; then
        return 0
    fi
    if ! printf '%s' "$body" | grep -q 'user does not exist'; then
        echo "[upload]   warn: user lookup failed for $username: $(printf '%s' "$body" | head -c 120)"
        return 1
    fi

    local email="${username}@local.invalid"
    local password
    password=$(openssl rand -hex 16)
    code=$(mc_api -o /dev/null -w "%{http_code}" \
        -X POST "${MEDIACMS_URL%/}/api/v1/users" \
        -H "Content-Type: application/json" \
        -d "$(jq -nc \
            --arg u "$username" \
            --arg n "${display_name:-$username}" \
            --arg e "$email" \
            --arg p "$password" \
            '{username:$u,name:$n,email:$e,password:$p}')")
    if [ "$code" = "201" ]; then
        echo "[upload]   created channel user $username"
        return 0
    fi
    echo "[upload]   warn: could not create user $username (http=$code)"
    return 1
}

assign_channel_owner() {
    local media_token="$1"
    local owner="$2"
    local code body

    [ -n "$media_token" ] && [ -n "$owner" ] || return 1

    body=$(mc_api -X POST "${MEDIACMS_URL%/}/api/v1/media/user/bulk_actions" \
        -H "Content-Type: application/json" \
        -d "$(jq -nc --arg t "$media_token" --arg o "$owner" \
            '{media_ids:[$t],action:"change_owner",owner:$o}')")
    if printf '%s' "$body" | grep -q 'Owner changed'; then
        echo "[upload]   owner → $owner"
        return 0
    fi
    echo "[upload]   warn: change_owner failed: $(printf '%s' "$body" | head -c 200)"
    return 1
}

echo "[upload] $title  (chan=$chan_tag id=$video_id $(du -h "$file" | awk '{print $1}'))"

# curl -F treats commas in filenames as multipart-mixed separators, and
# bare special chars can confuse @-syntax. Symlink to a clean name first.
ext="${file##*.}"
clean="$(dirname "$file")/vid_${video_id:-$$}.${ext}"
ln -sf "$file" "$clean"
resp=$(mktemp)
http_code=$(curl -sS -o "$resp" -w "%{http_code}" --max-time 1800 \
    -X POST "${MEDIACMS_URL%/}/api/v1/media" \
    -H "Authorization: Token $MEDIACMS_TOKEN" \
    -F "media_file=@$clean" \
    -F "title=$title" \
    -F "description=$desc_full" \
    -F "tags=$tags_field")
rm -f "$clean"

if [ "$http_code" = "201" ]; then
    friendly_token=$(jq -r '.friendly_token // ""' "$resp")
    echo "[upload]   ok  friendly_token=$friendly_token"

    if [ -n "$chan_tag" ] && [ -n "$friendly_token" ]; then
        ensure_channel_user "$chan_tag" "$uploader" || true
        assign_channel_owner "$friendly_token" "$chan_tag" || true
    fi

    rm -f "$resp" "$file" "$info" "$thumb" "$base.webp" "$base.png"
    # cleanup empty parent dir (the per-uploader subdir yt-dlp made)
    rmdir "$(dirname "$file")" 2>/dev/null || true
else
    echo "[upload]   FAIL http=$http_code"
    head -c 500 "$resp"; echo
    rm -f "$resp"
    exit 1
fi
