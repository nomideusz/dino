// The world. A time-of-day sky that interpolates between color keyframes
// based on the user's local clock, with a sun arcing across by day, a moon
// by night, and twinkling stars that fade in at dusk and out at dawn.
//
// The dot grid stays as a quiet graph-paper texture in the foreground.
// Vivid palette rendered at full canvas opacity: real cerulean at noon,
// golden dawns, fiery dusks. Overcast weather desaturates the sky toward
// gray, so the mood tracks the actual conditions outside. Text readability
// is handled by the frosted terrain cards in CSS, not by muting the sky.

import { THEME } from "./theme.js";
import type { WeatherConditions } from "./weather.js";

export interface WorldState {
  width: number;
  height: number;
}

export interface WorldOptions {
  /** Polled each frame for current weather. Returning null = clear sky. */
  weather?: () => WeatherConditions | null;
}

type RGB = [number, number, number];

interface SkyKeyframe {
  /** Hour of day, 0..24. KEYFRAMES must be sorted ascending. */
  hour: number;
  /** Top-of-screen color. */
  top: RGB;
  /** Bottom-of-screen color. */
  bottom: RGB;
}

// Sky color stops across a 24-hour day. The narrator interpolates between
// adjacent keyframes so transitions are smooth, not steppy.
const SKY: SkyKeyframe[] = [
  { hour:  0,   top: rgb("#0d1026"), bottom: rgb("#1c2144") }, // deep night (rich navy)
  { hour:  5,   top: rgb("#2b2350"), bottom: rgb("#7a3d5e") }, // pre-dawn (indigo → plum)
  { hour:  6.5, top: rgb("#5f56a6"), bottom: rgb("#f0956a") }, // dawn (lavender → golden peach)
  { hour:  9,   top: rgb("#3e8ede"), bottom: rgb("#b8e0f8") }, // morning (clear blue)
  { hour: 13,   top: rgb("#2e83e0"), bottom: rgb("#a6d9f7") }, // midday (cerulean)
  { hour: 16,   top: rgb("#4f86c9"), bottom: rgb("#f2c88e") }, // afternoon (blue going golden)
  { hour: 18,   top: rgb("#53387f"), bottom: rgb("#ef7440") }, // dusk (violet → fire)
  { hour: 20,   top: rgb("#241d4e"), bottom: rgb("#64346a") }, // evening (indigo → violet)
  { hour: 22,   top: rgb("#12132e"), bottom: rgb("#1e2242") }, // night
];

// Canonical sun window (decimal hours). Everything in this file — sky
// keyframes, the sun arc, stars, birds, fireflies — is keyed to this
// canonical clock. warpHour() maps the *real* solar day (from the weather
// service's sunrise/sunset) onto it, so the whole world tracks the actual
// sun with no per-feature changes: long summer evenings, short winter days.
const SUN_RISE = 5.8;
const SUN_SET = 18.2;

/**
 * Piecewise-linear time warp: real sunrise → SUN_RISE, real sunset →
 * SUN_SET, night stretched/compressed to fill the rest. Identity when sun
 * times are unknown or degenerate (polar day/night).
 */
function warpHour(h: number, rise: number | null, set: number | null): number {
  if (rise == null || set == null) return h;
  const dayLen = set - rise;
  if (dayLen < 1 || dayLen > 23) return h;
  if (h >= rise && h <= set) {
    return SUN_RISE + ((h - rise) / dayLen) * (SUN_SET - SUN_RISE);
  }
  const nightLen = 24 - dayLen;
  const sinceSet = (h - set + 24) % 24;
  return (SUN_SET + (sinceSet / nightLen) * (24 - SUN_SET + SUN_RISE)) % 24;
}

const GRID_PX = 24;

// Reference new moon: 2000-01-06 18:14 UTC. Used to derive lunar phase from
// the wall clock — keeps the moon in sync with the actual sky outside.
const MOON_REF_MS = Date.UTC(2000, 0, 6, 18, 14);
const MOON_SYNODIC_MS = 29.530588 * 86_400_000;

interface Star {
  x: number;
  y: number;
  brightness: number;
  twinklePhase: number;
}

interface Cloud {
  /** Anchor x in [0, 1] of world width — wraps at edges. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Drift speed, fraction of world width per second. */
  drift: number;
  /** Per-cloud silhouette seed so each puff looks slightly different. */
  seed: number;
  /** Depth band: 0 = far/back, 1 = mid, 2 = near/front. Drives parallax + opacity. */
  layer: 0 | 1 | 2;
}

interface Drop {
  x: number;
  y: number;
  vy: number;
  /** Sideways drift amplitude in pixels (snow only). */
  sway: number;
  swayPhase: number;
  /** Snow only: per-flake size class (0 = tiny, 1 = small, 2 = medium). */
  size: 0 | 1 | 2;
}

interface Splash {
  x: number;
  y: number;
  /** 0..1 — life progress; visual fades with progress. */
  age: number;
}

interface Bird {
  /** Position fraction across the world width [0, 1+]. */
  x: number;
  /** Vertical position fraction in the upper sky [0, 1]. */
  y: number;
  /** Drift across the world width per second. */
  speed: number;
  /** Wing-flap phase. */
  flapPhase: number;
}

interface ShootingStar {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  /** Total lifetime in seconds. */
  life: number;
}

interface Firefly {
  /** Stable per-firefly column offset. */
  bx: number;
  /** Phase offsets so each fly flickers and drifts on its own rhythm. */
  driftPhase: number;
  bobPhase: number;
  blinkPhase: number;
}

export class World {
  private stars: Star[] = [];
  private clouds: Cloud[] = [];
  private drops: Drop[] = [];
  private splashes: Splash[] = [];
  private birds: Bird[] = [];
  private fireflies: Firefly[] = [];
  /** Two layers of horizon silhouette (far + near) — regenerated on resize. */
  private hillsFar: Array<[number, number]> = [];
  private hillsNear: Array<[number, number]> = [];
  private dropsKind: "rain" | "snow" | "none" = "none";
  /** Slowly varying horizontal wind, [-1, 1]. Drives rain angle + cloud sway. */
  private wind = 0;
  private windPhase = Math.random() * Math.PI * 2;
  /** Seconds until the next lightning flash. Only ticks while thunder is on. */
  private lightningTimer = 4 + Math.random() * 6;
  /** 0..1 — current flash brightness, decays each frame after a strike. */
  private lightningIntensity = 0;
  /** Procedural bolt path (or null between strikes). */
  private bolt: Array<[number, number]> | null = null;
  private boltAge = 0;
  /** One meteor at a time, minutes apart — rarity is what makes it a delight. */
  private shooting: ShootingStar | null = null;
  private shootingTimer = 90 + Math.random() * 240;
  /** 0..1 — ground wetness. Builds while it rains, dries over ~5 minutes. */
  private wetness = 0;
  private readonly weatherFn: () => WeatherConditions | null;

