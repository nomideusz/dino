// Science — Ars Technica's science desk plus NASA's Astronomy Picture of
// the Day. APOD is a single quiet daily item; Ars provides the candidate
// pool the editor picks from.

import { fetchFeed } from "./rss.mjs";
import { condense, fetchJson } from "./util.mjs";
import { feedCandidates } from "./feedShared.mjs";

const ARS_SCIENCE = "https://feeds.arstechnica.com/arstechnica/science";
const NASA_KEY = process.env.NASA_API_KEY ?? "DEMO_KEY";
const APOD_URL = `https://api.nasa.gov/planetary/apod?api_key=${NASA_KEY}`;

export const Science = {
  name: "science",
  refreshEveryMs: 45 * 60_000,
  /** @param {AbortSignal} signal */
  async fetchCandidates(signal) {
    const [ars, apod] = await Promise.allSettled([
      fetchFeed(ARS_SCIENCE, signal),
      fetchApod(signal),
    ]);
    const out = [];
    if (ars.status === "fulfilled") {
      out.push(
        ...feedCandidates(ars.value, {
          category: "science",
          sourceName: "ars technica",
          idPrefix: "ars-sci",
        })
      );
    }
    if (apod.status === "fulfilled" && apod.value) out.push(apod.value);
    return out;
  },
};

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
