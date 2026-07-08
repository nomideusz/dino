// Entry point. Sets up the canvas + DPR scaling, builds the world and the
// dino, and runs the main animation loop.
//
// The page is a quiet reading room: the server's editor publishes only a
// few important stories per category per day, and they appear here as
// scattered text blocks — terrain Zaur walks on. No prompt, no feed churn,
// no sign-in. Zaur is the soul of the place, not a commentator.

import { Dino } from "./dino.js";
import { DinoAmbient } from "./dinoBehavior.js";
import { DinoBubble } from "./dinoBubble.js";
import { DinoMind } from "./dinoMind.js";
import { StoryReader } from "./storyReader.js";
import { WeatherClient } from "./weather.js";
import { World } from "./world.js";
import { typewriter } from "./typewriter.js";
import { TextTerrain } from "./textTerrain.js";
import { ZaurMemorySystem } from "./zaurMemory.js";
import { CATEGORIES, type Category, type Story } from "./services/content.js";

const ARCHIVE_API_URL = (
  import.meta.env.VITE_ARCHIVE_URL ?? "https://dino-archive.zaur.app"
).replace(/\/$/, "");

// ── Return greeting (small bubble, not an overlay) ───────────────────

const LAST_VISIT_KEY = "zaur-last-visit";

function getReturnGreeting(): string | null {
  try {
    const last = localStorage.getItem(LAST_VISIT_KEY);
    localStorage.setItem(LAST_VISIT_KEY, String(Date.now()));
    if (!last) return null;

    const goneMs = Date.now() - Number(last);
    const goneHrs = goneMs / 3_600_000;
    if (goneHrs < 6) return null; // don't greet on quick returns

    if (goneHrs < 48) {
      return "oh, you're back. a few things happened while you were away.";
    }
    return "you were gone a while. i kept the important ones for you.";
  } catch {
    return null;
  }
}

// ── Poke escalation ──────────────────────────────────────────────────

const POKE_LINES = [
  "ow!",
  "OW!",
  "STOP.",
  "i'm calling the cursor police.",
  "THAT'S IT. I'M LEAVING.",
];
let pokeCount = 0;
let pokeResetTimer = 0;

// ── Idle commentary ──────────────────────────────────────────────────

function getIdleComment(hour: number): string {
  const pool: string[] = [];

  if (hour >= 6 && hour < 9) {
    pool.push(
      "the sunrise looks like someone spilled orange juice on the sky.",
      "i slept inside the letter O last night. very round. very comforting.",
    );
  } else if (hour >= 11 && hour < 14) {
    pool.push(
      "is it lunch? it feels like lunch. everything feels like lunch when you're a dinosaur.",
      "i have strong opinions about this font. mostly that it's my home.",
    );
  } else if (hour >= 14 && hour < 17) {
    pool.push(
      "the afternoon light makes everything look like a memory.",
      "sometimes i sit here and think about the asteroid. other times i think about ferns.",
    );
  } else if (hour >= 17 && hour < 20) {
    pool.push(
      "the sky is doing that thing again. the pretty one. with the colors.",
      "evening is when the letters get sleepy. look. that lowercase 'e' is yawning.",
    );
  } else if (hour >= 20 || hour < 5) {
    pool.push(
      "night is when the dots in the grid come alive. i've been watching them.",
      "the moon is out. i wonder if it remembers the asteroid too.",
    );
  }

  pool.push(
    "monospaced fonts make me feel so organized. everything lines up. even my existential dread.",
    "i wonder what's written on the other side of the screen.",
    "the letter Q has a tail too. we're basically related.",
    "if i stand still long enough, do i become a glyph?",
    "small reminder: the asteroid wasn't personal. probably.",
  );

  return pool[Math.floor(Math.random() * pool.length)];
}

// ── Category preferences ─────────────────────────────────────────────

const CHANNELS_KEY = "dino-channels";

function loadChannels(): Set<Category> {
  try {
    const raw = localStorage.getItem(CHANNELS_KEY);
    if (!raw) return new Set(CATEGORIES);
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set(CATEGORIES);
    const valid = parsed.filter((c): c is Category => CATEGORIES.includes(c as Category));
    return valid.length > 0 ? new Set(valid) : new Set(CATEGORIES);
  } catch {
    return new Set(CATEGORIES);
  }
}

