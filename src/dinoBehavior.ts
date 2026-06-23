// Ambient dino behaviors. The Dino class itself only knows about momentary
// reactions (`react(mood, durationMs)`); these little tricks watch the world
// around the dino — clock, weather, how long it's been since something
// happened — and trigger periodic mood expressions so the page feels alive
// even when no cards are spawning. None of these touch the dino's internal
// state machine; they only call the public `react()` and read `isAvailable`,
// so they're safe to run alongside the courier loop.
//
// In this rebuild, the ambient system also drives weather-aware behaviors:
// Zaur shivers in snow, hides from thunder, stares at the moon, etc.

import type { Dino, Mood } from "./dino.js";
import type { WeatherConditions } from "./weather.js";

interface AmbientOptions {
  /** ms with no card spawn before the dino reads as "bored" / sleepy. */
  idleThresholdMs?: number;
  /** Minimum ms between two ambient triggers, so the dino isn't twitching. */
  cooldownMs?: number;
  /** Per-tick chance of firing once cooldown has elapsed. Keeps things calm. */
  perTickChance?: number;
}

const DEFAULTS: Required<AmbientOptions> = {
  idleThresholdMs: 3 * 60_000,
  cooldownMs: 9_000,
  perTickChance: 0.18,
};

/** Weather-specific commentary lines. */
const WEATHER_LINES: Record<string, string[]> = {
  thunder: [
    "THAT'S IT. I'M MOVING INSIDE A PDF.",
    "the sky is yelling at me. what did i do to the sky.",
    "thunder is just the clouds having a rex-istential crisis.",
    "lightning!! *hides behind the letter B*",
  ],
  snow: [
    "my pixels are freezing. do dinosaurs even have pixels? am i real?",
    "i'm using this semicolon as an umbrella. it's not working.",
    "snow is just the sky's dandruff. sorry. that was gross. *sits on a period*",
    "everything is white. am i inside a blank document?",
  ],
  rain: [
    "rain. the sky is crying. i get it, sky. i get it.",
    "each raindrop is a tiny period falling from above. it's beautiful and terrifying.",
    "i'm getting wet and i don't even know if i'm waterproof.",
    "the letters are getting soggy. can letters get soggy?",
  ],
  fog: [
    "i can't see the next paragraph. where am i?",
    "the fog ate the horizon. or maybe the horizon was never real.",
    "i swear the letter M was right here. the fog took it.",
  ],
  clear_night: [
    "do you think the moon remembers the asteroid too?",
    "the stars are out. they've been there since before me. they'll be there after.",
    "at night the letters look like constellations if i squint really hard.",
    "it's quiet. the kind of quiet where you hear your own thoughts. mine are mostly about ferns.",
  ],
  clear_day: [
    "the sun is warm on my tiny back. this is the best pixel-second of my life.",
    "everything is okay right now. this exact moment. don't think about asteroids.",
    "the light makes the letters glow. they're kind of beautiful. for symbols.",
  ],
};

export class DinoAmbient {
  private lastSpawnAt = performance.now();
  private lastTriggerAt = 0;
  private lastWeatherComment = 0;
  private readonly opts: Required<AmbientOptions>;

  /** Callback for showing weather-triggered commentary. */
  onWeatherComment: ((line: string) => void) | null = null;

  constructor(
    private readonly dino: Dino,
    private readonly weatherFn: () => WeatherConditions | null,
    opts: AmbientOptions = {},
  ) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  /** Reset the idle timer. Wire to MessageWorld.onSpawn. */
  noteSpawn(): void {
    this.lastSpawnAt = performance.now();
  }

  /**
   * Per-frame poll. Cheap — most calls bail before doing anything. Picks at
   * most one ambient mood to play, in a rough priority order so the loudest
   * cue (a thunderstorm) wins over the quietest (a calm sunny day).
   */
  update(now: number): void {
    if (!this.dino.isAvailable) return;
    if (now - this.lastTriggerAt < this.opts.cooldownMs) return;
    if (Math.random() > this.opts.perTickChance) return;

    const wx = this.weatherFn();
    const hour = new Date().getHours();
    const idleMs = now - this.lastSpawnAt;

    const pick = chooseAmbientMood({ wx, hour, idleMs, idleThresholdMs: this.opts.idleThresholdMs });
    if (!pick) return;

    this.dino.react(pick.mood, pick.duration);
    this.lastTriggerAt = now;

    // Weather-triggered commentary (at most once per 2 minutes).
    if (pick.weatherKey && this.onWeatherComment && now - this.lastWeatherComment > 120_000) {
      const lines = WEATHER_LINES[pick.weatherKey];
      if (lines && lines.length > 0) {
        const line = lines[Math.floor(Math.random() * lines.length)];
        setTimeout(() => this.onWeatherComment?.(line), 600);
        this.lastWeatherComment = now;
      }
    }

    // Stare-triggered commentary — when dino is sky-gazing, fire a contemplative line.
    if (this.dino.state === "stare" && this.onWeatherComment && now - this.lastWeatherComment > 90_000) {
      const wx = this.weatherFn();
      const stareLine = pickStareLine(wx, hour);
      if (stareLine) {
        setTimeout(() => this.onWeatherComment?.(stareLine), 1500);
        this.lastWeatherComment = now;
      }
    }
  }
}

