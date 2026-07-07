// The quiet editor. Sources fill a candidate pool on their own schedules;
// every couple of hours the editor sits down, reads everything new, and
// publishes only the few stories that genuinely matter — a handful per
// category per day, each with a short calm summary.
//
// With ANTHROPIC_API_KEY set, Claude Haiku acts as editor-in-chief: it
// rates importance and writes the brief, strictly from the feed text it is
// given. Without a key (or when the call fails) a heuristic takes over:
// rank by source signals (HN points, feed position, recency) and use the
// feed's own description as the summary.

import Anthropic from "@anthropic-ai/sdk";

import { setMaxListeners } from "node:events";

const ABORT_LISTENERS_PER_SOURCE = 64;

const SOURCE_TICK_MS = 60_000;
const EDITORIAL_INTERVAL_MS = 2 * 60 * 60_000;
const FIRST_PASS_DELAY_MS = 3 * 60_000;
const CANDIDATE_MAX_AGE_MS = 36 * 60 * 60_000;
const MAX_POOL_ITEMS = 400;

/** Editorial budget: how many stories may run per category per day. */
const MAX_PER_CATEGORY_PER_DAY = 4;
/** How many stories a single pass may publish per category. */
const MAX_PER_CATEGORY_PER_PASS = 2;
/** Claude importance (1-10) below which a story does not run. */
const MIN_IMPORTANCE = 6;
/** Heuristic signal (0-1) below which a story does not run. */
const MIN_HEURISTIC_SIGNAL = 0.62;
/** Cap candidates sent to Claude per category (top by signal). */
const CLAUDE_CANDIDATES_PER_CATEGORY = 12;

const CLAUDE_MODEL = "claude-haiku-4-5";
const CLAUDE_MAX_TOKENS = 2000;

const EDITOR_SYSTEM_PROMPT = `You are the editor of a very small, very quiet news page. It shows no ads, requires no sign-in, and publishes only a few stories per day. Readers trust it precisely because it is silent most of the time.

Your selection criteria:
- Genuine, lasting importance: things a thoughtful person would want to know a week from now.
- Prefer primary developments (a decision made, a result published, a major event) over commentary, previews, listicles, celebrity, sports, or outrage bait.
- For the ukraine category: significant military, humanitarian, or diplomatic developments about the war in Ukraine. Skip tangential culture/sports items.
- Never pick two stories about the same underlying event, including events in the "recently published" list.
- It is completely fine — often correct — to pick nothing for a category.

Summary rules:
- 2-3 calm, factual sentences, at most 60 words.
- Use ONLY the provided title/description/metadata. Never invent names, numbers, or details that are not in the text.
- If the description is empty or thin, write a single short sentence saying what the story appears to be about, nothing more.
- Plain language. No hype, no editorializing, no "breaking".`;

export class Editor {
  /**
   * @param {{
   *   onPublish: (story: {
   *     id: string; category: string; title: string; summary: string;
   *     href?: string; sourceName: string; publishedAt: number; importance: number;
   *   }) => void;
   *   isPublished: (id: string) => boolean;
   *   countPublishedSince: (category: string, sinceMs: number) => number;
   *   recentPublishedTitles: (category: string) => string[];
   *   anthropicApiKey?: string;
   *   logger?: Console;
   * }} opts
   */
  constructor(opts) {
    this.opts = opts;
    this.client = opts.anthropicApiKey ? new Anthropic({ apiKey: opts.anthropicApiKey }) : null;
    /** @type {Array<{ source: any, lastFetchedAt: number, inFlight: AbortController | null }>} */
    this.sources = [];
    /** @type {Map<string, any>} */
    this.pool = new Map();
    this.destroyed = false;
    this.tickHandle = null;
    this.passHandle = null;
    this.passRunning = false;
  }

  registerSource(source) {
    this.sources.push({ source, lastFetchedAt: 0, inFlight: null });
  }

  start() {
    this.tick();
    this.schedulePass(FIRST_PASS_DELAY_MS);
  }

