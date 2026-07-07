// The reading layer: a modal that shows a story in full (title, summary,
// and — when the server's reader can extract it — the whole article), plus
// an archive panel listing everything published in the last two days.
// Both keep the reader on the page; the original link is always one click
// away at the bottom.

import type { Story } from "./services/content.js";
import { formatWhen } from "./textTerrain.js";

export class StoryReader {
  private overlay: HTMLDivElement;
  private modal: HTMLDivElement;
  private openStoryId: string | null = null;

  constructor(private readonly archiveUrl: string) {
    this.overlay = document.createElement("div");
    this.overlay.className = "reader-overlay";
    this.overlay.setAttribute("hidden", "");

    this.modal = document.createElement("div");
    this.modal.className = "reader-modal";
    this.modal.setAttribute("role", "dialog");
    this.modal.setAttribute("aria-modal", "true");

    this.overlay.appendChild(this.modal);
    document.body.appendChild(this.overlay);

    this.overlay.addEventListener("pointerdown", (ev) => {
      if (ev.target === this.overlay) this.close();
    });
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") this.close();
    });
  }

  get isOpen(): boolean {
    return !this.overlay.hasAttribute("hidden");
  }

  close(): void {
    this.overlay.setAttribute("hidden", "");
    this.openStoryId = null;
    this.modal.replaceChildren();
  }

  /** Open a single story; lazily loads the full article text. */
  open(story: Story): void {
    this.openStoryId = story.id;
    this.modal.replaceChildren();

    const close = this.closeButton();

    const meta = document.createElement("div");
    meta.className = "reader-meta";
    meta.textContent = `${story.category} · ${story.sourceName} · ${formatWhen(story.deliveredAt ?? story.publishedAt ?? Date.now())}`;

    const title = document.createElement("h2");
    title.className = "reader-title";
    title.textContent = story.title;

    const lede = document.createElement("p");
    lede.className = "reader-lede";
    lede.textContent = story.summary;

    const body = document.createElement("div");
    body.className = "reader-body";
    const loading = document.createElement("p");
    loading.className = "reader-loading";
    loading.textContent = "// fetching the full article…";
    body.appendChild(loading);

    this.modal.append(close, meta, title, lede, body);

    if (story.href) {
      const source = document.createElement("a");
      source.className = "reader-source";
      source.href = story.href;
      source.target = "_blank";
      source.rel = "noopener";
      source.textContent = `read the original at ${story.sourceName} →`;
      this.modal.appendChild(source);
    }

    this.overlay.removeAttribute("hidden");
    this.modal.scrollTop = 0;

    void this.loadArticle(story, body);
  }

  /** Open the archive: everything currently in the shared 48h window. */
  openArchive(stories: Story[]): void {
    this.openStoryId = null;
    this.modal.replaceChildren();

    const close = this.closeButton();

    const title = document.createElement("h2");
    title.className = "reader-title";
    title.textContent = "the archive";

    const meta = document.createElement("div");
    meta.className = "reader-meta";
    meta.textContent = "everything the editor kept, last two days";

    this.modal.append(close, meta, title);

    const sorted = [...stories].sort(
      (a, b) => (b.deliveredAt ?? 0) - (a.deliveredAt ?? 0)
    );

    if (sorted.length === 0) {
      const empty = document.createElement("p");
      empty.className = "reader-loading";
      empty.textContent = "// nothing yet. the world has been quiet.";
      this.modal.appendChild(empty);
    }

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    let currentGroup = "";

    for (const story of sorted) {
      const at = story.deliveredAt ?? story.publishedAt ?? 0;
      const group = at >= startOfToday.getTime() ? "today" : "yesterday & before";
      if (group !== currentGroup) {
        currentGroup = group;
        const heading = document.createElement("div");
        heading.className = "archive-day";
        heading.textContent = group;
        this.modal.appendChild(heading);
      }

      const row = document.createElement("button");
      row.type = "button";
      row.className = `archive-row kind-${story.category}`;

      const rowMeta = document.createElement("span");
      rowMeta.className = "archive-row-meta";
      rowMeta.textContent = `${story.category} · ${formatWhen(at)}`;

      const rowTitle = document.createElement("span");
      rowTitle.className = "archive-row-title";
      rowTitle.textContent = story.title;

      row.append(rowMeta, rowTitle);
      row.addEventListener("click", () => this.open(story));
      this.modal.appendChild(row);
    }

    this.overlay.removeAttribute("hidden");
    this.modal.scrollTop = 0;
  }

  private async loadArticle(story: Story, body: HTMLElement): Promise<void> {
    let paragraphs: string[] | null = null;
    try {
      const resp = await fetch(`${this.archiveUrl}/article/${encodeURIComponent(story.id)}`);
      if (resp.ok) {
        const data = await resp.json();
        if (data?.ok && Array.isArray(data.paragraphs)) {
          paragraphs = data.paragraphs as string[];
        }
      }
    } catch {
      // Network hiccup — fall through to the link-only fallback.
    }

    // The reader may have moved on to another story meanwhile.
    if (this.openStoryId !== story.id) return;

    body.replaceChildren();
    if (paragraphs && paragraphs.length > 0) {
      for (const text of paragraphs) {
        const p = document.createElement("p");
        p.textContent = text;
        body.appendChild(p);
      }
    } else {
      const note = document.createElement("p");
      note.className = "reader-loading";
      note.textContent = "// couldn't fetch the full text — the summary above is the gist, and the original is one click below.";
      body.appendChild(note);
    }
  }

  private closeButton(): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "reader-close";
    btn.setAttribute("aria-label", "Close");
    btn.textContent = "✕";
    btn.addEventListener("click", () => this.close());
    return btn;
  }
}
