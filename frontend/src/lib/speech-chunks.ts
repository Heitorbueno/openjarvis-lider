/** Prepare short speakable chunks from the visible answer.
 *
 * Kokoro's CPU synthesis used to process an entire very long model answer
 * before Audio.play(), leaving the skin at "Preparando voz" for minutes.
 * Small chunks make the first spoken sentence available much sooner.
 */
export const MAX_AUTOSPEECH_CHARACTERS = 520;
export const SPEECH_CHUNK_CHARACTERS = 145;

export function prepareSpeechChunks(
  input: string,
  maxChars = MAX_AUTOSPEECH_CHARACTERS,
  chunkChars = SPEECH_CHUNK_CHARACTERS,
): string[] {
  if (!input.trim()) return [];
  if (maxChars < 40 || chunkChars < 30) throw new Error('Invalid TTS chunk limits');
  let clean = input
    .replace(/```[\s\S]*?```/g, ' Há um trecho de código na tela. ')
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/(?:^|\n)\s{0,3}#{1,6}\s*/g, '. ')
    .replace(/(?:^|\n)\s*[-*]\s+/g, '. ')
    .replace(/[\u200B-\u200D\uFE0F]/g, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .trim();
  if (!clean) return [];

  const wasLong = clean.length > maxChars;
  if (wasLong) {
    const preview = clean.slice(0, maxChars);
    // Prefer a complete sentence (but avoid dropping most of the answer).
    const lastSentence = Math.max(preview.lastIndexOf('. '), preview.lastIndexOf('? '), preview.lastIndexOf('! '));
    const cut = lastSentence > maxChars * .5
      ? lastSentence + 1 : Math.max(1, preview.lastIndexOf(' '));
    clean = preview.slice(0, cut).replace(/[,;:\s]+$/, '').trim();
    clean += '. Os detalhes restantes estão disponíveis por escrito.';
  }

  const result: string[] = [];
  while (clean.length) {
    if (clean.length <= chunkChars) { result.push(clean); break; }
    const preview = clean.slice(0, chunkChars + 1);
    const punctuation = Math.max(preview.lastIndexOf('. '), preview.lastIndexOf('? '), preview.lastIndexOf('! '), preview.lastIndexOf('; '));
    const splitAt = punctuation >= Math.min(45, chunkChars * .4)
      ? punctuation + 1 : preview.lastIndexOf(' ');
    const offset = splitAt > 0 ? splitAt : chunkChars;
    const part = clean.slice(0, offset).trim();
    if (part) result.push(part);
    clean = clean.slice(offset).trim();
  }
  return result;
}
