import { create } from 'zustand';
import { synthesizeSpeech, fetchTtsHealth } from './api';
import { prepareSpeechChunks } from './speech-chunks';

export type TtsState = 'idle' | 'loading' | 'speaking';

/**
 * Voice output is a single shared resource: one utterance at a time, for the
 * whole app. The state lives in one store rather than per component, because a
 * per-component hook would give every message its own audio element -- two
 * replies would then talk over each other, and autoplay would make that the
 * normal case rather than the exception.
 */
interface TtsStore {
  state: TtsState;
  /** Real audio amplitude sampled by Web Audio; 0..1. */
  audioLevel: number;
  /** id of the message currently loading or speaking, if any. */
  speakingId: string | null;
  error: string | null;
  /** Message whose read-aloud attempt failed, if any. */
  errorId: string | null;
  /** null until the health probe has answered. */
  available: boolean | null;
  /** Last message spoken by autoplay, so a re-render never repeats it. */
  autoSpokenId: string | null;
  speak: (id: string, text: string) => Promise<void>;
  stop: () => void;
  ensureHealth: () => Promise<void>;
  markAutoSpoken: (id: string) => void;
}

// Playback handles are not render state -- keeping them out of the store avoids
// re-rendering every subscriber when an audio element is swapped.
let audio: HTMLAudioElement | null = null;
let objectUrl: string | null = null;
let controller: AbortController | null = null;
let token = 0;
let healthProbe: Promise<void> | null = null;
let analyserContext: AudioContext | null = null;
let primedContext: AudioContext | null = null;
let visualFrame: number | null = null;

/** Call synchronously from the user's click/touch to unlock browser audio. */
export function unlockVoicePlayback(): void {
  if (typeof AudioContext === 'undefined') return;
  try {
    if (!primedContext || primedContext.state === 'closed') {
      primedContext = new AudioContext();
    }
    void primedContext.resume().catch(() => {});
  } catch { /* Browser may restrict audio; normal player still works. */ }
}
let levelStartedAt = 0;

function attachAudioVisualizer(el: HTMLAudioElement, mine: number): void {
  // Graceful degradation when Web Audio is unavailable or blocked by the browser.
  if (typeof AudioContext === 'undefined') return;
  try {
    const context = primedContext ?? new AudioContext();
    primedContext = null;
    // Never route an audible HTMLAudioElement into a suspended context:
    // on iOS this silently mutes it even if el.play() succeeded.
    if (context.state !== 'running') {
      void context.resume().catch(() => {});
      void context.close().catch(() => {});
      return;
    }
    analyserContext = context;
    const source = context.createMediaElementSource(el);
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.68;
    source.connect(analyser);
    analyser.connect(context.destination); // Keep audio audible; do not bypass the speakers.
    const samples = new Uint8Array(analyser.fftSize);
    levelStartedAt = 0;
    const measure = (now: number) => {
      if (mine !== token || !analyserContext || audio !== el) return;
      visualFrame = requestAnimationFrame(measure);
      if (now - levelStartedAt < 65) return;
      levelStartedAt = now;
      analyser.getByteTimeDomainData(samples);
      let power = 0;
      for (let i = 0; i < samples.length; i++) {
        const sample = (samples[i] - 128) / 128;
        power += sample * sample;
      }
      const rms = Math.sqrt(power / samples.length);
      useTtsStore.setState({ audioLevel: Math.min(1, rms * 4.2) });
    };
    visualFrame = requestAnimationFrame(measure);
    void context.resume().catch(() => {});
  } catch {
    // Visualization is optional; synthesis/playback must continue independently.
    if (analyserContext) { void analyserContext.close().catch(() => {}); analyserContext = null; }
  }
}


/** Only a stream ending in the active conversation may trigger autoplay. */
export function shouldAutoplayFinishedReply(
  previousStreamingConversationId: string | null,
  activeId: string | null,
  streamIsActive: boolean,
  lastMessage: { id: string; role: string } | undefined,
  autoSpokenId: string | null,
): boolean {
  return previousStreamingConversationId !== null
    && previousStreamingConversationId === activeId
    && !streamIsActive
    && lastMessage !== undefined
    && lastMessage.role === 'assistant'
    && lastMessage.id !== autoSpokenId;
}

