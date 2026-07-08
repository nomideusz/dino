// The dinosaur body. Zaur has simple gravity — he falls until he lands on a
// text block top-edge or the viewport floor. Text blocks act as platforms
// he can stand on, making the "letters are his world" concept literal.
//
// This class owns *how* he moves: walking (horizontal only, gravity handles
// the rest), hopping onto surfaces with a real jump arc, napping, staring.
// It does not decide *where* to go — that's `dinoMind.ts`, which strings
// these verbs into routines. Left alone, the body only fidgets: idles,
// blinks, looks around.

import {
  buildFrames,
  type FrameId,
  type RenderedFrame,
  SPRITE_GRID_H,
  SPRITE_GRID_W,
} from "./sprite.js";

export type Mood =
  | "angry"
  | "curious"
  | "excited"
  | "happy"
  | "neutral"
  | "sad"
  | "sleepy"
  | "surprised";

export type Activity =
  | "walk"
  | "idle"
  | "look"
  | "blink"
  | "sleep"
  | "react"
  | "stare";   // prolonged sky/moon gazing — look_up frame, long duration

export interface DinoOptions {
  /** Pixel scale (each sprite pixel is N CSS pixels). */
  scale: number;
  worldWidth: number;
  worldHeight: number;
  /** Optional override for the body color (defaults to sprite.INK). */
  color?: string;
}

/**
 * Anchor describing where things can be tethered to the dino.
 * `top` is the head; `bottom` is the feet.
 */
export interface BubbleAnchor {
  x: number;
  top: number;
  bottom: number;
}

/** A platform the dino can stand on. */
export interface Platform {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Callback to query available platforms at runtime. */
export type PlatformQuery = (x: number, fromY: number) => { y: number; platform: Platform | null };

// Gravity constants.
const GRAVITY = 480;       // px/s²
const MAX_FALL_SPEED = 600; // px/s
const GROUND_MARGIN = 60;   // px from bottom of viewport

export class Dino {
  private x: number;
  private y: number;
  private targetX: number;
  private targetY: number;
  private facing: 1 | -1 = 1;
  private speed = 36; // CSS px / s
  private activity: Activity = "idle";
  private nextDecisionAt = 0;
  private blinkUntil = 0;
  private wantsBlinkAt = 0;
  private animTick = 0;
  private frames: Record<FrameId, RenderedFrame>;
  private currentColor: string;

  /** Vertical velocity for gravity. */
  private vy = 0;
  /** Whether the dino is currently on a platform. */
  private onGround = true;
  /** The platform the dino is currently standing on (null = viewport floor). */
  private currentPlatform: Platform | null = null;

  /** Hook to query terrain platforms. Set by main.ts after construction. */
  platformQuery: PlatformQuery | null = null;

  /** Public mood — used to pick a face frame while reacting. */
  mood: Mood = "neutral";

  constructor(private opts: DinoOptions) {
    const color = opts.color ?? "#e8e4d8";
    this.currentColor = color;
    this.frames = buildFrames(opts.scale, color);
    this.x = opts.worldWidth * 0.5;
    this.y = opts.worldHeight - GROUND_MARGIN - this.heightPx;
    this.targetX = this.x;
    this.targetY = this.y;
    this.scheduleNextDecision(performance.now() + 1500);
    this.scheduleNextBlink(performance.now());
  }

  resize(worldWidth: number, worldHeight: number): void {
    this.opts.worldWidth = worldWidth;
    this.opts.worldHeight = worldHeight;

    const newScale = Math.max(2, Math.min(4, Math.round(Math.min(worldWidth, worldHeight) / 240)));
    if (newScale !== this.opts.scale) {
      this.opts.scale = newScale;
      this.frames = buildFrames(newScale, this.currentColor);
    }

    this.x = clamp(this.x, this.minX, this.maxX);
    this.y = clamp(this.y, this.minY, this.maxY);
    this.targetX = clamp(this.targetX, this.minX, this.maxX);
    this.targetY = clamp(this.targetY, this.minY, this.maxY);
  }

  get widthPx(): number {
    return SPRITE_GRID_W * this.opts.scale;
  }
  get heightPx(): number {
    return SPRITE_GRID_H * this.opts.scale;
  }