  constructor(private state: WorldState, opts: WorldOptions = {}) {
    this.weatherFn = opts.weather ?? (() => null);
    this.regenStars();
    this.regenClouds();
    this.regenHills();
    this.regenBirds();
    this.regenFireflies();
  }

  resize(state: WorldState): void {
    this.state = state;
    this.regenStars();
    this.regenClouds();
    this.regenHills();
    this.regenBirds();
    this.regenFireflies();
    this.drops = [];
    this.splashes = [];
    this.dropsKind = "none";
    this.bolt = null;
  }

  get width(): number {
    return this.state.width;
  }
  get height(): number {
    return this.state.height;
  }

  // The world is fully driven by the wall clock — nothing to advance per frame
  // for the sky itself, but we do step weather particles and atmospherics.
  update(dtMs: number): void {
    const wx = this.weatherFn();
    const dt = dtMs / 1000;
    this.tickWind(wx, dt);
    this.tickClouds(wx, dt);
    this.tickDrops(wx, dt);
    this.tickSplashes(dt);
    this.tickLightning(wx, dt);
    this.tickBirds(dt);
    this.tickShootingStar(dt, starAlpha(this.currentHour(wx)));
    this.tickWetness(wx, dt);
  }

  /** The canonical (sun-warped) hour — see warpHour. */
  private currentHour(wx: WeatherConditions | null, date = new Date()): number {
    const hReal = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
    return warpHour(hReal, wx?.sunriseH ?? null, wx?.sunsetH ?? null);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const { width, height } = this.state;
    const date = new Date();
    const wx = this.weatherFn();
    // All drawing below runs on the warped (canonical) clock — see warpHour.
    const h = this.currentHour(wx, date);

    // Sky gradient. Overcast pulls the colors toward gray, so a clear day is
    // genuinely blue and a stormy one genuinely leaden — weather owns the mood.
    const cloudAlpha = wx ? cloudAlphaFor(wx) : 0;
    let [topRGB, bottomRGB] = this.skyAt(h);
    if (cloudAlpha > 0) {
      topRGB = desatRGB(topRGB, cloudAlpha * 0.55);
      bottomRGB = desatRGB(bottomRGB, cloudAlpha * 0.55);
    }
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, rgbToCss(topRGB));
    grad.addColorStop(1, rgbToCss(bottomRGB));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // Horizon glow at sunrise/sunset — soft warm wash low on the screen.
    this.drawHorizonGlow(ctx, h);

    // Aurora bands at deep night when the sky is reasonably clear — drawn
    // before stars so it reads as a soft veil behind them.
    const auroraA = auroraAlpha(h) * (1 - cloudAlpha * 0.85);
    if (auroraA > 0.01) this.drawAurora(ctx, auroraA);

    // Stars (only at night-ish hours; heavy clouds also dim them).
    const sa = starAlpha(h) * (1 - cloudAlpha * 0.7);
    if (sa > 0.01) this.drawStars(ctx, sa);
    if (this.shooting) this.drawShootingStar(ctx, sa);

    // Distant cloud layer sits *behind* the sun/moon for a sense of depth.
    if (this.clouds.length > 0 && cloudAlpha > 0) {
      this.drawCloudLayer(ctx, 0, cloudAlpha, wx, h);
    }

    // Sun (by day) or moon (by night) arcing across the sky.
    this.drawCelestial(ctx, h, 1 - cloudAlpha * 0.55, date);

    // Distant horizon silhouettes — derived from the bottom sky color so they
    // always sit *between* the sky and the foreground cloud band.
    this.drawHills(ctx, h, bottomRGB);

    // Rain-slicked ground: a low reflective sheen that lingers after a shower.
    if (this.wetness > 0.02) this.drawWetSheen(ctx);

    // Hot, clear afternoons get a faint shimmer hovering over the horizon.
    const heat = wx ? heatFactor(wx.temperatureC, cloudAlpha, h) : 0;
    if (heat > 0.02) this.drawHeatHaze(ctx, heat);

    // Mid + near cloud layers in front of the celestial body.
    if (this.clouds.length > 0 && cloudAlpha > 0) {
      this.drawCloudLayer(ctx, 1, cloudAlpha, wx, h);
      this.drawCloudLayer(ctx, 2, cloudAlpha, wx, h);
    }

    // Pixel birds drifting across the upper sky on clear-ish days. They
    // shelter during precipitation, and winter skies are emptier.
    const month = date.getMonth();
    const winter = month === 11 || month <= 1;
    const sheltering = !!wx && wx.precipitation !== "none";
    const dayA = sheltering ? 0 : dayCreatureAlpha(h) * (1 - cloudAlpha * 0.6);
    if (dayA > 0.05) this.drawBirds(ctx, dayA, winter ? 0.4 : 1);

    // Fireflies near the lower sky band on clear nights — May to September;
    // fireflies in a January frost would break the spell.
    const flySeason = month >= 4 && month <= 8 ? 1 : 0;
    const flyA = fireflyAlpha(h) * flySeason * (1 - cloudAlpha * 0.85);
    if (flyA > 0.05) this.drawFireflies(ctx, flyA);

    // Fog haze — gradient overlay denser near the ground.
    if (wx?.fog) this.drawFog(ctx);

    // Rain / snow particles in front of the clouds.
    if (this.drops.length > 0) this.drawDrops(ctx);
    if (this.splashes.length > 0) this.drawSplashes(ctx);

    // Lightning: brief screen-wide flash + procedural bolt during thunder.
    if (this.lightningIntensity > 0) this.drawLightning(ctx);