  destroy() {
    this.destroyed = true;
    for (const s of this.sources) s.inFlight?.abort();
    if (this.tickHandle) clearTimeout(this.tickHandle);
    if (this.passHandle) clearTimeout(this.passHandle);
  }

  // ── Source polling ───────────────────────────────────────────────────

  tick() {
    if (this.destroyed) return;
    const now = Date.now();
    for (const s of this.sources) {
      if (s.inFlight) continue;
      if (now - s.lastFetchedAt < s.source.refreshEveryMs) continue;
      void this.refresh(s);
    }
    this.tickHandle = setTimeout(() => this.tick(), SOURCE_TICK_MS);
    this.tickHandle.unref?.();
  }

  async refresh(state) {
    const ctrl = new AbortController();
    setMaxListeners(ABORT_LISTENERS_PER_SOURCE, ctrl.signal);
    state.inFlight = ctrl;
    try {
      const items = await state.source.fetchCandidates(ctrl.signal);
      state.lastFetchedAt = Date.now();
      for (const it of items) {
        if (!it?.id || !it.category || !it.title) continue;
        this.pool.set(it.id, it);
      }
      this.prunePool();
      this.opts.logger?.info?.(`[editor] refreshed ${state.source.name} (+${items.length})`);
    } catch (err) {
      if (err && err.name !== "AbortError") {
        this.opts.logger?.warn?.(`[editor] ${state.source.name} failed`, err?.message ?? err);
      }
    } finally {
      state.inFlight = null;
    }
  }

  prunePool() {
    const cutoff = Date.now() - CANDIDATE_MAX_AGE_MS;
    for (const [id, item] of this.pool) {
      if (item.publishedAt < cutoff) this.pool.delete(id);
    }
    if (this.pool.size > MAX_POOL_ITEMS) {
      const overflow = [...this.pool.entries()]
        .sort(([, a], [, b]) => a.publishedAt - b.publishedAt)
        .slice(0, this.pool.size - MAX_POOL_ITEMS);
      for (const [id] of overflow) this.pool.delete(id);
    }
  }

  // ── Editorial pass ───────────────────────────────────────────────────

  schedulePass(delay) {
    this.passHandle = setTimeout(() => {
      void this.runPass().finally(() => {
        if (!this.destroyed) this.schedulePass(EDITORIAL_INTERVAL_MS);
      });
    }, delay);
    this.passHandle.unref?.();
  }

  async runPass() {
    if (this.passRunning || this.destroyed) return;
    this.passRunning = true;
    try {
      const byCategory = this.eligibleByCategory();
      if (byCategory.size === 0) {
        this.opts.logger?.info?.("[editor] pass: nothing eligible");
        return;
      }

      let picks = null;
      if (this.client) {
        try {
          picks = await this.claudePass(byCategory);
        } catch (err) {
          this.opts.logger?.warn?.(
            "[editor] Claude pass failed, falling back to heuristic:",
            err?.message ?? err
          );
        }
      }
      if (!picks) picks = this.heuristicPass(byCategory);

      for (const pick of picks) {
        this.opts.onPublish(pick);
        this.opts.logger?.info?.(
          `[editor] published [${pick.category}] ${pick.title.slice(0, 80)}`
        );
      }
      if (picks.length === 0) {
        this.opts.logger?.info?.("[editor] pass: nothing worth publishing");
      }
    } finally {
      this.passRunning = false;
    }
  }

  /** Candidates that are fresh, unpublished, and within today's budget. */
  eligibleByCategory() {
    const dayAgo = Date.now() - 24 * 60 * 60_000;
    const byCategory = new Map();
    for (const item of this.pool.values()) {
      if (this.opts.isPublished(item.id)) continue;
      const list = byCategory.get(item.category) ?? [];
      list.push(item);
      byCategory.set(item.category, list);
    }
    for (const [category, list] of byCategory) {
      const budget = MAX_PER_CATEGORY_PER_DAY - this.opts.countPublishedSince(category, dayAgo);
      if (budget <= 0) {
        byCategory.delete(category);
        continue;
      }
      list.sort((a, b) => b.signal - a.signal);
      byCategory.set(category, {
        budget: Math.min(budget, MAX_PER_CATEGORY_PER_PASS),
        candidates: list.slice(0, CLAUDE_CANDIDATES_PER_CATEGORY),
      });
    }
    return byCategory;
  }

