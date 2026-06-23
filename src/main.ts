// Entry point. Sets up the canvas + DPR scaling, builds the world and the
// dino, and runs the main animation loop.
//
// In this rebuild, text blocks are scattered across the full viewport as
// terrain. Zaur walks between them, stands on them, and reacts to content.
// The world canvas is dimmed to a soft backdrop behind the letters.

import { Dino, type Mood } from "./dino.js";
import { DinoAmbient } from "./dinoBehavior.js";
import { DinoBubble } from "./dinoBubble.js";
import { DinoVoice } from "./dinoVoice.js";
import { WeatherClient } from "./weather.js";
import { World } from "./world.js";
import { typewriter } from "./typewriter.js";
import { RadioAudio, type RadioChannel, channelFrequency } from "./radio.js";
import { TextTerrain } from "./textTerrain.js";
import { ZaurMemorySystem } from "./zaurMemory.js";
import type { ContentItem } from "./services/content.js";

const ARCHIVE_API_URL = (
  import.meta.env.VITE_ARCHIVE_URL ?? "https://dino-archive.zaur.app"
).replace(/\/$/, "");

// ── Return greeting ──────────────────────────────────────────────────

const LAST_VISIT_KEY = "zaur-last-visit";

function getReturnGreeting(): string | null {
  try {
    const last = localStorage.getItem(LAST_VISIT_KEY);
    localStorage.setItem(LAST_VISIT_KEY, String(Date.now()));
    if (!last) return null;

    const goneMs = Date.now() - Number(last);
    const goneMin = goneMs / 60_000;
    const goneHrs = goneMin / 60;
    const goneDays = goneHrs / 24;

    if (goneMin < 5) return null; // just refreshed

    if (goneMin < 60) {
      return "oh. you again. i wasn't doing anything weird. definitely not eating punctuation.";
    }
    if (goneHrs < 6) {
      const hrs = Math.round(goneHrs);
      return `${hrs} hour${hrs > 1 ? "s" : ""}?? i had to read ALL the news by myself. do you know how hard that is with two-pixel arms?`;
    }
    if (goneDays < 2) {
      return "a whole day. i ate three semicolons and a paragraph while you were gone. i'm not sorry. a dino's gotta eat.";
    }
    if (goneDays < 7) {
      const d = Math.round(goneDays);
      return `...you were gone ${d} days. i've been sitting on this period for ${d * 24} hours. my legs are asleep. all four of them. wait. i have two. see? i already forgot.`;
    }
    return "i thought you forgot about me. i've been here the whole time. the letters kept me company. mostly the letter Q. Q is nice.";
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

  // Time-of-day flavored lines
  if (hour >= 6 && hour < 9) {
    pool.push(
      "good morning world! everything is terrifying! let's go!",
      "the sunrise looks like someone spilled orange juice on the sky.",
      "i slept inside the letter O last night. very round. very comforting.",
      "stretching my tiny arms... stretch... okay that's enough exercise for today.",
    );
  } else if (hour >= 11 && hour < 14) {
    pool.push(
      "is it lunch? it feels like lunch. everything feels like lunch when you're a dinosaur.",
      "peak productivity hours. *stares at a comma for ten minutes*",
      "i have strong opinions about this font. mostly that it's my home.",
    );
  } else if (hour >= 14 && hour < 17) {
    pool.push(
      "do you ever wonder if the letter W is just M upside down? or if M is W upside down? who came first?",
      "the afternoon light makes everything look like a memory.",
      "i think periods are just full stops that wanted to be something more.",
      "sometimes i sit here and think about the asteroid. other times i think about ferns.",
    );
  } else if (hour >= 17 && hour < 20) {
    pool.push(
      "the sky is doing that thing again. the pretty one. with the colors.",
      "today i learned... wait. i forgot. i learned something though. probably.",
      "evening is when the letters get sleepy. look. that lowercase 'e' is yawning.",
    );
  } else if (hour >= 20 || hour < 5) {
    pool.push(
      "*yawn* the letters are going to sleep. i should... *yawn*... also...",
      "night is when the dots in the grid come alive. i've been watching them.",
      "did you know nocturnal dinosaurs were a thing? i'm not one. i'm just... still awake.",
      "the moon is out. i wonder if it remembers the asteroid too.",
    );
  }

  // Universal lines
  pool.push(
    "is that a comma? it looks delicious.",
    "my tail is getting caught in the margins again.",
    "monospaced fonts make me feel so organized. everything lines up. even my existential dread.",
    "i wonder what's written on the other side of the screen.",
    "this paragraph is nice and cozy. i might stay here forever. or five seconds. same thing.",
    "the letter Q has a tail too. we're basically related.",
    "i just realized i can't actually read. i've been pretending this whole time.",
    "if i stand still long enough, do i become a glyph?",
    "sometimes i think about how space is infinite. then i think about ferns. ferns are better.",
    "small reminder: the asteroid wasn't personal. probably.",
  );

  return pool[Math.floor(Math.random() * pool.length)];
}

// ── Punctuation reactions ────────────────────────────────────────────

function scanForPunctuationReaction(text: string): string | null {
  // Only trigger occasionally
  if (Math.random() > 0.35) return null;
  
  const hasExclaim = /!{2,}/.test(text) || /[A-Z]{5,}/.test(text);
  const hasQuestion = /\?{2,}/.test(text);
  const hasEllipsis = /\.{3,}/.test(text);
  
  if (hasExclaim) {
    const lines = [
      "ALL THOSE EXCLAMATION MARKS. my tiny ears.",
      "why is everyone YELLING. this is a library. of letters. that i live in.",
      "the capital letters are so loud today.",
    ];
    return lines[Math.floor(Math.random() * lines.length)];
  }
  if (hasQuestion) {
    const lines = [
      "so many questions. i don't have answers. i barely have arms.",
      "?? i don't know either. let me ask this semicolon.",
    ];
    return lines[Math.floor(Math.random() * lines.length)];
  }
  if (hasEllipsis) {
    const lines = [
      "the dot dot dot is making me... sleepy...",
      "ellipsis. the suspense. i can't handle... *falls asleep*",
    ];
    return lines[Math.floor(Math.random() * lines.length)];
  }
  return null;
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
  const chatForm = document.getElementById("chat-form") as HTMLFormElement;
  const chatInput = document.getElementById("chat-input") as HTMLInputElement;
  const cameraBtn = document.getElementById("camera-btn") as HTMLButtonElement;
  const voiceBtn = document.getElementById("voice-btn") as HTMLButtonElement;
  const radioWidget = document.getElementById("radio-widget") as HTMLElement;
  const radioPowerBtn = document.getElementById("radio-power-btn") as HTMLButtonElement;
  const trackInfoEl = radioWidget.querySelector(".radio-track-info") as HTMLElement;
  const freqDisplayEl = document.getElementById("radio-freq-display") as HTMLElement;
  const statusTextEl = radioWidget.querySelector(".status-text") as HTMLElement;

  let dpr = Math.max(1, window.devicePixelRatio || 1);
  let cssW = stage.clientWidth;
  let cssH = stage.clientHeight;

  function applySize(): void {
    cssW = stage.clientWidth;
    cssH = stage.clientHeight;
    dpr = Math.max(1, window.devicePixelRatio || 1);

    // Size both canvases identically.
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
  const voice = new DinoVoice(ARCHIVE_API_URL);
  const radio = new RadioAudio();

  const ambient = new DinoAmbient(dino, () => weather.conditions());
  ambient.onWeatherComment = (line) => {
    bubble.show(line);
    // Voice for dramatic weather moments.
    if (isVoiceEnabled && line.includes("!")) {
      void voice.say(line);
    }
  };

  // Text terrain system — scattered across the viewport.
  const terrain = new TextTerrain(terrainEl, {
    viewW: cssW,
    viewH: cssH,
    marginX: 24,
    marginTop: 80,
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

  // Track rendered item IDs to prevent duplicates.
  const renderedItemIds = new Set<string>();

  // Zaur's cross-session memory.
  const memory = new ZaurMemorySystem();

  // ── Audio/Voice system toggles ────────────────────────────────────

  let isVoiceEnabled = voice.isEnabled();
  voiceBtn.textContent = isVoiceEnabled ? "🔊" : "🔇";
  voiceBtn.classList.toggle("active", isVoiceEnabled);

  voiceBtn.addEventListener("click", () => {
    isVoiceEnabled = voice.toggle();
    voiceBtn.textContent = isVoiceEnabled ? "🔊" : "🔇";
    voiceBtn.classList.toggle("active", isVoiceEnabled);
    if (isVoiceEnabled) {
      void voice.playSfx("/sfx/chime");
    }
    connectSse();
  });

  // ── Radio ─────────────────────────────────────────────────────────

  let isRadioPlaying = false;
  let trackChangeCount = 0;

  const DJ_TRACK_LINES = [
    "this song makes my tiny arms want to air guitar. *air guitars with no guitar and no arms*",
    "i'm going to pretend i chose this track. great taste, me.",
    "is this what humans call a 'bop'? my tail is bopping. i think it's a bop.",
    "if you close your eyes this sounds like the asteroid approaching. but in a good way.",
    "music is just organized air. and i'm just organized pixels. we're basically the same.",
    "i wonder what the letters think of the music. the letter B looks like it's nodding.",
    "this beat is making me forget about the asteroid. almost.",
    "i could dance to this. i won't. but i could. theoretically.",
  ];

  const DJ_BETWEEN_LINES = [
    "coming up next on zaur fm... honestly i don't know what's next. i can't read the playlist. tiny arms.",
    "that was a good one. or bad. i have no frame of reference. i'm a dinosaur.",
    "loading next track... or as i call it, 'standing here waiting'.",
  ];

  const DJ_START_LINES = [
    "music! finally! it was way too quiet in here. just me and the letters and the existential dread.",
    "zaur fm is on the air! *taps microphone* is this thing on? i don't have a microphone.",
    "oh good, sounds. i was starting to hear my own thoughts and they're mostly about ferns.",
  ];

  const DJ_STOP_LINES = [
    "and we're off the air. back to the sound of me breathing and the letters judging me.",
    "the silence is deafening. like a very quiet asteroid.",
    "it's too quiet. i can hear the semicolons whispering.",
  ];

  let selectedChannel: RadioChannel = "all";

  async function setRadioPower(turnOn: boolean, channel: RadioChannel): Promise<void> {
    const wasPlaying = isRadioPlaying;
    
    if (turnOn) {
      isRadioPlaying = true;
      dino.musicPlaying = true;
      radioWidget.classList.add("active");
      statusTextEl.textContent = "ONLINE";
      const freq = channelFrequency(channel);
      freqDisplayEl.textContent = `${freq.toFixed(1)} MHz`;
      trackInfoEl.textContent = "tuning station...";
      
      const playSuccess = await radio.playMusic(channel);
      if (!playSuccess) {
        // If play failed, turn off
        await setRadioPower(false, channel);
        return;
      }
      
      if (!wasPlaying) {
        trackChangeCount = 1;
        const line = DJ_START_LINES[Math.floor(Math.random() * DJ_START_LINES.length)];
        dino.react("excited", 1800);
        setTimeout(() => bubble.show(line), 600);
      } else {
        dino.react("excited", 1000);
      }
    } else {
      isRadioPlaying = false;
      dino.musicPlaying = false;
      radio.stopMusic();
      radioWidget.classList.remove("active");
      statusTextEl.textContent = "OFFLINE";
      freqDisplayEl.textContent = "OFF";
      trackInfoEl.textContent = "offline";
      
      if (wasPlaying) {
        trackChangeCount = 0;
        const line = DJ_STOP_LINES[Math.floor(Math.random() * DJ_STOP_LINES.length)];
        dino.react("sad", 1200);
        setTimeout(() => bubble.show(line), 400);
      }
    }
  }

  radioPowerBtn.addEventListener("click", () => {
    void setRadioPower(!isRadioPlaying, selectedChannel);
  });

  radio.onTrackChange = (info) => {
    trackInfoEl.textContent = `${info.title} • ${info.artist} (${info.playlist})`;
    trackChangeCount++;
    
    // DJ commentary on track changes (not the first one — that gets a "start" line).
    if (trackChangeCount > 1 && Math.random() < 0.6) {
      const pool = Math.random() < 0.7 ? DJ_TRACK_LINES : DJ_BETWEEN_LINES;
      const line = pool[Math.floor(Math.random() * pool.length)];
      setTimeout(() => {
        bubble.show(line);
        dino.react("happy", 1200);
      }, 2000);
    }
  };

  const channelBtns = radioWidget.querySelectorAll(".channel-btn");
  channelBtns.forEach((btn) => {
    btn.addEventListener("click", async () => {
      const channel = btn.getAttribute("data-channel") as RadioChannel;
      
      // If we clicked the ALREADY active channel while radio is ON, turn the radio OFF!
      if (isRadioPlaying && selectedChannel === channel) {
        await setRadioPower(false, channel);
        return;
      }
      
      // Update DOM selection styling
      channelBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      selectedChannel = channel;
      
      // Always play/tune when clicking a channel button
      await setRadioPower(true, channel);
    });
  });

  // ── Return greeting ───────────────────────────────────────────────

  const greeting = getReturnGreeting();
  if (greeting) {
    const greetEl = document.createElement("div");
    greetEl.className = "return-greeting";
    greetEl.textContent = "";
    stage.appendChild(greetEl);
    
    // Typewriter the greeting.
    setTimeout(() => {
      void typewriter(greetEl, greeting, { cps: 30, playClick: false }).then(() => {
        // Fade out after reading.
        setTimeout(() => {
          greetEl.classList.add("return-greeting--fading");
          setTimeout(() => greetEl.remove(), 1500);
        }, 5000);
      });
    }, 800);

    // Zaur reacts to the returning visitor.
    setTimeout(() => {
      dino.react("excited", 2000);
      // Use memory greeting if available, otherwise generic.
      const memGreeting = memory.getMemoryGreeting();
      bubble.show(memGreeting ?? "you're back!!");
    }, 1200);
  }

  // ── Queue for staggered typewriter rendering ──────────────────────
  const typewriterQueue: ContentItem[] = [];

  function escapeHtml(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function awaitDinoArrival(targetX: number, targetY: number): Promise<void> {
    return new Promise((resolve) => {
      let attempts = 0;
      const check = () => {
        attempts++;
        const dist = Math.hypot(dino.position.x - targetX, dino.position.y - targetY);
        // Arrived, or Dino went back to idle/wandering (finished walk), or timeout
        if (
          dist < 32 ||
          dino.state === "idle" ||
          dino.state === "look" ||
          dino.state === "stare" ||
          attempts > 100
        ) {
          resolve();
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  }

  async function eatLetterAnimation(block: import("./textTerrain.js").TerrainBlock): Promise<string | null> {
    const textEl = block.el.querySelector("[data-text-content]") as HTMLElement;
    if (!textEl) return null;
    const rawText = textEl.textContent || "";
    if (!rawText) return null;

    // Find indices of punctuation first, they are tastier.
    const punctRegex = /[\.,;!\?\(\)\[\]\{\}\-\"\']/g;
    const indices: number[] = [];
    let match;
    while ((match = punctRegex.exec(rawText)) !== null) {
      indices.push(match.index);
    }

    // If no punctuation, pick any letter or number.
    if (indices.length === 0) {
      const letterRegex = /[a-zA-Z0-9]/g;
      while ((match = letterRegex.exec(rawText)) !== null) {
        indices.push(match.index);
      }
    }

    if (indices.length === 0) return null;

    // Pick a random index.
    const targetIdx = indices[Math.floor(Math.random() * indices.length)];
    const char = rawText[targetIdx];

    const before = rawText.slice(0, targetIdx);
    const after = rawText.slice(targetIdx + 1);

    // Make it flash!
    textEl.innerHTML = `${escapeHtml(before)}<span class="eaten-letter-flash">${escapeHtml(char)}</span>${escapeHtml(after)}`;

    // Wait 500ms.
    await new Promise((r) => setTimeout(r, 500));

    // Replace the letter with a space so the block length remains identical and doesn't shift layout.
    textEl.innerHTML = `${escapeHtml(before)} <span style="opacity: 0;">${escapeHtml(char)}</span>${escapeHtml(after)}`;

    return char;
  }

  function processTypewriterQueue(): void {
    if (typewriterQueue.length === 0) {
      setTimeout(processTypewriterQueue, 2500);
      return;
    }

    const isTyping = terrain.blocks.some((b) => b.typing);
    if (!dino.isAvailable || isTyping) {
      setTimeout(processTypewriterQueue, 2500);
      return;
    }

    const nextItem = typewriterQueue.shift();
    if (nextItem) {
      renderItem(nextItem, true);
    }

    const nextDelay = 18000 + Math.random() * 9000; // occasionally show up, e.g. 18-27s
    setTimeout(processTypewriterQueue, nextDelay);
  }

  // Start the queue processor after a brief startup delay.
  setTimeout(processTypewriterQueue, 5000);

  // ── Content rendering ─────────────────────────────────────────────

  function renderItem(item: ContentItem, isNew: boolean): void {
    if (renderedItemIds.has(item.id)) return;
    renderedItemIds.add(item.id);

    const block = terrain.place(item, isNew);
    if (!block) return;

    if (isNew) {
      const textEl = block.el.querySelector("[data-text-content]") as HTMLElement;
      if (textEl) {
        void typewriter(textEl, item.text, { cps: 38, playClick: isVoiceEnabled }).then(() => {
          textEl.classList.remove("typing-cursor");
          block.typing = false;

          // Zaur reacts to the new article!
          triggerDinoReaction(item, block);
        });
      }
    }
  }

  // ── Zaur reactions ────────────────────────────────────────────────

  async function triggerDinoReaction(item: ContentItem, block: import("./textTerrain.js").TerrainBlock): Promise<void> {
    // Walk to the new block.
    const targetX = block.x + block.w / 2;
    const targetY = block.y - dino.heightPx;
    dino.goTo(targetX, targetY);
    dino.react("surprised", 800);

    // Fetch the reaction in parallel while Zaur is walking.
    const commentPromise = (async () => {
      let resComment: string | null = null;
      try {
        const resp = await fetch(`${ARCHIVE_API_URL}/api/zaur-react`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: item.kind, text: item.text }),
        });
        if (resp.ok) {
          const body = await resp.json();
          resComment = body.text;
        }
      } catch {
        // Fall through
      }
      if (!resComment) {
        resComment = scanForPunctuationReaction(item.text);
      }
      if (!resComment) {
        resComment = getFallbackReaction(item);
      }
      return resComment;
    })();

    // Earthquake shake — magnitude-aware intensity.
    if (item.kind === "quake") {
      // Parse magnitude from text (e.g. "M5.2" or "magnitude 5.2").
      const magMatch = item.text.match(/(?:M|magnitude\s*)(\d+\.?\d*)/i);
      const magnitude = magMatch ? parseFloat(magMatch[1]) : 3.0;
      const intensity = Math.min(3, Math.max(0.5, magnitude / 3));

      stage.style.setProperty("--shake-intensity", `${intensity}`);
      terrainEl.style.setProperty("--shake-intensity", `${intensity}`);
      terrainEl.classList.add("earthquake-shake");
      stage.classList.add("earthquake-shake");
      const shakeDur = 400 + Math.round(magnitude * 100);
      setTimeout(() => {
        terrainEl.classList.remove("earthquake-shake");
        stage.classList.remove("earthquake-shake");
        stage.style.removeProperty("--shake-intensity");
        terrainEl.style.removeProperty("--shake-intensity");
      }, shakeDur);

      // Screen flash for big quakes (M5.0+).
      if (magnitude >= 5.0) {
        const flash = document.createElement("div");
        flash.className = "earthquake-flash";
        stage.appendChild(flash);
        setTimeout(() => flash.remove(), 600);
      }
    }

    // Note the article in Zaur's memory.
    memory.noteArticle(item.text, item.kind);

    // Wait for Dino to arrive near the block.
    await awaitDinoArrival(targetX, targetY);

    // Face the target (forces dino to face it properly upon arrival).
    dino.goTo(targetX, targetY);

    // Eat a letter!
    let eatenChar: string | null = null;
    try {
      eatenChar = await eatLetterAnimation(block);
    } catch (err) {
      console.warn("[eat] failed to eat letter:", err);
    }

    if (eatenChar) {
      dino.react("happy", 1200);
      block.el.style.transform = "scale(0.97) translateY(1px)";
      setTimeout(() => {
        block.el.style.transform = "";
      }, 150);
      // Wait for chew animation to finish/partially run.
      await new Promise((r) => setTimeout(r, 1000));
    }

    let comment = await commentPromise;

    if (eatenChar && comment) {
      // 60% chance to comment on the character eaten
      if (Math.random() < 0.6) {
        const foodJokes = [
          `nom. that '${eatenChar}' was crunchy.`,
          `burp. that '${eatenChar}' was a bit stale.`,
          `i ate the '${eatenChar}'. you didn't need it anyway.`,
          `that '${eatenChar}' tasted like pixels.`,
          `crunchy '${eatenChar}'. 7/10.`,
          `the '${eatenChar}' was the best part of this text.`,
        ];
        const joke = foodJokes[Math.floor(Math.random() * foodJokes.length)];
        comment = `${joke} ${comment}`;
      }
    }

    if (comment) {
      bubble.show(comment);
      if (isVoiceEnabled && (item.kind === "quake" || item.kind === "space")) {
        void voice.say(comment);
      }
    }
  }

  function getFallbackReaction(item: ContentItem): string {
    const pools: Record<string, string[]> = {
      quake: [
        "the ground is having feelings again. i don't like it when the ground has feelings.",
        "earthquakes are the planet's way of saying it's uncomfortable. same, earth. same.",
        "my tail is vibrating at a frequency i can't identify. is this fear? or indigestion?",
        "the letters are falling off the page. or i'm shaking. hard to tell.",
      ],
      space: [
        "that's so far away it doesn't exist for me. but i still worry about it.",
        "space is infinite. my arms are not. this feels relevant somehow.",
        "do you think the stars remember the dinosaurs? i hope so.",
        "thirteen billion light years is a long walk. even for someone with my dedication.",
      ],
      bird: [
        "a bird. my distant cousin who got the flying upgrade and i got... this. these arms.",
        "birds are just dinosaurs who figured out how to leave. i stayed. i have my reasons.",
        "every time i see a bird i think about what could have been. then i think about ferns.",
      ],
      fact: [
        "that's either deeply profound or completely useless. possibly both.",
        "i will remember this fact for exactly four seconds. three. two. what were we talking about?",
        "fascinating. did you know that i can't actually read? i've been faking it since the Cretaceous.",
      ],
      news: [
        "humans are doing things again. brave, confusing things.",
        "i read this three times and understood it less each time. classic news.",
        "this makes me want to hide inside a parenthesis and think about it for a while.",
        "interesting. concerning. i'm going to pretend i understand the implications.",
      ],
    };
    const pool = pools[item.kind] ?? pools.news!;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // ── Interactive chat ──────────────────────────────────────────────

  chatForm.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;

    chatInput.value = "";

    // Render user's message as a terrain block near the bottom.
    const userItem: ContentItem = {
      id: `user-${Date.now()}`,
      kind: "news" as ContentItem["kind"],
      text,
      publishedAt: Date.now(),
      score: 0.3,
    };
    renderedItemIds.add(userItem.id);

    const userBlock = terrain.place(userItem, true);
    if (userBlock) {
      userBlock.el.classList.add("kind-user");
      userBlock.el.classList.remove("kind-news");
      const textEl = userBlock.el.querySelector("[data-text-content]") as HTMLElement;
      if (textEl) {
        textEl.textContent = text;
        textEl.classList.remove("typing-cursor");
      }
      const metaEl = userBlock.el.querySelector(".tb-meta") as HTMLElement;
      if (metaEl) metaEl.textContent = "you";
    }

    // Zaur gets excited and moves to the user's message.
    dino.react("excited", 800);
    let eatenCharPromise: Promise<string | null> = Promise.resolve(null);
    if (userBlock) {
      const tx = userBlock.x + userBlock.w / 2;
      const ty = userBlock.y - dino.heightPx;
      dino.goTo(tx, ty);
      eatenCharPromise = (async () => {
        await awaitDinoArrival(tx, ty);
        let eaten: string | null = null;
        try {
          eaten = await eatLetterAnimation(userBlock);
        } catch {
          // ignore
        }
        if (eaten) {
          dino.react("happy", 1200);
          userBlock.el.style.transform = "scale(0.97) translateY(1px)";
          setTimeout(() => {
            userBlock.el.style.transform = "";
          }, 150);
          await new Promise((r) => setTimeout(r, 1000));
        }
        return eaten;
      })();
    }

    // Check if user is introducing themselves.
    const foundName = memory.checkForName(text);
    if (foundName) {
      void eatenCharPromise.then(() => {
        setTimeout(() => {
          bubble.show(`nice to meet you, ${memory.userName}. i'm zaur. i don't have a last name.`);
        }, 300);
      });
    }

    try {
      const resp = await fetch(`${ARCHIVE_API_URL}/api/zaur-talk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });

      if (resp.ok) {
        const body = await resp.json();
        const reply = body.text;

        // Render Zaur's reply as a terrain block.
        const replyItem: ContentItem = {
          id: `zaur-${Date.now()}`,
          kind: "fact" as ContentItem["kind"],
          text: reply,
          publishedAt: Date.now(),
          score: 0.5,
        };
        renderedItemIds.add(replyItem.id);

        // Wait for Zaur to finish eating the user's message before responding!
        await eatenCharPromise;

        const replyBlock = terrain.place(replyItem, true);
        if (replyBlock) {
          replyBlock.el.classList.add("kind-zaur");
          replyBlock.el.classList.remove("kind-fact");
          const textEl = replyBlock.el.querySelector("[data-text-content]") as HTMLElement;
          const metaEl = replyBlock.el.querySelector(".tb-meta") as HTMLElement;
          if (metaEl) metaEl.textContent = "zaur";
          if (textEl) {
            await typewriter(textEl, reply, { cps: 35, playClick: isVoiceEnabled });
            textEl.classList.remove("typing-cursor");
          }
        }

        dino.react("happy", 1200);
        bubble.show(reply.length > 80 ? reply.slice(0, 77) + "..." : reply);
        if (isVoiceEnabled) void voice.say(reply);
      } else {
        throw new Error("API call error");
      }
    } catch {
      await eatenCharPromise;
      dino.react("sad", 1000);
      bubble.show("rawr! i got distracted by a shiny dot! what were we talking about?");
    }
  });

  // ── Easter eggs ──────────────────────────────────────────────────

  // Magic words in chat — intercept before the API call by checking
  // the chat form's submit handler. We inject them into the existing
  // flow by watching the chat input for special keywords.
  const MAGIC_WORDS: Record<string, { mood: Mood; line: string; action?: () => void }> = {
    fern: {
      mood: "sad",
      line: "you said the magic word. *sniff* ferns are the only thing that survived with me. they're all i have. besides you. and these letters.",
    },
    rawr: {
      mood: "excited",
      line: "RAWR!! that's dinosaur for 'i appreciate your existence but i'm too cool to say it directly'. *tiny roar*",
    },
    asteroid: {
      mood: "sad",
      line: "we don't... we don't talk about that. *sits on a period and stares at nothing* i'm fine. i'm fine.",
    },
    meteor: {
      mood: "surprised",
      line: "INCOMING!! wait. it's just a pixel. a very fast pixel. *hides behind the letter B*",
      action: () => {
        // Fire a pixel meteor across the screen.
        const meteor = document.createElement("div");
        meteor.className = "easter-meteor";
        stage.appendChild(meteor);
        setTimeout(() => meteor.remove(), 2000);
      },
    },
    "42": {
      mood: "curious",
      line: "the answer to life, the universe, and everything. but what's the question? i think it's about ferns.",
    },
    "hello": {
      mood: "happy",
      line: "hello! hi! hey! greetings! salutations! *waves with arms that cannot wave* ...hi.",
    },
  };

  // Intercept magic words in the chat submit — check before the API call.
  chatForm.addEventListener("submit", (ev) => {
    const text = chatInput.value.trim().toLowerCase();
    const magic = MAGIC_WORDS[text];
    if (magic) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      chatInput.value = "";
      dino.react(magic.mood, 2000);
      bubble.show(magic.line);
      if (isVoiceEnabled) void voice.say(magic.line);
      magic.action?.();
    }
  }, true); // Capture phase — runs before the main handler.

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

  // Radio idle nudge — if radio has been off for > 5 min, occasionally ask about music.
  let lastRadioNudge = performance.now();
  setInterval(() => {
    if (isRadioPlaying) {
      lastRadioNudge = performance.now();
      return;
    }
    const elapsed = performance.now() - lastRadioNudge;
    if (elapsed < 5 * 60_000) return;
    if (!dino.isAvailable || Math.random() > 0.15) return;

    const nudgeLines = [
      "it's really quiet in here. do you want me to hum? i'm a terrible hummer.",
      "there's a radio button down there. just saying. no pressure. lots of pressure.",
      "the silence is making me hear things. like my own thoughts. they're weird.",
      "i miss the music. the letters were dancing. or i was imagining it. hard to tell with pixels.",
    ];
    const line = nudgeLines[Math.floor(Math.random() * nudgeLines.length)];
    bubble.show(line);
    dino.react("curious", 1800);
    lastRadioNudge = performance.now();
  }, 30_000);

  // Screenshot / Share Mode
  let isCapturing = false;

  const captureScreenshot = async () => {
    if (isCapturing) return;
    isCapturing = true;

    // React to being photographed.
    dino.react("surprised", 1500);
    setTimeout(() => {
      bubble.show("did you just... screenshot me? i wasn't ready! my pixels were relaxed!");
    }, 800);

    // Hide UI elements.
    document.body.classList.add("capturing");
    
    // Add watermark.
    const watermark = document.createElement("div");
    watermark.className = "screenshot-watermark";
    watermark.textContent = "dino.zaur.app";
    stage.appendChild(watermark);

    try {
      // Dynamic import to avoid blocking initial load.
      const { toBlob } = await import("html-to-image");
      
      const blob = await toBlob(stage, {
        quality: 0.95,
        backgroundColor: "#14141a",
        style: {
          transform: "scale(1)",
          transformOrigin: "top left",
        },
        filter: (node) => {
          // Don't capture UI controls or chat form.
          if (node instanceof HTMLElement) {
            if (node.classList?.contains("bottom-bar")) return false;
            if (node.classList?.contains("radio-drawer")) return false;
          }
          return true;
        }
      });

      if (blob) {
        // Download.
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `zaur-world-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
        a.click();
        URL.revokeObjectURL(url);

        // Copy to clipboard if supported.
        try {
          if (navigator.clipboard && window.ClipboardItem) {
            await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
          }
        } catch {
          // Ignore clipboard errors.
        }
      }
    } catch (err) {
      console.error("Screenshot failed:", err);
      bubble.show("the camera broke. it's probably my fault.");
    } finally {
      document.body.classList.remove("capturing");
      watermark.remove();
      isCapturing = false;
    }
  };

  cameraBtn.addEventListener("click", captureScreenshot);

  // Press 's' to screenshot (if not typing in chat).
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "s" && document.activeElement !== chatInput) {
      void captureScreenshot();
    }
  });

  // ── Click/Poke handling ───────────────────────────────────────────

  stage.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    const target = ev.target;
    if (target instanceof Element && target.closest("button, a, select, input, form, .radio-drawer")) {
      return;
    }
    const rect = stage.getBoundingClientRect();
    const px = ev.clientX - rect.left;
    const py = ev.clientY - rect.top;

    // Check if poke on Dino — escalating reactions.
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
        if (isVoiceEnabled) void voice.say(line);
        const offX = dino.bubbleAnchor.x < cssW / 2 ? cssW + 100 : -100;
        dino.goTo(offX, dino.bubbleAnchor.bottom - dino.heightPx);
        // Come back after 8 seconds.
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
        if (isVoiceEnabled) void voice.say(line);
      }
      return;
    }

    // Otherwise walk to clicked position.
    dino.goTo(px, py - dino.heightPx);
  });

  // ── SSE real-time events ──────────────────────────────────────────

  let es: EventSource | null = null;
  let isFirstLoad = true;

  function connectSse(): void {
    if (es) {
      es.close();
    }

    es = new EventSource(`${ARCHIVE_API_URL}/events?sound=${isVoiceEnabled ? "1" : "0"}`);

    es.addEventListener("open", () => {
      console.log("[stream] SSE event source connected");
      if (systemMsg) systemMsg.remove();
    });

    es.addEventListener("message", (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (!data) return;

        switch (data.type) {
          case "snapshot": {
            const flatItems: ContentItem[] = [];
            for (const list of Object.values(data.bins || {})) {
              if (Array.isArray(list)) {
                flatItems.push(...(list as ContentItem[]));
              }
            }
            // Sort oldest first.
            flatItems.sort((a, b) => {
              const timeA = a.publishedAt ?? a.deliveredAt ?? 0;
              const timeB = b.publishedAt ?? b.deliveredAt ?? 0;
              return timeA - timeB;
            });
            
            // Render first 3 snapshot items instantly so the page is not empty.
            const initialCount = Math.min(3, flatItems.length);
            const initial = flatItems.slice(0, initialCount);
            for (const item of initial) {
              renderItem(item, false);
            }
            
            // Queue the rest to typewriter one by one.
            const remaining = flatItems.slice(initialCount);
            for (const item of remaining) {
              if (!renderedItemIds.has(item.id)) {
                typewriterQueue.push(item);
              }
            }
            
            // Position Zaur in the center, but only on first load so we don't reset him when toggling sound.
            if (isFirstLoad) {
              setTimeout(() => {
                dino.goTo(cssW / 2, cssH * 0.6);
              }, 800);
              isFirstLoad = false;
            }
            break;
          }

          case "add": {
            const item = data.item as ContentItem;
            if (renderedItemIds.has(item.id)) return;
            typewriterQueue.push(item);
            break;
          }

          case "dino_thought": {
            const text = data.text as string;
            bubble.show(text);
            if (isVoiceEnabled) void voice.say(text);
            dino.react("happy", 1000);
            break;
          }

          case "dino_sfx": {
            const path = data.path as string;
            if (isVoiceEnabled) void voice.playSfx(path);
            break;
          }

          case "expire":
          case "items_expired": {
            const ids = data.ids as string[];
            if (!ids) return;
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
        terrain.repositionAll();
      }
    });
  });
  resizeObserver.observe(stage);

  // ── Idle wandering between text blocks ────────────────────────────

  setInterval(() => {
    if (!dino.isAvailable || dino.state === "walk") return;
    if (Math.random() > 0.45) return;

    const block = terrain.randomBlock(true);
    if (!block) {
      // No blocks yet — wander randomly.
      dino.goTo(Math.random() * cssW, Math.random() * cssH * 0.7);
      return;
    }

    // Walk to a random position on/near this text block.
    const targetX = block.x + Math.random() * block.w;
    const targetY = block.y - dino.heightPx; // Stand on top of the block.
    dino.goTo(targetX, targetY);

    // Idle commentary.
    if (Math.random() < 0.25) {
      const hour = new Date().getHours();
      // Try memory comment first, fallback to time-of-day.
      const line = memory.getMemoryIdleComment() ?? getIdleComment(hour);
      setTimeout(() => {
        bubble.show(line);
        if (isVoiceEnabled && Math.random() < 0.2) {
          void voice.say(line);
        }
      }, 2500);
    }
  }, 14000);

  // Track user interactions to detect "ultra-idle" (30+ min).
  let lastUserInteraction = performance.now();
  let ultraIdleFired = false;
  
  const resetInteraction = () => {
    lastUserInteraction = performance.now();
    ultraIdleFired = false;
  };
  stage.addEventListener("pointerdown", resetInteraction);
  chatForm.addEventListener("submit", resetInteraction);

  const ULTRA_IDLE_LINES = [
    "i've been standing here so long i started building a tiny house from semicolons. it fell down. twice.",
    "hello? is anyone there? or did the page fall asleep? pages don't sleep. ...do they?",
    "i've been counting the pixels. there are a lot of them. i lost count at seven.",
    "i wonder what the other tabs are doing. probably something more interesting. *sigh*",
    "if a dinosaur stands on a webpage and nobody scrolls, does it even render?",
    "i've had three existential crises in the last minute. a new personal record.",
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
    if (isVoiceEnabled) void voice.say(line);
  }, 60_000);

  // ── ISS Pass-Over Tracker ─────────────────────────────────────────
  
  let issSpotted = false;
  const pollISS = async () => {
    if (issSpotted || !dino.isAvailable) return;
    try {
      const resp = await fetch("https://api.wheretheiss.at/v1/satellites/25544");
      if (!resp.ok) return;
      await resp.json(); // Just verify it's valid JSON
      
      // The ISS moves fast. We'll just randomly decide it's "visible" occasionally
      // to keep the easter egg alive, but tie it to the real API call so it's
      // technically happening when the ISS is doing *something*.
      if (Math.random() < 0.15) {
        issSpotted = true;
        
        // Render the ISS.
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

        // Remove after it flies across.
        setTimeout(() => {
          issDot.remove();
          issSpotted = false; // allow it to be spotted again much later
        }, 30_000);
      }
    } catch {
      // ignore
    }
  };
  
  // Check every 2 minutes.
  setInterval(pollISS, 120_000);
  setTimeout(pollISS, 30_000); // Initial check after 30s.

  // ── Persist important articles periodically ───────────────────────

  setInterval(() => {
    terrain.persist();
  }, 60_000);

  // Also persist on unload.
  window.addEventListener("beforeunload", () => {
    terrain.persist();
  });

  // ── Restore persisted blocks ──────────────────────────────────────

  const restored = terrain.restore();
  for (const item of restored) {
    renderItem(item, false);
  }

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

    // 3. Keep speech bubble overlays attached.
    bubble.update();
    ambient.update(now);

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