function saveChannels(channels: Set<Category>): void {
  try {
    localStorage.setItem(CHANNELS_KEY, JSON.stringify([...channels]));
  } catch {
    // Private mode — runtime state still applies.
  }
}

// ── Main app ─────────────────────────────────────────────────────────

function startApp(stage: HTMLElement, worldCanvas: HTMLCanvasElement, dinoCanvas: HTMLCanvasElement): void {
  const maybeWorldCtx = worldCanvas.getContext("2d");
  const maybeDinoCtx = dinoCanvas.getContext("2d");
  if (!maybeWorldCtx || !maybeDinoCtx) throw new Error("2D canvas context unavailable");
  const worldCtx: CanvasRenderingContext2D = maybeWorldCtx;
  const dinoCtx: CanvasRenderingContext2D = maybeDinoCtx;

  // DOM Elements
  const terrainEl = document.getElementById("terrain") as HTMLElement;
  const systemMsg = document.getElementById("system-msg") as HTMLElement;
  const channelsEl = document.getElementById("channels") as HTMLElement;
  const archiveBtn = document.getElementById("archive-btn") as HTMLButtonElement;

  let dpr = Math.max(1, window.devicePixelRatio || 1);
  let cssW = stage.clientWidth;
  let cssH = stage.clientHeight;

  function applySize(): void {
    cssW = stage.clientWidth;
    cssH = stage.clientHeight;
    dpr = Math.max(1, window.devicePixelRatio || 1);

    for (const c of [worldCanvas, dinoCanvas]) {
      c.width = Math.round(cssW * dpr);
      c.height = Math.round(cssH * dpr);
      c.style.width = `${cssW}px`;
      c.style.height = `${cssH}px`;
    }
    worldCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    worldCtx.imageSmoothingEnabled = false;
    dinoCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    dinoCtx.imageSmoothingEnabled = false;
  }

  applySize();

  // ── Core systems ──────────────────────────────────────────────────

  const weather = new WeatherClient(stage);
  const world = new World(
    { width: cssW, height: cssH },
    { weather: () => weather.conditions() }
  );

  const dinoScale = Math.max(2, Math.min(4, Math.round(Math.min(cssW, cssH) / 240)));
  const dino = new Dino({ scale: dinoScale, worldWidth: cssW, worldHeight: cssH });

  const bubble = new DinoBubble(stage, dino);
  const reader = new StoryReader(ARCHIVE_API_URL);

  const ambient = new DinoAmbient(dino, () => weather.conditions());
  ambient.onWeatherComment = (line) => {
    bubble.show(line);
  };

  // Story terrain — scattered across the viewport.
  const terrain = new TextTerrain(terrainEl, {
    viewW: cssW,
    viewH: cssH,
    marginX: 24,
    marginTop: 96,
    marginBottom: 80,
  });

  // Wire up the dino's gravity system to the terrain.
  dino.platformQuery = (x, fromY) => {
    const result = terrain.platformAt(x, fromY);
    return {
      y: result.y,
      platform: result.block ? { x: result.block.x, y: result.block.y, w: result.block.w, h: result.block.h } : null,
    };
  };

  // Zaur's mind — the routines that decide where he goes and why.
  const mind = new DinoMind(dino, terrain, () => ({ w: cssW, h: cssH }));
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__dino = { dino, mind, terrain };
  }

  // Track rendered story IDs to prevent duplicates.
  const renderedStoryIds = new Set<string>();

  // Everything currently in the shared 48h archive, for the archive panel.
  const allStories = new Map<string, Story>();

  // Zaur's cross-session memory.
  const memory = new ZaurMemorySystem();

  // ── Reading: click a story → full article modal; archive panel ─────

  terrain.onStoryClick = (story) => {
    reader.open(story);
    // Zaur keeps you company: he walks over near what you're reading.
    mind.watchReading(story.id);
  };
  archiveBtn.addEventListener("click", () => {
    reader.openArchive([...allStories.values()]);
  });

  // ── Category channels ─────────────────────────────────────────────

  const channels = loadChannels();

  function applyChannels(): void {
    const all = channels.size === CATEGORIES.length;
    terrain.setVisibleCategories(all ? null : channels);
    for (const btn of channelsEl.querySelectorAll<HTMLButtonElement>("[data-category]")) {
      const cat = btn.dataset.category as Category;
      btn.classList.toggle("active", channels.has(cat));
    }
  }

  for (const category of CATEGORIES) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "channel-btn";
    btn.dataset.category = category;
    btn.textContent = category;
    btn.addEventListener("click", () => {
      if (channels.has(category)) {
        // Never allow zero channels — the page would be empty forever.
        if (channels.size > 1) channels.delete(category);
      } else {
        channels.add(category);
      }
      saveChannels(channels);
      applyChannels();
    });
    channelsEl.appendChild(btn);
  }
  applyChannels();

  // ── Return greeting ───────────────────────────────────────────────

  const greeting = getReturnGreeting();
  if (greeting) {
    setTimeout(() => {
      dino.react("happy", 1800);
      bubble.show(memory.getMemoryGreeting() ?? greeting);
    }, 2500);
  }

  // ── Queue for staggered story rendering ───────────────────────────

  const storyQueue: Story[] = [];

  function processStoryQueue(): void {
    if (storyQueue.length === 0) {
      setTimeout(processStoryQueue, 2500);
      return;
    }

    const isTyping = terrain.blocks.some((b) => b.typing);
    if (isTyping) {
      setTimeout(processStoryQueue, 2500);
      return;
    }

    const next = storyQueue.shift();
    if (next) renderStory(next, true);

    const nextDelay = 9000 + Math.random() * 6000;
    setTimeout(processStoryQueue, nextDelay);
  }

  setTimeout(processStoryQueue, 4000);

  // ── Story rendering ───────────────────────────────────────────────

  function renderStory(story: Story, isNew: boolean): void {
    if (renderedStoryIds.has(story.id)) return;
    renderedStoryIds.add(story.id);

    const block = terrain.place(story, isNew);
    if (!block) return;

    memory.noteArticle(`${story.title} ${story.summary}`, story.category);

    if (isNew) {
      const textEl = block.el.querySelector(".tb-text") as HTMLElement;
      if (textEl) {
        // Re-measure the columns as the summary grows line by line.
        const reflow = setInterval(() => terrain.noteContentChanged(), 700);
        void typewriter(textEl, story.summary, { cps: 42, playClick: false }).then(() => {
          clearInterval(reflow);
          textEl.classList.remove("typing-cursor");
          block.typing = false;
          terrain.noteContentChanged();
          // Zaur notices: he walks over and hops onto the fresh story.
          mind.visitNew(block.id);
        });
      } else {
        block.typing = false;
      }
    }
  }

  // ── Easter eggs ──────────────────────────────────────────────────

  // Konami code: ↑↑↓↓←→←→BA → Zaur puts on sunglasses.
  const KONAMI = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];
  let konamiIdx = 0;
  let konamiActive = false;

  document.addEventListener("keydown", (ev) => {
    const key = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
    if (key === KONAMI[konamiIdx]) {
      konamiIdx++;
      if (konamiIdx >= KONAMI.length) {
        konamiIdx = 0;
        konamiActive = !konamiActive;
        document.body.classList.toggle("zaur-cool", konamiActive);
        if (konamiActive) {
          dino.react("happy", 2000);
          bubble.show("😎 deal with it. i look incredible. the letter C is jealous.");
        } else {
          dino.react("sad", 1200);
          bubble.show("fine. back to being a regular dinosaur. *removes tiny sunglasses*");
        }
      }
    } else {
      konamiIdx = 0;
    }
  });

  // ── Click/Poke handling ───────────────────────────────────────────

  stage.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    const target = ev.target;
    if (target instanceof Element && target.closest("button, a, select, input, form, .radio-widget, .terrain-block")) {
      return;
    }
    // The user is directing him — the mind stays out of the way for a bit.
    mind.deferFor(12_000);
    const rect = stage.getBoundingClientRect();
    const px = ev.clientX - rect.left;
    const py = ev.clientY - rect.top;

    // Poke on Dino — escalating reactions.
    if (dino.contains(px, py)) {
      if (pokeResetTimer) clearTimeout(pokeResetTimer);
      pokeResetTimer = window.setTimeout(() => { pokeCount = 0; }, 8000);

      const lineIdx = Math.min(pokeCount, POKE_LINES.length - 1);
      const line = POKE_LINES[lineIdx];
      pokeCount++;

      if (pokeCount >= POKE_LINES.length) {
        // Run off screen!
        dino.react("angry", 600);
        bubble.show(line);
        const offX = dino.bubbleAnchor.x < cssW / 2 ? cssW + 100 : -100;
        dino.goTo(offX, dino.bubbleAnchor.bottom - dino.heightPx);
        setTimeout(() => {
          dino.goTo(cssW / 2, cssH * 0.6);
          pokeCount = 0;
          setTimeout(() => {
            bubble.show("...fine. i'm back. but i'm still upset.");
          }, 3000);
        }, 8000);
      } else {
        dino.react(pokeCount >= 3 ? "angry" : "sad", 800);
        bubble.show(line);
      }
      return;
    }

    // Otherwise walk to clicked position.
    dino.goTo(px, py - dino.heightPx);
  });

  // ── SSE real-time events ──────────────────────────────────────────

  let isFirstLoad = true;

  function connectSse(): void {
    const es = new EventSource(`${ARCHIVE_API_URL}/events`);

    es.addEventListener("open", () => {
      console.log("[stream] SSE event source connected");
    });

    es.addEventListener("message", (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (!data) return;

        switch (data.type) {
          case "snapshot": {
            const list = Array.isArray(data.stories) ? (data.stories as Story[]) : [];
            for (const story of list) allStories.set(story.id, story);
            // Newest stories matter most — render those first so pruning
            // (if the archive outgrows the screen) drops the oldest.
            const sorted = [...list].sort(
              (a, b) => (b.deliveredAt ?? 0) - (a.deliveredAt ?? 0)
            );

            if (sorted.length === 0) {
              systemMsg.textContent = "// nothing important yet. the world is quiet today.";
            } else {
              systemMsg.remove();
            }

            // First few appear right away so the page isn't blank; the rest
            // typewrite in one at a time.
            const initial = sorted.slice(0, 5);
            for (const story of initial) {
              renderStory(story, false);
            }
            for (const story of sorted.slice(5)) {
              if (!renderedStoryIds.has(story.id)) storyQueue.push(story);
            }

            if (isFirstLoad) {
              setTimeout(() => {
                dino.goTo(cssW / 2, cssH * 0.6);
              }, 800);
              isFirstLoad = false;
            }
            break;
          }

          case "add": {
            const story = data.story as Story;
            allStories.set(story.id, story);
            if (renderedStoryIds.has(story.id)) return;
            systemMsg.remove();
            storyQueue.push(story);
            break;
          }

          case "dino_thought": {
            const text = data.text as string;
            bubble.show(text);
            break;
          }

          case "expire": {
            const ids = data.ids as string[];
            if (!ids) return;
            for (const id of ids) allStories.delete(id);
            terrain.fadeOut(ids);
            break;
          }
        }
      } catch (err) {
        console.warn("[stream] error processing event message:", err);
      }
    });

    es.addEventListener("error", (err) => {
      console.warn("[stream] SSE connection error:", err);
    });
  }

  connectSse();

  // ── Stage size observer ───────────────────────────────────────────

  let resizeRaf = 0;
  const resizeObserver = new ResizeObserver(() => {
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      const oldW = cssW;
      const oldH = cssH;
      applySize();
      if (cssW !== oldW || cssH !== oldH) {
        world.resize({ width: cssW, height: cssH });
        dino.resize(cssW, cssH);
        terrain.updateConstraints(cssW, cssH);
      }
    });
  });
  resizeObserver.observe(stage);

  // ── Occasional idle commentary ────────────────────────────────────
  // Movement is the mind's job now; this only speaks, rarely.

  setInterval(() => {
    if (!dino.isAvailable) return;
    if (Math.random() > 0.15) return;
    const hour = new Date().getHours();
    const line = memory.getMemoryIdleComment() ?? getIdleComment(hour);
    bubble.show(line);
  }, 60_000);

  // Track user interactions to detect "ultra-idle" (30+ min).
  let lastUserInteraction = performance.now();
  let ultraIdleFired = false;

  stage.addEventListener("pointerdown", () => {
    lastUserInteraction = performance.now();
    ultraIdleFired = false;
  });

  const ULTRA_IDLE_LINES = [
    "i've been standing here so long i started building a tiny house from semicolons. it fell down. twice.",
    "hello? is anyone there? or did the page fall asleep? pages don't sleep. ...do they?",
    "i wonder what the other tabs are doing. probably something more interesting. *sigh*",
    "if a dinosaur stands on a webpage and nobody scrolls, does it even render?",
    "the letter Q and i have become friends. we're both a bit... unnecessary. but we're here.",
  ];

  setInterval(() => {
    if (ultraIdleFired) return;
    const elapsed = performance.now() - lastUserInteraction;
    if (elapsed < 30 * 60_000) return;
    if (!dino.isAvailable) return;

    ultraIdleFired = true;
    const line = ULTRA_IDLE_LINES[Math.floor(Math.random() * ULTRA_IDLE_LINES.length)];
    dino.react("sad", 3000);
    bubble.show(line);
  }, 60_000);

  // ── ISS Pass-Over easter egg ──────────────────────────────────────

  let issSpotted = false;
  const pollISS = async () => {
    if (issSpotted || !dino.isAvailable) return;
    try {
      const resp = await fetch("https://api.wheretheiss.at/v1/satellites/25544");
      if (!resp.ok) return;
      await resp.json();

      // The ISS moves fast — a small random chance keeps the easter egg
      // alive, tied to a real API call so it happens while the ISS is
      // actually doing *something*.
      if (Math.random() < 0.15) {
        issSpotted = true;

        const issDot = document.createElement("div");
        issDot.className = "iss-dot";
        stage.appendChild(issDot);

        dino.react("curious", 4000);
        setTimeout(() => {
          const lines = [
            "there's a tiny light moving up there. humans live in it. in SPACE. i can't even climb a capital letter.",
            "is that a star? no, it's moving too fast. probably another thing i can't reach.",
            "the space station. travelling at 17,500 mph. i'm travelling at 0 mph. we balance each other out.",
          ];
          bubble.show(lines[Math.floor(Math.random() * lines.length)]);
        }, 1500);

        setTimeout(() => {
          issDot.remove();
          issSpotted = false;
        }, 30_000);
      }
    } catch {
      // ignore
    }
  };

  setInterval(pollISS, 120_000);
  setTimeout(pollISS, 30_000);

  // ── Main animation frame loop ─────────────────────────────────────

  let last = performance.now();
  function frame(now: number): void {
    const dt = Math.min(64, now - last);
    last = now;

    worldCtx.clearRect(0, 0, cssW, cssH);
    dinoCtx.clearRect(0, 0, cssW, cssH);

    // Apply Day/Night body CSS themes dynamically.
    const conds = weather.conditions();
    if (conds) {
      if (conds.isDay) {
        document.body.classList.add("theme-day");
      } else {
        document.body.classList.remove("theme-day");
      }
    }

    // 1. Draw weather particles and sky backgrounds on the world canvas (dimmed).
    world.update(dt);
    world.draw(worldCtx);

    // 2. Draw Zaur on the dino canvas (above terrain).
    dino.update(now, dt);
    dino.draw(dinoCtx);

    // 3. Keep speech bubble overlays attached; run the mind + ambient moods.
    // Ambient reactions stay quiet while he's mid-routine, so a weather
    // shiver can't derail a walk to a story.
    bubble.update();
    mind.tick(now);
    if (!mind.busy) ambient.update(now);

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// Bootstrap
const stage = document.querySelector<HTMLElement>(".stage");
const worldCanvas = document.getElementById("world-canvas") as HTMLCanvasElement | null;
const dinoCanvas = document.getElementById("dino-canvas") as HTMLCanvasElement | null;

if (!stage || !worldCanvas || !dinoCanvas) {
  throw new Error("Could not find required stage elements in DOM");
}

startApp(stage, worldCanvas, dinoCanvas);