  async claudePass(byCategory) {
    const sections = [];
    for (const [category, { budget, candidates }] of byCategory) {
      const recent = this.opts.recentPublishedTitles(category).slice(0, 8);
      sections.push({
        category,
        maxPicks: budget,
        recentlyPublished: recent,
        candidates: candidates.map((c) => ({
          id: c.id,
          title: c.title,
          description: c.description || "",
          source: c.sourceName,
          meta: c.meta ?? "",
          ageHours: Math.round((Date.now() - c.publishedAt) / 3_600_000),
        })),
      });
    }

    const userPrompt = `Here are today's candidates, grouped by category. For each category you may pick at most "maxPicks" stories, and only stories with importance ${MIN_IMPORTANCE} or higher (scale 1-10). Picking nothing is fine.

${JSON.stringify(sections, null, 1)}

Reply with ONLY a JSON object, no markdown fences, in this exact shape:
{"picks": [{"id": "...", "importance": 7, "summary": "..."}]}`;

    const response = await this.client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: CLAUDE_MAX_TOKENS,
      system: EDITOR_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "");

    const parsed = JSON.parse(text);
    if (!parsed || !Array.isArray(parsed.picks)) throw new Error("malformed editor reply");

    const candidateById = new Map();
    for (const { candidates } of byCategory.values()) {
      for (const c of candidates) candidateById.set(c.id, c);
    }

    const out = [];
    const usedPerCategory = new Map();
    for (const pick of parsed.picks) {
      const candidate = candidateById.get(pick?.id);
      if (!candidate) continue;
      const importance = Number(pick.importance);
      if (!Number.isFinite(importance) || importance < MIN_IMPORTANCE) continue;
      const summary =
        typeof pick.summary === "string" && pick.summary.trim().length > 0
          ? pick.summary.trim().slice(0, 500)
          : fallbackSummary(candidate);
      const used = usedPerCategory.get(candidate.category) ?? 0;
      const { budget } = byCategory.get(candidate.category) ?? { budget: 0 };
      if (used >= budget) continue;
      usedPerCategory.set(candidate.category, used + 1);
      out.push(toStory(candidate, summary, Math.min(1, importance / 10)));
    }
    return out;
  }

  heuristicPass(byCategory) {
    const out = [];
    for (const [, { candidates }] of byCategory) {
      // Without an editor-in-chief we stay extra conservative: one story
      // per category per pass, and only when the signal is strong.
      const best = candidates[0];
      if (!best || best.signal < MIN_HEURISTIC_SIGNAL) continue;
      out.push(toStory(best, fallbackSummary(best), Math.min(1, best.signal)));
    }
    return out;
  }
}

function toStory(candidate, summary, importance) {
  return {
    id: candidate.id,
    category: candidate.category,
    title: candidate.title,
    summary,
    href: candidate.href,
    sourceName: candidate.sourceName,
    publishedAt: candidate.publishedAt,
    importance,
  };
}

/** Summary without Claude: the feed's own description, or the raw signals. */
function fallbackSummary(candidate) {
  const desc = (candidate.description ?? "").trim();
  if (desc.length > 0) {
    const sentences = desc.match(/[^.!?]+[.!?]+(?:\s|$)/g);
    const short = sentences ? sentences.slice(0, 2).join(" ").trim() : desc;
    return short.slice(0, 400);
  }
  if (candidate.meta) return `${candidate.meta} — via ${candidate.sourceName}.`;
  return `via ${candidate.sourceName}.`;
}
