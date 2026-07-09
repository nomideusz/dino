// The dino archive — a tiny server for a quiet news page.
//
// An Editor (see editor.mjs) polls a few quality sources, and a few times a
// day publishes the handful of stories that genuinely matter. Published
// stories live here for STORY_TTL_MS and are streamed to every visitor over
// SSE. Everyone sees the same world.
//
// No database — an optional JSON snapshot on disk survives redeploys.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname } from "node:path";

import { Editor } from "./editor.mjs";
import { extractArticle } from "./reader.mjs";
import { createMusings } from "./sources/musings.mjs";
import { Business } from "./sources/business.mjs";
import { Climate } from "./sources/climate.mjs";
import { Culture } from "./sources/culture.mjs";
import { Science } from "./sources/science.mjs";
import { Tech } from "./sources/tech.mjs";
import { Ukraine } from "./sources/ukraine.mjs";
import { WorldNews } from "./sources/world.mjs";

const PORT = Number(process.env.PORT ?? 8080);
/** Stories persist for two days once the editor decides they matter. */
const STORY_TTL_MS = 48 * 60 * 60 * 1000;
const MAX_STORIES = 200;
const MAX_PUBLISHED_IDS = 600;
const CATEGORIES = new Set([
  "tech",
  "world",
  "ukraine",
  "science",
  "culture",
  "business",
  "climate",
]);

/**
 * Optional disk path for snapshotting stories between restarts (e.g.
 * /data/stories.json on a CapRover volume). Unset = in-memory only.
 */
const ARCHIVE_PERSIST_PATH = process.env.ARCHIVE_PERSIST_PATH ?? null;
const ARCHIVE_PERSIST_INTERVAL_MS = 60_000;

const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS ??
    [
      "https://dino.zaur.app",
      "http://localhost:5173",
      "http://localhost:5174",
      "http://localhost:4173",
    ].join(","))
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);

// ── Story store ──────────────────────────────────────────────────────────

/** @type {Array<{ id: string, category: string, title: string, summary: string, href?: string, sourceName: string, publishedAt: number, deliveredAt: number, importance: number }>} */
let stories = [];
/** Ids the editor has already run — so a story never runs twice. @type {Set<string>} */
const publishedIds = new Set();

/** @type {Set<{ res: import("node:http").ServerResponse, hb: NodeJS.Timeout }>} */
const sseClients = new Set();

function pruneStories() {
  const cutoff = Date.now() - STORY_TTL_MS;
  const expired = stories.filter((s) => s.deliveredAt < cutoff).map((s) => s.id);
  if (expired.length > 0) {
    stories = stories.filter((s) => s.deliveredAt >= cutoff);
    markArchiveDirty();
  }
  return expired;
}

function snapshot() {
  pruneStories();
  return { stories, ttlMs: STORY_TTL_MS };
}

function publishStory(story) {
  const item = {
    id: story.id,
    category: story.category,
    title: story.title,
    summary: story.summary,
    href: story.href,
    sourceName: story.sourceName,
    publishedAt: story.publishedAt,
    deliveredAt: Date.now(),
    importance: story.importance,
  };
  publishedIds.add(story.id);
  while (publishedIds.size > MAX_PUBLISHED_IDS) {
    const oldest = publishedIds.values().next().value;
    if (!oldest) break;
    publishedIds.delete(oldest);
  }
  stories.unshift(item);
  if (stories.length > MAX_STORIES) stories.length = MAX_STORIES;
  markArchiveDirty();
  broadcastEvent({ type: "add", story: item });
}

// ── Disk snapshot persistence ────────────────────────────────────────────

let archiveDirty = false;
function markArchiveDirty() {
  archiveDirty = true;
}

