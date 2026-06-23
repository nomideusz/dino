// Zaur's Memory — a localStorage-backed system that remembers things
// across sessions so Zaur can reference past content and interactions.
//
// Tracks:
// - Topics/keywords from articles the user has seen
// - Session count (how many times the user has visited)
// - User's name (if they ever told Zaur in chat)
// - Notable events (big earthquakes, space discoveries, etc.)
//
// All data is stored under a single localStorage key as JSON.

const MEMORY_KEY = "zaur-memory";
const MAX_TOPICS = 50;
const MAX_EVENTS = 20;

interface ZaurMemory {
  /** Total number of sessions (page loads). */
  sessionCount: number;
  /** First visit timestamp. */
  firstVisit: number;
  /** User's name, if they ever told Zaur. */
  userName: string | null;
  /** Topic keywords extracted from articles, newest first. */
  topics: string[];
  /** Notable events Zaur remembers. */
  events: MemoryEvent[];
  /** Last session timestamp. */
  lastSession: number;
}

interface MemoryEvent {
  /** Short description. */
  text: string;
  /** Content kind. */
  kind: string;
  /** When it happened. */
  at: number;
}

function defaultMemory(): ZaurMemory {
  return {
    sessionCount: 0,
    firstVisit: Date.now(),
    userName: null,
    topics: [],
    events: [],
    lastSession: Date.now(),
  };
}

function load(): ZaurMemory {
  try {
    const raw = localStorage.getItem(MEMORY_KEY);
    if (!raw) return defaultMemory();
    const parsed = JSON.parse(raw) as Partial<ZaurMemory>;
    return {
      sessionCount: parsed.sessionCount ?? 0,
      firstVisit: parsed.firstVisit ?? Date.now(),
      userName: parsed.userName ?? null,
      topics: Array.isArray(parsed.topics) ? parsed.topics : [],
      events: Array.isArray(parsed.events) ? parsed.events : [],
      lastSession: parsed.lastSession ?? Date.now(),
    };
  } catch {
    return defaultMemory();
  }
}

function save(mem: ZaurMemory): void {
  try {
    localStorage.setItem(MEMORY_KEY, JSON.stringify(mem));
  } catch {
    // Private mode or storage full — ok.
  }
}

// Keywords to ignore when extracting topics.
const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "in", "on", "at", "to",
  "for", "of", "and", "or", "but", "it", "its", "this", "that", "with",
  "from", "by", "as", "be", "has", "have", "had", "will", "been", "would",
  "could", "should", "may", "might", "not", "no", "can", "do", "does",
  "did", "just", "about", "up", "out", "so", "if", "than", "very", "more",
  "also", "after", "before", "now", "new", "said", "says", "one", "two",
  "first", "last", "over", "into", "when", "where", "how", "what", "who",
  "which", "their", "there", "they", "them", "then", "some", "all", "any",
  "each", "every", "both", "few", "many", "much", "most", "other", "such",
  "only", "own", "same", "time", "year", "years", "day", "days", "people",
  "way", "world", "being", "thing", "things", "still", "back", "even",
  "well", "through", "between", "while", "here", "because", "since",
]);

/** Extract 1-3 notable keywords from an article. */
function extractTopics(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOP_WORDS.has(w));
  
  // Pick the most interesting-looking words (longer, less common).
  const scored = words.map((w) => ({
    word: w,
    score: w.length + (w.length > 7 ? 3 : 0),
  }));
  scored.sort((a, b) => b.score - a.score);
  
  // Deduplicate and take top 2.
  const seen = new Set<string>();
  const result: string[] = [];
  for (const { word } of scored) {
    if (seen.has(word)) continue;
    seen.add(word);
    result.push(word);
    if (result.length >= 2) break;
  }
  return result;
}

export class ZaurMemorySystem {
  private mem: ZaurMemory;

  constructor() {
    this.mem = load();
    this.mem.sessionCount++;
    this.mem.lastSession = Date.now();
    save(this.mem);
  }

  get sessionCount(): number {
    return this.mem.sessionCount;
  }

  get firstVisit(): number {
    return this.mem.firstVisit;
  }

  get userName(): string | null {
    return this.mem.userName;
  }

  get topics(): readonly string[] {
    return this.mem.topics;
  }

  get events(): readonly MemoryEvent[] {
    return this.mem.events;
  }

  /** Set the user's name (from chat). */
  setUserName(name: string): void {
    this.mem.userName = name.trim().slice(0, 30);
    save(this.mem);
  }