    // Quiet graph-paper dot grid on top
    ctx.fillStyle = THEME.grid;
    for (let y = GRID_PX; y < height; y += GRID_PX) {
      for (let x = GRID_PX; x < width; x += GRID_PX) {
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }

  /** Returns interpolated [top, bottom] sky colors for a given decimal hour. */
  private skyAt(h: number): [RGB, RGB] {
    for (let i = 0; i < SKY.length; i++) {
      const next = SKY[i];
      if (next.hour > h) {
        const prev =
          i === 0
            ? { ...SKY[SKY.length - 1], hour: SKY[SKY.length - 1].hour - 24 }
            : SKY[i - 1];
        const t = (h - prev.hour) / (next.hour - prev.hour);
        return [lerpRGB(prev.top, next.top, t), lerpRGB(prev.bottom, next.bottom, t)];
      }
    }
    // h is past the last keyframe — wrap around to the first
    const prev = SKY[SKY.length - 1];
    const next = { ...SKY[0], hour: SKY[0].hour + 24 };
    const t = (h - prev.hour) / (next.hour - prev.hour);
    return [lerpRGB(prev.top, next.top, t), lerpRGB(prev.bottom, next.bottom, t)];
  }

  private drawHorizonGlow(ctx: CanvasRenderingContext2D, h: number): void {
    // Strongest in the half-hour around sunrise/sunset, fading either side.
    const strength = horizonGlowStrength(h);
    if (strength <= 0.02) return;
    const { width, height } = this.state;
    // Anchor the glow on whichever horizon the sun is near.
    const onLeft = h < 12;
    const cx = onLeft ? width * 0.18 : width * 0.82;
    const cy = height * 0.62;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(width, height) * 0.7);
    const a = (0.18 * strength).toFixed(3);
    grad.addColorStop(0, `rgba(220, 130, 90, ${a})`);
    grad.addColorStop(0.5, `rgba(160, 80, 90, ${(0.10 * strength).toFixed(3)})`);
    grad.addColorStop(1, "rgba(60, 30, 60, 0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
  }

  private drawStars(ctx: CanvasRenderingContext2D, alpha: number): void {
    const t = performance.now() / 1000;
    for (const s of this.stars) {
      const twinkle = 0.65 + 0.35 * Math.sin(t * 1.4 + s.twinklePhase);
      const a = s.brightness * twinkle * alpha;
      ctx.fillStyle = `rgba(232, 228, 216, ${a.toFixed(3)})`;
      const ix = s.x | 0;
      const iy = s.y | 0;
      ctx.fillRect(ix, iy, 1, 1);
      // The brighter ones get a 2-pixel "flare" so the field looks varied.
      if (s.brightness > 0.75) ctx.fillRect(ix + 1, iy, 1, 1);
    }
  }

  private drawCelestial(
    ctx: CanvasRenderingContext2D,
    h: number,
    dim: number,
    date: Date
  ): void {
    const isSun = h >= SUN_RISE && h <= SUN_SET;

    let t: number;
    if (isSun) {
      t = (h - SUN_RISE) / (SUN_SET - SUN_RISE);
    } else {
      // Moon arcs from sunset (h = SUN_SET) through midnight to sunrise next day.
      let moonH = h - SUN_SET;
      if (moonH < 0) moonH += 24;
      const moonSpan = 24 - SUN_SET + SUN_RISE; // hours moon is up
      t = moonH / moonSpan;
    }

    const x = this.state.width * (0.08 + t * 0.84);
    const baseY = this.state.height * 0.22;
    const arcHeight = this.state.height * 0.13;
    const y = baseY - Math.sin(t * Math.PI) * arcHeight;

    ctx.save();
    ctx.globalAlpha = Math.max(0.2, dim);

    if (isSun) {
      // How close the sun is to the horizon (0 = noon, 1 = at horizon).
      const horizonness = Math.min(1, Math.abs(t - 0.5) * 2);
      this.drawSun(ctx, x, y, horizonness);
    } else {
      this.drawMoon(ctx, x, y, date);
    }

    ctx.restore();
  }

  private drawSun(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    horizonness: number,
  ): void {
    // Bigger near the horizon — matches the design (r=30 at noon, r=36 low),
    // sells the atmospheric magnification you actually see at sunrise/sunset.
    const r = 28 + 8 * horizonness;
    // Color shifts from warm gold at noon to deep orange near the horizon.
    const ease = horizonness * horizonness;
    const discR = clampByte(248 - 4 * ease);
    const discG = clampByte(208 - 64 * ease);
    const discB = clampByte(138 - 84 * ease);
    const glowR = clampByte(255);
    const glowG = clampByte(210 - 30 * ease);
    const glowB = clampByte(140 - 40 * ease);

    // Stacked halo arcs — five concentric warm rings, biggest+faintest first,
    // smallest+strongest last. Reads cleaner than a single radial blur and
    // matches the rest of the pixel-flavoured style.
    for (let i = 4; i >= 0; i--) {
      const a = 0.05 + (4 - i) * 0.02;
      ctx.fillStyle = `rgba(${glowR}, ${glowG}, ${glowB}, ${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, r * (1 + i * 0.6), 0, Math.PI * 2);
      ctx.fill();
    }

    // Sun rays — only fade in when the sun is low (horizon scattering effect).
    if (horizonness > 0.4) {
      const rayAlpha = (horizonness - 0.4) * 0.30;
      ctx.strokeStyle = `rgba(${glowR}, ${glowG}, ${glowB}, ${rayAlpha.toFixed(3)})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const rayCount = 10;
      const innerR = r * 1.7;
      const outerR = r * 5.5;
      for (let i = 0; i < rayCount; i++) {
        // Slight phase from the wall clock so rays drift instead of rigidly
        // pointing — a barely-perceptible shimmer.
        const a = (i / rayCount) * Math.PI * 2 + performance.now() * 0.00004;
        const cx = Math.cos(a);
        const sy = Math.sin(a);
        ctx.moveTo(x + cx * innerR, y + sy * innerR);
        ctx.lineTo(x + cx * outerR, y + sy * outerR);
      }
      ctx.stroke();
    }

    // Disc with a touch of limb darkening: an off-center radial gradient
    // produces a subtle "lit from above-left" feel without being cartoonish.
    const discGrad = ctx.createRadialGradient(
      x - r * 0.3, y - r * 0.3, r * 0.2,
      x, y, r,
    );
    discGrad.addColorStop(0, rgbToCss([
      clampByte(discR + 12), clampByte(discG + 12), clampByte(discB + 8),
    ]));
    discGrad.addColorStop(1, rgbToCss([discR, discG, discB]));
    ctx.fillStyle = discGrad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawMoon(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    date: Date
  ): void {
    const r = 18;
    const phase = lunarPhase(date); // 0..1
    const illum = (1 - Math.cos(phase * Math.PI * 2)) / 2; // 0..1
    const waxing = phase < 0.5;

    // Stacked halo arcs — four concentric cool rings; brighter near the disc,
    // fading outward. A full moon nudges every layer up a touch so it really
    // glows. Mirrors the stacked-arc style we use for the sun.
    const haloBoost = 0.04 * illum;
    for (let i = 3; i >= 0; i--) {
      const a = 0.04 + (3 - i) * 0.02 + haloBoost;
      ctx.fillStyle = `rgba(220, 222, 235, ${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, r * (1 + i * 0.7), 0, Math.PI * 2);
      ctx.fill();
    }

    // Earthshine: the dark side faintly visible when the moon is a thin crescent.
    // Strongest near new moon, gone by first quarter.
    const earthshine = Math.max(0, 0.28 - illum) / 0.28;

    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.clip();

    // Dark side base color (with earthshine boost).
    const darkR = clampByte(36 + 18 * earthshine);
    const darkG = clampByte(38 + 18 * earthshine);
    const darkB = clampByte(54 + 22 * earthshine);
    const darkCss = rgbToCss([darkR, darkG, darkB]);
    ctx.fillStyle = darkCss;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);

    // Lit hemisphere as a half-rect (clipped to disc).
    const litCss = "#e2e3eb";
    ctx.fillStyle = litCss;
    if (waxing) {
      ctx.fillRect(x, y - r, r, r * 2);
    } else {
      ctx.fillRect(x - r, y - r, r, r * 2);
    }

    // Terminator: an ellipse that bulges into either the lit or dark half
    // depending on whether we're past first/last quarter.
    const ellipseRx = r * Math.abs(1 - 2 * illum);
    if (illum < 0.5) {
      // Less than half lit — shadow ellipse extends into the lit half.
      ctx.fillStyle = darkCss;
      ctx.beginPath();
      ctx.ellipse(x, y, ellipseRx, r, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (illum > 0.5) {
      // More than half lit — lit ellipse extends into the dark half.
      ctx.fillStyle = litCss;
      ctx.beginPath();
      ctx.ellipse(x, y, ellipseRx, r, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Surface detail — craters with subtle highlight rims. Drawn after the
    // shadow so the dark hemisphere naturally hides any craters that fall on it.
    this.drawCraters(ctx, x, y, r, waxing, illum);

    // Limb darkening — soft dark vignette around the edge gives the disc volume.
    const limbGrad = ctx.createRadialGradient(x, y, r * 0.85, x, y, r);
    limbGrad.addColorStop(0, "rgba(0,0,0,0)");
    limbGrad.addColorStop(1, "rgba(20, 18, 28, 0.40)");
    ctx.fillStyle = limbGrad;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);

    ctx.restore();
  }

  private drawCraters(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    r: number,
    waxing: boolean,
    illum: number,
  ): void {
    // Five fixed crater positions in unit-disc coordinates. Drawing them at the
    // same place every night makes the moon feel like a familiar object rather
    // than a procedurally re-rolled blob.
    const craters: Array<[number, number, number]> = [
      [ 0.32, -0.18, 0.22],
      [-0.30,  0.28, 0.16],
      [ 0.10,  0.45, 0.12],
      [-0.48, -0.36, 0.10],
      [ 0.55,  0.06, 0.09],
    ];

    // Subtle shadow-side suppression: craters near the terminator get faded
    // so they don't pop against the line.
    ctx.fillStyle = "rgba(150, 152, 168, 0.50)";
    ctx.beginPath();
    for (const [dx, dy, cr] of craters) {
      const onLitHalf = waxing ? dx > 0 : dx < 0;
      // Skip craters that would be on the dark side when the moon is mostly dark.
      if (illum < 0.15 && !onLitHalf) continue;
      ctx.moveTo(x + r * dx + r * cr, y + r * dy);
      ctx.arc(x + r * dx, y + r * dy, r * cr, 0, Math.PI * 2);
    }
    ctx.fill();

    // Faint highlight rims on the lit side of each crater — sells the relief.
    ctx.fillStyle = "rgba(255, 255, 255, 0.10)";
    ctx.beginPath();
    for (const [dx, dy, cr] of craters) {
      const onLitHalf = waxing ? dx > 0 : dx < 0;
      if (illum < 0.30 && !onLitHalf) continue;
      const hx = x + r * dx + (waxing ? -r * cr * 0.35 : r * cr * 0.35);
      const hy = y + r * dy - r * cr * 0.35;
      ctx.moveTo(hx + r * cr * 0.45, hy);
      ctx.arc(hx, hy, r * cr * 0.45, 0, Math.PI * 2);
    }
    ctx.fill();
  }

  private drawCloudLayer(
    ctx: CanvasRenderingContext2D,
    layer: 0 | 1 | 2,
    alpha: number,
    wx: WeatherConditions | null,
    h: number,
  ): void {
    const stormy = !!(wx && (wx.thunder || wx.cloudiness === 2));
    // Top edge color (lit by sky), bottom edge color (in self-shadow).
    let top: RGB = stormy ? [100, 102, 116] : [220, 222, 232];
    let bot: RGB = stormy ? [38, 38, 50] : [130, 132, 152];
    // Golden hour: the low sun lights clouds from below, so the shadowed
    // underside catches fire first and the top edge only blushes. Storm
    // decks still glow, just ember-dim.
    const glow = horizonGlowStrength(h);
    if (glow > 0.02) {
      const k = glow * (stormy ? 0.35 : 1);
      bot = lerpRGB(bot, [246, 138, 96], 0.7 * k);
      top = lerpRGB(top, [240, 186, 158], 0.35 * k);
    }
    const [topR, topG, topB] = top;
    const [botR, botG, botB] = bot;
    // Distant clouds are dimmer (atmospheric perspective).
    const layerOpacity = layer === 0 ? 0.55 : layer === 1 ? 0.85 : 1.0;
    const baseAlpha = alpha * (wx?.thunder ? 0.85 : 0.55) * layerOpacity;

    for (const cloud of this.clouds) {
      if (cloud.layer !== layer) continue;

      const cx = cloud.x * this.state.width;
      const cy = cloud.y;
      const w = cloud.width;
      const h = cloud.height;

      // Vertical light/shadow gradient per cloud — top reads brighter.
      const grad = ctx.createLinearGradient(0, cy - h * 0.6, 0, cy + h * 0.7);
      grad.addColorStop(0, `rgba(${topR}, ${topG}, ${topB}, ${baseAlpha.toFixed(3)})`);
      grad.addColorStop(1, `rgba(${botR}, ${botG}, ${botB}, ${(baseAlpha * 0.85).toFixed(3)})`);
      ctx.fillStyle = grad;

      // A cloud is 4–5 overlapping ellipses; the seed deterministically
      // varies the puff pattern so each one looks distinct.
      const lobes = 4 + (cloud.seed & 1);
      for (let i = 0; i < lobes; i++) {
        const offX = ((cloud.seed * (i + 1) * 31) % 100) / 100 - 0.5;
        const offY = ((cloud.seed * (i + 2) * 17) % 60) / 100 - 0.3;
        const rx = (w / 2) * (0.55 + ((cloud.seed * (i + 3) * 7) % 40) / 100);
        const ry = (h / 2) * (0.65 + ((cloud.seed * (i + 4) * 5) % 30) / 100);
        ctx.beginPath();
        ctx.ellipse(cx + offX * w * 0.6, cy + offY * h * 0.8, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private drawFog(ctx: CanvasRenderingContext2D): void {
    const { width, height } = this.state;
    // Vertical gradient — denser near the ground than at the sky.
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, "rgba(180, 184, 196, 0.04)");
    grad.addColorStop(0.55, "rgba(190, 192, 202, 0.18)");
    grad.addColorStop(1, "rgba(200, 200, 210, 0.32)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // A second slow-drifting band at mid-height suggests layered haze.
    const t = performance.now() / 1000;
    const bandY = height * (0.55 + Math.sin(t * 0.06) * 0.04);
    const bandH = height * 0.18;
    const band = ctx.createLinearGradient(0, bandY - bandH, 0, bandY + bandH);
    band.addColorStop(0, "rgba(210, 212, 220, 0)");
    band.addColorStop(0.5, "rgba(210, 212, 220, 0.10)");
    band.addColorStop(1, "rgba(210, 212, 220, 0)");
    ctx.fillStyle = band;
    ctx.fillRect(0, bandY - bandH, width, bandH * 2);
  }

  private drawDrops(ctx: CanvasRenderingContext2D): void {
    if (this.dropsKind === "rain") {
      // Wind tilts the streak — small angle is enough to read as windy weather.
      const tilt = this.wind * 4; // px of horizontal offset over the streak length
      ctx.strokeStyle = "rgba(170, 190, 220, 0.55)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const d of this.drops) {
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x - 1.5 + tilt, d.y + 8);
      }
      ctx.stroke();
    } else if (this.dropsKind === "snow") {
      ctx.fillStyle = "rgba(232, 234, 244, 0.85)";
      for (const d of this.drops) {
        const sx = d.x + Math.sin(d.swayPhase) * d.sway + this.wind * 6;
        const ix = sx | 0;
        const iy = d.y | 0;
        if (d.size === 0) {
          ctx.fillRect(ix, iy, 1, 1);
        } else if (d.size === 1) {
          ctx.fillRect(ix, iy, 1, 1);
          ctx.fillRect(ix + 1, iy, 1, 1);
          ctx.fillRect(ix, iy + 1, 1, 1);
        } else {
          // 3px cross — bigger flakes catch the eye.
          ctx.fillRect(ix, iy, 1, 1);
          ctx.fillRect(ix + 1, iy, 1, 1);
          ctx.fillRect(ix - 1, iy, 1, 1);
          ctx.fillRect(ix, iy + 1, 1, 1);
          ctx.fillRect(ix, iy - 1, 1, 1);
        }
      }
    }
  }

  private drawSplashes(ctx: CanvasRenderingContext2D): void {
    ctx.strokeStyle = "rgba(170, 190, 220, 0.5)";
    ctx.lineWidth = 1;
    for (const s of this.splashes) {
      const a = (1 - s.age) * 0.6;
      const w = 2 + s.age * 4;
      ctx.strokeStyle = `rgba(170, 190, 220, ${a.toFixed(3)})`;
      ctx.beginPath();
      // A short flat arc — looks like water bouncing off the surface.
      ctx.ellipse(s.x, s.y, w, 1, 0, Math.PI, 0);
      ctx.stroke();
    }
  }

  private drawLightning(ctx: CanvasRenderingContext2D): void {
    const { width, height } = this.state;
    // Screen-wide brightening — capped so it stays moody, not flashbang.
    const flashAlpha = this.lightningIntensity * 0.22;
    ctx.fillStyle = `rgba(220, 220, 240, ${flashAlpha.toFixed(3)})`;
    ctx.fillRect(0, 0, width, height);

    if (this.bolt && this.bolt.length > 1) {
      // Bolt fades faster than the flash — visible only in the first ~120ms.
      const boltAlpha = Math.max(0, 1 - this.boltAge * 8) * 0.85;
      if (boltAlpha > 0.02) {
        ctx.strokeStyle = `rgba(245, 245, 255, ${boltAlpha.toFixed(3)})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(this.bolt[0][0], this.bolt[0][1]);
        for (let i = 1; i < this.bolt.length; i++) {
          ctx.lineTo(this.bolt[i][0], this.bolt[i][1]);
        }
        ctx.stroke();
        // Faint outer glow on the bolt
        ctx.strokeStyle = `rgba(200, 210, 255, ${(boltAlpha * 0.35).toFixed(3)})`;
        ctx.lineWidth = 4;
        ctx.stroke();
      }
    }
  }

  private tickWind(wx: WeatherConditions | null, dt: number): void {
    // Real wind speed sets the amplitude; the two summed sines keep the
    // gusting organic (not perfectly periodic). ~35 km/h reads as full
    // bluster: slanted rain, hurried clouds. A calm day barely stirs.
    const strength = 0.25 + 0.75 * Math.min(1, (wx?.windSpeed ?? 8) / 35);
    this.windPhase += dt * 0.07;
    this.wind =
      (Math.sin(this.windPhase) * 0.6 +
        Math.sin(this.windPhase * 0.31 + 2.1) * 0.4) * strength;
  }

  private tickClouds(wx: WeatherConditions | null, dt: number): void {
    if (!wx || wx.cloudiness === 0) return;
    // A wind nudge on top of each cloud's intrinsic drift — with real wind
    // speed in this.wind's amplitude, a blustery day visibly hurries them.
    const windNudge = this.wind * 0.006;
    for (const cloud of this.clouds) {
      // Front-layer clouds are pushed harder — parallax sells depth.
      const layerScale = cloud.layer === 0 ? 0.35 : cloud.layer === 1 ? 1.0 : 1.6;
      cloud.x += (cloud.drift + windNudge) * layerScale * dt;
      // Wrap horizontally — fraction-of-width coordinates make this trivial.
      if (cloud.x > 1.15) cloud.x -= 1.3;
      else if (cloud.x < -0.15) cloud.x += 1.3;
    }
  }

  private tickDrops(wx: WeatherConditions | null, dt: number): void {
    const wantKind: "rain" | "snow" | "none" = wx?.precipitation ?? "none";
    if (wantKind !== this.dropsKind) {
      this.dropsKind = wantKind;
      this.regenDrops(wx);
    }
    if (this.drops.length === 0 || wantKind === "none") return;
    const { width, height } = this.state;
    for (const d of this.drops) {
      d.y += d.vy * dt;
      if (wantKind === "snow") {
        d.swayPhase += dt * 1.4;
      } else {
        // Rain: wind also pushes drops sideways, so wrapping accounts for it.
        d.x += this.wind * 22 * dt;
      }
      if (d.y > height + 8) {
        // Rain occasionally spawns a splash where it lands. Throttled by chance
        // and a hard cap — splashes are cheap, but a few hundred would chew CPU.
        if (wantKind === "rain" && this.splashes.length < 30 && Math.random() < 0.2) {
          this.splashes.push({ x: d.x, y: height - 2, age: 0 });
        }
        d.y = -8;
        d.x = Math.random() * width;
      }
      if (wantKind === "rain") {
        if (d.x < -8) d.x += width + 16;
        else if (d.x > width + 8) d.x -= width + 16;
      }
    }
  }

  private tickSplashes(dt: number): void {
    if (this.splashes.length === 0) return;
    for (const s of this.splashes) s.age += dt * 4; // ~250ms total life
    this.splashes = this.splashes.filter((s) => s.age < 1);
  }

  private tickLightning(wx: WeatherConditions | null, dt: number): void {
    if (!wx?.thunder) {
      this.lightningIntensity = 0;
      this.bolt = null;
      // Reset the timer so the first strike after thunder returns isn't immediate.
      this.lightningTimer = 4 + Math.random() * 6;
      return;
    }
    this.lightningTimer -= dt;
    if (this.lightningTimer <= 0) {
      this.lightningIntensity = 0.6 + Math.random() * 0.4;
      // Rarely double-strike — the eye reads it as a louder storm.
      this.lightningTimer = (Math.random() < 0.18 ? 0.18 : 0) + 4 + Math.random() * 9;
      this.bolt = generateBolt(this.state.width, this.state.height);
      this.boltAge = 0;
    }
    if (this.lightningIntensity > 0) {
      // Fast exponential decay — 0.001^dt drops to ~0.07 over 1s.
      this.lightningIntensity *= Math.pow(0.001, dt);
      if (this.lightningIntensity < 0.01) this.lightningIntensity = 0;
    }
    if (this.bolt) {
      this.boltAge += dt;
      if (this.boltAge > 0.25) this.bolt = null;
    }
  }

  private regenClouds(): void {
    const count = Math.max(6, Math.round(this.state.width / 180));
    let seed = 7331;
    const rand = (): number => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    this.clouds = [];
    const skyBand = this.state.height * 0.42;
    for (let i = 0; i < count; i++) {
      // Distribute across three depth layers. Distant clouds are smaller and
      // higher in the frame; near clouds are larger and sit lower.
      const layerRoll = rand();
      const layer: 0 | 1 | 2 = layerRoll < 0.35 ? 0 : layerRoll < 0.75 ? 1 : 2;
      const sizeMul = layer === 0 ? 0.55 : layer === 1 ? 1.0 : 1.35;
      const w = (90 + rand() * 130) * sizeMul;
      const yJitter =
        layer === 0
          ? rand() * skyBand * 0.55
          : layer === 1
          ? skyBand * 0.2 + rand() * skyBand * 0.6
          : skyBand * 0.4 + rand() * skyBand * 0.6;
      this.clouds.push({
        x: rand() * 1.3 - 0.15,
        y: 30 + yJitter,
        width: w,
        height: w * (0.34 + rand() * 0.16),
        // Base drift speed; tickClouds applies the per-layer parallax scale.
        drift: (rand() < 0.5 ? -1 : 1) * (0.005 + rand() * 0.012),
        seed: 1 + Math.floor(rand() * 9999),
        layer,
      });
    }
  }

  private regenDrops(wx: WeatherConditions | null): void {
    if (!wx || wx.precipitation === "none") {
      this.drops = [];
      return;
    }
    const isRain = wx.precipitation === "rain";
    const baseCount = Math.round((this.state.width * this.state.height) / (isRain ? 12_000 : 18_000));
    const count = Math.round(baseCount * (0.4 + wx.intensity));
    this.drops = [];
    for (let i = 0; i < count; i++) {
      // Snow flake size distribution: lots of tiny, few medium — feels natural.
      const sizeRoll = Math.random();
      const size: 0 | 1 | 2 = sizeRoll < 0.55 ? 0 : sizeRoll < 0.9 ? 1 : 2;
      this.drops.push({
        x: Math.random() * this.state.width,
        y: Math.random() * this.state.height,
        vy: isRain ? 280 + Math.random() * 220 : 30 + Math.random() * 50,
        sway: isRain ? 0 : 0.6 + Math.random() * 1.6,
        swayPhase: Math.random() * Math.PI * 2,
        size,
      });
    }
  }

  /**
   * Deterministic seeded layout so stars don't shimmer between frames and
   * keep the same map until the window resizes.
   */
  private regenStars(): void {
    const count = Math.round((this.state.width * this.state.height) / 9000);
    let seed = 12345;
    const rand = (): number => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    this.stars = [];
    for (let i = 0; i < count; i++) {
      this.stars.push({
        x: rand() * this.state.width,
        // Keep stars in the upper ~70% so they read as "sky"
        y: rand() * (this.state.height * 0.7),
        brightness: 0.35 + rand() * 0.65,
        twinklePhase: rand() * Math.PI * 2,
      });
    }
  }

  /** Two-layer horizon silhouette. The path is sampled once at resize time. */
  private regenHills(): void {
    const { width, height } = this.state;
    this.hillsFar = hillPath(7331, height * 0.62, height * 0.028, 22, width);
    this.hillsNear = hillPath(919, height * 0.74, height * 0.036, 16, width);
  }

  private regenBirds(): void {
    // Bird density scales gently with width; a 1200px sky gets ~5 birds.
    const count = Math.max(3, Math.round(this.state.width / 240));
    let seed = 4242;
    const rand = (): number => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    this.birds = [];
    for (let i = 0; i < count; i++) {
      this.birds.push({
        x: rand(),
        y: 0.10 + rand() * 0.18,
        // Slightly different cruising speeds so the flock doesn't move in lockstep.
        speed: 0.012 + rand() * 0.012,
        flapPhase: rand() * Math.PI * 2,
      });
    }
  }

  private regenFireflies(): void {
    let seed = 808;
    const rand = (): number => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    const count = Math.max(8, Math.round(this.state.width / 90));
    this.fireflies = [];
    for (let i = 0; i < count; i++) {
      this.fireflies.push({
        bx: rand() * this.state.width,
        driftPhase: rand() * Math.PI * 2,
        bobPhase: rand() * Math.PI * 2,
        blinkPhase: rand() * Math.PI * 2,
      });
    }
  }

  private drawHills(ctx: CanvasRenderingContext2D, h: number, bottomRGB: RGB): void {
    if (this.hillsFar.length === 0) return;
    const { width, height } = this.state;
    // Hills live: deep meadow green in daylight, cool indigo at night, with
    // the sky's horizon color bleeding in for atmospheric perspective.
    const bg = lerpRGB([0x1e, 0x16, 0x2d], [0x2f, 0x6b, 0x40], daylight(h));
    const farRGB = lerpRGB(bottomRGB, bg, 0.62);
    const nearRGB = lerpRGB(bottomRGB, bg, 0.84);

    ctx.fillStyle = rgbToCss(farRGB);
    fillHillPath(ctx, this.hillsFar, width, height);
    ctx.fillStyle = rgbToCss(nearRGB);
    fillHillPath(ctx, this.hillsNear, width, height);
  }

  private drawAurora(ctx: CanvasRenderingContext2D, alpha: number): void {
    const { width, height } = this.state;
    const t = performance.now() / 1000;
    // Three offset bands in different cool hues — they share a vertical band
    // (10%–50% of height) and shimmer at slightly different rates.
    const bands: Array<[number, number, number]> = [
      [120, 200, 180],
      [100, 180, 210],
      [180, 140, 200],
    ];
    for (let band = 0; band < bands.length; band++) {
      const [r, g, b] = bands[band];
      const peak = (0.10 + 0.04 * Math.sin(t * 0.5 + band)) * alpha;
      const grad = ctx.createLinearGradient(0, height * 0.10, 0, height * 0.50);
      grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0)`);
      grad.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, ${peak.toFixed(3)})`);
      grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      const baseY = height * 0.12 + band * Math.max(18, height * 0.04);
      ctx.moveTo(0, baseY);
      for (let x = 0; x <= width; x += 20) {
        const y = baseY + Math.sin(x * 0.012 + t * 0.3 + band) * 22;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(width, height * 0.50);
      ctx.lineTo(0, height * 0.50);
      ctx.closePath();
      ctx.fill();
    }
  }

