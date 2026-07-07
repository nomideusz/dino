// World — BBC World RSS plus major earthquakes (M6.5+) from USGS. The feed
// gives ~25 headlines a day; the editor keeps only what genuinely matters.

import { fetchFeed } from "./rss.mjs";
import { condense, fetchJson } from "./util.mjs";
import { feedCandidates } from "./feedShared.mjs";

const BBC_WORLD = "https://feeds.bbci.co.uk/news/world/rss.xml";
const USGS_MAJOR = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson";
const MIN_MAGNITUDE = 6.5;

export const WorldNews = {
  name: "world",
  refreshEveryMs: 30 * 60_000,
  /** @param {AbortSignal} signal */
  async fetchCandidates(signal) {
    const [bbc, quakes] = await Promise.allSettled([
      fetchFeed(BBC_WORLD, signal),
      fetchMajorQuakes(signal),
    ]);
    const out = [];
    if (bbc.status === "fulfilled") {
      out.push(
        ...feedCandidates(bbc.value, {
          category: "world",
          sourceName: "bbc news",
          idPrefix: "bbc-world",
        })
      );
    }
    if (quakes.status === "fulfilled") out.push(...quakes.value);
    return out;
  },
};

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