  /** The ground floor Y position (bottom of viewport minus margin). */
  get groundY(): number {
    return this.opts.worldHeight - GROUND_MARGIN - this.heightPx;
  }

  /** Current (x, y) coordinates in stage CSS pixels. */
  get position(): { x: number; y: number } {
    return { x: this.x, y: this.y };
  }

  /** Tether point for things attached to the dino — head + feet. */
  get bubbleAnchor(): BubbleAnchor {
    // The head sits in the upper-right of the 20×16 sprite (cols ~13-19).
    // That's ~6 sprite-pixels right of center; mirror when facing left.
    const dx = this.opts.scale * 6;
    return {
      x: this.x + (this.facing === 1 ? dx : -dx),
      top: this.y, // top of head
      bottom: this.y + this.heightPx, // bottom of feet
    };
  }

  /** Read-only state — used by the mind to decide what to ask next. */
  get state(): Activity {
    return this.activity;
  }

  /** True when the dino can be given a new instruction. */
  get isAvailable(): boolean {
    return (
      this.activity === "idle" ||
      this.activity === "walk" ||
      this.activity === "look" ||
      this.activity === "stare"
    );
  }

  /** Whether he's standing on something (vs. mid-air). */
  get grounded(): boolean {
    return this.onGround;
  }

  /** The platform he's standing on (null = viewport floor or mid-air). */
  get standingOn(): Platform | null {
    return this.onGround ? this.currentPlatform : null;
  }

  /** Has he reached his walk target? Horizontal only — gravity owns Y. */
  hasArrived(eps = 8): boolean {
    return Math.abs(this.targetX - this.x) <= eps;
  }

  /**
   * Ask the dino to pause and emote. He stops where he is, shows the
   * matching face for `durationMs`, then the decision loop resumes.
   */
  react(mood: Mood = "curious", durationMs = 2200): void {
    this.mood = mood;
    this.activity = "react";
    this.targetX = this.x;
    this.targetY = this.y;
    this.nextDecisionAt = performance.now() + durationMs;
  }

  /** Hit-test in stage CSS pixels. Loose — a forgiving bounding box. */
  contains(px: number, py: number): boolean {
    const halfW = this.widthPx / 2;
    return (
      px >= this.x - halfW &&
      px <= this.x + halfW &&
      py >= this.y &&
      py <= this.y + this.heightPx
    );
  }

  /**
   * Walk toward x. Y is ignored for motion — he walks along whatever
   * surface he's on, falls off edges, and gravity sorts out the rest.
   * (The y parameter is kept so callers can express intent, e.g. clicks.)
   */
  goTo(x: number, _y?: number): void {
    if (!this.isAvailable) return;
    this.activity = "walk";
    this.targetX = clamp(x, this.minX, this.maxX);
    this.targetY = this.y;
    this.speed = 52;
    this.mood = "curious";
    this.faceToward(this.targetX);
    this.nextDecisionAt = Number.POSITIVE_INFINITY;
  }

  /**
   * Jump toward a surface: an impulse big enough to clear `surfaceY` (a
   * platform top edge, in CSS px), drifting horizontally toward `x` while
   * airborne. Landing is the normal gravity/platform check.
   */
  hopTo(x: number, surfaceY: number): void {
    if (!this.isAvailable || !this.onGround) return;
    const feetY = this.y + this.heightPx;
    const rise = Math.max(0, feetY - surfaceY);
    const impulse = Math.sqrt(2 * GRAVITY * (rise + 30));
    this.vy = -impulse;
    this.onGround = false;
    this.currentPlatform = null;

    this.activity = "walk";
    this.targetX = clamp(x, this.minX, this.maxX);
    this.targetY = this.y;
    // Aim to cover the horizontal distance in roughly the airtime.
    const airtime = ((impulse + Math.sqrt(Math.max(0, impulse * impulse - 2 * GRAVITY * rise))) / GRAVITY) || 0.5;
    const dist = Math.abs(this.targetX - this.x);
    this.speed = clamp(dist / Math.max(0.3, airtime), 30, 160);
    this.mood = "excited";
    this.faceToward(this.targetX);
    this.nextDecisionAt = Number.POSITIVE_INFINITY;
  }

