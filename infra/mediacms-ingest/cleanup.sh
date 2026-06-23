#!/bin/bash
# Per-channel retention: for each unique channel tag (chan-* tag we attach at
# upload time), keep the newest $KEEP videos and delete the rest via the API.
# Channel tags are tagged alongside "youtube-mirror" by upload.sh.
set -u

KEEP="${KEEP_PER_CHANNEL:-10}"
PAGE_SIZE=100

ts() { date -Iseconds; }
echo "[cleanup $(ts)] keep=$KEEP per channel"

# Pull every page of media items tagged "youtube-mirror" so we don't touch
# manually-uploaded content.
page=1
all_json=$(mktemp)
echo "[]" > "$all_json"

while :; do
    resp=$(curl -sS --max-time 60 \
        -H "Authorization: Token $MEDIACMS_TOKEN" \
        "${MEDIACMS_URL%/}/api/v1/media?t=youtube-mirror&page=$page&page_size=$PAGE_SIZE")
    count=$(printf '%s' "$resp" | jq '.results | length' 2>/dev/null || echo 0)
    [ "$count" = "0" ] && break
    # merge results into all_json
    jq --argjson new "$(printf '%s' "$resp" | jq '.results')" '. + $new' "$all_json" > "$all_json.tmp" \
        && mv "$all_json.tmp" "$all_json"
    next=$(printf '%s' "$resp" | jq -r '.next // ""')
    [ -z "$next" ] && break
    page=$((page + 1))
done

total=$(jq 'length' "$all_json")
echo "[cleanup] found $total mirrored videos"

# Group by chan-* tag, keep newest $KEEP by add_date, delete the rest.
to_delete=$(jq -r --argjson keep "$KEEP" '
    map(. + {chan: ((.tags // []) | map(select(. != "youtube-mirror")) | .[0] // "_unknown")})
    | group_by(.chan)
    | map(sort_by(.add_date) | reverse | .[$keep:])
    | flatten
    | .[]
    | .friendly_token
' "$all_json")

deleted=0
for token in $to_delete; do
    [ -z "$token" ] && continue
    code=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 30 \
        -X DELETE -H "Authorization: Token $MEDIACMS_TOKEN" \
        "${MEDIACMS_URL%/}/api/v1/media/$token")
    if [ "$code" = "204" ] || [ "$code" = "200" ]; then
        deleted=$((deleted + 1))
    else
        echo "[cleanup]   delete $token failed http=$code"
    fi
done
echo "[cleanup $(ts)] deleted $deleted videos"
rm -f "$all_json"