function loadArchiveFromDisk() {
  if (!ARCHIVE_PERSIST_PATH) return;
  let raw;
  try {
    raw = readFileSync(ARCHIVE_PERSIST_PATH, "utf-8");
  } catch (err) {
    if (err.code === "ENOENT") {
      console.log(`[archive] no snapshot at ${ARCHIVE_PERSIST_PATH} — starting empty`);
    } else {
      console.warn(`[archive] could not read snapshot, starting empty:`, err.message);
    }
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.warn(`[archive] snapshot malformed, starting empty:`, err.message);
    return;
  }
  // Older snapshots used a { bins } shape — those simply start fresh.
  if (!parsed || !Array.isArray(parsed.stories)) {
    console.log(`[archive] snapshot has old/unexpected shape, starting empty`);
    return;
  }
  const cutoff = Date.now() - STORY_TTL_MS;
  stories = parsed.stories
    .filter(
      (s) =>
        s &&
        typeof s === "object" &&
        typeof s.id === "string" &&
        CATEGORIES.has(s.category) &&
        typeof s.title === "string" &&
        typeof s.summary === "string" &&
        typeof s.deliveredAt === "number" &&
        s.deliveredAt >= cutoff
    )
    .slice(0, MAX_STORIES);
  const ids = Array.isArray(parsed.publishedIds) ? parsed.publishedIds : [];
  for (const id of ids.slice(-MAX_PUBLISHED_IDS)) {
    if (typeof id === "string") publishedIds.add(id);
  }
  for (const s of stories) publishedIds.add(s.id);
  console.log(
    `[archive] loaded ${stories.length} stor${stories.length === 1 ? "y" : "ies"} from ${ARCHIVE_PERSIST_PATH}`
  );
}

function saveArchiveToDisk(force = false) {
  if (!ARCHIVE_PERSIST_PATH) return;
  if (!archiveDirty && !force) return;
  try {
    pruneStories();
    const payload = JSON.stringify({
      savedAt: Date.now(),
      stories,
      publishedIds: [...publishedIds],
    });
    const tmp = `${ARCHIVE_PERSIST_PATH}.tmp`;
    mkdirSync(dirname(ARCHIVE_PERSIST_PATH), { recursive: true });
    writeFileSync(tmp, payload);
    renameSync(tmp, ARCHIVE_PERSIST_PATH);
    archiveDirty = false;
  } catch (err) {
    console.warn(`[archive] snapshot write failed:`, err.message);
  }
}

// ── SSE ──────────────────────────────────────────────────────────────────

function broadcastEvent(event) {
  if (sseClients.size === 0) return;
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of sseClients) {
    try {
      client.res.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

// Drain expired stories so connected clients see them fade in real time.
setInterval(() => {
  const expired = pruneStories();
  if (expired.length > 0) {
    broadcastEvent({ type: "expire", ids: expired });
  }
}, 60_000).unref();

// ── HTTP plumbing ────────────────────────────────────────────────────────

function setCors(req, res) {
  const origin = req.headers.origin;
  if (typeof origin === "string" && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function sendJson(req, res, status, body) {
  setCors(req, res);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

// ── Article reader cache ─────────────────────────────────────────────────
//
// Extracted article bodies, keyed by story id. Entries live for a few hours
// (articles don't change), and failures are cached briefly so a page that
// blocks us isn't re-fetched on every modal open.
const READER_CACHE_TTL_MS = 6 * 60 * 60_000;
const READER_FAILURE_TTL_MS = 15 * 60_000;
const READER_CACHE_MAX = 300;

/** @type {Map<string, { paragraphs: string[] | null, expiresAt: number }>} */
const readerCache = new Map();
/** @type {Map<string, Promise<string[] | null>>} */
const readerInFlight = new Map();

async function readArticle(story) {
  const cached = readerCache.get(story.id);
  if (cached && cached.expiresAt > Date.now()) return cached.paragraphs;

  let pending = readerInFlight.get(story.id);
  if (!pending) {
    pending = extractArticle(story.href)
      .catch(() => null)
      .then((paragraphs) => {
        if (readerCache.size >= READER_CACHE_MAX) {
          const oldest = readerCache.keys().next().value;
          if (oldest) readerCache.delete(oldest);
        }
        readerCache.set(story.id, {
          paragraphs,
          expiresAt:
            Date.now() + (paragraphs ? READER_CACHE_TTL_MS : READER_FAILURE_TTL_MS),
        });
        readerInFlight.delete(story.id);
        return paragraphs;
      });
    readerInFlight.set(story.id, pending);
  }
  return pending;
}

// ── Server ───────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      setCors(req, res);
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(req, res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" && url.pathname === "/archive") {
      sendJson(req, res, 200, snapshot());
      return;
    }

    if (req.method === "GET" && url.pathname === "/events") {
      setCors(req, res);
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      // Seed with the current archive so the client doesn't race /archive.
      const snap = snapshot();
      res.write(
        `data: ${JSON.stringify({ type: "snapshot", stories: snap.stories, ttlMs: snap.ttlMs })}\n\n`
      );
      const hb = setInterval(() => {
        try {
          res.write(`: ping\n\n`);
        } catch {
          /* socket gone — handled by close listener */
        }
      }, 25_000);
      const client = { res, hb };
      sseClients.add(client);
      req.on("close", () => {
        clearInterval(hb);
        sseClients.delete(client);
      });
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/article/")) {
      // Full text for a *published* story only — this is a reader for our
      // own archive, not an open extraction proxy.
      const id = decodeURIComponent(url.pathname.slice("/article/".length));
      const story = stories.find((s) => s.id === id);
      if (!story || typeof story.href !== "string") {
        sendJson(req, res, 404, { error: "story not found" });
        return;
      }
      const paragraphs = await readArticle(story);
      if (!paragraphs) {
        sendJson(req, res, 200, { ok: false });
        return;
      }
      setCors(req, res);
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=3600",
      });
      res.end(JSON.stringify({ ok: true, paragraphs }));
      return;
    }

    sendJson(req, res, 404, { error: "not found" });
  } catch (err) {
    console.error("[archive] handler error:", err);
    sendJson(req, res, 500, { error: "internal error" });
  }
});

