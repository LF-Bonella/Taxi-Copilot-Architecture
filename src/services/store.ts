/**
 * Persistência local (localStorage + fallback em memória para testes Node/Vitest)
 * isolada para a edição Showcase (Portfólio).
 * Utiliza o namespace `taxi_showcase:` para nunca colidir com dados operacionais reais.
 */
const memoryStore = new Map<string, string>();

function hasBrowserStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function';
  } catch {
    return false;
  }
}

export function load<T>(key: string, fallback: T): T {
  const fullKey = `taxi_showcase:${key}`;
  try {
    const raw = hasBrowserStorage()
      ? localStorage.getItem(fullKey)
      : (memoryStore.get(fullKey) ?? null);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function save<T>(key: string, value: T) {
  const fullKey = `taxi_showcase:${key}`;
  try {
    const serialized = JSON.stringify(value);
    if (hasBrowserStorage()) {
      localStorage.setItem(fullKey, serialized);
    } else {
      memoryStore.set(fullKey, serialized);
    }
  } catch {
    /* cota cheia */
  }
}

export interface Settings {
  osrmBase: string;
  voice: boolean;
  theme: 'dark' | 'light';
  /** Parâmetros de estimativa tarifária de referência (Rio de Janeiro). */
  tariff: { flag: number; perKm: number; perHourStopped: number };
  /** 'auto' usa Open-Meteo; 'on'/'off' força (laboratório). */
  rainOverride: 'auto' | 'on' | 'off';
  /** deslocamento do relógio em minutos (laboratório: testar turnos) */
  clockOffsetMin: number;
}

export const DEFAULT_SETTINGS: Settings = {
  osrmBase: 'https://router.project-osrm.org',
  voice: true,
  theme: 'dark',
  tariff: { flag: 5.8, perKm: 2.8, perHourStopped: 33 },
  rainOverride: 'auto',
  clockOffsetMin: 0,
};
