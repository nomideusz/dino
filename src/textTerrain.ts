// Text-as-Terrain — scattered text blocks across the full viewport.
//
// Each text block is a positioned DOM element that serves as both readable
// content and physical terrain for Zaur to walk on. Blocks are placed at
// semi-random positions with collision avoidance, and their top edges act
// as platforms the dino can stand on.
//
// The placement algorithm divides the viewport into a loose grid and picks
// cells with the fewest existing neighbors, keeping the scatter organic
// but not overlapping.

import type { ContentItem } from "./services/content.js";

export interface TerrainBlock {
  id: string;
  el: HTMLDivElement;
  item: ContentItem;
  /** CSS-space bounding rect, kept in sync with the DOM. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Epoch ms when this block was placed. */
  placedAt: number;
  /** Whether this block was restored from localStorage (dimmer). */
  restored: boolean;
  /** Whether this block is currently being typewritten. */
  typing: boolean;
  /** Importance score — higher = stays longer, gets saved. */
  importance: number;
}

interface PlacementConstraints {
  viewW: number;
  viewH: number;
  /** Horizontal margin from viewport edges. */
  marginX: number;
  /** Vertical margin from top (header space). */
  marginTop: number;
  /** Margin from bottom (bottom bar). */
  marginBottom: number;
}

const MAX_BLOCKS = 12;
const PERSIST_KEY = "zaur-terrain-blocks";
const MAX_PERSISTED = 12;

// Size ranges for text blocks (CSS px).
const BLOCK_MIN_W = 180;
const BLOCK_MAX_W = 420;

export class TextTerrain {
  readonly blocks: TerrainBlock[] = [];
  private readonly container: HTMLElement;
  private readonly constraints: PlacementConstraints;
  private placementAttempts = 0;

  constructor(container: HTMLElement, constraints: PlacementConstraints) {
    this.container = container;
    this.constraints = constraints;
  }

  updateConstraints(viewW: number, viewH: number): void {
    this.constraints.viewW = viewW;
    this.constraints.viewH = viewH;
  }

  /** Reposition all currently active text blocks when constraints change. */
  repositionAll(): void {
    const tempBlocks = [...this.blocks];
    this.blocks.length = 0;

    for (const block of tempBlocks) {
      const blockW = blockWidthFor(block.item, this.constraints.viewW);
      const estH = Math.max(60, Math.min(200, block.item.text.length * 0.8 + 40));
      const pos = this.findPosition(blockW, estH);
      if (pos) {
        block.x = pos.x;
        block.y = pos.y;
        block.w = blockW;
        block.h = estH;

        block.el.style.left = `${pos.x}px`;
        block.el.style.top = `${pos.y}px`;
        block.el.style.maxWidth = `${blockW}px`;

        requestAnimationFrame(() => {
          const rect = block.el.getBoundingClientRect();
          const containerRect = this.container.getBoundingClientRect();
          block.h = rect.height;
          block.y = rect.top - containerRect.top;
        });
      }
      this.blocks.push(block);
    }
  }

  /**
   * Place a new content item on the terrain. Returns the created block,
   * or null if the terrain is full and no space was found.
   */
  place(item: ContentItem, isNew: boolean): TerrainBlock | null {
    // Check for duplicates.
    if (this.blocks.some((b) => b.id === item.id)) return null;

    // Prune if at capacity.
    while (this.blocks.length >= MAX_BLOCKS) {
      this.removeOldest();
    }

    const importance = scoreImportance(item);
    const blockW = blockWidthFor(item, this.constraints.viewW);
    // Estimate height from text length (we'll measure after DOM insertion).
    const estH = Math.max(60, Math.min(200, item.text.length * 0.8 + 40));

    const pos = this.findPosition(blockW, estH);
    if (!pos) return null;

    const block = this.createBlockElement(item, pos.x, pos.y, blockW, isNew);

    const terrain: TerrainBlock = {
      id: item.id,
      el: block,
      item,
      x: pos.x,
      y: pos.y,
      w: blockW,
      h: estH,
      placedAt: Date.now(),
      restored: !isNew,
      typing: isNew,
      importance,
    };

    this.blocks.push(terrain);
    this.container.appendChild(block);

    // Measure actual height after DOM insertion.
    requestAnimationFrame(() => {
      const rect = block.getBoundingClientRect();
      const containerRect = this.container.getBoundingClientRect();
      terrain.h = rect.height;
      terrain.y = rect.top - containerRect.top;
    });

    return terrain;
  }

