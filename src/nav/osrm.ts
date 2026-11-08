/** Roteamento OSRM (OpenStreetMap) + instruções curva-a-curva em pt-BR. */
import { cumulativeDistances, type LngLat } from '../engine/geo';

export interface Lane { indications: string[]; valid: boolean }

export interface RouteStep {
  distance: number;
  duration: number;
  name: string;
  ref?: string;
  destinations?: string;
  rotaryName?: string;
  maneuver: { type: string; modifier?: string; location: LngLat; exit?: number; bearingAfter: number };
  lanes?: Lane[];
  /** índice no geometry da rota onde este passo começa */
  startIndex: number;
  /** distância acumulada (m) do início da rota até o início deste passo */
  startDist: number;
  /** índice da perna (leg) — útil para rotas com vários pontos de parada */
  leg: number;
  instruction: string;
}

export interface Route {
  distance: number;
  duration: number;
  geometry: LngLat[];
  cum: number[];
  steps: RouteStep[];
  /** distância acumulada no fim de cada perna */
  legEnds: number[];
  waypoints: LngLat[];
}

export const DEFAULT_OSRM = 'https://router.project-osrm.org';

/* ---------------- Instruções em português ---------------- */

const MOD: Record<string, string> = {
  left: 'à esquerda',
  right: 'à direita',
  'slight left': 'levemente à esquerda',
  'slight right': 'levemente à direita',
  'sharp left': 'acentuadamente à esquerda',
  'sharp right': 'acentuadamente à direita',
  straight: 'em frente',
  uturn: 'o retorno',
};

const MASC = /^(viaduto|túnel|tunel|elevado|largo|boulevard|acesso|mergulhão|aterro|corredor|anel|trevo|arco|parque|caminho|beco|trecho|eixo)\b/i;

/** "na Rua X" / "no Viaduto Y" */
export function onStreet(name: string): string {
  if (!name) return '';
  return `${MASC.test(name) ? 'no' : 'na'} ${name}`;
}

function streetOf(s: { name: string; ref?: string }): string {
  return s.name || s.ref || '';
}

const ORD = ['', 'primeira', 'segunda', 'terceira', 'quarta', 'quinta', 'sexta', 'sétima', 'oitava'];

export function buildInstruction(step: Pick<RouteStep, 'maneuver' | 'name' | 'ref' | 'destinations' | 'rotaryName'>, isLastLeg = true): string {
  const { type, modifier, exit } = step.maneuver;
  const street = streetOf(step);
  const on = street ? ` ${onStreet(street)}` : '';
  const mod = modifier ? MOD[modifier] ?? '' : '';
  const toward = step.destinations ? ` sentido ${step.destinations.split(',')[0]}` : '';

  switch (type) {
    case 'depart':
      return street ? `Siga ${onStreet(street)}` : 'Siga em frente';
    case 'arrive': {
      const side = modifier === 'left' ? ' à esquerda' : modifier === 'right' ? ' à direita' : '';
      return isLastLeg ? `Você chegou ao destino${side}` : `Ponto de passagem alcançado${side}`;
    }
    case 'turn':
    case 'end of road': {
      if (modifier === 'uturn') return `Faça o retorno${on}`;
      if (modifier === 'straight') return `Siga em frente${on}`;
      const prefix = type === 'end of road' ? 'No fim da via, vire' : 'Vire';
      return `${prefix} ${mod}${on}`;
    }
    case 'new name':
      return street ? `Continue ${onStreet(street)}` : 'Continue em frente';
    case 'continue':
      if (modifier === 'uturn') return `Faça o retorno${on}`;
      if (!modifier || modifier === 'straight') return street ? `Continue ${onStreet(street)}` : 'Continue em frente';
      return `Mantenha-se ${mod}${on}`;
    case 'merge':
      return `Entre ${mod ? mod + ' ' : ''}${street ? onStreet(street) : 'na via'}`.replace(/\s+/g, ' ').trim();
    case 'on ramp':
      return `Pegue o acesso ${mod}${street ? ' para ' + street : ''}${toward}`.trim();
    case 'off ramp':
      return `Pegue a saída ${mod}${toward || (street ? ' para ' + street : '')}`.trim();
    case 'fork':
      return `Na bifurcação, mantenha-se ${mod || 'em frente'}${toward || on}`;
    case 'roundabout':
    case 'rotary': {
      const ord = exit && exit < ORD.length ? ORD[exit] : exit ? `${exit}ª` : '';
      const rot = step.rotaryName ? ` (${step.rotaryName})` : '';
      return ord ? `Na rotatória${rot}, pegue a ${ord} saída${on}` : `Entre na rotatória${rot}`;
    }
    case 'roundabout turn':
      return `Na rotatória, vire ${mod}${on}`;
    case 'exit roundabout':
    case 'exit rotary':
      return `Saia da rotatória${on}`;
    case 'use lane':
      return `Use a faixa ${mod || 'indicada'}${on}`;
    default:
      return street ? `Continue ${onStreet(street)}` : 'Continue em frente';
  }
}

