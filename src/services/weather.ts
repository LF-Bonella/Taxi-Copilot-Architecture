/** Clima atual via Open-Meteo (gratuito, sem chave). */
import type { LngLat } from '../engine/geo';

export interface Weather {
  precipitation: number; // mm na última hora
  temperature: number;
  code: number;
  rainLevel: 0 | 1 | 2;
  description: string;
  fetchedAt: number;
}

const RAIN_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99]);
const HEAVY_CODES = new Set([63, 65, 67, 81, 82, 95, 96, 99]);

export function rainLevelFrom(precip: number, code: number): 0 | 1 | 2 {
  if (precip >= 2 || HEAVY_CODES.has(code)) return 2;
  if (precip >= 0.2 || RAIN_CODES.has(code)) return 1;
  return 0;
}

function describe(code: number): string {
  if (code === 0) return 'Céu limpo';
  if (code <= 3) return 'Parcialmente nublado';
  if (code === 45 || code === 48) return 'Neblina';
  if (code >= 51 && code <= 57) return 'Garoa';
  if (code >= 61 && code <= 67) return 'Chuva';
  if (code >= 80 && code <= 82) return 'Pancadas de chuva';
  if (code >= 95) return 'Tempestade';
  return 'Nublado';
}

export async function fetchWeather(p: LngLat): Promise<Weather> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${p[1].toFixed(3)}&longitude=${p[0].toFixed(3)}&current=precipitation,temperature_2m,weather_code&timezone=America%2FSao_Paulo`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const d = await res.json();
  const precipitation = d.current?.precipitation ?? 0;
  const code = d.current?.weather_code ?? 0;
  return {
    precipitation,
    temperature: d.current?.temperature_2m ?? NaN,
    code,
    rainLevel: rainLevelFrom(precipitation, code),
    description: describe(code),
    fetchedAt: Date.now(),
  };
}