  /** Remove a block by ID. */
  remove(id: string): void {
    const idx = this.blocks.findIndex((b) => b.id === id);
    if (idx < 0) return;
    const block = this.blocks[idx];
    block.el.classList.add("terrain-block--fading");
    setTimeout(() => {
      block.el.remove();
    }, 800);
    this.blocks.splice(idx, 1);
  }

  /** Fade out blocks by IDs (expired). */
  fadeOut(ids: string[]): void {
    const idSet = new Set(ids);
    for (const block of this.blocks) {
      if (idSet.has(block.id)) {
        block.el.classList.add("terrain-block--expired");
      }
    }
  }

  /** Get the platform (top edge) at a given x coordinate. */
  platformAt(x: number, fromY: number): { y: number; block: TerrainBlock | null } {
    let bestY = this.constraints.viewH - 60; // default ground
    let bestBlock: TerrainBlock | null = null;

    for (const block of this.blocks) {
      const topEdge = block.y;
      // Only consider blocks whose horizontal span includes x.
      if (x >= block.x - 8 && x <= block.x + block.w + 8) {
        // Only consider blocks below fromY (the dino is above them).
        if (topEdge > fromY && topEdge < bestY) {
          bestY = topEdge;
          bestBlock = block;
        }
      }
    }

    return { y: bestY, block: bestBlock };
  }

  /** Find the nearest block to the given position. */
  nearestBlock(x: number, y: number): TerrainBlock | null {
    if (this.blocks.length === 0) return null;
    let best: TerrainBlock | null = null;
    let bestDist = Infinity;
    for (const b of this.blocks) {
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      const d = Math.hypot(cx - x, cy - y);
      if (d < bestDist) {
        bestDist = d;
        best = b;
      }
    }
    return best;
  }

  /** Pick a random block, optionally weighted toward recent ones. */
  randomBlock(preferRecent = false): TerrainBlock | null {
    if (this.blocks.length === 0) return null;
    if (!preferRecent || Math.random() < 0.3) {
      return this.blocks[Math.floor(Math.random() * this.blocks.length)];
    }
    // Bias toward the last third of blocks (most recent).
    const start = Math.max(0, this.blocks.length - Math.ceil(this.blocks.length / 3));
    return this.blocks[start + Math.floor(Math.random() * (this.blocks.length - start))];
  }

  /** Persist important blocks to localStorage for returning visitors. */
  persist(): void {
    try {
      const toSave = this.blocks
        .filter((b) => b.importance >= 0.4 && !b.restored)
        .sort((a, b) => b.importance - a.importance)
        .slice(0, MAX_PERSISTED)
        .map((b) => ({
          id: b.item.id,
          kind: b.item.kind,
          text: b.item.text,
          href: b.item.href,
          linkLabel: b.item.linkLabel,
          publishedAt: b.item.publishedAt,
          score: b.item.score,
          savedAt: Date.now(),
        }));
      localStorage.setItem(PERSIST_KEY, JSON.stringify(toSave));
    } catch {
      // Private mode or storage full — that's fine.
    }
  }

  /** Restore persisted blocks from localStorage. */
  restore(): ContentItem[] {
    try {
      const raw = localStorage.getItem(PERSIST_KEY);
      if (!raw) return [];
      const items = JSON.parse(raw) as Array<ContentItem & { savedAt?: number }>;
      if (!Array.isArray(items)) return [];
      // Only restore items from the last 24 hours.
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      return items.filter(
        (it) =>
          it &&
          typeof it.id === "string" &&
          typeof it.text === "string" &&
          (it.savedAt ?? it.publishedAt ?? it.deliveredAt ?? Date.now()) >= cutoff
      );
    } catch {
      return [];
    }
  }

  /** Clear all blocks from DOM and internal state. */
  clear(): void {
    for (const b of this.blocks) b.el.remove();
    this.blocks.length = 0;
  }

  // ── Private ──────────────────────────────────────────────────────────

