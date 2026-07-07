// Shared helper for turning parsed RSS items into editor candidates.

import { createHash } from "node:crypto";

import { condense } from "./util.mjs";

const MAX_ITEMS_PER_FEED = 25;
const MAX_AGE_MS = 36 * 60 * 60_000;

/**
 * Live blogs, roundups, and quizzes are the opposite of "read it once, it
 * still matters next week" — push them to the bottom of the pile.
 */
const EPHEMERAL_TITLE = /\b(live|as it happened|at a glance|what we know|in pictures|quiz|briefing|updates?)\b/i;

/**
 * Map raw feed items into editor candidates. The `signal` prior blends feed
 * position (editors put the biggest stories first) with recency.
 *
 * @param {Array<{ title: string, link: string, description: string, publishedAt: number }>} items
 * @param {{ category: string, sourceName: string, idPrefix: string }} opts
 */
export function feedCandidates(items, { category, sourceName, idPrefix }) {
  const now = Date.now();
  const out = [];
  items.slice(0, MAX_ITEMS_PER_FEED).forEach((item, index) => {
    if (!item.title || !item.link) return;
    if (now - item.publishedAt > MAX_AGE_MS) return;
    const positionPrior = Math.max(0, 0.35 - index * 0.03);
    const hoursOld = Math.max(0, (now - item.publishedAt) / 3_600_000);
    const recencyPrior = Math.max(0, 0.35 - hoursOld * 0.02);
    const ephemeralPenalty = EPHEMERAL_TITLE.test(item.title) ? 0.3 : 0;
    out.push({
      id: `${idPrefix}:${hashUrl(item.link)}`,
      category,
      title: condense(item.title, 200),
      description: condense(item.description, 600),
      href: item.link,
      sourceName,
      publishedAt: item.publishedAt,
      signal: Math.max(0.05, 0.3 + positionPrior + recencyPrior - ephemeralPenalty),
    });
  });
  return out;
}

function hashUrl(url) {
  return createHash("sha1").update(url).digest("hex").slice(0, 12);
}
