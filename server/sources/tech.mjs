// Tech — Hacker News front page. We fetch the top stories with their point
// counts and hand them to the editor as candidates; the editor (Claude or
// the heuristic) decides which few actually matter today.

import { condense, fetchJson, logScore } from "./util.mjs";

const HN_TOP = "https://hacker-news.firebaseio.com/v0/topstories.json";
const HN_ITEM = (id) => `https://hacker-news.firebaseio.com/v0/item/${id}.json`;
const FETCH_COUNT = 20;

export const Tech = {
  name: "hacker-news",
  refreshEveryMs: 20 * 60_000,
  /** @param {AbortSignal} signal */
  async fetchCandidates(signal) {
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
  },
};