  private findPosition(
    w: number,
    h: number,
  ): { x: number; y: number } | null {
    const { viewW, viewH, marginX, marginTop, marginBottom } = this.constraints;
    const usableW = viewW - marginX * 2 - w;
    const usableH = viewH - marginTop - marginBottom - h;

    if (usableW <= 0 || usableH <= 0) {
      // Viewport too small — stack vertically with some offset.
      return {
        x: marginX + Math.random() * Math.max(10, viewW - marginX * 2 - w),
        y: marginTop + (this.blocks.length * 120) % Math.max(100, usableH + h),
      };
    }

    // Try random positions, pick the one with least overlap.
    let bestPos = { x: 0, y: 0 };
    let bestOverlap = Infinity;
    const attempts = 120;

    for (let i = 0; i < attempts; i++) {
      const x = marginX + Math.random() * usableW;
      const y = marginTop + Math.random() * usableH;
      const overlap = this.overlapScore(x, y, w, h);
      if (overlap < bestOverlap) {
        bestOverlap = overlap;
        bestPos = { x, y };
        if (overlap === 0) break; // Perfect — no overlap at all.
      }
    }

    this.placementAttempts++;
    return bestPos;
  }

  private overlapScore(x: number, y: number, w: number, h: number): number {
    let total = 0;
    // Add safety margins to prevent blocks from spawning too close.
    const padX = 45;
    const padY = 25;
    
    for (const b of this.blocks) {
      const ox = Math.max(0, Math.min(x + w + padX, b.x + b.w + padX) - Math.max(x - padX, b.x - padX));
      const oy = Math.max(0, Math.min(y + h + padY, b.y + b.h + padY) - Math.max(y - padY, b.y - padY));
      const area = ox * oy;
      if (area > 0) {
        total += area / (w * h);
      }
    }
    return total;
  }

  private createBlockElement(
    item: ContentItem,
    x: number,
    y: number,
    w: number,
    isNew: boolean,
  ): HTMLDivElement {
    const block = document.createElement("div");
    block.id = `tb-${item.id}`;
    block.className = `terrain-block kind-${item.kind}${isNew ? " terrain-block--new" : " terrain-block--restored"}`;
    block.style.left = `${x}px`;
    block.style.top = `${y}px`;
    block.style.maxWidth = `${w}px`;

    const timeVal = item.publishedAt ?? item.deliveredAt ?? Date.now();
    const timeStr = new Date(timeVal).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    block.innerHTML = `
      <div class="tb-meta">${timeStr} · ${item.kind}</div>
      <div class="tb-text${isNew ? " typing-cursor" : ""}" data-text-content></div>
      ${item.href ? `<a class="tb-link" href="${item.href}" target="_blank" rel="noopener">${item.linkLabel || "→"}</a>` : ""}
    `;

    if (!isNew) {
      const textEl = block.querySelector("[data-text-content]") as HTMLElement;
      if (textEl) textEl.textContent = item.text;
    }

    return block;
  }

  private removeOldest(): void {
    // Remove the lowest-importance, oldest block.
    let worst = 0;
    let worstScore = Infinity;
    for (let i = 0; i < this.blocks.length; i++) {
      const b = this.blocks[i];
      const age = (Date.now() - b.placedAt) / 60_000; // minutes
      const score = b.importance - age * 0.01;
      if (score < worstScore) {
        worstScore = score;
        worst = i;
      }
    }
    const removed = this.blocks.splice(worst, 1)[0];
    removed.el.classList.add("terrain-block--fading");
    setTimeout(() => removed.el.remove(), 800);
  }
}

/** Score how "important" an item is — higher = saved to localStorage. */
function scoreImportance(item: ContentItem): number {
  let score = typeof item.score === "number" ? item.score : 0.5;
  // Quakes and space items feel more dramatic/memorable.
  if (item.kind === "quake") score += 0.15;
  if (item.kind === "space") score += 0.1;
  // Longer texts tend to be meatier articles.
  if (item.text.length > 120) score += 0.1;
  if (item.href) score += 0.05;
  return Math.min(1, score);
}

/** Pick a width based on content importance and viewport size. */
function blockWidthFor(item: ContentItem, viewW: number): number {
  const maxW = Math.min(BLOCK_MAX_W, viewW * 0.55);
  const minW = Math.min(BLOCK_MIN_W, viewW * 0.3);
  // Important items get wider blocks.
  const importance = scoreImportance(item);
  const t = 0.4 + importance * 0.6;
  return Math.round(minW + (maxW - minW) * t);
}
