// Zaur's mind. The Dino class is the body (walking, hopping, gravity);
// this is the part that decides where to go and why, so his movement reads
// as a small creature with habits instead of a random walk.
//
// He has a handful of routines, weighted by time of day:
//
//   read      — pick a story he hasn't visited, walk under it, hop on top,
//               stand there a while. New stories jump the queue.
//   patrol    — amble across the ground, pausing to look up at the columns.
//   go home   — return to his spot (bottom-left, under the radio) and sit.
//   nap       — lie down at home. Long naps at night, catnaps by day.
//   stargaze  — find an empty stretch of ground and stare at the sky.
//
// Mornings are for reading, afternoons for patrolling, evenings wind down,
// and at night he mostly stays home, gazes, and sleeps. User interactions
// (clicks, pokes) put the mind on hold so it never fights the user.

import type { Dino } from "./dino.js";
import type { TerrainBlock, TextTerrain } from "./textTerrain.js";

type Step =
  /** floor: get down to the ground first (naps happen on the floor, not on articles). */
  | { kind: "walk"; x: number; floor?: boolean }
  | { kind: "hop"; blockId: string }
  | { kind: "pause"; ms: number; pose?: "curious" | "happy" }
  | { kind: "nap"; ms: number }
  | { kind: "stare"; ms: number };

type Routine = "read" | "patrol" | "home" | "nap" | "stargaze";

/** Max height (px above his feet) he'll actually jump; higher = admire from below. */
const MAX_HOP_RISE = 620;
const STEP_TIMEOUT_MS = 14_000;

export class DinoMind {
  private steps: Step[] = [];
  private stepStarted = false;
  private stepStartedAt = 0;
  /** Failure cutoff — a step still running past this aborts the whole plan. */
  private stepDeadline = 0;
  private nextPlanAt = performance.now() + 6_000;
  private holdUntil = 0;
  private readonly visited = new Set<string>();

  constructor(
    private readonly dino: Dino,
    private readonly terrain: TextTerrain,
    private readonly view: () => { w: number; h: number }
  ) {}

  /** Mid-routine — lets other systems (ambient moods) stay out of the way. */
  get busy(): boolean {
    return this.steps.length > 0;
  }

  /** User did something — stay out of the way for a bit. */
  deferFor(ms: number): void {
    this.holdUntil = Math.max(this.holdUntil, performance.now() + ms);
    this.steps = [];
    this.stepStarted = false;
  }

  /** A new story finished typing in — go see it, whatever else was planned. */
  visitNew(blockId: string): void {
    const block = this.blockById(blockId);
    if (!block || block.hidden) return;
    this.visited.add(blockId);
    this.steps = [
      ...this.approachSteps(block),
      { kind: "pause", ms: 4_000 + Math.random() * 4_000, pose: "happy" },
    ];
    this.stepStarted = false;
    this.nextPlanAt = performance.now() + 10_000;
  }

  /** The reader opened a story — wander over and keep them company. */
  watchReading(blockId: string): void {
    const block = this.blockById(blockId);
    if (!block || block.hidden) return;
    this.steps = [
      { kind: "walk", x: block.x + block.w / 2 },
      { kind: "pause", ms: 16_000, pose: "curious" },
    ];
    this.stepStarted = false;
    this.nextPlanAt = performance.now() + 20_000;
  }

  /** Per-frame tick. Cheap — most calls check one condition and return. */
  tick(now: number): void {
    if (now < this.holdUntil) return;

    if (this.steps.length === 0) {
      if (now >= this.nextPlanAt && this.dino.isAvailable && this.dino.state !== "walk") {
        this.plan();
      }
      return;
    }

    const step = this.steps[0];

    if (!this.stepStarted) {
      if (!this.dino.isAvailable && this.dino.state !== "sleep") return;
      this.startStep(step, now);
      return;
    }

    if (now > this.stepDeadline) {
      // Step failed (blocked, target vanished, walked into a wall of
      // bad luck) — drop the whole plan rather than doing the remaining
      // steps somewhere they weren't meant to happen.
      this.steps = [];
      this.stepStarted = false;
      this.nextPlanAt = now + 6_000 + Math.random() * 8_000;
      return;
    }

    if (this.isStepDone(step, now)) {
      this.steps.shift();
      this.stepStarted = false;
      if (this.steps.length === 0) {
        this.nextPlanAt = now + 8_000 + Math.random() * 18_000;
      }
      return;
    }

    // Walks resume themselves: he pauses at block edges on the way down,
    // and reactions (poke, weather) can interrupt — re-aim at the target
    // instead of standing around until the deadline kills the plan.
    if (step.kind === "walk" && this.dino.state === "idle" && this.dino.grounded) {
      this.dino.goTo(step.x);
    }
  }

