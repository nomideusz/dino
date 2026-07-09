// Business — economy and markets desks. The editor filters out routine
// tick-by-tick market noise and keeps developments that still matter next week.

import { fetchFeed } from "./rss.mjs";
import { feedCandidates } from "./feedShared.mjs";

const BUSINESS_FEEDS = [
  { url: "https://www.theguardian.com/business/rss", sourceName: "the guardian", idPrefix: "gdn-biz" },
  { url: "https://feeds.bbci.co.uk/news/business/rss.xml", sourceName: "bbc news", idPrefix: "bbc-biz" },
  { url: "https://feeds.npr.org/1006/rss.xml", sourceName: "npr", idPrefix: "npr-biz" },
];

export const Business = {
  name: "business",
  refreshEveryMs: 30 * 60_000,
  /** @param {AbortSignal} signal */
  async fetchCandidates(signal) {
    const results = await Promise.allSettled(
      BUSINESS_FEEDS.map(({ url }) => fetchFeed(url, signal))
    );
    const out = [];
    results.forEach((result, index) => {
      if (result.status !== "fulfilled") return;
      const { sourceName, idPrefix } = BUSINESS_FEEDS[index];
      out.push(
        ...feedCandidates(result.value, {
          category: "business",
          sourceName,
          idPrefix,
        })
      );
    });
    return out;
  },
};
