// The story model shared with the archive server. The server's editor
// publishes only a few stories per category per day; each carries a short
// summary so the page is readable on its own, plus a link to the source.

export type Category = "tech" | "world" | "ukraine" | "science";

export const CATEGORIES: readonly Category[] = ["tech", "world", "ukraine", "science"];

export interface Story {
  /** Stable ID — used to avoid rendering the same story twice. */
  id: string;
  category: Category;
  title: string;
  /** 2-3 calm sentences written by the editor. */
  summary: string;
  /** Link to the original article. */
  href?: string;
  sourceName: string;
  /** When the source published the story (epoch ms). */
  publishedAt?: number;
  /** When our editor decided it mattered (epoch ms). */
  deliveredAt?: number;
  /** 0..1 — the editor's importance rating. */
  importance: number;
}
