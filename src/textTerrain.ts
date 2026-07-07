// Text-as-Terrain — stories scattered across the full viewport.
//
// Each story is a positioned DOM element that serves as both readable
// content and physical terrain for Zaur to walk on. Blocks are placed at
// semi-random positions with collision avoidance, and their top edges act
// as platforms the dino can stand on.
//
// The world starts empty and quietly fills as the editor publishes; the
// most important stories survive pruning the longest.

import type { Category, Story } from "./services/content.js";

export interface TerrainBlock {
  id: string;
  el: HTMLDivElement;
  story: Story;
  /** CSS-space bounding rect, kept in sync with the DOM. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Epoch ms when this block was placed. */
  placedAt: number;
  /** Whether this block is currently being typewritten. */
  typing: boolean;
  /** Whether the block is hidden by the category filter. */
  hidden: boolean;
  /** Importance score — higher = survives pruning longer. */
  importance: number;
}

interface PlacementConstraints {
  viewW: number;
  viewH: number;
  /** Horizontal margin from viewport edges. */
  marginX: number;
  /** Vertical margin from top (header space). */
  marginTop: number;
  /** Margin from bottom (bottom controls). */
  marginBottom: number;
}

const MAX_BLOCKS = 14;

// Size ranges for story blocks (CSS px).
const BLOCK_MIN_W = 240;
const BLOCK_MAX_W = 460;

export class TextTerrain {
  readonly blocks: TerrainBlock[] = [];
  private readonly container: HTMLElement;
  private readonly constraints: PlacementConstraints;
  private visibleCategories: Set<Category> | null = null;

  constructor(container: HTMLElement, constraints: PlacementConstraints) {
    this.container = container;
    this.constraints = constraints;
  }

  updateConstraints(viewW: number, viewH: number): void {
    this.constraints.viewW = viewW;
    this.constraints.viewH = viewH;
  }

  /** Show only these categories (null = show everything). */
  setVisibleCategories(categories: Set<Category> | null): void {
    this.visibleCategories = categories;
    for (const block of this.blocks) {
      block.hidden = !this.isCategoryVisible(block.story.category);
      block.el.classList.toggle("terrain-block--hidden", block.hidden);
    }
  }

  isCategoryVisible(category: Category): boolean {
    return this.visibleCategories === null || this.visibleCategories.has(category);
  }

  /** Reposition all currently active blocks when constraints change. */
  repositionAll(): void {
    const tempBlocks = [...this.blocks];
    this.blocks.length = 0;

    for (const block of tempBlocks) {
      const blockW = blockWidthFor(block.story, this.constraints.viewW);
      const estH = estimateHeight(block.story);
      const pos = this.findPosition(blockW, estH);
      if (pos) {
        block.x = pos.x;
        block.y = pos.y;
        block.w = blockW;
        block.h = estH;

        block.el.style.left = `${pos.x}px`;
        block.el.style.top = `${pos.y}px`;
        block.el.style.maxWidth = `${blockW}px`;

        this.measureSoon(block);
      }
      this.blocks.push(block);
    }
  }

  /**
   * Place a new story on the terrain. Returns the created block, or null if
   * it's already present.
   */
  place(story: Story, isNew: boolean): TerrainBlock | null {
    if (this.blocks.some((b) => b.id === story.id)) return null;

    while (this.blocks.length >= MAX_BLOCKS) {
      this.removeLeastImportant();
    }

    const importance = story.importance ?? 0.5;
    const blockW = blockWidthFor(story, this.constraints.viewW);
    const estH = estimateHeight(story);

    const pos = this.findPosition(blockW, estH);
    if (!pos) return null;

    const el = this.createBlockElement(story, pos.x, pos.y, blockW, isNew);
    const hidden = !this.isCategoryVisible(story.category);
    el.classList.toggle("terrain-block--hidden", hidden);

    const block: TerrainBlock = {
      id: story.id,
      el,
      story,
      x: pos.x,
      y: pos.y,
      w: blockW,
      h: estH,
      placedAt: Date.now(),
      typing: isNew,
      hidden,
      importance,
    };

    this.blocks.push(block);
    this.container.appendChild(el);
    this.measureSoon(block);

    return block;
  }

