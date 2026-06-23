import { RADIO_MANIFEST } from "virtual:radio-manifest";
import type { ContentKind } from "./services/content.js";

export type RadioChannel = "all" | "news" | "quake" | "fact" | "space" | "bird";

export interface RadioPick {
  id: string;
  url: string;
}

const ARCHIVE_API_URL = (
  import.meta.env.VITE_ARCHIVE_URL ?? "https://dino-archive.zaur.app"
).replace(/\/$/, "");

const RADIO_FOLDER: Record<RadioChannel, string> = {
  all: "all",
  news: "news",
  quake: "quakes",
  fact: "facts",
  space: "space",
  bird: "birds",
};

/** High-level mapping from Zaur's channels to synthesised melody scale frequencies. */
const SCALE_FREQS: Record<RadioChannel, number[]> = {
  all: [220.0, 246.94, 261.63, 293.66, 329.63, 349.23, 392.0, 440.0],
  news: [261.63, 293.66, 329.63, 392.0, 440.0],
  quake: [110.0, 130.81, 146.83, 164.81, 196.0],
  fact: [329.63, 349.23, 392.0, 440.0, 493.88, 523.25],
  space: [440.0, 493.88, 523.25, 587.33, 659.25, 783.99, 880.0],
  bird: [523.25, 587.33, 659.25, 698.46, 783.99, 880.0, 987.77, 1046.5],
};

export function channelFrequency(channel: RadioChannel): number {
  switch (channel) {
    case "all":   return 92.5;
    case "news":  return 88.0;
    case "quake": return 99.1;
    case "fact":  return 101.5;
    case "space": return 104.9;
    case "bird":  return 107.7;
  }
}

function kindFrequency(kind: ContentKind): number {
  switch (kind) {
    case "news":    return 360;
    case "weather": return 440;
    case "fact":    return 520;
    case "quake":   return 180;
    case "space":   return 680;
    case "bird":    return 880;
  }
}

