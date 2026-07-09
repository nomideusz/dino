// Science — Ars Technica's science desk, NASA's Astronomy Picture of the Day,
// and desks from BBC Science, Nature, Science, and ESA. APOD is a single quiet
// daily item; the RSS feeds provide the candidate pool the editor picks from.

import { fetchFeed } from "./rss.mjs";
import { condense, fetchJson } from "./util.mjs";
import { feedCandidates } from "./feedShared.mjs";

const ARS_SCIENCE = "https://feeds.arstechnica.com/arstechnica/science";
const BBC_SCIENCE = "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml";
const NATURE = "https://www.nature.com/nature.rss";
const SCIENCE_MAG = "https://www.science.org/rss/news_current.xml";
const ESA = "https://www.esa.int/rssfeed/Our_Activities/Space_Science";
const NASA_KEY = process.env.NASA_API_KEY ?? "DEMO_KEY";
const APOD_URL = `https://api.nasa.gov/planetary/apod?api_key=${NASA_KEY}`;

const SCIENCE_FEEDS = [
  { url: ARS_SCIENCE, sourceName: "ars technica", idPrefix: "ars-sci" },
  { url: BBC_SCIENCE, sourceName: "bbc news", idPrefix: "bbc-sci" },
  { url: NATURE, sourceName: "nature", idPrefix: "nature" },
  { url: SCIENCE_MAG, sourceName: "science", idPrefix: "science-mag" },
  { url: ESA, sourceName: "esa", idPrefix: "esa" },
];

export const Science = {
  name: "science",
  refreshEveryMs: 45 * 60_000,
  /** @param {AbortSignal} signal */
  async fetchCandidates(signal) {
    const [feeds, apod] = await Promise.allSettled([
      fetchScienceFeeds(signal),
      fetchApod(signal),
    ]);
    const out = [];
    if (feeds.status === "fulfilled") out.push(...feeds.value);
    if (apod.status === "fulfilled" && apod.value) out.push(apod.value);
    return out;
  },
};

async function fetchScienceFeeds(signal) {
  const results = await Promise.allSettled(
    SCIENCE_FEEDS.map(({ url }) => fetchFeed(url, signal))
  );
  const out = [];
  results.forEach((result, index) => {
    if (result.status !== "fulfilled") return;
    const { sourceName, idPrefix } = SCIENCE_FEEDS[index];
    out.push(
      ...feedCandidates(result.value, {
        category: "science",
        sourceName,
        idPrefix,
      })
    );
  });
  return out;
}

// APOD is a daily feed — cache by UTC date so frequent refreshes don't burn
// NASA's free quota.
let apodCache = { date: "", item: /** @type {object|null} */ (null) };

async function fetchApod(signal) {
  const today = new Date().toISOString().slice(0, 10);
  if (apodCache.date === today && apodCache.item) return apodCache.item;
  const data = await fetchJson(APOD_URL, signal);
  if (!data?.title || !data?.date) return null;
  const item = {
    id: `apod:${data.date}`,
    category: "science",
    title: `Astronomy picture of the day: ${condense(data.title, 120)}`,
    description: condense(data.explanation ?? "", 500),
    href: `https://apod.nasa.gov/apod/ap${apodDateSlug(data.date)}.html`,
    sourceName: "nasa",
    publishedAt: Date.parse(data.date) || Date.now(),
    signal: 0.6,
  };
  apodCache = { date: today, item };
  return item;
}

function apodDateSlug(date) {
  // "2026-04-25" → "260425" matching apod.nasa.gov/apod/apYYMMDD.html
  const [y, m, d] = date.split("-");
  return `${y.slice(2)}${m}${d}`;
}
