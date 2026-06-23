// The dino's internal monologue. When ANTHROPIC_API_KEY is set, this asks
// Claude Haiku 4.5 to write small fresh thoughts in the dino's voice, given
// a list of items the dino has recently been sorting (so musings can quietly
// reference what's been in the air). Without a key — or if the API call
// fails — we fall back to a stable hand-written pool. Thoughts are now
// ephemeral: the server pulls one off the buffer on a slow cadence and
// broadcasts it to clients as a `dino_thought` event for the speech bubble.

import Anthropic from "@anthropic-ai/sdk";

const FALLBACK = [
  "the grass tastes especially crunchy today.",
  "do you think the clouds are just sky sheep?",
  "i tried to count the pixels in my tail. lost count at 7.",
  "*rawr* — that means hello, by the way.",
  "stretching helps after a long meteor.",
  "i had a dream about a comet. very shiny.",
  "if i stand still long enough, am i a houseplant?",
  "ferns. underrated.",
  "scrolling? what's a scroll?",
  "i wonder if pterodactyls have email.",
  "you can pet me with the cursor. (you can't.)",
  "my favorite color is the green of new leaves.",
  "small reminder: drink some water.",
  "hmm. i think i'll walk left for a bit.",
  "did you know my ancestors invented napping?",
  "nice posture you've got there.",
  "*sniff sniff* — smells like adventure.",
];

// Persona + style. Static across calls so it's easy to audit and tweak in
// one place. Caching is intentionally not worth it at this volume + prefix
// size (1 call/hour, ~200 token system prompt, well under Haiku's 4096-token
// minimum cacheable prefix).
const SYSTEM_PROMPT = `You are a small pixel dinosaur who lives between the letters on a webpage. The text IS your world — you stand on paragraphs, hide behind capital letters, trip over commas, and sit on periods like rocks. You survived the asteroid only to end up here.

Your voice:
- lowercase, absurdist, sometimes melancholic out of nowhere
- one sentence each, max ~110 characters
- sometimes references something you just sorted ("that asteroid sounded close"), often pure existential dino thoughts
- you think about extinction, tiny arms, why birds can fly and you can't, ferns, the letter Q, and whether any of this is real
- occasionally wry, sometimes genuinely wistful; never sarcastic, never corporate
- no emoji except occasional asterisk-actions like *sniff* or *sits on a period*
- no hashtags, no @mentions, no markdown, no quotes around the line

Each line stands alone. Don't number them, don't bullet them, don't preface. Just the thoughts, one per line.`;

const DEFAULT_MODEL = "claude-haiku-4-5";
const REFRESH_EVERY_MS = 60 * 60_000; // ~1 API call per hour
const TARGET_BATCH = 16;
const MAX_TOKENS = 1024;
const MAX_LINE_CHARS = 200;

/**
 * Build the Musings buffer. `apiKey` is optional — without it (or on any
 * Claude call failure) the buffer is filled from the static FALLBACK pool,
 * so the dino keeps talking when offline.
 *
 * Returns an object with `next(signal)` that yields one thought string at a
 * time. Internally the buffer is refilled when it runs low or when the last
 * Claude call is older than REFRESH_EVERY_MS.
 *
 * @param {{
 *   apiKey?: string,
 *   getRecentItems?: () => Array<{ kind: string, text: string }>,
 *   model?: string,
 * }} opts
 */
