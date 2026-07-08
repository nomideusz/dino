// Text-as-Terrain — stories laid out in even masonry columns.
//
// Each story is a positioned DOM element that serves as both readable
// content and physical terrain for Zaur to walk on. Blocks flow into 1-4
// columns (viewport-dependent), newest first, each dropping into the
// currently shortest column — tidy enough to read, uneven enough that the
// top edges still make interesting platforms.

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
  /** Small per-block horizontal offset so columns don't look machine-made. */
  jitterX: number;
}

interface PlacementConstraints {
  viewW: number;
  viewH: number;
  /** Horizontal margin from viewport edges. */
  marginX: number;
  /** Vertical margin from top (radio widget space). */
  marginTop: number;
  /** Margin from bottom (bottom controls). */
  marginBottom: number;
}

const MAX_BLOCKS = 14;
const COLUMN_TARGET_W = 400;
const COLUMN_MAX_W = 460;
const COLUMN_GAP_X = 36;
const ROW_GAP_Y = 34;
const JITTER_X = 14;

export class TextTerrain {
  readonly blocks: TerrainBlock[] = [];
  /** Called when the reader clicks a story block. */
  onStoryClick: ((story: Story) => void) | null = null;

  private readonly container: HTMLElement;
  private readonly constraints: PlacementConstraints;
  private visibleCategories: Set<Category> | null = null;
  private relayoutRaf = 0;

  constructor(container: HTMLElement, constraints: PlacementConstraints) {
    this.container = container;
    this.constraints = constraints;
  }

  updateConstraints(viewW: number, viewH: number): void {
    this.constraints.viewW = viewW;
    this.constraints.viewH = viewH;
    this.scheduleRelayout();
  }

  /** Show only these categories (null = show everything). */
  setVisibleCategories(categories: Set<Category> | null): void {
    this.visibleCategories = categories;
    for (const block of this.blocks) {
      block.hidden = !this.isCategoryVisible(block.story.category);
      block.el.classList.toggle("terrain-block--hidden", block.hidden);
    }
    this.scheduleRelayout();
  }

  isCategoryVisible(category: Category): boolean {
    return this.visibleCategories === null || this.visibleCategories.has(category);
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

    const el = this.createBlockElement(story, isNew);
    const hidden = !this.isCategoryVisible(story.category);
    el.classList.toggle("terrain-block--hidden", hidden);
    // Park off-screen until the first masonry pass assigns a real slot,
    // so snapshot blocks never flash at the top-left corner.
    el.style.left = "-9999px";
    el.style.top = "0px";

    const block: TerrainBlock = {
      id: story.id,
      el,
      story,
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      placedAt: Date.now(),
      typing: isNew,
      hidden,
      importance: story.importance ?? 0.5,
      jitterX: (Math.random() * 2 - 1) * JITTER_X,
    };

    this.blocks.push(block);
    this.container.appendChild(el);
    this.scheduleRelayout();

    return block;
  }

