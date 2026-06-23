// Canvas rendering for Zaur — frame data lives in ./spriteFrames (vendored
// from the former @zaur/sprite workspace package).

import {
  SPRITE_FRAMES,
  SPRITE_GRID_H,
  SPRITE_GRID_W,
  ZAUR_INK,
  type FrameId
} from './spriteFrames.js';
import { THEME } from './theme.js';

export {
  SPRITE_GRID_H,
  SPRITE_GRID_W,
  type FrameId
} from './spriteFrames.js';

type Palette = Record<string, string>;

/** Default body color — follows dinosaurus theme when available. */
export const INK = THEME.ink;

export interface RenderedFrame {
  /** Right-facing canvas. */
  right: HTMLCanvasElement;
  /** Pre-flipped left-facing canvas (avoids per-frame transforms). */
  left: HTMLCanvasElement;
  scale: number;
}

/** Render every frame to offscreen canvases at the given pixel scale. */
export function buildFrames(scale: number, color: string = INK): Record<FrameId, RenderedFrame> {
  const palette: Palette = { '.': 'transparent', X: color, W: 'transparent' };
  const out = {} as Record<FrameId, RenderedFrame>;
  for (const id of Object.keys(SPRITE_FRAMES) as FrameId[]) {
    out[id] = renderOne(SPRITE_FRAMES[id], scale, palette);
  }
  return out;
}

function renderOne(rows: string[], scale: number, palette: Palette): RenderedFrame {
  const w = SPRITE_GRID_W * scale;
  const h = SPRITE_GRID_H * scale;

  const right = document.createElement('canvas');
  right.width = w;
  right.height = h;
  const ctx = right.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;

  for (let y = 0; y < SPRITE_GRID_H; y++) {
    const row = rows[y] ?? '';
    for (let x = 0; x < SPRITE_GRID_W; x++) {
      const ch = row[x] ?? '.';
      const fill = palette[ch];
      if (!fill || fill === 'transparent') continue;
      ctx.fillStyle = fill;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }

  const left = document.createElement('canvas');
  left.width = w;
  left.height = h;
  const lctx = left.getContext('2d')!;
  lctx.imageSmoothingEnabled = false;
  lctx.translate(w, 0);
  lctx.scale(-1, 1);
  lctx.drawImage(right, 0, 0);

  return { right, left, scale };
}

// Re-export for callers that want the package default without theme coupling.
export { ZAUR_INK };
