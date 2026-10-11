import { describe, it, expect, vi, beforeEach } from 'vitest';

const request = vi.fn<typeof fetch>();
vi.mock('./api', () => ({
  apiFetch: (...args: Parameters<typeof fetch>) => request(...args),
}));

import { getTomorrowWeatherCity, describeTomorrowForecast, getTomorrowForecast } from './weather-forecast';

beforeEach(() => request.mockReset());

describe('weather-specific intent detection', () => {
  it('detects weather tomorrow in Cuiabá after natural question', () => {
    expect(getTomorrowWeatherCity('realize uma pesquisa de temperatura em Cuiabá amanhã')).toBe('Cuiabá');
  });
  it('detects forecast tomorrow before city', () => {
    expect(getTomorrowWeatherCity('Qual a previsão do tempo amanhã em Cuiabá?')).toBe('Cuiabá');
  });
  it('routes the exact microphone transcription from the Jarvis Líder PWA', () => {
    expect(getTomorrowWeatherCity('Olá Jarvis, eu quero que me diga a previsão do templo para a manhã em Cuiabá.')).toBe('Cuiabá');
    expect(getTomorrowWeatherCity('previsão do tempo para a manhã em Cuiabá')).toBe('Cuiabá');
    expect(getTomorrowWeatherCity('previsão do tempo para amanhã em Cuiabá')).toBe('Cuiabá');
  });
  it('does not confuse morning meetings with tomorrow weather', () => {
    expect(getTomorrowWeatherCity('Marque a reunião para a manhã em Cuiabá')).toBeNull();
    expect(getTomorrowWeatherCity('previsão de temperatura hoje de manhã em Cuiabá')).toBeNull();
  });
  it('does not hijack other requests', () => {
    expect(getTomorrowWeatherCity('temperatura de ontem em Cuiabá')).toBeNull();
    expect(getTomorrowWeatherCity('faça um cálculo amanhã')).toBeNull();
  });
});

const forecast = {
  provider: 'Open-Meteo',
  source_url: 'https://open-meteo.com/',
  location: { name: 'Cuiabá', region: 'Mato Grosso', country: 'Brasil', timezone: 'America/Cuiaba' },
  date: '2026-10-12',
  temperature_max_c: 36.5,
  temperature_min_c: 24.2,
  precipitation_probability_percent: 30,
  weather_code: 2,
  description_pt: 'parcialmente nublado',
  retrieved_at: '2026-10-11T21:00:00+00:00',
};

describe('weather API and formatting', () => {
  it('uses authenticated app API helper and the requested city', async () => {
    request.mockResolvedValue(new Response(JSON.stringify(forecast), { status: 200 }));
    expect(await getTomorrowForecast('Cuiabá')).toEqual(forecast);
    expect(request.mock.calls[0][0]).toBe('/v1/weather/tomorrow?city=Cuiab%C3%A1');
  });
  it('never silently guesses when the weather provider fails', async () => {
    request.mockResolvedValue(new Response(JSON.stringify({ detail: 'Serviço indisponível' }), { status: 503 }));
    await expect(getTomorrowForecast('Cuiabá')).rejects.toThrow('Serviço indisponível');
  });
  it('reports provider, forecast date and numeric values', () => {
    const answer = describeTomorrowForecast(forecast, 'pt-BR');
    expect(answer).toContain('12/10/2026');
    expect(answer).toContain('36,5 °C');
    expect(answer).toContain('24,2 °C');
    expect(answer).toContain('30%');
    expect(answer).toContain('Open-Meteo');
  });
});
