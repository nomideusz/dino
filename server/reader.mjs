// Full-text reader. Fetches a published story's original page and extracts
// the readable paragraphs so the client can show the whole article in a
// modal without leaving the site.
//
// This is a heuristic, not a headless browser: strip the obvious non-content
// tags, prefer <article>/<main> when present, then keep the <p> blocks that
// look like sentences. Works well on article-shaped sites (BBC, Guardian,
// Ars); on everything else the client quietly falls back to summary + link.

import { decodeEntities } from "./sources/util.mjs";

const FETCH_TIMEOUT_MS = 12_000;
const MAX_HTML_BYTES = 3 * 1024 * 1024;
const MAX_PARAGRAPHS = 60;
const MAX_TOTAL_CHARS = 14_000;
const MIN_PARAGRAPH_CHARS = 60;

/** Common boilerplate that survives tag stripping. */
const BOILERPLATE = /(sign up|subscribe|newsletter|cookie|all rights reserved|follow us|related articles|read more:|advertisement|share this|terms of service|privacy policy)/i;

/**
 * @param {string} url
 * @returns {Promise<string[] | null>} readable paragraphs, or null.
 */
export async function extractArticle(url) {
  if (!/^https?:\/\//i.test(url)) return null;
  const html = await fetchHtml(url);
  if (!html) return null;

  let scope = html;
  // Prefer semantic containers when the page has them.
  const article = firstTagBlock(html, "article");
  const main = firstTagBlock(html, "main");
  if (article && article.length > 500) scope = article;
  else if (main && main.length > 500) scope = main;

  scope = scope
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|iframe|figure|figcaption|aside|nav|footer|header|form|button)[\s>][\s\S]*?<\/\1>/gi, " ");

  const paragraphs = [];
  let total = 0;
  const re = /<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/gi;
  let m;
  while ((m = re.exec(scope)) !== null && paragraphs.length < MAX_PARAGRAPHS) {
    const text = cleanText(m[1]);
    if (text.length < MIN_PARAGRAPH_CHARS) continue;
    if (BOILERPLATE.test(text) && text.length < 200) continue;
    paragraphs.push(text);
    total += text.length;
    if (total >= MAX_TOTAL_CHARS) break;
  }

  // A real article has some body to it; two stray <p>s are navigation crumbs.
  if (paragraphs.length < 3 || total < 400) return null;
  return paragraphs;
}

async function fetchHtml(url) {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(new Error("timeout")), FETCH_TIMEOUT_MS);
  timeout.unref?.();
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 dinosaurus-reader/0.1",
      },
    });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("html")) return null;

    // Stream with a size cap so a misbehaving page can't eat the heap.
    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      chunks.push(value);
      if (received >= MAX_HTML_BYTES) {
        ctrl.abort();
        break;
      }
    }
    return Buffer.concat(chunks).toString("utf-8");
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function firstTagBlock(html, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = html.match(re);
  return m ? m[1] : null;
}

function cleanText(raw) {
  let t = raw.replace(/<[^>]+>/g, " ");
  t = decodeEntities(t);
  return t.replace(/\s+/g, " ").trim();
}
