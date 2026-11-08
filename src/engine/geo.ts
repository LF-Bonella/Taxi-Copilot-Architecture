/** Utilitários geométricos (sem dependências). Coordenadas sempre em [lng, lat]. */
export type LngLat = [number, number];

const R = 6371000;
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

export function haversine(a: LngLat, b: LngLat): number {
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Rumo inicial de a -> b, em graus [0, 360). */
export function bearing(a: LngLat, b: LngLat): number {
  const φ1 = toRad(a[1]);
  const φ2 = toRad(b[1]);
  const Δλ = toRad(b[0] - a[0]);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function destination(p: LngLat, bearingDeg: number, distM: number): LngLat {
  const δ = distM / R;
  const θ = toRad(bearingDeg);
  const φ1 = toRad(p[1]);
  const λ1 = toRad(p[0]);
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 =
    λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return [toDeg(λ2), toDeg(φ2)];
}

/** Diferença angular mínima entre dois rumos (0..180). */
export function angleDiff(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360) + 360) % 360;
  return d > 180 ? 360 - d : d;
}

export function cumulativeDistances(line: LngLat[]): number[] {
  const cum = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + haversine(line[i - 1], line[i]));
  return cum;
}

export interface Snap {
  /** índice do início do segmento */
  index: number;
  /** fração (0..1) dentro do segmento */
  t: number;
  point: LngLat;
  /** distância perpendicular (m) do ponto à linha */
  distFromLine: number;
  /** distância percorrida ao longo da linha (m) até o ponto projetado */
  distAlong: number;
}

/** Projeta p no segmento a-b usando aproximação equirretangular local (precisa em escala urbana). */
function projectOnSegment(p: LngLat, a: LngLat, b: LngLat) {
  const k = Math.cos(toRad(p[1]));
  const ax = (a[0] - p[0]) * k, ay = a[1] - p[1];
  const bx = (b[0] - p[0]) * k, by = b[1] - p[1];
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : -(ax * dx + ay * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const point: LngLat = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  return { t, point, dist: haversine(p, point) };
}

/**
 * Encaixa p na polilinha. Se `hint` for informado, procura primeiro numa janela à frente
 * (evita "pular" para trechos paralelos/anteriores da rota, comum em laços de pesca).
 */
export function snapToLine(line: LngLat[], cum: number[], p: LngLat, hint?: number): Snap {
  const search = (from: number, to: number): Snap => {
    let best: Snap = { index: 0, t: 0, point: line[0], distFromLine: Infinity, distAlong: 0 };
    for (let i = Math.max(0, from); i < Math.min(line.length - 1, to); i++) {
      const r = projectOnSegment(p, line[i], line[i + 1]);
      if (r.dist < best.distFromLine) {
        best = { index: i, t: r.t, point: r.point, distFromLine: r.dist, distAlong: cum[i] + (cum[i + 1] - cum[i]) * r.t };
      }
    }
    return best;
  };
  if (line.length < 2) {
    return { index: 0, t: 0, point: line[0], distFromLine: line[0] ? haversine(p, line[0]) : Infinity, distAlong: 0 };
  }
  if (hint !== undefined) {
    const local = search(hint - 3, hint + 250);
    if (local.distFromLine < 60) return local;
  }
  return search(0, line.length);
}

/** Ponto e rumo a uma distância `d` ao longo da linha. */
export function pointAlong(line: LngLat[], cum: number[], d: number): { point: LngLat; bearing: number; index: number } {
  if (d <= 0) return { point: line[0], bearing: bearing(line[0], line[1] ?? line[0]), index: 0 };
  const total = cum[cum.length - 1];
  if (d >= total) {
    const n = line.length;
    return { point: line[n - 1], bearing: bearing(line[Math.max(0, n - 2)], line[n - 1]), index: n - 2 };
  }
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= d) lo = mid; else hi = mid;
  }
  const seg = cum[hi] - cum[lo];
  const t = seg === 0 ? 0 : (d - cum[lo]) / seg;
  const a = line[lo], b = line[hi];
  return { point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], bearing: bearing(a, b), index: lo };
}

export function formatDistance(m: number): string {
  if (m >= 10000) return `${Math.round(m / 1000)} km`;
  if (m >= 1000) return `${(m / 1000).toFixed(1).replace('.', ',')} km`;
  if (m >= 100) return `${Math.round(m / 50) * 50} m`;
  return `${Math.max(0, Math.round(m / 10) * 10)} m`;
}

/** Distância falada, arredondada como um copiloto humano falaria. */
export function spokenDistance(m: number): string {
  if (m >= 1000) {
    const km = Math.round(m / 100) / 10;
    return km === 1 ? '1 quilômetro' : `${String(km).replace('.', ',')} quilômetros`;
  }
  return `${Math.round(m / 50) * 50 || 50} metros`;
}

export function formatDuration(sec: number): string {
  const min = Math.round(sec / 60);
  if (min < 60) return `${Math.max(1, min)} min`;
  const h = Math.floor(min / 60);
  return `${h} h ${String(min % 60).padStart(2, '0')}`;
}

/** Gera anel de coordenadas de um polígono circular para geofencing e visualização. */
export function circlePolygon(center: LngLat, radiusM: number, points = 24): LngLat[] {
  const ring: LngLat[] = [];
  const step = 360 / points;
  for (let i = 0; i < points; i++) {
    ring.push(destination(center, i * step, radiusM));
  }
  ring.push(ring[0]); // Fecha o anel
  return ring;
}
