/** Busca de endereços (Photon/Komoot, OSM, sem chave) e endereço reverso (Nominatim). */
import type { LngLat } from '../engine/geo';

export interface Place { label: string; detail: string; pos: LngLat }

// Região metropolitana do Rio (inclui Niterói)
const RIO_BBOX = '-43.80,-23.10,-42.95,-22.70';

export async function searchPlaces(q: string, near: LngLat, signal?: AbortSignal): Promise<Place[]> {
  const params = new URLSearchParams({ q, lat: String(near[1]), lon: String(near[0]), limit: '7', bbox: RIO_BBOX });
  const res = await fetch(`https://photon.komoot.io/api/?${params}`, { signal });
  if (!res.ok) throw new Error(`Busca falhou (${res.status})`);
  const data = await res.json();
  return (data.features ?? []).map((f: any) => {
    const p = f.properties ?? {};
    const street = [p.street, p.housenumber].filter(Boolean).join(', ');
    const label = p.name || street || p.district || p.city || 'Local';
    const detail = [p.name && street ? street : '', p.district || p.locality, p.city].filter(Boolean).join(' · ');
    return { label, detail, pos: f.geometry.coordinates as LngLat };
  });
}

let lastReverse = 0;
export async function reverseGeocode(p: LngLat): Promise<string> {
  // Política do Nominatim: no máximo 1 req/s.
  const wait = 1100 - (Date.now() - lastReverse);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastReverse = Date.now();
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&lat=${p[1]}&lon=${p[0]}&accept-language=pt-BR`);
    if (!res.ok) throw new Error();
    const d = await res.json();
    const a = d.address ?? {};
    return [a.road, a.suburb || a.neighbourhood].filter(Boolean).join(', ') || d.name || 'Local sem nome';
  } catch {
    return `${p[1].toFixed(4)}, ${p[0].toFixed(4)}`;
  }
}