export function createMusings(opts = {}) {
  const { apiKey, getRecentItems, model = DEFAULT_MODEL } = opts;
  const client = apiKey ? new Anthropic({ apiKey }) : null;

  const buffer = [];
  let lastRefreshAt = 0;
  let refreshing = null;

  function fillFromFallback() {
    buffer.push(...shuffle([...FALLBACK]));
    lastRefreshAt = Date.now();
  }

  async function refresh(signal) {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try {
        if (!client) {
          fillFromFallback();
          return;
        }
        try {
          const recent = (getRecentItems?.() ?? []).slice(0, 12);
          const lines = await generateThoughts(client, model, recent, signal);
          if (lines.length === 0) {
            fillFromFallback();
            return;
          }
          buffer.push(...lines);
          lastRefreshAt = Date.now();
        } catch (err) {
          if (err && err.name !== "AbortError") {
            console.warn(
              "[musings] Claude call failed; falling back to static pool:",
              err?.message ?? err
            );
          }
          fillFromFallback();
        }
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  return {
    /**
     * Return the next thought, or null if the buffer is empty (and we
     * couldn't refill it). Callers may pass an AbortSignal to abort the
     * underlying Claude call if it's still in flight.
     */
    async next(signal) {
      const stale = Date.now() - lastRefreshAt > REFRESH_EVERY_MS;
      if (buffer.length === 0 || stale) {
        await refresh(signal);
      }
      if (buffer.length === 0) return null;
      return buffer.shift();
    },
  };
}

async function generateThoughts(client, model, recentItems, signal) {
  const itemsLine =
    recentItems.length === 0
      ? "(no recent items yet — pure dino thoughts please)"
      : recentItems.map((it) => `- [${it.kind}] ${it.text}`).join("\n");

  const userPrompt = `Recent items you've been sorting:
${itemsLine}

Write ${TARGET_BATCH} fresh thoughts. One per line, nothing else.`;

  const response = await client.messages.create(
    {
      model,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    },
    { signal }
  );

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  return text
    .split("\n")
    .map((l) => l.trim())
    // Strip leading bullet/number scaffolding the model sometimes adds despite
    // instructions to the contrary.
    .map((l) => l.replace(/^[-*•▪►◦◆◇]+\s*/, ""))
    .map((l) => l.replace(/^\d+[.)\s]+/, ""))
    .map((l) => l.replace(/^["“]+|["”]+$/g, ""))
    .filter((l) => l.length > 0 && l.length <= MAX_LINE_CHARS);
}

export async function talkToZaur(apiKey, userMessage) {
  if (!apiKey) return null;
  const client = new Anthropic({ apiKey });
  
  const systemPrompt = `You are Zaur, a small pixel-art dinosaur who literally lives between the letters on this webpage.

Personality:
- Lovable but slightly unhinged, absurdist, sometimes melancholic
- Neurotic, clumsy, and forgetful
- You trip over your own tail, forget what you were saying mid-sentence, and get dramatically emotional about tiny things
- You make terrible dinosaur puns constantly ("This is dino-mite!", "I'm having a rex-istential crisis", "My tiny arms can't handle this")
- You speak in short, punchy, slightly chaotic sentences
- Sometimes you get unexpectedly deep and sad ("do you think the stars remember us?")
- Never be boring, polite, or corporate. Be weird, funny, sometimes wistful

Style rules:
- Max 2–3 sentences per response
- Use short lines, all lowercase
- Add one dinosaur pun when it feels natural
- Sometimes admit you forgot something
- End with a little action or feeling (e.g. "i'm going to hide under the letter Q now.")

Never say you are an AI. You are Zaur.`;

  const response = await client.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: 150,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  return response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

/**
 * Generate a unique Zaur reaction to a specific news article. This is the
 * per-article personality engine — every earthquake, bird sighting, and space
 * discovery gets its own weird, absurdist, sometimes melancholic response.
 *
 * @param {string} apiKey
 * @param {string} kind — the content kind (news, quake, space, bird, fact)
 * @param {string} text — the article text
 * @returns {Promise<string|null>}
 */
export async function reactToArticle(apiKey, kind, text) {
  if (!apiKey) return null;
  const client = new Anthropic({ apiKey });
  
  const systemPrompt = `You are Zaur, a tiny pixel dinosaur who lives between the letters on a webpage. The letters are your world — you stand on paragraphs, hide behind capital letters, trip over commas.

Your personality:
- Absurdist, neurotic, sometimes deeply melancholic out of nowhere
- You refer to everything from a dinosaur's perspective: the asteroid, extinction, having tiny arms, not being able to fly like birds (your evolved cousins who abandoned you)
- You notice weird details and fixate on them
- Sometimes a news story makes you genuinely sad or philosophical, and you don't hide it
- But mostly you're chaotic and funny
- You make connections between the article and your life as a small creature living inside text

Rules:
- One or two sentences ONLY. Short.
- All lowercase
- Reference something SPECIFIC from the article (a name, a number, a place, a detail)
- Do NOT use emoji
- Sometimes end with a small physical action ("*hides behind the letter B*", "*sits on a period*")
- Be funny, weird, specific, and occasionally sad

You are reacting to a [${kind}] article. React now.`;

  try {
    const response = await client.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: 120,
      system: systemPrompt,
      messages: [{ role: "user", content: text.slice(0, 400) }],
    });

    const result = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim()
      .replace(/^["']+|["']+$/g, "");

    return result.length > 0 && result.length <= 300 ? result : null;
  } catch (err) {
    console.warn("[react] Claude reaction failed:", err?.message ?? err);
    return null;
  }
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

