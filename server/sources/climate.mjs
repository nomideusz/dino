// Climate — environment and energy-transition desks. Distinct from the
// science category: policy, extreme weather, and systemic shifts rather
// than pure research papers.

import { fetchFeed } from "./rss.mjs";
import { feedCandidates } from "./feedShared.mjs";

const CLIMATE_FEEDS = [
  { url: "https://www.theguardian.com/environment/rss", sourceName: "the guardian", idPrefix: "gdn-env" },
  { url: "https://www.carbonbrief.org/feed", sourceName: "carbon brief", idPrefix: "carbon-brief" },
  { url: "https://yaleclimateconnections.org/feed/", sourceName: "yale climate connections", idPrefix: "yale-climate" },
];

export const Climate = {
  name: "climate",
  refreshEveryMs: 45 * 60_000,
  /** @param {AbortSignal} signal */
  async fetchCandidates(signal) {
    const results = await Promise.allSettled(
      CLIMATE_FEEDS.map(({ url }) => fetchFeed(url, signal))
    );
    const out = [];
    results.forEach((result, index) => {
      if (result.status !== "fulfilled") return;
      const { sourceName, idPrefix } = CLIMATE_FEEDS[index];
      out.push(
        ...feedCandidates(result.value, {
          category: "climate",
          sourceName,
          idPrefix,
        })
      );
    });
    return out;
  },
};