/** Staring contemplation lines — context-aware, melancholic/absurdist. */
function pickStareLine(wx: WeatherConditions | null, hour: number): string | null {
  const pool: string[] = [];

  if (hour >= 22 || hour < 5) {
    pool.push(
      "the night sky is just the universe's screensaver. i relate.",
      "i wonder how many of those stars are already dead. we have that in common.",
      "if i stare long enough, will the sky stare back? that seems like a bad idea.",
      "the moon looks like the letter O that escaped the page. brave O.",
      "everything is so quiet. just me and the void. and these letters. mostly the letters.",
    );
  } else if (hour >= 6 && hour < 10) {
    pool.push(
      "morning light makes the letters look golden. or maybe my pixels are just warm.",
      "the sky is waking up too. we're all just pixels trying to render.",
      "i think the sun and i have an understanding. we both just show up every day.",
    );
  } else if (hour >= 17 && hour < 22) {
    pool.push(
      "the sky is doing its watercolor thing. i'd paint if i had arms that could hold a brush.",
      "evening is when i think about all the letters i never said.",
      "sunset is nature's way of saying 'to be continued'. like an ellipsis in the sky.",
    );
  } else {
    pool.push(
      "clouds look like letters in a language i almost understand.",
      "looking up makes me feel small. which is weird because i'm already very small.",
      "the sky doesn't have margins. i'm jealous.",
    );
  }

  // Weather-specific stare lines.
  if (wx?.precipitation === "rain") {
    pool.push(
      "watching the rain fall. each drop is a tiny period landing on the world.",
      "the rain sounds like the page is being typed on. from above. by a very wet typist.",
    );
  }
  if (wx?.precipitation === "snow") {
    pool.push(
      "snowflakes look like tiny asterisks. the sky is annotating everything.",
      "each snowflake is unique. like letters. like me. ...right?",
    );
  }

  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

interface ChoiceContext {
  wx: WeatherConditions | null;
  hour: number;
  idleMs: number;
  idleThresholdMs: number;
}

interface MoodChoice {
  mood: Mood;
  duration: number;
  /** Key into WEATHER_LINES for optional commentary. */
  weatherKey?: string;
}

/**
 * Priority-ordered ambient mood selection. First match wins. Weather cues are
 * loudest, then long-idle "lying down", then time-of-day baseline, then the
 * gentle clear-day happiness as a fallback so a sunny afternoon still gets
 * the occasional smile.
 */
function chooseAmbientMood(ctx: ChoiceContext): MoodChoice | null {
  const { wx, hour, idleMs, idleThresholdMs } = ctx;

  // Storm: brief alarm. The lightning visuals already do the loud part —
  // the dino just looks worried.
  if (wx?.thunder) return { mood: "angry", duration: 1400, weatherKey: "thunder" };

  // Snow / freezing rain: shivers / sad face. Dino is not a fan.
  if (wx?.precipitation === "snow") return { mood: "sad", duration: 2000, weatherKey: "snow" };

  // Heavy rain: drowsy and melancholic.
  if (wx?.precipitation === "rain" && wx.intensity >= 0.6)
    return { mood: "sad", duration: 2400, weatherKey: "rain" };

  // Lighter rain: just a mood shift.
  if (wx?.precipitation === "rain")
    return { mood: "curious", duration: 1800, weatherKey: "rain" };

  // Fog: confused.
  if (wx?.fog) return { mood: "surprised", duration: 1600, weatherKey: "fog" };

  // Long idle: lies down sleepy. Heaviest behavioural tell that the page
  // has been quiet — invites the user to do something.
  if (idleMs > idleThresholdMs) return { mood: "sleepy", duration: 4000 };

  // Night hours: contemplative.
  if (hour >= 22 || hour < 5) {
    // Clear night: stare at the sky.
    if (wx && !wx.isDay && wx.cloudiness === 0 && wx.precipitation === "none") {
      return { mood: "curious", duration: 3000, weatherKey: "clear_night" };
    }
    return { mood: "sleepy", duration: 2800 };
  }

  // Early morning: bouncy.
  if (hour >= 6 && hour < 9) return { mood: "excited", duration: 1500 };

  // Clear sunny day during waking hours: small smile, fired rarely thanks to
  // the perTickChance + cooldown. Skipped under heavy clouds or fog.
  if (
    wx &&
    wx.isDay &&
    wx.cloudiness === 0 &&
    wx.precipitation === "none" &&
    !wx.fog
  ) {
    return { mood: "happy", duration: 1800, weatherKey: "clear_day" };
  }

  return null;
}