  /** Lie down and sleep for `ms`. The decision loop wakes him after. */
  nap(ms: number): void {
    if (!this.isAvailable || !this.onGround) return;
    this.activity = "sleep";
    this.targetX = this.x;
    this.nextDecisionAt = performance.now() + ms;
  }

  /** Look up at the sky for `ms`. */
  stargaze(ms: number): void {
    if (!this.isAvailable) return;
    this.activity = "stare";
    this.targetX = this.x;
    this.nextDecisionAt = performance.now() + ms;
  }

  update(now: number, dtMs: number): void {
    const dtSec = dtMs / 1000;

    // Blink layer — independent of motion.
    if (
      now >= this.wantsBlinkAt &&
      this.activity !== "sleep" &&
      this.activity !== "react"
    ) {
      this.blinkUntil = now + 130;
      this.scheduleNextBlink(now);
    }

    // ── Gravity ──────────────────────────────────────────────────────
    // Apply gravity when not on a solid surface. The dino falls until
    // he hits a text block top-edge or the viewport floor. Landing only
    // happens on the way down (vy >= 0), so hops can rise through the
    // level of the surface they started from.
    if (!this.onGround) {
      this.vy = Math.min(this.vy + GRAVITY * dtSec, MAX_FALL_SPEED);
      this.y += this.vy * dtSec;

      const feetY = this.y + this.heightPx;
      const floorY = this.opts.worldHeight - GROUND_MARGIN;
      const query = this.platformQuery;

      if (this.vy >= 0) {
        if (query) {
          // Candidates measured from the head down: generous enough that a
          // fast fall can't tunnel through a platform between frames.
          const result = query(this.x, this.y);
          if (feetY >= result.y) {
            // Landed on a platform or the ground.
            this.y = result.y - this.heightPx;
            this.vy = 0;
            this.onGround = true;
            this.currentPlatform = result.platform;
          }
        } else if (feetY >= floorY) {
          this.y = floorY - this.heightPx;
          this.vy = 0;
          this.onGround = true;
          this.currentPlatform = null;
        }
      }
    } else if (this.platformQuery) {
      // Grounded: re-query the surface under him every frame. This covers
      // both walking off a platform edge and the masonry reflow moving a
      // block under his feet — he follows small shifts, falls otherwise.
      const feetY = this.y + this.heightPx;
      const result = this.platformQuery(this.x, feetY - 8);
      if (result.y - feetY <= 48) {
        this.y = result.y - this.heightPx;
        this.currentPlatform = result.platform;
      } else {
        this.onGround = false;
        this.vy = 0;
        this.currentPlatform = null;
      }
    }

    // ── Horizontal movement ──────────────────────────────────────────
    // Walking moves x only; y always comes from gravity + platforms.
    if (this.activity === "walk") {
      const dx = this.targetX - this.x;
      const dist = Math.abs(dx);
      const step = this.speed * dtSec;

      if (dist <= 1.5 || step >= dist) {
        this.x = this.targetX;
        if (this.onGround) {
          // Arrived — go idle and let the mind pick the next thing.
          this.activity = "idle";
          this.scheduleNextDecision(now + 700 + Math.random() * 2200);
        }
        // Mid-air (a hop): keep the walk state until we land, so the
        // arrival above fires on solid ground.
      } else {
        this.x += Math.sign(dx) * step;
        if (dist > 0.5) this.facing = dx >= 0 ? 1 : -1;
      }
    }

    if (now >= this.nextDecisionAt) {
      this.pickNextActivity(now);
    }

    this.animTick += dtMs;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    // Rebuild frames dynamically if theme color changes.
    if (!this.opts.color) {
      const currentInk = getComputedStyle(document.body).getPropertyValue("--ink").trim();
      if (currentInk && currentInk !== this.currentColor) {
        this.currentColor = currentInk;
        this.frames = buildFrames(this.opts.scale, currentInk);
      }
    }

    const frame = this.currentFrame();
    const img = this.facing === 1 ? frame.right : frame.left;
    // Subtle bob: walking = 1px step bob, idle = gentle breathing, stare = still
    const moving = this.activity === "walk" && this.onGround;
    const idling = this.activity === "idle";
    let bob = 0;
    if (moving) {
      bob = Math.round(Math.sin(this.animTick / 110));
    } else if (idling) {
      // Tiny 0.5px breathing oscillation — barely visible but alive.
      bob = Math.sin(this.animTick / 800) * 0.6;
    }

    // Squash-and-stretch on landing.
    const falling = !this.onGround && this.vy > 50;
    if (falling) {
      // Stretch while falling.
      ctx.save();
      const cx = Math.round(this.x);
      const cy = Math.round(this.y + this.heightPx / 2);
      ctx.translate(cx, cy);
      ctx.scale(0.9, 1.1);
      ctx.translate(-cx, -cy);
      ctx.drawImage(
        img,
        Math.round(this.x - this.widthPx / 2),
        Math.round(this.y + bob)
      );
      ctx.restore();
    } else {
      // Small grounding shadow.
      if (this.onGround) {
        const shadowW = this.widthPx * 0.6;
        const shadowH = 3;
        const shadowX = Math.round(this.x);
        const shadowY = Math.round(this.y + this.heightPx + 1);
        ctx.save();
        ctx.globalAlpha = 0.15;
        ctx.fillStyle = "#000";
        ctx.beginPath();
        ctx.ellipse(shadowX, shadowY, shadowW / 2, shadowH, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      ctx.drawImage(
        img,
        Math.round(this.x - this.widthPx / 2),
        Math.round(this.y + bob)
      );
    }
  }

  private currentFrame(): RenderedFrame {
    const now = performance.now();
    if (this.activity === "sleep") return this.frames.sleep;
    if (this.activity === "stare") return this.frames.look_up;
    if (!this.onGround) {
      // Airborne — rising reads as a happy leap, falling as surprise.
      return this.vy < 0 ? this.frames.cheer : this.frames.surprise;
    }
    if (now < this.blinkUntil) return this.frames.blink;
    if (this.activity === "react") return this.moodFrame();
    if (this.activity === "look") return this.frames.look_up;
    if (this.activity === "walk") {
      return Math.floor(this.animTick / 180) % 2 === 0
        ? this.frames.walk_a
        : this.frames.walk_b;
    }
    return this.frames.idle;
  }

  private moodFrame(): RenderedFrame {
    switch (this.mood) {
      case "angry":
        return this.frames.angry;
      case "happy":
        return this.frames.happy;
      case "excited":
        return this.frames.cheer;
      case "sad":
        return this.frames.sad;
      case "curious":
        return this.frames.look_up;
      case "surprised":
        return this.frames.surprise;
      case "sleepy":
        return this.frames.sleep;
      case "neutral":
        return this.frames.idle;
    }
  }

  /**
   * The body's own fidgets between the mind's instructions. Never walks
   * anywhere — moving with purpose is the mind's job. Just idles, glances
   * around, occasionally emotes.
   */
  private pickNextActivity(now: number): void {
    const r = Math.random();
    if (this.activity === "sleep" && r < 0.55) {
      // Wake from a nap with a small stretch — show the "look up" pose
      // briefly so the transition reads as yawning/stretching.
      this.activity = "react";
      this.mood = "curious";
      this.scheduleNextDecision(now + 700 + Math.random() * 600);
      return;
    }
    if (r < 0.07) {
      const emotes: Mood[] = ["happy", "sad", "surprised", "curious"];
      this.react(emotes[Math.floor(Math.random() * emotes.length)], 1100 + Math.random() * 700);
      return;
    }
    if (r < 0.8) {
      this.activity = "idle";
      this.scheduleNextDecision(now + 1500 + Math.random() * 3000);
    } else {
      this.activity = "look";
      this.scheduleNextDecision(now + 900 + Math.random() * 1100);
    }
  }

  private faceToward(x: number): void {
    if (Math.abs(x - this.x) > 0.5) {
      this.facing = x >= this.x ? 1 : -1;
    }
  }

  private get minX(): number {
    return this.widthPx / 2 + 8;
  }
  private get maxX(): number {
    return this.opts.worldWidth - this.widthPx / 2 - 8;
  }
  private get minY(): number {
    return 8;
  }
  private get maxY(): number {
    return this.opts.worldHeight - this.heightPx - GROUND_MARGIN;
  }

  private scheduleNextDecision(at: number): void {
    this.nextDecisionAt = at;
  }

  private scheduleNextBlink(now: number): void {
    this.wantsBlinkAt = now + 2200 + Math.random() * 3800;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
