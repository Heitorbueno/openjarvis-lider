import { describe, expect, it } from 'vitest';
import { encodeSpeechWav, validRecordedContainer } from './speech-wav';

function tone(rate: number, seconds: number): Float32Array {
  const samples = new Float32Array(Math.round(rate * seconds));
  for (let i = 0; i < samples.length; i++) samples[i] = Math.sin(2 * Math.PI * 440 * i / rate) * .5;
  return samples;
}
const chars = (buffer: ArrayBuffer, start: number, length: number) =>
  String.fromCharCode(...new Uint8Array(buffer, start, length));

describe('browser microphone WAV encoder', () => {
  it('produces a complete valid 16 kHz mono PCM WAV from 48k browser audio', async () => {
    const pcm = tone(48000, 1);
    const blob = encodeSpeechWav([pcm.slice(0, 24000), pcm.slice(24000)], 48000);
    expect(blob.type).toBe('audio/wav');
    expect(blob.size).toBe(44 + 2 * 16000);
    const data = await blob.arrayBuffer();
    const view = new DataView(data);
    expect(chars(data, 0, 4)).toBe('RIFF');
    expect(chars(data, 8, 4)).toBe('WAVE');
    expect(chars(data, 12, 4)).toBe('fmt ');
    expect(chars(data, 36, 4)).toBe('data');
    expect(view.getUint32(4, true)).toBe(blob.size - 8);
    expect(view.getUint32(40, true)).toBe(blob.size - 44);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(await validRecordedContainer(blob, 'audio/wav')).toBe(true);
    expect(view.getInt16(44 + 2 * 3, true)).not.toBe(0);
  });

  it('converts 44.1k recordings without fragmented containers', async () => {
    const wav = encodeSpeechWav([tone(44100, 2)], 44100);
    expect(wav.size).toBe(44 + 64000);
    expect(new DataView(await wav.arrayBuffer()).getUint32(24, true)).toBe(16000);
  });

  it('never submits a zero-duration or header-only recording to Whisper', () => {
    expect(() => encodeSpeechWav([], 48000)).toThrow('Nenhum áudio');
    expect(() => encodeSpeechWav([tone(48000, 0.1)], 48000)).toThrow('muito curto');
  });

  it('caps runaway recording size before allocation', () => {
    expect(() => encodeSpeechWav([tone(8000, 76)], 8000)).toThrow('muito longa');
  });

  it('rejects incomplete WebM/MP4 fallback blobs on the client', async () => {
    const partial = new Blob([new Uint8Array(400)], { type: 'audio/webm' });
    expect(await validRecordedContainer(partial, 'audio/webm')).toBe(false);
    expect(await validRecordedContainer(new Blob([new Uint8Array(20)]), 'audio/webm')).toBe(false);
    const ebml = new Uint8Array(280);
    ebml.set([0x1a, 0x45, 0xdf, 0xa3]);
    expect(await validRecordedContainer(new Blob([ebml]), 'audio/webm')).toBe(true);
  });
});
