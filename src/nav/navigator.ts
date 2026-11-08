/**
 * Sessão de navegação: acompanha o progresso do GPS na rota, gera avisos de voz
 * no tempo certo, detecta saída da rota (para recalcular) e chegada.
 */
import { angleDiff, bearing, haversine, snapToLine, spokenDistance, type LngLat, type Snap } from '../engine/geo';
import type { Route, RouteStep } from './osrm';

export type NavKind = 'destino' | 'pesca' | 'evento' | 'fuga' | 'corrida';

export interface NavUpdate {
  snap: Snap;
  stepIndex: number;
  step: RouteStep;
  next?: RouteStep;
  /** passo depois do próximo (para "e depois...") */
  then?: RouteStep;
  distToManeuver: number;
  remainingDist: number;
  remainingTime: number;
  legIndex: number;
  offRoute: boolean;
  arrived: boolean;
  /** frases para falar agora (já deduplicadas) */
  cues: string[];
}

export interface NavOptions {
  /** distância perpendicular (m) a partir da qual consideramos fora da rota */
  offRouteMeters?: number;
  /** quantas leituras consecutivas fora da rota antes de recalcular */
  offRouteFixes?: number;
  arriveMeters?: number;
}

export class NavSession {
  readonly route: Route;
  readonly kind: NavKind;
  readonly label: string;
  readonly destination: LngLat;
  private hint = 0;
  private offCount = 0;
  private spoken = new Set<string>();
  private lastStepIndex = -1;
  private opts: Required<NavOptions>;
  private maxAlong = 0;

  constructor(route: Route, kind: NavKind, label: string, opts: NavOptions = {}) {
    this.route = route;
    this.kind = kind;
    this.label = label;
    this.destination = route.geometry[route.geometry.length - 1];
    this.opts = { offRouteMeters: 45, offRouteFixes: 3, arriveMeters: 30, ...opts };
  }

  /** Índice do passo cuja manobra ainda está à frente. */
  private stepAt(distAlong: number): number {
    const steps = this.route.steps;
    let i = 0;
    for (let k = 0; k < steps.length; k++) {
      if (steps[k].startDist <= distAlong + 1) i = k; else break;
    }
    return i;
  }

  private once(key: string, text: string, out: string[]) {
    if (this.spoken.has(key)) return;
    this.spoken.add(key);
    out.push(text);
  }

  update(pos: LngLat, speedMps: number, accuracy = 10, heading: number | null = null): NavUpdate {
    const r = this.route;
    const snap = snapToLine(r.geometry, r.cum, pos, this.hint);
    this.hint = snap.index;

    // Fora da rota: longe da linha OU andando na contramão da rota por várias leituras.
    const threshold = Math.max(this.opts.offRouteMeters, Math.min(accuracy * 1.5, 120));
    let wrongWay = false;
    if (heading != null && speedMps > 3 && snap.index < r.geometry.length - 1) {
      const segBearing = bearing(r.geometry[snap.index], r.geometry[snap.index + 1]);
      wrongWay = angleDiff(heading, segBearing) > 135;
    }
    if (snap.distFromLine > threshold || wrongWay) this.offCount++; else this.offCount = 0;
    const offRoute = this.offCount >= this.opts.offRouteFixes;

    const along = Math.max(snap.distAlong, Math.min(this.maxAlong, snap.distAlong + 30));
    this.maxAlong = Math.max(this.maxAlong, along);

    const stepIndex = this.stepAt(along);
    const step = r.steps[stepIndex];
    const next = r.steps[stepIndex + 1];
    const then = r.steps[stepIndex + 2];
    const total = r.cum[r.cum.length - 1];
    const distToManeuver = next ? Math.max(0, next.startDist - along) : Math.max(0, total - along);
    const remainingDist = Math.max(0, total - along);

    // tempo restante: fração do passo atual + passos seguintes
    let remainingTime = 0;
    if (step) {
      const stepLen = Math.max(1, (next ? next.startDist : total) - step.startDist);
      remainingTime += step.duration * Math.min(1, distToManeuver / stepLen);
      for (let k = stepIndex + 1; k < r.steps.length; k++) remainingTime += r.steps[k].duration;
    }

    let legIndex = r.legEnds.findIndex((end) => along < end - 5);
    if (legIndex < 0) legIndex = r.legEnds.length - 1;

    const arrived = haversine(pos, this.destination) < this.opts.arriveMeters || (remainingDist < this.opts.arriveMeters && !offRoute);

    const cues: string[] = [];
    if (!offRoute && !arrived) {
      if (stepIndex !== this.lastStepIndex) {
        this.lastStepIndex = stepIndex;
        if (stepIndex === 0) this.once('depart', `${step.instruction}.`, cues);
        else if (distToManeuver > 2500 && next) this.once(`long-${stepIndex}`, `Siga por ${spokenDistance(distToManeuver)}.`, cues);
      }
      if (next) {
        const v = Math.max(speedMps, 8); // ~30 km/h mínimo para calcular antecedência
        const farAt = Math.max(500, v * 30);
        const nearAt = Math.max(150, v * 12);
        const nowAt = Math.max(35, v * 4);
        const thenTxt = then && then.startDist - next.startDist < 120 ? `, e logo depois, ${lowerFirst(then.instruction)}` : '';
        if (distToManeuver <= farAt && distToManeuver > nearAt * 1.5 && next.startDist - step.startDist > farAt) {
          this.once(`far-${stepIndex}`, `Em ${spokenDistance(distToManeuver)}, ${lowerFirst(next.instruction)}.`, cues);
        } else if (distToManeuver <= nearAt && distToManeuver > nowAt * 1.5) {
          this.once(`near-${stepIndex}`, `Em ${spokenDistance(distToManeuver)}, ${lowerFirst(next.instruction)}${thenTxt}.`, cues);
        } else if (distToManeuver <= nowAt) {
          this.once(`now-${stepIndex}`, `${next.instruction}${thenTxt}.`, cues);
        }
      }
    }
    if (arrived) this.once('arrive', this.kind === 'corrida' ? 'Destino do passageiro alcançado.' : 'Você chegou ao destino.', cues);

    return { snap, stepIndex, step, next, then, distToManeuver, remainingDist, remainingTime, legIndex, offRoute, arrived, cues };
  }

  /** Pontos de passagem que ainda faltam (para recalcular sem perder o circuito). */
  remainingWaypoints(legIndex: number): LngLat[] {
    return this.route.waypoints.slice(legIndex + 1);
  }

  resetOffRoute() {
    this.offCount = 0;
  }
}

function lowerFirst(s: string): string {
  return s ? s[0].toLowerCase() + s.slice(1) : s;
}