  private tickBirds(dt: number): void {
    if (this.birds.length === 0) return;
    for (const b of this.birds) {
      b.x += b.speed * dt;
      b.flapPhase += dt * 6;
      if (b.x > 1.1) b.x -= 1.25; // wrap with a small buffer beyond the right edge
    }
  }

  private drawBirds(ctx: CanvasRenderingContext2D, alpha: number, frac = 1): void {
    if (this.birds.length === 0) return;
    const { width, height } = this.state;
    ctx.fillStyle = `rgba(20, 20, 28, ${(0.7 * alpha).toFixed(3)})`;
    const count = Math.max(1, Math.round(this.birds.length * frac));
    for (const b of this.birds.slice(0, count)) {
      const bx = b.x * width;
      const by = b.y * height;
      const flap = Math.sin(b.flapPhase);
      // Wings up vs. wings down — a 2-frame flap silhouette.
      if (flap > 0) {
        ctx.fillRect((bx | 0) - 3, (by | 0) - 1, 3, 1);
        ctx.fillRect(bx | 0, (by | 0) - 1, 3, 1);
      } else {
        ctx.fillRect((bx | 0) - 3, by | 0, 3, 1);
        ctx.fillRect(bx | 0, by | 0, 3, 1);
      }
    }
  }

  private tickShootingStar(dt: number, starA: number): void {
    if (this.shooting) {
      this.shooting.age += dt;
      this.shooting.x += this.shooting.vx * dt;
      this.shooting.y += this.shooting.vy * dt;
      if (this.shooting.age > this.shooting.life) this.shooting = null;
      return;
    }
    if (starA < 0.5) return; // only when the stars are properly out
    this.shootingTimer -= dt;
    if (this.shootingTimer <= 0) {
      this.shootingTimer = 120 + Math.random() * 300; // one every 2–7 minutes
      const { width, height } = this.state;
      const speed = 420 + Math.random() * 240;
      const angle = Math.PI * (0.12 + Math.random() * 0.16); // shallow descent
      const dir = Math.random() < 0.5 ? 1 : -1;
      this.shooting = {
        x: width * (0.1 + Math.random() * 0.8),
        y: height * (0.04 + Math.random() * 0.22),
        vx: Math.cos(angle) * speed * dir,
        vy: Math.sin(angle) * speed,
        age: 0,
        life: 0.5 + Math.random() * 0.4,
      };
    }
  }