export class RadioAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private hum: OscillatorNode | null = null;
  private musicGain: GainNode | null = null;
  public track: HTMLAudioElement | null = null;
  private currentTrackId: string | null = null;
  private trackEndedHandler: (() => void) | null = null;
  private staticTimer: number | null = null;
  private musicTimer: number | null = null;
  private musicStep = 0;
  private musicChannel: RadioChannel = "all";
  private enabled = false;
  private musicEnabled = false;

  public onTrackChange: ((info: { title: string; artist: string; playlist: string }) => void) | null = null;

  async toggle(channel: RadioChannel): Promise<boolean> {
    if (this.enabled) {
      this.stop();
      return false;
    }
    await this.start(channel);
    return this.enabled;
  }

  get isMusicEnabled(): boolean {
    return this.musicEnabled;
  }

  async playMusic(channel: RadioChannel): Promise<boolean> {
    this.musicChannel = channel;
    if (this.musicEnabled) {
      if (this.track) {
        await this.switchTrack(channel);
      } else {
        this.tune(channel);
      }
      return true;
    }
    const trackStarted = await this.startTrack(channel);
    if (trackStarted) return true;
    await this.ensureStarted(channel);
    this.startMusic(channel);
    return this.musicEnabled;
  }

  async toggleMusic(channel: RadioChannel): Promise<boolean> {
    if (this.musicEnabled) {
      this.stopMusic();
      return false;
    }
    return this.playMusic(channel);
  }

  isLiveStream(): boolean {
    return (
      typeof this.currentTrackId === "string" &&
      this.currentTrackId.startsWith("internet:")
    );
  }

  pauseLive(): boolean {
    if (!this.musicEnabled || !this.isLiveStream()) return false;
    if (this.track) {
      try {
        this.track.pause();
        this.track.removeAttribute("src");
        this.track.load();
      } catch {
        // ignore
      }
    }
    this.stopMusic();
    return true;
  }

  tune(channel: RadioChannel): void {
    this.musicChannel = channel;
    if (this.musicEnabled && this.track) void this.switchTrack(channel);
    if (!this.ctx) return;
    if (this.enabled && this.hum) {
      this.hum.frequency.setTargetAtTime(channelFrequency(channel), this.ctx.currentTime, 0.04);
      this.staticBurst(0.16, 0.018);
    }
  }

  item(kind: ContentKind): void {
    if (!this.enabled || !this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    this.beep(kindFrequency(kind), now, 0.055);
    this.beep(kindFrequency(kind) * 1.5, now + 0.08, 0.05);
  }

  warn(): void {
    if (!this.enabled) return;
    this.staticBurst(0.28, 0.035);
  }

  private async start(channel: RadioChannel): Promise<void> {
    await this.ensureStarted(channel);
    if (!this.ctx || !this.master) return;
    if (this.hum) {
      this.enabled = true;
      return;
    }
    const hum = this.ctx.createOscillator();
    hum.type = "triangle";
    hum.frequency.value = channelFrequency(channel);
    hum.connect(this.master);
    hum.start();

    this.hum = hum;
    this.enabled = true;
    this.staticTimer = window.setInterval(() => this.staticBurst(0.08, 0.008), 3_500);
    this.tune(channel);
  }

  private async ensureStarted(channel: RadioChannel): Promise<void> {
    this.musicChannel = channel;
    if (this.ctx && this.master) {
      await this.ctx.resume();
      return;
    }
    const AudioCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;
    const ctx = new AudioCtor();
    await ctx.resume();
    const master = ctx.createGain();
    master.gain.value = 0.025;
    master.connect(ctx.destination);

    this.ctx = ctx;
    this.master = master;
  }

  private stop(): void {
    if (this.staticTimer !== null) window.clearInterval(this.staticTimer);
    this.staticTimer = null;
    this.hum?.stop();
    this.hum = null;
    this.enabled = false;
    if (!this.musicEnabled) this.closeIfSilent();
  }

  private startMusic(channel: RadioChannel): void {
    if (!this.ctx || this.musicEnabled) return;
    this.musicChannel = channel;
    const gain = this.ctx.createGain();
    gain.gain.value = 0.08;
    gain.connect(this.ctx.destination);
    this.musicGain = gain;
    this.musicEnabled = true;
    this.musicStep = 0;
    this.musicTimer = window.setInterval(() => this.playMusicStep(), 280);
    this.playMusicStep();
  }

  public stopMusic(): void {
    if (this.musicTimer !== null) window.clearInterval(this.musicTimer);
    this.musicTimer = null;
    if (this.track) {
      this.track.pause();
      if (this.trackEndedHandler) {
        this.track.removeEventListener("ended", this.trackEndedHandler);
      }
      this.track = null;
    }
    this.trackEndedHandler = null;
    this.currentTrackId = null;
    this.musicGain?.disconnect();
    this.musicGain = null;
    this.musicEnabled = false;
    this.closeIfSilent();
  }

  private async startTrack(channel: RadioChannel): Promise<boolean> {
    const pick = await fetchTrack(channel, null);
    if (!pick) return false;
    const audio = new Audio(pick.url);
    audio.volume = 0.42;
    audio.preload = "auto";
    const onEnded = () => this.playNextRandom();
    audio.addEventListener("ended", onEnded);
    try {
      await audio.play();
      this.track = audio;
      this.currentTrackId = pick.id;
      this.trackEndedHandler = onEnded;
      this.musicEnabled = true;
      this.musicChannel = channel;
      
      this.onTrackChange?.({
        title: pick.title || "ambient synth",
        artist: pick.artist || "zaur station",
        playlist: pick.playlist || channel
      });

      return true;
    } catch {
      audio.removeEventListener("ended", onEnded);
      return false;
    }
  }

  private async switchTrack(channel: RadioChannel): Promise<void> {
    if (!this.track) return;
    const pick = await fetchTrack(channel, this.currentTrackId);
    if (!pick) return;
    const absolute = new URL(pick.url, window.location.href).href;
    if (this.track.src === absolute) return;
    this.track.src = pick.url;
    this.currentTrackId = pick.id;
    try {
      await this.track.play();
      this.onTrackChange?.({
        title: pick.title || "ambient synth",
        artist: pick.artist || "zaur station",
        playlist: pick.playlist || channel
      });
    } catch {
      this.stopMusic();
      await this.toggleMusic(channel);
    }
  }

  private async playNextRandom(): Promise<void> {
    if (!this.musicEnabled || !this.track) return;
    const pick = await fetchTrack(this.musicChannel, this.currentTrackId);
    if (!pick) {
      this.stopMusic();
      return;
    }
    this.track.src = pick.url;
    this.currentTrackId = pick.id;
    try {
      await this.track.play();
      this.onTrackChange?.({
        title: pick.title || "ambient synth",
        artist: pick.artist || "zaur station",
        playlist: pick.playlist || this.musicChannel
      });
    } catch {
      this.stopMusic();
    }
  }

  private closeIfSilent(): void {
    if (this.enabled || this.musicEnabled) return;
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
  }

  private beep(freq: number, startAt: number, duration: number): void {
    if (!this.ctx || !this.master) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(0.045, startAt + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    osc.connect(gain).connect(this.master);
    osc.start(startAt);
    osc.stop(startAt + duration + 0.02);
  }

  private playMusicStep(): void {
    if (!this.ctx || !this.musicGain) return;
    const scale = SCALE_FREQS[this.musicChannel] || SCALE_FREQS.all;
    const freq = scale[this.musicStep % scale.length];
    const now = this.ctx.currentTime;
    this.musicNote(freq, now, 0.22);
    if (this.musicStep % 4 === 0) this.musicNote(freq / 2, now, 0.28, "triangle", 0.45);
    this.musicStep += 1;
  }

  private musicNote(
    freq: number,
    startAt: number,
    duration: number,
    type: OscillatorType = "sine",
    volume = 1.0
  ): void {
    if (!this.ctx || !this.musicGain) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(0.035 * volume, startAt + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    osc.connect(gain).connect(this.musicGain);
    osc.start(startAt);
    osc.stop(startAt + duration + 0.02);
  }

  private staticBurst(duration: number, volume: number): void {
    if (!this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    const bufferSize = this.ctx.sampleRate * duration;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 1000;
    filter.Q.value = 0.5;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    noise.connect(filter).connect(gain).connect(this.master);
    noise.start(now);
    noise.stop(now + duration + 0.01);
  }
}

async function fetchTrack(
  channel: RadioChannel,
  avoid: string | null
): Promise<{ id: string; url: string; title?: string; artist?: string; playlist?: string } | undefined> {
  if (ARCHIVE_API_URL) {
    try {
      const params = new URLSearchParams({ channel });
      if (avoid) params.set("avoid", avoid);
      const resp = await fetch(`${ARCHIVE_API_URL}/radio/track?${params}`, {
        cache: "no-store",
      });
      if (resp.ok) {
        const body = (await resp.json()) as {
          id?: unknown;
          url?: unknown;
          title?: unknown;
          artist?: unknown;
          playlist?: unknown;
        };
        if (typeof body.id === "string" && typeof body.url === "string") {
          const absolute = new URL(body.url, ARCHIVE_API_URL).href;
          return {
            id: body.id,
            url: absolute,
            title: typeof body.title === "string" ? body.title : undefined,
            artist: typeof body.artist === "string" ? body.artist : undefined,
            playlist: typeof body.playlist === "string" ? body.playlist : undefined,
          };
        }
      }
    } catch {
      // ignore
    }
  }
  return pickLocalTrack(channel, avoid);
}

function pickLocalTrack(channel: RadioChannel, avoid: string | null): any {
  const folder = RADIO_FOLDER[channel];
  let pool = RADIO_MANIFEST[folder] ?? [];
  if (pool.length === 0 && folder !== RADIO_FOLDER.all) {
    pool = RADIO_MANIFEST[RADIO_FOLDER.all] ?? [];
  }
  if (pool.length === 0) return undefined;
  if (pool.length === 1) return { id: pool[0], url: pool[0], title: "local audio", artist: "dino loop" };
  const candidates = avoid ? pool.filter((t) => t !== avoid) : pool;
  const list = candidates.length > 0 ? candidates : pool;
  const url = list[Math.floor(Math.random() * list.length)];
  return { id: url, url, title: decodeURIComponent(url.split("/").pop() || "track"), artist: "local playlist" };
}
