// Character-by-character text reveal for the Zaur text world.

export interface TypewriterOptions {
  /** Characters per second. */
  cps?: number;
  /** Called after each character (e.g. to scroll or reposition the dino). */
  onTick?: () => void;
  signal?: AbortSignal;
  /** Whether to play mechanical click sound effects. */
  playClick?: boolean;
}

// Global shared AudioContext for typewriter clicks to avoid instantiation lag
let clickCtx: AudioContext | null = null;

function playTypewriterClick(): void {
  try {
    const AudioCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;
    if (!clickCtx) {
      clickCtx = new AudioCtor();
    }
    if (clickCtx.state === "suspended") {
      void clickCtx.resume();
    }
    const now = clickCtx.currentTime;
    const osc = clickCtx.createOscillator();
    const gain = clickCtx.createGain();
    
    // Procedural mechanical key click: high frequency noise burst
    osc.type = "triangle";
    osc.frequency.setValueAtTime(1400 + Math.random() * 800, now);
    
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.008, now + 0.001);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.012);
    
    osc.connect(gain).connect(clickCtx.destination);
    osc.start(now);
    osc.stop(now + 0.015);
  } catch {
    // browser blocked audio / not interacted yet — ignore quietly
  }
}

export async function typewriter(
  element: HTMLElement,
  text: string,
  opts: TypewriterOptions = {}
): Promise<void> {
  const cps = opts.cps ?? 35;
  const delayMs = 1000 / cps;
  element.textContent = "";

  for (let i = 0; i < text.length; i++) {
    if (opts.signal?.aborted) return;
    element.textContent = text.slice(0, i + 1);
    
    if (opts.playClick) {
      // Don't click on spaces to make it sound more realistic
      const char = text[i];
      if (char && char.trim()) {
        playTypewriterClick();
      }
    }
    
    opts.onTick?.();
    if (i < text.length - 1) {
      await sleep(delayMs, opts.signal);
    }
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = window.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
