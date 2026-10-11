import { describe, expect, it } from 'vitest';
import { prepareSpeechChunks, MAX_AUTOSPEECH_CHARACTERS, SPEECH_CHUNK_CHARACTERS } from './speech-chunks';

describe('fast speech segmentation', () => {
  it('splits a forecast into small utterances without losing weather facts', () => {
    const input = 'Previsão de amanhã em Cuiabá: máxima de 34,9 °C e mínima de 23,1 °C. Chance de chuva de 25%. Fonte: Open-Meteo. A temperatura da manhã será diferente da tarde e a previsão pode mudar ao longo do dia.';
    const chunks = prepareSpeechChunks(input);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every(x => x.length <= SPEECH_CHUNK_CHARACTERS)).toBe(true);
    const result = chunks.join(' ');
    expect(result).toContain('34,9 °C');
    expect(result).toContain('23,1 °C');
    expect(result).toContain('Open-Meteo');
  });

  it('does not require Kokoro to synthesize thousands of characters before playback', () => {
    const verbose = Array.from({ length: 45 }, (_, i) => `Detalhe número ${i}. O sistema precisa ler este conteúdo.`).join(' ');
    const chunks = prepareSpeechChunks(verbose);
    const output = chunks.join(' ');
    expect(output.length).toBeLessThan(MAX_AUTOSPEECH_CHARACTERS + 100);
    expect(output).toContain('detalhes restantes estão disponíveis por escrito');
    expect(chunks[0].length).toBeLessThanOrEqual(SPEECH_CHUNK_CHARACTERS);
  });

  it('removes markdown links and formatting before audio playback', () => {
    const spoken = prepareSpeechChunks('**Olá**, previsão no [Open-Meteo](https://open-meteo.com/).');
    expect(spoken.join(' ')).toContain('Open-Meteo');
    expect(spoken.join(' ')).not.toContain('https://');
    expect(spoken.join(' ')).not.toContain('**');
  });

  it('ignores empty text and rejects invalid chunk parameters', () => {
    expect(prepareSpeechChunks('  ')).toEqual([]);
    expect(() => prepareSpeechChunks('texto', 12, 100)).toThrow('Invalid');
  });

  it('does not split a long word forever', () => {
    const chunks = prepareSpeechChunks('a'.repeat(270), 270, 80);
    expect(chunks).toHaveLength(4);
    expect(chunks.join('')).toBe('a'.repeat(270));
  });
});
