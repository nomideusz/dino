#!/usr/bin/env python3
"""Reassign mirrored media from the ingest token user to per-channel owners.

Run on the MediaCMS host:
  docker exec -i mediacms-web-1 python3 - < reassign-channel-owners.py

MediaCMS sets the API token user (nom) as owner on every upload. Channel
identity lives in tags; this script moves ownership to a User whose username
matches the channel tag.
"""
import os
import re
import secrets

import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "cms.settings")
django.setup()

from files.methods import change_media_owner  # noqa: E402
from users.models import Media, User  # noqa: E402

INGEST_USER = os.environ.get("MEDIACMS_INGEST_USER", "nom")
VALID_USERNAME = re.compile(r"^[a-z0-9-]+$")


def normalize_username(tag: str) -> str:
    return re.sub(r"[^a-z0-9-]", "", tag.lower())


def channel_from_description(description: str) -> str:
    for line in (description or "").splitlines():
        if line.startswith("Channel:"):
            return line.split(":", 1)[1].strip()
    return ""


def resolve_channel(media) -> str:
    channel_tags = [t.title for t in media.tags.all() if t.title != "youtube-mirror"]
    if channel_tags:
        return channel_tags[0]
    return channel_from_description(media.description)


fixed = 0
created = 0
skipped = 0
failed = 0
invalid = 0

for media in Media.objects.filter(user__username=INGEST_USER).prefetch_related("tags"):
    raw_channel = resolve_channel(media)
    if not raw_channel:
        skipped += 1
        continue

    chan = normalize_username(raw_channel)
    if not chan or not VALID_USERNAME.match(chan):
        invalid += 1
        print(f"skip invalid username from {raw_channel!r}: {media.friendly_token}")
        continue

    owner, was_created = User.objects.get_or_create(
        username=chan,
        defaults={
            "email": f"{chan}@local.invalid",
            "name": raw_channel,
        },
    )
    if was_created:
        owner.set_password(secrets.token_hex(16))
        owner.save(update_fields=["password"])
        created += 1

    result = change_media_owner(media.id, owner)
    if result is None:
        failed += 1
        print(f"fail {media.friendly_token} → {chan}")
    else:
        fixed += 1

print(
    f"fixed={fixed} created_users={created} skipped_no_tag={skipped} "
    f"invalid_tag={invalid} failed={failed}"
)
