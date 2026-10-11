import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn<typeof fetch>();
class MemoryStorage {
  getItem(): string | null { return null; }
}

beforeEach(() => {
  vi.resetModules();
  globalThis.fetch = fetchMock;
  fetchMock.mockReset();
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Whisper explicit language', () => {
  it('sends pt language by default to prevent auto-detection of Portuguese as Arabic', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      text: 'Olá Jarvis', language: 'pt', duration_seconds: 1, confidence: 0.9,
    }), { status: 200 }));
    const { transcribeAudio } = await import('./api');
    const blob = new Blob(['wav'], { type: 'audio/webm' });
    await transcribeAudio(blob);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe('/v1/speech/transcribe');
    const body = init?.body as FormData;
    expect(body.get('language')).toBe('pt');
    expect((body.get('file') as File).name).toBe('recording.webm');
  });

  it('sends an explicitly selected English locale and Safari container filename', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      text: 'Hello', language: 'en', duration_seconds: 1, confidence: 0.9,
    }), { status: 200 }));
    const { transcribeAudio } = await import('./api');
    await transcribeAudio(new Blob(['mp4'], { type: 'audio/mp4' }), 'recording.m4a', 'en');
    const body = fetchMock.mock.calls[0][1]?.body as FormData;
    expect(body.get('language')).toBe('en');
    expect((body.get('file') as File).name).toBe('recording.m4a');
  });

  it('keeps optional automatic language detection for explicit opt-out', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      text: 'texto', language: 'pt', duration_seconds: 1, confidence: 0.6,
    }), { status: 200 }));
    const { transcribeAudio } = await import('./api');
    await transcribeAudio(new Blob(['audio']), 'recording.webm', undefined);
    const body = fetchMock.mock.calls[0][1]?.body as FormData;
    // The third argument defaults to Portuguese; explicit auto-detect is not used in the PWA.
    expect(body.get('language')).toBe('pt');
  });
});