// Restore the previous snapshot before opening the port.
loadArchiveFromDisk();

if (ARCHIVE_PERSIST_PATH) {
  setInterval(() => saveArchiveToDisk(), ARCHIVE_PERSIST_INTERVAL_MS).unref?.();
  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[archive] received ${signal}, flushing snapshot…`);
    saveArchiveToDisk(true);
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

server.listen(PORT, () => {
  console.log(
    `[archive] listening on :${PORT} (TTL ${STORY_TTL_MS}ms, persist=${ARCHIVE_PERSIST_PATH ?? "off"})`
  );
});

// ── The editor ───────────────────────────────────────────────────────────

const editor = new Editor({
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  isPublished: (id) => publishedIds.has(id),
  countPublishedSince: (category, sinceMs) =>
    stories.filter((s) => s.category === category && s.deliveredAt >= sinceMs).length,
  recentPublishedTitles: (category) =>
    stories.filter((s) => s.category === category).map((s) => s.title),
  onPublish: publishStory,
  logger: console,
});
editor.registerSource(Tech);
editor.registerSource(WorldNews);
editor.registerSource(Ukraine);
editor.registerSource(Science);
editor.registerSource(Culture);
editor.registerSource(Business);
editor.registerSource(Climate);
editor.start();

// ── Dino thoughts ────────────────────────────────────────────────────────
//
// Ephemeral, rare. The dino is the soul of the page, not a commentator —
// a small thought drifts by every several minutes, grounded in whatever
// the editor has recently published.
const THOUGHT_INTERVAL_BASE_MS = 5 * 60_000;
const THOUGHT_INTERVAL_JITTER_MS = 5 * 60_000;
const THOUGHT_INITIAL_DELAY_MS = 45_000;
const musings = createMusings({
  apiKey: process.env.ANTHROPIC_API_KEY,
  getRecentItems: () =>
    stories.slice(0, 10).map((s) => ({ kind: s.category, text: s.title })),
});
async function broadcastDinoThought() {
  if (sseClients.size === 0) return;
  try {
    const text = await musings.next();
    if (!text) return;
    broadcastEvent({ type: "dino_thought", text });
  } catch (err) {
    console.warn("[musings] thought broadcast failed:", err?.message ?? err);
  }
}
function scheduleNextThought(delay) {
  setTimeout(() => {
    void broadcastDinoThought();
    scheduleNextThought(
      THOUGHT_INTERVAL_BASE_MS + Math.random() * THOUGHT_INTERVAL_JITTER_MS
    );
  }, delay).unref?.();
}
scheduleNextThought(THOUGHT_INITIAL_DELAY_MS);