  // ── Step execution ─────────────────────────────────────────────────

  private startStep(step: Step, now: number): void {
    // Asleep with something to do (e.g. a new story arrived mid-nap):
    // wake him first, retry on the next tick.
    if (this.dino.state === "sleep") {
      this.dino.react("surprised", 700);
      return;
    }

    this.stepStarted = true;
    this.stepStartedAt = now;
    this.stepDeadline = now + STEP_TIMEOUT_MS;

    switch (step.kind) {
      case "walk": {
        // A floor-bound walk that starts on top of a block heads for the
        // nearest block edge first; gravity takes him down, then the
        // resume logic in tick() re-aims him at the real target.
        const on = step.floor ? this.dino.standingOn : null;
        if (on) {
          const { w } = this.view();
          const exits = [on.x - 34, on.x + on.w + 34].filter((x) => x > 50 && x < w - 50);
          exits.sort((a, b) => Math.abs(a - step.x) - Math.abs(b - step.x));
          this.dino.goTo(exits[0] ?? step.x);
        } else {
          this.dino.goTo(step.x);
        }
        // Long walks get a deadline that matches the distance.
        const dist = Math.abs(step.x - this.dino.position.x);
        this.stepDeadline = now + (dist / 45) * 1000 + 10_000;
        break;
      }
      case "hop": {
        const block = this.blockById(step.blockId);
        if (!block || block.hidden) {
          this.stepDeadline = now; // gone — plan aborts on next tick
          return;
        }
        this.dino.hopTo(block.x + block.w / 2, block.y);
        break;
      }
      case "pause":
        this.stepDeadline = now + step.ms + 2_000;
        if (step.pose && Math.random() < 0.7) {
          this.dino.react(step.pose, Math.min(step.ms, 2_600));
        }
        break;
      case "nap":
        this.dino.nap(step.ms);
        this.stepDeadline = now + step.ms + 8_000;
        break;
      case "stare":
        this.dino.stargaze(step.ms);
        this.stepDeadline = now + step.ms + 4_000;
        break;
    }
  }

  private isStepDone(step: Step, now: number): boolean {
    const elapsed = now - this.stepStartedAt;
    switch (step.kind) {
      case "walk":
        return (
          this.dino.grounded &&
          Math.abs(this.dino.position.x - step.x) <= 10 &&
          (!step.floor || this.dino.standingOn === null)
        );
      case "hop": {
        if (!this.dino.grounded) return false;
        const block = this.blockById(step.blockId);
        if (!block) return true;
        // Done when he's standing on that block's top edge.
        return Math.abs((this.dino.position.y + this.dino.heightPx) - block.y) < 6;
      }
      case "pause":
        return elapsed >= step.ms;
      case "nap":
        // Over when he's slept his fill, or woke himself up early.
        return (
          elapsed >= step.ms ||
          (elapsed > 2_000 && this.dino.state !== "sleep" && this.dino.state !== "react")
        );
      case "stare":
        return elapsed >= step.ms || (elapsed > 1_000 && this.dino.state !== "stare");
    }
  }

  // ── Planning ───────────────────────────────────────────────────────

  private plan(): void {
    const routine = this.pickRoutine(new Date().getHours());
    switch (routine) {
      case "read":
        this.planRead();
        break;
      case "patrol":
        this.planPatrol();
        break;
      case "home":
        this.steps = [
          { kind: "walk", x: this.homeX(), floor: true },
          { kind: "pause", ms: 6_000 + Math.random() * 8_000 },
        ];
        break;
      case "nap": {
        const hour = new Date().getHours();
        const night = hour >= 22 || hour < 6;
        const ms = night ? 30_000 + Math.random() * 45_000 : 9_000 + Math.random() * 9_000;
        this.steps = [
          { kind: "walk", x: this.homeX(), floor: true },
          { kind: "pause", ms: 1_000 },
          { kind: "nap", ms },
        ];
        break;
      }
      case "stargaze":
        this.steps = [
          { kind: "walk", x: this.quietX(), floor: true },
          { kind: "stare", ms: 5_000 + Math.random() * 5_000 },
        ];
        break;
    }
    this.stepStarted = false;
  }