/** Ângulo da seta para o ícone de manobra. */
export function maneuverAngle(m: { type: string; modifier?: string }): number | 'uturn' | 'arrive' | 'roundabout' {
  if (m.type === 'arrive') return 'arrive';
  if (m.type === 'roundabout' || m.type === 'rotary' || m.type === 'roundabout turn') return 'roundabout';
  switch (m.modifier) {
    case 'uturn': return 'uturn';
    case 'sharp right': return 135;
    case 'right': return 90;
    case 'slight right': return 45;
    case 'slight left': return -45;
    case 'left': return -90;
    case 'sharp left': return -135;
    default: return 0;
  }
}

/* ---------------- Requisição ---------------- */

export class RoutingError extends Error {}

export async function fetchRoutes(
  points: LngLat[],
  opts: { base?: string; alternatives?: boolean; signal?: AbortSignal; bearing?: number | null } = {},
): Promise<Route[]> {
  if (points.length < 2) throw new RoutingError('São necessários ao menos 2 pontos');
  const base = (opts.base || DEFAULT_OSRM).replace(/\/$/, '');
  const coords = points.map((p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`).join(';');
  const params = new URLSearchParams({
    overview: 'false',
    geometries: 'geojson',
    steps: 'true',
    alternatives: opts.alternatives && points.length === 2 ? '3' : 'false',
    continue_straight: 'default',
  });
  // Respeita o sentido atual do carro na largada (evita mandar fazer retorno à toa).
  if (opts.bearing != null && Number.isFinite(opts.bearing)) {
    params.set('bearings', [`${Math.round(opts.bearing)},60`, ...points.slice(1).map(() => '')].join(';'));
  }
  const res = await fetch(`${base}/route/v1/driving/${coords}?${params}`, { signal: opts.signal });
  if (!res.ok) throw new RoutingError(`Servidor de rotas respondeu ${res.status}`);
  const data = await res.json();
  if (data.code !== 'Ok' || !data.routes?.length) throw new RoutingError(data.message || 'Nenhuma rota encontrada');
  return data.routes.map((r: any) => parseRoute(r, points));
}

export function parseRoute(r: any, waypoints: LngLat[]): Route {
  const geometry: LngLat[] = [];
  const steps: RouteStep[] = [];
  const legCount = r.legs.length;

  r.legs.forEach((leg: any, li: number) => {
    leg.steps.forEach((s: any) => {
      const coords: LngLat[] = s.geometry.coordinates;
      const startIndex = Math.max(0, geometry.length - (geometry.length ? 1 : 0));
      // concatena sem duplicar o ponto de junção
      coords.forEach((c, i) => {
        if (i === 0 && geometry.length) {
          const last = geometry[geometry.length - 1];
          if (last[0] === c[0] && last[1] === c[1]) return;
        }
        geometry.push(c);
      });
      const inter = s.intersections?.[0];
      const step: RouteStep = {
        distance: s.distance,
        duration: s.duration,
        name: s.name ?? '',
        ref: s.ref,
        destinations: s.destinations,
        rotaryName: s.rotary_name,
        maneuver: {
          type: s.maneuver.type,
          modifier: s.maneuver.modifier,
          location: s.maneuver.location,
          exit: s.maneuver.exit,
          bearingAfter: s.maneuver.bearing_after,
        },
        lanes: inter?.lanes?.length > 1 ? inter.lanes : undefined,
        startIndex,
        startDist: 0,
        leg: li,
        instruction: '',
      };
      step.instruction = buildInstruction(step, li === legCount - 1);
      steps.push(step);
    });
  });

  const cum = cumulativeDistances(geometry);
  for (const s of steps) s.startDist = cum[Math.min(s.startIndex, cum.length - 1)];
  // fim de cada perna = início do passo "arrive" da perna
  const legEnds = r.legs.map((_: any, li: number) => {
    const arrive = steps.filter((s) => s.leg === li).pop();
    return arrive ? arrive.startDist : cum[cum.length - 1];
  });

  // `lanes` de cada passo descrevem as faixas na interseção da própria manobra (exibir no banner da próxima manobra).
  return { distance: r.distance, duration: r.duration, geometry, cum, steps, legEnds, waypoints };
}
