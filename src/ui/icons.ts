/** Ícones de manobra e faixas (SVG inline). */
import { maneuverAngle } from '../nav/osrm';

export function maneuverIcon(m: { type: string; modifier?: string }, size = 64): string {
  const a = maneuverAngle(m);
  const s = `width="${size}" height="${size}" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"`;
  if (a === 'arrive') return `<svg ${s}><path d="M18 58V8"/><path d="M18 10h30l-7 9 7 9H18" fill="currentColor" stroke-width="4"/></svg>`;
  if (a === 'uturn') return `<svg ${s}><path d="M42 58V26a12 12 0 0 0-24 0v8"/><path d="M8 26l10 10 10-10"/></svg>`;
  if (a === 'roundabout') {
    const ex = m.modifier?.includes('left') ? -90 : m.modifier?.includes('right') ? 90 : 0;
    return `<svg ${s}><circle cx="32" cy="34" r="11"/><g transform="rotate(${ex} 32 34)"><path d="M32 23V6"/><path d="M24 13l8-8 8 8"/></g><path d="M32 45v15"/></svg>`;
  }
  // seta: haste vem de baixo e dobra no ângulo da manobra
  const rad = (a * Math.PI) / 180;
  const ex = 32 + Math.sin(rad) * 22, ey = 30 - Math.cos(rad) * 22;
  const hx1 = ex + Math.sin(rad - 2.5) * 12, hy1 = ey - Math.cos(rad - 2.5) * 12;
  const hx2 = ex + Math.sin(rad + 2.5) * 12, hy2 = ey - Math.cos(rad + 2.5) * 12;
  return `<svg ${s}><path d="M32 60V30L${ex.toFixed(1)} ${ey.toFixed(1)}"/><path d="M${hx1.toFixed(1)} ${hy1.toFixed(1)}L${ex.toFixed(1)} ${ey.toFixed(1)}L${hx2.toFixed(1)} ${hy2.toFixed(1)}"/></svg>`;
}

const LANE_GLYPH: Record<string, string> = {
  left: '↰', 'slight left': '↖', 'sharp left': '↙', straight: '↑', 'slight right': '↗', right: '↱', 'sharp right': '↘', uturn: '↶', none: '↑',
};

export function lanesHtml(lanes?: { indications: string[]; valid: boolean }[]): string {
  if (!lanes?.length) return '';
  return lanes
    .map((l) => `<span class="lane ${l.valid ? 'ok' : ''}">${l.indications.map((i) => LANE_GLYPH[i] ?? '↑').join('')}</span>`)
    .join('');
}

export const carSvg = `<svg width="44" height="44" viewBox="0 0 44 44"><circle cx="22" cy="22" r="20" fill="rgba(250,204,21,.18)"/><path d="M22 6 L34 36 L22 29 L10 36 Z" fill="#facc15" stroke="#111" stroke-width="2.5" stroke-linejoin="round"/></svg>`;
