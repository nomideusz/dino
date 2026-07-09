// World — BBC World RSS plus major earthquakes (M6.5+) from USGS, with
// additional desks from NPR, The Guardian, DW, and the New York Times. The
// feeds give a wide candidate pool; the editor keeps only what genuinely matters.

import { fetchFeed } from "./rss.mjs";
import { condense, fetchJson } from "./util.mjs";
import { feedCandidates } from "./feedShared.mjs";

const BBC_WORLD = "https://feeds.bbci.co.uk/news/world/rss.xml";
const NPR_WORLD = "https://feeds.npr.org/1004/rss.xml";
const GUARDIAN_WORLD = "https://www.theguardian.com/world/rss";
const DW_WORLD = "https://rss.dw.com/rdf/rss-en-world";
const NYT_WORLD = "https://rss.nytimes.com/services/xml/rss/nyt/World.xml";
const USGS_MAJOR = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson";
const MIN_MAGNITUDE = 6.5;

const WORLD_FEEDS = [
  { url: BBC_WORLD, sourceName: "bbc news", idPrefix: "bbc-world" },
  { url: NPR_WORLD, sourceName: "npr", idPrefix: "npr-world" },
  { url: GUARDIAN_WORLD, sourceName: "the guardian", idPrefix: "gdn-world" },
  { url: DW_WORLD, sourceName: "dw", idPrefix: "dw-world" },
  { url: NYT_WORLD, sourceName: "new york times", idPrefix: "nyt-world" },
];

export const WorldNews = {
  name: "world",
  refreshEveryMs: 30 * 60_000,
  /** @param {AbortSignal} signal */
  async fetchCandidates(signal) {
    const [feeds, quakes] = await Promise.allSettled([
      fetchWorldFeeds(signal),
      fetchMajorQuakes(signal),
    ]);
    const out = [];
    if (feeds.status === "fulfilled") out.push(...feeds.value);
    if (quakes.status === "fulfilled") out.push(...quakes.value);
    return out;
  },
};

async function fetchWorldFeeds(signal) {
  const results = await Promise.allSettled(
    WORLD_FEEDS.map(({ url }) => fetchFeed(url, signal))
  );
  const out = [];
  results.forEach((result, index) => {
    if (result.status !== "fulfilled") return;
    const { sourceName, idPrefix } = WORLD_FEEDS[index];
    out.push(
      ...feedCandidates(result.value, {
        category: "world",
        sourceName,
        idPrefix,
      })
    );
  });
  return out;
}

async function fetchMajorQuakes(signal) {
  const data = await fetchJson(USGS_MAJOR, signal);
  const out = [];
  for (const f of data.features ?? []) {
    const p = f.properties ?? {};
    const mag = p.mag;
    if (typeof mag !== "number" || mag < MIN_MAGNITUDE) continue;
    const place = (p.place ?? "somewhere out there").trim();
    out.push({
      id: `quake:${f.id}`,
      category: "world",
      title: `Magnitude ${mag.toFixed(1)} earthquake — ${condense(place, 120)}`,
      description: "",
      href: p.url,
      sourceName: "usgs",
      publishedAt: typeof p.time === "number" ? p.time : Date.now(),
      signal: Math.min(0.95, mag / 8),
      meta: `M${mag.toFixed(1)}`,
    });
  }
  return out;
}