  private pickRoutine(hour: number): Routine {
    let weights: Record<Routine, number>;
    if (hour >= 22 || hour < 6) {
      weights = { read: 0.5, patrol: 0.5, home: 2, nap: 4, stargaze: 3 };
    } else if (hour < 11) {
      weights = { read: 5, patrol: 2.5, home: 1, nap: 0.3, stargaze: 0.4 };
    } else if (hour < 17) {
      weights = { read: 3, patrol: 3, home: 1.5, nap: 0.8, stargaze: 0.4 };
    } else {
      weights = { read: 2, patrol: 2, home: 3, nap: 1, stargaze: 1.5 };
    }

    // Nothing left to read → don't pick read (or reset if he's seen it all).
    if (!this.nextUnvisited()) {
      if (this.visited.size > 0 && Math.random() < 0.3) this.visited.clear();
      else weights.read = 0;
    }

    const total = Object.values(weights).reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (const [routine, w] of Object.entries(weights) as [Routine, number][]) {
      r -= w;
      if (r <= 0) return routine;
    }
    return "patrol";
  }

  private planRead(): void {
    const block = this.nextUnvisited();
    if (!block) {
      this.planPatrol();
      return;
    }
    this.visited.add(block.id);
    this.steps = [
      ...this.approachSteps(block),
      { kind: "pause", ms: 5_000 + Math.random() * 6_000 },
    ];
  }

  private planPatrol(): void {
    const { w } = this.view();
    const stops = 2 + Math.floor(Math.random() * 2);
    this.steps = [];
    for (let i = 0; i < stops; i++) {
      this.steps.push(
        { kind: "walk", x: (0.1 + Math.random() * 0.8) * w, floor: true },
        { kind: "pause", ms: 2_000 + Math.random() * 3_500, pose: Math.random() < 0.5 ? "curious" : undefined }
      );
    }
  }

  /**
   * Walk under a block, then hop onto it. Blocks too high to reach from
   * the ground get climbed via a lower block in the same column when one
   * exists; otherwise he stands beneath and looks up instead.
   */
  private approachSteps(block: TerrainBlock): Step[] {
    const { h } = this.view();
    const groundFeetY = h - 60;
    const rise = groundFeetY - block.y;
    const centerX = block.x + block.w / 2;

    if (rise <= MAX_HOP_RISE) {
      return [{ kind: "walk", x: centerX }, { kind: "hop", blockId: block.id }];
    }

    // A stepping stone: same column (horizontal overlap), below the
    // target, reachable from the ground, target reachable from its top.
    const stone = this.terrain.blocks.find(
      (b) =>
        b.id !== block.id &&
        !b.hidden &&
        b.x < block.x + block.w &&
        b.x + b.w > block.x &&
        b.y > block.y + 40 &&
        groundFeetY - b.y <= MAX_HOP_RISE &&
        b.y - block.y <= MAX_HOP_RISE
    );
    if (stone) {
      return [
        { kind: "walk", x: stone.x + stone.w / 2 },
        { kind: "hop", blockId: stone.id },
        { kind: "hop", blockId: block.id },
      ];
    }

    return [
      { kind: "walk", x: centerX },
      { kind: "pause", ms: 3_000, pose: "curious" },
    ];
  }

  private nextUnvisited(): TerrainBlock | null {
    const candidates = this.terrain.blocks.filter((b) => !b.hidden && !this.visited.has(b.id));
    if (candidates.length === 0) return null;
    // Prefer the most recent unread story.
    candidates.sort((a, b) => b.placedAt - a.placedAt);
    return candidates[0];
  }

  private blockById(id: string): TerrainBlock | null {
    return this.terrain.blocks.find((b) => b.id === id) ?? null;
  }

  private homeX(): number {
    // Bottom-left, roughly under the radio widget.
    return Math.max(70, this.view().w * 0.08);
  }

  private quietX(): number {
    // A stretch of ground away from home — right side, a bit random.
    return this.view().w * (0.6 + Math.random() * 0.3);
  }
}