  private drawShootingStar(ctx: CanvasRenderingContext2D, alpha: number): void {
    const s = this.shooting;
    if (!s) return;
    // Sine envelope: flares in, burns, fades out.
    const a = Math.sin((s.age / s.life) * Math.PI) * alpha;
    if (a < 0.02) return;
    const trail = 0.09; // seconds of tail behind the head
    const tx = s.x - s.vx * trail;
    const ty = s.y - s.vy * trail;
    const grad = ctx.createLinearGradient(tx, ty, s.x, s.y);
    grad.addColorStop(0, "rgba(255, 252, 240, 0)");
    grad.addColorStop(1, `rgba(255, 252, 240, ${(0.9 * a).toFixed(3)})`);
    ctx.strokeStyle = grad;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(s.x, s.y);
    ctx.stroke();
  }

  private tickWetness(wx: WeatherConditions | null, dt: number): void {
    if (wx?.precipitation === "rain") {
      this.wetness = Math.min(1, this.wetness + dt / 20); // soaked in ~20s
    } else {
      this.wetness = Math.max(0, this.wetness - dt / 300); // dries over ~5 min
    }
  }

  private drawWetSheen(ctx: CanvasRenderingContext2D): void {
    const { width, height } = this.state;
    const a = 0.12 * this.wetness;
    const grad = ctx.createLinearGradient(0, height * 0.86, 0, height);
    grad.addColorStop(0, "rgba(180, 200, 230, 0)");
    grad.addColorStop(1, `rgba(190, 210, 240, ${a.toFixed(3)})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, height * 0.86, width, height * 0.14);
  }

  private drawHeatHaze(ctx: CanvasRenderingContext2D, k: number): void {
    const { width, height } = this.state;
    const t = performance.now() / 1000;
    // Two soft warm bands wavering just above the horizon — cheap shimmer.
    for (let i = 0; i < 2; i++) {
      const y = height * (0.6 + i * 0.07) + Math.sin(t * (0.8 + i * 0.3) + i * 2) * 3;
      const bandH = height * 0.05;
      const grad = ctx.createLinearGradient(0, y - bandH, 0, y + bandH);
      grad.addColorStop(0, "rgba(255, 232, 180, 0)");
      grad.addColorStop(0.5, `rgba(255, 232, 180, ${(0.05 * k).toFixed(3)})`);
      grad.addColorStop(1, "rgba(255, 232, 180, 0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, y - bandH, width, bandH * 2);
    }
  }

  private drawFireflies(ctx: CanvasRenderingContext2D, alpha: number): void {
    if (this.fireflies.length === 0) return;
    const t = performance.now() / 1000;
    const { width, height } = this.state;
    const bandTop = height * 0.55;
    const bandH = height * 0.20;
    for (const f of this.fireflies) {
      const fx = ((f.bx + Math.sin(t * 0.35 + f.driftPhase) * 24) % width + width) % width;
      const fy = bandTop + (Math.sin(t * 0.7 + f.bobPhase) * 0.5 + 0.5) * bandH;
      const blink = 0.5 + 0.5 * Math.sin(t * 2 + f.blinkPhase);
      const a = blink * 0.7 * alpha;
      if (a > 0.02) {
        ctx.fillStyle = `rgba(232, 228, 140, ${a.toFixed(3)})`;
        ctx.fillRect(fx | 0, fy | 0, 2, 2);
      }
    }
  }
}

/**
 * Cloud overlay strength for the current conditions. 0 means no draw,
 * 1 means full opacity. Heavier cloudiness, thunder, and active rain all
 * push this higher; intensity adds a small extra weight.
 */
function cloudAlphaFor(wx: WeatherConditions): number {
  let a = 0;
  if (wx.cloudiness === 1) a = 0.35;
  else if (wx.cloudiness === 2) a = 0.65;
  if (wx.thunder) a = Math.max(a, 0.85);
  if (wx.precipitation === "rain") a = Math.max(a, 0.55);
  if (wx.precipitation === "snow") a = Math.max(a, 0.5);
  return Math.min(1, a + wx.intensity * 0.1);
}

/**
 * Star visibility curve. 1.0 from late evening through deep night, fading
 * symmetrically at dusk/dawn so the transition matches the sky gradient.
 */
function starAlpha(h: number): number {
  if (h >= 20 || h <= 4) return 1;
  if (h > 18 && h < 20) return (h - 18) / 2; // dusk fade-in
  if (h > 4 && h < 6) return 1 - (h - 4) / 2; // dawn fade-out
  return 0;
}

/** Aurora visibility — strongest in the deep-night window, off by day. */
function auroraAlpha(h: number): number {
  if (h >= 21 || h <= 4) return 1;
  if (h > 19 && h < 21) return (h - 19) / 2;
  if (h > 4 && h < 6) return 1 - (h - 4) / 2;
  return 0;
}

/** Heat-haze strength: ramps 27→35°C, needs daylight and a clear-ish sky. */
function heatFactor(tempC: number, cloudAlpha: number, h: number): number {
  const t = (tempC - 27) / 8;
  if (t <= 0) return 0;
  return Math.min(1, t) * daylight(h) * (1 - cloudAlpha);
}

/** Daylight factor, 0 at night → 1 in full day, easing through twilight. */
function daylight(h: number): number {
  if (h <= SUN_RISE - 1 || h >= SUN_SET + 1) return 0;
  if (h < SUN_RISE + 1) return (h - (SUN_RISE - 1)) / 2;
  if (h > SUN_SET - 1) return ((SUN_SET + 1) - h) / 2;
  return 1;
}

/** Daytime creature alpha (birds) — eases in/out around the working day. */
function dayCreatureAlpha(h: number): number {
  if (h <= SUN_RISE - 0.5 || h >= SUN_SET + 0.5) return 0;
  if (h < SUN_RISE + 1) return (h - (SUN_RISE - 0.5)) / 1.5;
  if (h > SUN_SET - 1) return Math.max(0, ((SUN_SET + 0.5) - h) / 1.5);
  return 1;
}

/** Firefly alpha — only after dark and not at the deepest part of night. */
function fireflyAlpha(h: number): number {
  if (h >= 19.5 && h < 23) return Math.min(1, (h - 19.5) / 1.5);
  if (h >= 23 || h < 1) return 1;
  if (h >= 1 && h < 3) return 1 - (h - 1) / 2;
  return 0;
}

/**
 * Sunrise / sunset horizon glow strength, 0..1. Peaks for ~30 minutes
 * around SUN_RISE and SUN_SET and falls off either side.
 */
function horizonGlowStrength(h: number): number {
  const dRise = Math.abs(h - SUN_RISE);
  const dSet = Math.abs(h - SUN_SET);
  const d = Math.min(dRise, dSet);
  if (d > 1.2) return 0;
  // Smooth ease-out from peak at d=0 down to 0 at d=1.2
  const t = 1 - d / 1.2;
  return t * t;
}

/**
 * Lunar phase as a fraction in [0, 1): 0 = new, 0.25 = first qtr, 0.5 = full,
 * 0.75 = last qtr. Computed from the synodic month against a known new moon
 * reference, accurate to within a few hours which is plenty for visuals.
 */
function lunarPhase(date: Date): number {
  const elapsed = date.getTime() - MOON_REF_MS;
  return ((elapsed % MOON_SYNODIC_MS) + MOON_SYNODIC_MS) % MOON_SYNODIC_MS / MOON_SYNODIC_MS;
}

/** Build a procedural lightning bolt path: zig-zag from the cloud band downward. */
function generateBolt(w: number, h: number): Array<[number, number]> {
  const startX = w * (0.18 + Math.random() * 0.64);
  const segments = 7 + Math.floor(Math.random() * 5);
  const targetY = h * (0.32 + Math.random() * 0.28);
  const stepY = targetY / segments;
  const path: Array<[number, number]> = [[startX, 0]];
  let x = startX;
  let y = 0;
  for (let i = 0; i < segments; i++) {
    y += stepY;
    x += (Math.random() - 0.5) * 22;
    path.push([x, y]);
  }
  return path;
}

/**
 * Build a procedural ridgeline as a polyline, sampled across the world's
 * width. Each layer is seeded so its silhouette is stable between frames.
 */
function hillPath(
  seed: number,
  baseY: number,
  amp: number,
  segments: number,
  width: number,
): Array<[number, number]> {
  let s = seed;
  const r = (): number => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= segments; i++) {
    const x = (i / segments) * width;
    const y = baseY + Math.sin(i * 0.7 + r() * 3) * amp + r() * amp * 0.4;
    pts.push([x, y]);
  }
  return pts;
}

/** Close a ridgeline polyline down to the bottom of the canvas and fill it. */
function fillHillPath(
  ctx: CanvasRenderingContext2D,
  pts: Array<[number, number]>,
  width: number,
  height: number,
): void {
  ctx.beginPath();
  ctx.moveTo(0, height);
  for (const [x, y] of pts) ctx.lineTo(x, y);
  ctx.lineTo(width, height);
  ctx.closePath();
  ctx.fill();
}

// ── Color helpers ────────────────────────────────────────────────────────

function rgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function rgbToCss(c: RGB): string {
  return `rgb(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0})`;
}

/** Mix a color toward its own luminance gray — overcast-sky desaturation. */
function desatRGB(c: RGB, k: number): RGB {
  const l = c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114;
  return lerpRGB(c, [l, l, l], k);
}

function lerpRGB(a: RGB, b: RGB, t: number): RGB {
  const k = Math.max(0, Math.min(1, t));
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}
