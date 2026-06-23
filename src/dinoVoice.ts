// Optional voice for dino's thoughts and ambient sound effects. When
// enabled, each `dino_thought` event triggers a fetch to /tts and each
// `dino_sfx` event a fetch to /sfx/<token>; the archive proxies/serves
// the MP3 back, the browser plays it through a Blob URL that's revoked
// as soon as playback ends — nothing is persisted.
//
// Browsers block autoplay until the user has interacted with the page;
// the radio's voice toggle (rendered in messages.ts) acts as that gesture
// so subsequent `audio.play()` calls succeed.

const STORAGE_KEY = "dino-voice-enabled";

export class DinoVoice {
  private enabled: boolean;
  private current: HTMLAudioElement | null = null;
  private currentUrl: string | null = null;
  private currentAbort: AbortController | null = null;

  constructor(private readonly archiveUrl: string) {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch {
      // Private mode / storage disabled — fall through, default off.
    }
    this.enabled = stored === "1";
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(value: boolean): void {
    this.enabled = value;
    try {
      localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
    } catch {
      // ignore — runtime state is still authoritative for this tab
    }
    if (!value) this.stopCurrent();
  }

  toggle(): boolean {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }

  async say(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    const ok = await this.fetchAndPlay((signal) =>
      fetch(`${this.archiveUrl}/tts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: trimmed }),
        signal,
      })
    );
    if (!ok && this.enabled && typeof window !== "undefined" && window.speechSynthesis) {
      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(trimmed);
        utterance.rate = 1.05;
        utterance.pitch = 1.15;
        window.speechSynthesis.speak(utterance);
      } catch (err) {
        console.warn("[voice] speech synthesis fallback failed:", err);
      }
    }
  }

  /**
   * Play an ambient sfx clip from a relative archive path (e.g.
   * "/sfx/<token>") or an absolute URL. Same playback path as `say()` —
   * gated by the voice toggle and aborted if a fresh thought/sfx arrives.
   */
  async playSfx(path: string): Promise<void> {
    if (!path) return;
    const url = /^https?:/i.test(path) ? path : `${this.archiveUrl}${path}`;
    await this.fetchAndPlay((signal) => fetch(url, { signal }));
  }

  private async fetchAndPlay(
    fetcher: (signal: AbortSignal) => Promise<Response>
  ): Promise<boolean> {
    if (!this.enabled) return false;

    this.stopCurrent();
    const ac = new AbortController();
    this.currentAbort = ac;

    let blob: Blob | null = null;
    try {
      const resp = await fetcher(ac.signal);
      if (!resp.ok) return false;
      blob = await resp.blob();
    } catch (err) {
      if ((err as { name?: string })?.name !== "AbortError") {
        console.warn("[voice] fetch failed:", err);
      }
      return false;
    } finally {
      if (this.currentAbort === ac) this.currentAbort = null;
    }

    if (ac.signal.aborted || !blob) return false;

    const objectUrl = URL.createObjectURL(blob);
    const audio = new Audio(objectUrl);
    this.current = audio;
    this.currentUrl = objectUrl;

    const cleanup = () => {
      if (this.currentUrl === objectUrl) {
        URL.revokeObjectURL(objectUrl);
        this.currentUrl = null;
      }
      if (this.current === audio) this.current = null;
    };
    audio.addEventListener("ended", cleanup);
    audio.addEventListener("error", cleanup);

    try {
      await audio.play();
      return true;
    } catch {
      // Autoplay blocked, or playback rejected. Drop quietly.
      cleanup();
      return false;
    }
  }

  private stopCurrent(): void {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    }
    if (this.currentAbort) {
      this.currentAbort.abort();
      this.currentAbort = null;
    }
    if (this.current) {
      try {
        this.current.pause();
      } catch {
        // ignore
      }
      this.current = null;
    }
    if (this.currentUrl) {
      URL.revokeObjectURL(this.currentUrl);
      this.currentUrl = null;
    }
  }
}