  /** Fade out blocks by IDs (expired on the server). */
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
      if (block.hidden) continue;
      const topEdge = block.y;
      if (x >= block.x - 8 && x <= block.x + block.w + 8) {
        if (topEdge > fromY && topEdge < bestY) {
          bestY = topEdge;
          bestBlock = block;
        }
      }
    }

    return { y: bestY, block: bestBlock };
  }

  /** Pick a random visible block, optionally weighted toward recent ones. */
  randomBlock(preferRecent = false): TerrainBlock | null {
    const visible = this.blocks.filter((b) => !b.hidden);
    if (visible.length === 0) return null;
    if (!preferRecent || Math.random() < 0.3) {
      return visible[Math.floor(Math.random() * visible.length)];
    }
    // Bias toward the last third of blocks (most recent).
    const start = Math.max(0, visible.length - Math.ceil(visible.length / 3));
    return visible[start + Math.floor(Math.random() * (visible.length - start))];
  }

  /** Clear all blocks from DOM and internal state. */
  clear(): void {
    for (const b of this.blocks) b.el.remove();
    this.blocks.length = 0;
  }

  // ── Private ──────────────────────────────────────────────────────────

  private measureSoon(block: TerrainBlock): void {
    requestAnimationFrame(() => {
      const rect = block.el.getBoundingClientRect();
      const containerRect = this.container.getBoundingClientRect();
      block.h = rect.height;
      block.y = rect.top - containerRect.top;
    });
  }

  private findPosition(w: number, h: number): { x: number; y: number } | null {
    const { viewW, viewH, marginX, marginTop, marginBottom } = this.constraints;
    const usableW = viewW - marginX * 2 - w;
    const usableH = viewH - marginTop - marginBottom - h;

    if (usableW <= 0 || usableH <= 0) {
      // Viewport too small — stack vertically with some offset.
      return {
        x: marginX + Math.random() * Math.max(10, viewW - marginX * 2 - w),
        y: marginTop + (this.blocks.length * 140) % Math.max(100, usableH + h),
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
        if (overlap === 0) break;
      }
    }

    return bestPos;
  }

  private overlapScore(x: number, y: number, w: number, h: number): number {
    let total = 0;
    // Safety margins so blocks don't spawn too close to each other.
    const padX = 45;
    const padY = 30;

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
    story: Story,
    x: number,
    y: number,
    w: number,
    isNew: boolean,
  ): HTMLDivElement {
    const el = document.createElement("div");
    el.id = `tb-${story.id}`;
    el.className = `terrain-block kind-${story.category}${isNew ? " terrain-block--new" : ""}`;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.maxWidth = `${w}px`;

    const timeVal = story.deliveredAt ?? story.publishedAt ?? Date.now();
    const timeStr = formatWhen(timeVal);

    const meta = document.createElement("div");
    meta.className = "tb-meta";
    meta.textContent = `${story.category} · ${timeStr}`;

    const title = document.createElement("div");
    title.className = "tb-title";
    title.textContent = story.title;

    const summary = document.createElement("div");
    summary.className = `tb-text${isNew ? " typing-cursor" : ""}`;
    if (!isNew) summary.textContent = story.summary;

    el.append(meta, title, summary);

    if (story.href) {
      const link = document.createElement("a");
      link.className = "tb-link";
      link.href = story.href;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = story.sourceName || "source";
      el.appendChild(link);
    }

    return el;
  }

  private removeLeastImportant(): void {
    let worst = 0;
    let worstScore = Infinity;
    for (let i = 0; i < this.blocks.length; i++) {
      const b = this.blocks[i];
      const ageHours = (Date.now() - b.placedAt) / 3_600_000;
      const score = b.importance - ageHours * 0.04;
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

/** "14:05" for today, "yesterday", or "2 days ago". */
function formatWhen(epochMs: number): string {
  const now = new Date();
  const then = new Date(epochMs);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (epochMs >= startOfToday) {
    return then.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  const daysAgo = Math.ceil((startOfToday - epochMs) / (24 * 60 * 60_000));
  return daysAgo <= 1 ? "yesterday" : `${daysAgo} days ago`;
}

function estimateHeight(story: Story): number {
  const chars = story.title.length + story.summary.length;
  return Math.max(80, Math.min(260, chars * 0.55 + 60));
}

/** Pick a width based on importance and viewport size. */
function blockWidthFor(story: Story, viewW: number): number {
  const maxW = Math.min(BLOCK_MAX_W, viewW * 0.6);
  const minW = Math.min(BLOCK_MIN_W, viewW * 0.4);
  const importance = story.importance ?? 0.5;
  const t = 0.4 + importance * 0.6;
  return Math.round(minW + (maxW - minW) * t);
}
