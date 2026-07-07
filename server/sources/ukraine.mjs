// Ukraine — dedicated coverage of the war and the country, from two feeds
// that both maintain a running Ukraine desk: The Guardian's Ukraine section
// and the BBC's "War in Ukraine" topic.

import { fetchFeed } from "./rss.mjs";
import { feedCandidates } from "./feedShared.mjs";

const GUARDIAN_UKRAINE = "https://www.theguardian.com/world/ukraine/rss";
const BBC_UKRAINE = "https://feeds.bbci.co.uk/news/topics/c1vw6q14rzqt/rss.xml";

export const Ukraine = {
  name: "ukraine",
  refreshEveryMs: 30 * 60_000,
  /** @param {AbortSignal} signal */
  async fetchCandidates(signal) {
    const [guardian, bbc] = await Promise.allSettled([
      fetchFeed(GUARDIAN_UKRAINE, signal),
      fetchFeed(BBC_UKRAINE, signal),
    ]);
    const out = [];
    if (guardian.status === "fulfilled") {
      out.push(
        ...feedCandidates(guardian.value, {
          category: "ukraine",
          sourceName: "the guardian",
          idPrefix: "gdn-ua",
        })
      );
    }
    if (bbc.status === "fulfilled") {
      out.push(
        ...feedCandidates(bbc.value, {
          category: "ukraine",
          sourceName: "bbc news",
          idPrefix: "bbc-ua",
        })
      );
    }
    return out;
  },
};