function releaseClip(): void {
  if (visualFrame !== null) { cancelAnimationFrame(visualFrame); visualFrame = null; }
  if (analyserContext) { void analyserContext.close().catch(() => {}); analyserContext = null; }
  useTtsStore.setState({ audioLevel: 0 });
  if (audio) {
    // Detach first: clearing src re-runs the media load algorithm, which fails
    // on an empty source and dispatches an `error` event. With the handler
    // still attached that surfaces as a bogus "Playback failed" after every
    // successful utterance.
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    audio.src = '';
    audio = null;
  }
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
}

function teardown(): void {
  releaseClip();
  if (controller) {
    controller.abort();
    controller = null;
  }
}

export const useTtsStore = create<TtsStore>((set, get) => ({
  state: 'idle',
  audioLevel: 0,
  speakingId: null,
  error: null,
  errorId: null,
  available: null,
  autoSpokenId: null,

  ensureHealth: () => {
    if (healthProbe) return healthProbe;
    healthProbe = fetchTtsHealth()
      .then((health) => {
        set({ available: health.available });
        if (!health.available) healthProbe = null;
      })
      .catch(() => {
        set({ available: false });
        healthProbe = null;
      });
    return healthProbe;
  },

  markAutoSpoken: (id: string) => set({ autoSpokenId: id }),

  speak: async (id: string, text: string) => {
    const chunks = prepareSpeechChunks(text);
    if (!chunks.length) return;

    token += 1;
    const mine = token;
    teardown();
    set({ state: 'loading', speakingId: id, error: null, errorId: null });

    const ac = new AbortController();
    controller = ac;
    type ReadyChunk = { blob: Blob; error?: never } | { blob?: never; error: unknown };
    // Catch prefetch errors immediately: a user pressing Stop cannot leave an
    // unhandled promise rejection from a synthesis started in the background.
    const prefetch = (index: number): Promise<ReadyChunk> =>
      synthesizeSpeech(chunks[index], { signal: ac.signal })
        .then(blob => ({ blob }), error => ({ error }));

    const runChunk = async (index: number, prepared?: Promise<ReadyChunk>): Promise<void> => {
      if (mine !== token) return;
      set({ state: 'loading', speakingId: id });
      try {
        const ready = await (prepared ?? prefetch(index));
        if (mine !== token) return;
        if (ready.error) throw ready.error;
        if (!ready.blob) throw new Error('O motor de voz não retornou áudio.');
        const url = URL.createObjectURL(ready.blob);
        objectUrl = url;
        const el = new Audio(url);
        audio = el;

        let nextReady: Promise<ReadyChunk> | undefined;
        el.onerror = () => {
          if (mine !== token) return;
          teardown();
          set({ state: 'idle', speakingId: null, error: 'Falha na reprodução de áudio', errorId: id });
        };

        el.onended = () => {
          if (mine !== token) return;
          releaseClip();
          if (index + 1 < chunks.length) {
            // Use the chunk synthesized while the previous one was playing.
            void runChunk(index + 1, nextReady);
          } else {
            teardown();
            set({ state: 'idle', speakingId: null });
          }
        };

        await el.play();
        if (mine !== token) return;
        attachAudioVisualizer(el, mine);
        set({ state: 'speaking', speakingId: id });
        // Keep the next speech request ahead of playback without waiting for
        // the entire answer. Full chat text is preserved; long audio is
        // explicitly shortened by prepareSpeechChunks.
        if (index + 1 < chunks.length) nextReady = prefetch(index + 1);
      } catch (err) {
        if (mine !== token) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        teardown();
        set({
          state: 'idle',
          speakingId: null,
          error: err instanceof Error ? err.message : 'Falha na síntese de voz',
          errorId: id,
        });
      }
    };

    await runChunk(0);
  },

  stop: () => {
    token += 1;
    teardown();
    set({ state: 'idle', speakingId: null, error: null, errorId: null });
  },
}));

/** Test seam: reset module-level playback handles between cases. */
export function __resetTtsForTests(): void {
  teardown();
  token = 0;
  healthProbe = null;
  useTtsStore.setState({
    state: 'idle',
    audioLevel: 0,
    speakingId: null,
    error: null,
    errorId: null,
    available: null,
    autoSpokenId: null,
  });
}