  /** Record topics from an article. */
  noteArticle(text: string, kind: string): void {
    const topics = extractTopics(text);
    for (const t of topics) {
      // Move to front if already known, otherwise add.
      const idx = this.mem.topics.indexOf(t);
      if (idx >= 0) this.mem.topics.splice(idx, 1);
      this.mem.topics.unshift(t);
    }
    // Cap.
    if (this.mem.topics.length > MAX_TOPICS) {
      this.mem.topics.length = MAX_TOPICS;
    }

    // Noteworthy events get remembered individually.
    if (kind === "quake" || kind === "space") {
      this.mem.events.unshift({
        text: text.slice(0, 100),
        kind,
        at: Date.now(),
      });
      if (this.mem.events.length > MAX_EVENTS) {
        this.mem.events.length = MAX_EVENTS;
      }
    }

    save(this.mem);
  }

  /** Check if the user mentioned their name in chat. */
  checkForName(message: string): boolean {
    // Patterns like "my name is X", "i'm X", "call me X".
    const patterns = [
      /my name is (\w+)/i,
      /i'?m (\w+)/i,
      /call me (\w+)/i,
      /name'?s (\w+)/i,
    ];
    for (const p of patterns) {
      const m = message.match(p);
      if (m && m[1] && m[1].length >= 2 && m[1].length <= 20) {
        this.setUserName(m[1]);
        return true;
      }
    }
    return false;
  }

  /** Generate a memory-aware greeting line for returning visitors. */
  getMemoryGreeting(): string | null {
    if (this.mem.sessionCount <= 1) return null;

    const lines: string[] = [];

    // Session count milestones.
    if (this.mem.sessionCount === 10) {
      lines.push("this is your 10th visit. double digits. we're basically best friends now.");
    } else if (this.mem.sessionCount === 50) {
      lines.push("50 visits. at this point i should probably charge rent. but i won't. because i'm nice. and also a dinosaur.");
    } else if (this.mem.sessionCount === 100) {
      lines.push("100 visits. i've been counting. with my tiny arms. it took a while.");
    } else if (this.mem.sessionCount % 25 === 0) {
      lines.push(`visit number ${this.mem.sessionCount}. you keep coming back. i'm suspicious but also flattered.`);
    }

    // Name reference.
    if (this.mem.userName) {
      lines.push(`oh, ${this.mem.userName}! you're back! *happy tail wag*`);
      lines.push(`${this.mem.userName} returns! the letters were asking about you. well, the letter Q was. the others don't care.`);
    }

    // Recent event reference.
    const recentEvent = this.mem.events[0];
    if (recentEvent) {
      const ageHours = (Date.now() - recentEvent.at) / (1000 * 60 * 60);
      if (ageHours < 48) {
        if (recentEvent.kind === "quake") {
          lines.push(`last time you were here there was an earthquake. i'm still shaking. or that's just my normal state. hard to tell.`);
        } else if (recentEvent.kind === "space") {
          lines.push(`remember that space thing from last time? i've been thinking about it. the universe is big. i am small. the letters are medium.`);
        }
      }
    }

    // Topic references.
    if (this.mem.topics.length > 3) {
      const t = this.mem.topics[Math.floor(Math.random() * Math.min(5, this.mem.topics.length))];
      lines.push(`i've been thinking about "${t}" since last time. i don't know why. my brain is very small.`);
    }

    if (lines.length === 0) return null;
    return lines[Math.floor(Math.random() * lines.length)];
  }

  /** Generate a memory-aware idle comment. */
  getMemoryIdleComment(): string | null {
    if (this.mem.topics.length < 2) return null;
    if (Math.random() > 0.3) return null; // Don't be too chatty.

    const t1 = this.mem.topics[Math.floor(Math.random() * Math.min(8, this.mem.topics.length))];
    const t2 = this.mem.topics[Math.floor(Math.random() * Math.min(8, this.mem.topics.length))];
    if (t1 === t2) return null;

    const templates = [
      `i keep thinking about "${t1}". and "${t2}". are they connected? everything feels connected when you're a dinosaur.`,
      `"${t1}"... that word keeps bouncing around in my tiny skull. or is it "${t2}"? both? neither? *sits on a period*`,
      `the letters spell out "${t1}" sometimes when i'm not looking. or maybe i'm imagining it. i imagine a lot of things.`,
    ];
    return templates[Math.floor(Math.random() * templates.length)];
  }
}
