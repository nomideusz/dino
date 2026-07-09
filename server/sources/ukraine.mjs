// Ukraine — dedicated coverage of the war and the country, from The Guardian's
// Ukraine section, the BBC's "War in Ukraine" topic, Ukrainska Pravda, and
// the Kyiv Independent.

import { fetchFeed } from "./rss.mjs";
import { feedCandidates } from "./feedShared.mjs";

const GUARDIAN_UKRAINE = "https://www.theguardian.com/world/ukraine/rss";
const BBC_UKRAINE = "https://feeds.bbci.co.uk/news/topics/c1vw6q14rzqt/rss.xml";
const KYIV_INDEPENDENT = "https://kyivindependent.com/feed/rss/";
const UKR_PRAVDA = "https://www.pravda.com.ua/rss/";

const UKRAINE_FEEDS = [
  { url: GUARDIAN_UKRAINE, sourceName: "the guardian", idPrefix: "gdn-ua" },
  { url: BBC_UKRAINE, sourceName: "bbc news", idPrefix: "bbc-ua" },
  { url: KYIV_INDEPENDENT, sourceName: "kyiv independent", idPrefix: "kyiv-ind" },
  { url: UKR_PRAVDA, sourceName: "ukrainska pravda", idPrefix: "pravda-ua" },
];

export const Ukraine = {
  name: "ukraine",
  refreshEveryMs: 30 * 60_000,
  /** @param {AbortSignal} signal */
  async fetchCandidates(signal) {
    const results = await Promise.allSettled(
      UKRAINE_FEEDS.map(({ url }) => fetchFeed(url, signal))
    );
    const out = [];
    results.forEach((result, index) => {
      if (result.status !== "fulfilled") return;
      const { sourceName, idPrefix } = UKRAINE_FEEDS[index];
      out.push(
        ...feedCandidates(result.value, {
          category: "ukraine",
          sourceName,
          idPrefix,
        })
      );
    });
    return out;
  },
};
