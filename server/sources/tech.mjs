// Tech — Hacker News front page plus desks from BBC Technology, Ars Technica,
// and MIT Technology Review. HN supplies point counts as a signal; the RSS
// feeds add slower, reported stories the editor can weigh alongside the front page.

import { fetchFeed } from "./rss.mjs";
import { condense, fetchJson, logScore } from "./util.mjs";
import { feedCandidates } from "./feedShared.mjs";

const HN_TOP = "https://hacker-news.firebaseio.com/v0/topstories.json";
const HN_ITEM = (id) => `https://hacker-news.firebaseio.com/v0/item/${id}.json`;
const FETCH_COUNT = 20;

const TECH_FEEDS = [
  { url: "https://feeds.bbci.co.uk/news/technology/rss.xml", sourceName: "bbc news", idPrefix: "bbc-tech" },
  { url: "https://feeds.arstechnica.com/arstechnica/index", sourceName: "ars technica", idPrefix: "ars-tech" },
  { url: "https://www.technologyreview.com/feed/", sourceName: "mit technology review", idPrefix: "mit-tr" },
];

export const Tech = {
  name: "hacker-news",
  refreshEveryMs: 20 * 60_000,
  /** @param {AbortSignal} signal */
  async fetchCandidates(signal) {
    const [hn, ...feeds] = await Promise.allSettled([
      fetchHnTop(signal),
      ...TECH_FEEDS.map(({ url }) => fetchFeed(url, signal)),
    ]);
    const out = [];
    if (hn.status === "fulfilled") out.push(...hn.value);
    feeds.forEach((result, index) => {
      if (result.status !== "fulfilled") return;
      const { sourceName, idPrefix } = TECH_FEEDS[index];
      out.push(
        ...feedCandidates(result.value, {
          category: "tech",
          sourceName,
          idPrefix,
        })
      );
    });
    return out;
  },
};

async function fetchHnTop(signal) {
  const ids = (await fetchJson(HN_TOP, signal)).slice(0, FETCH_COUNT);
  const stories = await Promise.allSettled(ids.map((id) => fetchJson(HN_ITEM(id), signal)));
  const out = [];
  for (const r of stories) {
    if (r.status !== "fulfilled") continue;
    const s = r.value;
    if (!s || !s.title || s.type !== "story") continue;
    const points = s.score ?? 0;
    const title = condense(String(s.title), 200);
    const href = s.url ?? `https://news.ycombinator.com/item?id=${s.id}`;
    out.push({
      id: `hn:${s.id}`,
      category: "tech",
      title,
      description: "",
      href,
      sourceName: "hacker news",
      publishedAt: (s.time ?? 0) * 1000,
      signal: logScore(points, 3),
      meta: `${points} points, ${s.descendants ?? 0} comments`,
    });
  }
  return out;
}
