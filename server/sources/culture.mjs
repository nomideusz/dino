// Culture — arts, books, film, and ideas from desks that still publish
// slowly enough for an editor to pick what lasts beyond the weekend.

import { fetchFeed } from "./rss.mjs";
import { feedCandidates } from "./feedShared.mjs";

const CULTURE_FEEDS = [
  { url: "https://www.theguardian.com/culture/rss", sourceName: "the guardian", idPrefix: "gdn-culture" },
  { url: "https://feeds.npr.org/1008/rss.xml", sourceName: "npr", idPrefix: "npr-arts" },
];

export const Culture = {
  name: "culture",
  refreshEveryMs: 45 * 60_000,
  /** @param {AbortSignal} signal */
  async fetchCandidates(signal) {
    const results = await Promise.allSettled(
      CULTURE_FEEDS.map(({ url }) => fetchFeed(url, signal))
    );
    const out = [];
    results.forEach((result, index) => {
      if (result.status !== "fulfilled") return;
      const { sourceName, idPrefix } = CULTURE_FEEDS[index];
      out.push(
        ...feedCandidates(result.value, {
          category: "culture",
          sourceName,
          idPrefix,
        })
      );
    });
    return out;
  },
};