  /**
   * Typewriting grows a block line by line; keep the columns honest while
   * it types by re-measuring on a slow tick from the caller.
   */
  noteContentChanged(): void {
    this.scheduleRelayout();
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

  /** Clear all blocks from DOM and internal state. */
  clear(): void {
    for (const b of this.blocks) b.el.remove();
    this.blocks.length = 0;
  }

  // ── Layout ───────────────────────────────────────────────────────────

  private scheduleRelayout(): void {
    if (this.relayoutRaf) return;
    this.relayoutRaf = requestAnimationFrame(() => {
      this.relayoutRaf = 0;
      this.relayout();
    });
  }

  /**
   * Masonry pass: newest story first, each block dropped into the shortest
   * column. Runs after any placement/removal/filter/resize and re-measures
   * real DOM heights, so the columns stay even as content settles.
   */
  private relayout(): void {
    const { viewW, marginX, marginTop } = this.constraints;
    const usableW = viewW - marginX * 2;
    const columnCount = Math.max(1, Math.min(4, Math.round(usableW / COLUMN_TARGET_W)));
    const colW = Math.min(
      COLUMN_MAX_W,
      Math.floor((usableW - COLUMN_GAP_X * (columnCount - 1)) / columnCount)
    );

    // The radio widget floats top-left; columns that pass underneath it
    // start below its bottom edge instead of marginTop.
    const radio = document.getElementById("radio-widget");
    const radioRect = radio?.getBoundingClientRect() ?? null;

    const visible = this.blocks
      .filter((b) => !b.hidden)
      .sort(
        (a, b) =>
          (b.story.deliveredAt ?? b.placedAt) - (a.story.deliveredAt ?? a.placedAt)
      );

    // Measure with the final width applied so heights are truthful.
    for (const block of visible) {
      block.el.style.maxWidth = `${colW}px`;
      block.el.style.width = `${colW}px`;
    }

    const colHeights = new Array<number>(columnCount).fill(marginTop);
    if (radioRect) {
      for (let i = 0; i < columnCount; i++) {
        const colLeft = marginX + i * (colW + COLUMN_GAP_X);
        const overlaps = colLeft < radioRect.right && colLeft + colW > radioRect.left;
        if (overlaps) {
          colHeights[i] = Math.max(colHeights[i], radioRect.bottom + 24);
        }
      }
    }
    for (const block of visible) {
      const h = block.el.getBoundingClientRect().height || block.h || 100;
      let col = 0;
      for (let i = 1; i < columnCount; i++) {
        if (colHeights[i] < colHeights[col]) col = i;
      }
      const x = marginX + col * (colW + COLUMN_GAP_X) + block.jitterX;
      const y = colHeights[col];

      // First placement snaps into position; later reflows glide (the
      // left/top transition) so the columns visibly resettle.
      const firstLayout = block.w === 0;
      if (firstLayout) block.el.style.transition = "none";
      block.el.style.left = `${Math.round(x)}px`;
      block.el.style.top = `${Math.round(y)}px`;
      if (firstLayout) {
        void block.el.offsetWidth; // flush so the snap isn't animated
        block.el.style.transition = "";
      }

      block.x = x;
      block.y = y;
      block.w = colW;
      block.h = h;
      colHeights[col] = y + h + ROW_GAP_Y;
    }
  }

  // ── Private ──────────────────────────────────────────────────────────

  private createBlockElement(story: Story, isNew: boolean): HTMLDivElement {
    const el = document.createElement("div");
    el.id = `tb-${story.id}`;
    el.className = `terrain-block kind-${story.category}${isNew ? " terrain-block--new" : ""}`;

    const timeVal = story.deliveredAt ?? story.publishedAt ?? Date.now();

    const meta = document.createElement("div");
    meta.className = "tb-meta";
    meta.textContent = `${story.category} · ${formatWhen(timeVal)}`;

    const title = document.createElement("div");
    title.className = "tb-title";
    title.textContent = story.title;

    const summary = document.createElement("div");
    summary.className = `tb-text${isNew ? " typing-cursor" : ""}`;
    if (!isNew) summary.textContent = story.summary;

    el.append(meta, title, summary);

    if (story.href) {
      const link = document.createElement("span");
      link.className = "tb-link";
      link.textContent = "read →";
      el.appendChild(link);
    }

    el.addEventListener("click", () => {
      this.onStoryClick?.(story);
    });

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
    setTimeout(() => {
      removed.el.remove();
      this.scheduleRelayout();
    }, 800);
  }
}

/** "14:05" for today, "yesterday", or "2 days ago". */
export function formatWhen(epochMs: number): string {
  const now = new Date();
  const then = new Date(epochMs);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (epochMs >= startOfToday) {
    return then.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  const daysAgo = Math.ceil((startOfToday - epochMs) / (24 * 60 * 60_000));
  return daysAgo <= 1 ? "yesterday" : `${daysAgo} days ago`;
}
