// Minimal RSS 2.0 / Atom parser — no dependencies. Handles the small set of
// well-formed feeds we actually consume (BBC, Guardian, Ars Technica).
// Extracts title / link / description / pubDate per item; CDATA and basic
// entities are unwrapped so downstream code always sees plain UTF-8 text.

import { decodeEntities } from "./util.mjs";

const DEFAULT_TIMEOUT_MS = 12_000;

/**
 * Fetch an RSS/Atom feed and return its items.
 *
 * @param {string} url
 * @param {AbortSignal} signal
 * @returns {Promise<Array<{ title: string, link: string, description: string, publishedAt: number }>>}
 */
export async function fetchFeed(url, signal, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
  timeout.unref?.();
  const abort = () => ctrl.abort(signal.reason);
  if (signal.aborted) abort();
  else signal.addEventListener("abort", abort, { once: true });

  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
        "user-agent": "Mozilla/5.0 (compatible; dinosaurus-archive/0.2)",
      },
    });
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);
    return parseFeed(await res.text());
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}

/** Parse RSS 2.0 `<item>` or Atom `<entry>` blocks out of raw XML. */
export function parseFeed(xml) {
  const items = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  for (const block of blocks) {
    const title = cleanText(tagContent(block, "title"));
    if (!title) continue;
    const link = extractLink(block);
    const description = cleanText(
      tagContent(block, "description") ?? tagContent(block, "summary") ?? ""
    );
    const dateRaw =
      tagContent(block, "pubDate") ??
      tagContent(block, "published") ??
      tagContent(block, "updated") ??
      tagContent(block, "dc:date");
    const publishedAt = dateRaw ? Date.parse(dateRaw.trim()) : NaN;
    items.push({
      title,
      link,
      description,
      publishedAt: Number.isFinite(publishedAt) ? publishedAt : Date.now(),
    });
  }
  return items;
}

function tagContent(block, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = block.match(re);
  return m ? m[1] : null;
}

function extractLink(block) {
  // RSS 2.0: <link>https://…</link>
  const plain = tagContent(block, "link");
  if (plain && plain.trim().startsWith("http")) return decodeEntities(plain.trim());
  // Atom: <link href="https://…" rel="alternate"/>
  const href = block.match(/<link[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
  return href ? decodeEntities(href[1].trim()) : "";
}

function cleanText(raw) {
  if (!raw) return "";
  let t = raw;
  // Unwrap CDATA.
  t = t.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  // Feeds ship markup two ways: literal tags inside CDATA (Ars) or
  // entity-encoded tags (&lt;p&gt; — the Guardian). Decode first so both
  // forms become real tags, strip them, then decode once more for text
  // that was double-encoded (&amp;amp;).
  t = decodeEntities(t);
  t = t.replace(/<[^>]+>/g, " ");
  t = decodeEntities(t);
  return t.replace(/\s+/g, " ").trim();
}
