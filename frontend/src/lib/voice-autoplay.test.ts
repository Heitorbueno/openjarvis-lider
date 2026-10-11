import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./store', () => ({ useAppStore: { getState: vi.fn() } }));
vi.mock('./tts', () => ({ useTtsStore: { getState: vi.fn() } }));
vi.mock('./message-text', () => ({ stripThinkTags: (text: string) => text }));

import { useAppStore } from './store';
import { useTtsStore } from './tts';
import { speakCompletedReply } from './voice-autoplay';

const app = {
  activeId: 'chat1',
  streamState: { isStreaming: false },
  settings: { voiceAutoplay: true, voiceOutputEnabled: true },
  messages: [{ id: 'reply1', role: 'assistant', content: 'Olá, posso ajudar.' }],
};

const voice = {
  available: true as boolean | null,
  autoSpokenId: null as string | null,
  ensureHealth: vi.fn(async () => {}),
  markAutoSpoken: vi.fn((id: string) => { voice.autoSpokenId = id; }),
  speak: vi.fn(async () => {}),
};

beforeEach(() => {
  app.activeId = 'chat1';
  app.streamState.isStreaming = false;
  app.settings.voiceAutoplay = true;
  app.settings.voiceOutputEnabled = true;
  app.messages = [{ id: 'reply1', role: 'assistant', content: 'Olá, posso ajudar.' }];
  voice.available = true;
  voice.autoSpokenId = null;
  voice.ensureHealth.mockReset().mockResolvedValue(undefined);
  voice.markAutoSpoken.mockClear();
  voice.speak.mockClear();
  vi.mocked(useAppStore.getState).mockReturnValue(app as unknown as ReturnType<typeof useAppStore.getState>);
  vi.mocked(useTtsStore.getState).mockReturnValue(voice as unknown as ReturnType<typeof useTtsStore.getState>);
});

describe('completed reply speech handoff', () => {
  it('synthesizes the exact completed assistant reply once', async () => {
    expect(await speakCompletedReply('chat1', 'reply1')).toBe(true);
    expect(voice.ensureHealth).toHaveBeenCalledTimes(1);
    expect(voice.markAutoSpoken).toHaveBeenCalledWith('reply1');
    expect(voice.speak).toHaveBeenCalledWith('reply1', 'Olá, posso ajudar.');
    expect(await speakCompletedReply('chat1', 'reply1')).toBe(false);
    expect(voice.speak).toHaveBeenCalledTimes(1);
  });

  it('does not speak when autoplay is disabled', async () => {
    app.settings.voiceAutoplay = false;
    expect(await speakCompletedReply('chat1', 'reply1')).toBe(false);
    expect(voice.ensureHealth).not.toHaveBeenCalled();
  });

  it('does not speak a stale reply when conversation changes while Kokoro loads', async () => {
    voice.ensureHealth.mockImplementation(async () => {
      app.activeId = 'other-chat';
    });
    expect(await speakCompletedReply('chat1', 'reply1')).toBe(false);
    expect(voice.speak).not.toHaveBeenCalled();
  });

  it('does not speak while a new response is streaming', async () => {
    app.streamState.isStreaming = true;
    expect(await speakCompletedReply('chat1', 'reply1')).toBe(false);
    expect(voice.speak).not.toHaveBeenCalled();
  });

  it('does not attempt audio when the backend health probe fails', async () => {
    voice.available = false;
    expect(await speakCompletedReply('chat1', 'reply1')).toBe(false);
    expect(voice.speak).not.toHaveBeenCalled();
  });

  it('never vocalizes API failures as normal Jarvis answers', async () => {
    app.messages = [{ id: 'reply1', role: 'assistant', content: 'Error: model offline' }];
    expect(await speakCompletedReply('chat1', 'reply1')).toBe(false);
    expect(voice.speak).not.toHaveBeenCalled();
  });
});
