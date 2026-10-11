/** Deterministic PCM16 mono WAV encoder for microphone recording.
 *
 * Captures from Web Audio rather than fragmented MediaRecorder WebM:
 * complete RIFF/WAVE headers avoid FFmpeg's "End of file" on short blobs.
 * All processing stays in the browser; no dependencies or network requests.
 */
export const SPEECH_WAV_SAMPLE_RATE = 16000;
export const MAX_SPEECH_RECORDING_SECONDS = 75;

/** Downsample floating-point mono PCM to 16 kHz, encode 16-bit little endian. */
export function encodeSpeechWav(
  chunks: readonly Float32Array[],
  inputSampleRate: number,
  outputSampleRate = SPEECH_WAV_SAMPLE_RATE,
): Blob {
  if (!Number.isFinite(inputSampleRate) || inputSampleRate < 8000 || inputSampleRate > 192000) {
    throw new Error('Invalid microphone sample rate');
  }
  if (!Number.isInteger(outputSampleRate) || outputSampleRate < 8000 || outputSampleRate > 48000) {
    throw new Error('Invalid target sample rate');
  }
  const totalSamples = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  if (!totalSamples) throw new Error('Nenhum áudio foi capturado. Fale antes de finalizar a gravação.');
  if (totalSamples > inputSampleRate * MAX_SPEECH_RECORDING_SECONDS) {
    throw new Error('Gravação muito longa. Envie mensagens de até 75 segundos.');
  }
  // The microphone sample rate normally is 44.1k/48k. Box averaging
  // works for both rates and avoids copying empty/disjoint WebM fragments.
  const all = new Float32Array(totalSamples);
  let offset = 0;
  for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.length; }
  const outputLength = Math.floor(totalSamples * outputSampleRate / inputSampleRate);
  if (outputLength < outputSampleRate * .35) {
    throw new Error('Áudio muito curto. Mantenha o microfone ativado por pelo menos um segundo.');
  }
  const lengthBytes = outputLength * 2;
  const bytes = new ArrayBuffer(44 + lengthBytes);
  const header = new DataView(bytes);
  const setChars = (at: number, word: string) => {
    for (let i = 0; i < word.length; i++) header.setUint8(at + i, word.charCodeAt(i));
  };
  setChars(0, 'RIFF');
  header.setUint32(4, 36 + lengthBytes, true);
  setChars(8, 'WAVE');
  setChars(12, 'fmt ');
  header.setUint32(16, 16, true);          // PCM format chunk size
  header.setUint16(20, 1, true);           // PCM (not float)
  header.setUint16(22, 1, true);           // mono
  header.setUint32(24, outputSampleRate, true);
  header.setUint32(28, outputSampleRate * 2, true);
  header.setUint16(32, 2, true);
  header.setUint16(34, 16, true);
  setChars(36, 'data');
  header.setUint32(40, lengthBytes, true);

  const ratio = inputSampleRate / outputSampleRate;
  for (let i = 0; i < outputLength; i++) {
    const first = Math.floor(i * ratio);
    const last = Math.min(totalSamples, Math.max(first + 1, Math.ceil((i + 1) * ratio)));
    let sum = 0;
    for (let j = first; j < last; j++) sum += all[j];
    const raw = sum / (last - first);
    const value = Math.max(-1, Math.min(1, Number.isFinite(raw) ? raw : 0));
    header.setInt16(44 + 2 * i, value < 0 ? Math.round(value * 32768) : Math.round(value * 32767), true);
  }
  return new Blob([bytes], { type: 'audio/wav' });
}

/** Reject raw/partial WebM/MP4 blobs before they reach the Whisper backend. */
export async function validRecordedContainer(blob: Blob, mime: string): Promise<boolean> {
  if (blob.size < 256) return false;
  const signature = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  if (mime.includes('webm')) return signature[0] === 0x1a && signature[1] === 0x45
    && signature[2] === 0xdf && signature[3] === 0xa3;
  if (mime.includes('mp4') || mime.includes('m4a')) {
    return String.fromCharCode(...signature.slice(4, 8)) === 'ftyp';
  }
  if (mime.includes('wav')) {
    return String.fromCharCode(...signature.slice(0, 4)) === 'RIFF'
      && String.fromCharCode(...signature.slice(8, 12)) === 'WAVE';
  }
  return true; // Ogg support verified by backend decode.
}
