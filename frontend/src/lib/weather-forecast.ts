import { apiFetch } from './api';
import type { AppLanguage } from './i18n';

export interface TomorrowForecast {
  provider: string;
  source_url: string;
  location: { name: string; region?: string | null; country?: string | null; timezone: string };
  date: string;
  temperature_max_c: number | null;
  temperature_min_c: number | null;
  precipitation_probability_percent: number | null;
  weather_code: number | null;
  description_pt: string;
  retrieved_at: string;
}

const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Strict routing for tomorrow's forecast; other questions remain with the chosen AI. */
export function getTomorrowWeatherCity(question: string): string | null {
  const normal = normalize(question);
  if (!/\b(amanha|tomorrow)\b/i.test(normal)) return null;
  if (!/\b(temperatura|previsao|clima|tempo|weather|forecast)\b/i.test(normal)) return null;

  // Examples: 'temperatura em Cuiabá amanhã', 'previsão amanhã em Cuiabá'.
  const match = question.match(/\b(?:em|in)\s+([\p{L}\p{M} .'-]{2,80}?)(?=\s+amanh[ãa]|\s+tomorrow|[?!.,]|$)/iu);
  if (!match) return null;
  const city = match[1].trim().replace(/\s+/g, ' ');
  if (!city || city.length > 80) return null;
  return city;
}

export async function getTomorrowForecast(city: string, signal?: AbortSignal): Promise<TomorrowForecast> {
  const response = await apiFetch(`/v1/weather/tomorrow?city=${encodeURIComponent(city)}`, { signal });
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const json = await response.json();
      if (typeof json.detail === 'string') message = json.detail;
    } catch { /* keep status */ }
    throw new Error(message);
  }
  return response.json() as Promise<TomorrowForecast>;
}

const formatNumber = (value: number | null, locale: string, digits = 1) =>
  value === null ? null : new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0, maximumFractionDigits: digits,
  }).format(value);

export function describeTomorrowForecast(forecast: TomorrowForecast, language: AppLanguage): string {
  const pt = language === 'pt-BR';
  const place = [forecast.location.name, forecast.location.region].filter(Boolean).join(', ');
  const date = forecast.date.split('-').reverse().join('/');
  const high = formatNumber(forecast.temperature_max_c, pt ? 'pt-BR' : 'en-US');
  const low = formatNumber(forecast.temperature_min_c, pt ? 'pt-BR' : 'en-US');
  const rain = formatNumber(forecast.precipitation_probability_percent, pt ? 'pt-BR' : 'en-US', 0);
  const temp = [
    high === null ? null : (pt ? `máxima de ${high} °C` : `high ${high} °C`),
    low === null ? null : (pt ? `mínima de ${low} °C` : `low ${low} °C`),
  ].filter(Boolean).join(pt ? ' e ' : ' and ');
  const precip = rain === null ? '' : (pt ? ` Probabilidade máxima de chuva: ${rain}%.` : ` Maximum precipitation probability: ${rain}%.`);
  if (pt) return `Previsão para amanhã, ${date}, em ${place}: ${temp || 'temperaturas indisponíveis'}. Condição prevista: ${forecast.description_pt}.${precip} Fonte: ${forecast.provider} (consulta em tempo real, horário local de ${forecast.location.timezone}).`;
  return `Tomorrow's forecast for ${place} (${date}): ${temp || 'temperature unavailable'}. Weather: ${forecast.description_pt}.${precip} Source: ${forecast.provider}; location time zone: ${forecast.location.timezone}.`;
}
