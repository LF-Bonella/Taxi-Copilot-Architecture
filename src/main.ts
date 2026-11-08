import './styles.css';
import { formatDistance, formatDuration, haversine, type LngLat } from './engine/geo';
import {
  RIO_CENTER,
  RIO_ZONES,
  SHIFTS,
  behaviorCommand,
  deadZoneCheck,
  eventZones,
  getShift,
  rankZones,
  zoneColor,
  type ScoredZone,
} from './engine/veteranBrain';
import {
  getCalendarDayInfo,
  getSeasonalExpectedEvents,
  getHolidaysForYear,
} from './engine/calendarEngine';
import {
  RIO_VENUES,
  hhmm,
  parseFlyer,
} from './engine/eventDetector';
import {
  RIO_DANGER_ZONES,
  evaluateRouteSafety,
  checkCurrentPositionSafety,
} from './engine/safetyZones';
import {
  calculateRemainingAutonomy,
  DEFAULT_GNV_STATE,
  evaluateRouteGnv,
  findNearestGnvStations,
  recordRefuel,
  RIO_GNV_STATIONS,
  updateGnvOdometer,
  type GnvDots,
  type GnvState,
} from './engine/gnvTracker';
import { REPORT_META, type Opportunity, type ReportType, type TrafficReport, type TripRecord } from './engine/types';
import { fetchRoutes, type Route } from './nav/osrm';
import { NavSession, type NavKind } from './nav/navigator';
import { reverseGeocode, searchPlaces, type Place } from './services/geocode';
import { fetchWeather, type Weather } from './services/weather';
import { Voice } from './services/voice';
import { LocationProvider, type Fix } from './services/location';
import { DEFAULT_SETTINGS, load, save, type Settings } from './services/store';
import {
  CloudSyncService,
  type DispatcherMessage,
  type DriverTelemetry,
} from './services/cloudSync';
import { CentralDashboard } from './ui/centralDashboard';
import { lanesHtml, maneuverIcon } from './ui/icons';
import { MapView } from './ui/mapView';

/* ---------------- Estado global ---------------- */

const settings: Settings = { ...DEFAULT_SETTINGS, ...load<Partial<Settings>>('settings', {}) };
let manualEvents: Opportunity[] = load<Opportunity[]>('manual_events', []);
let cloudEvents: Opportunity[] = [];
let events: Opportunity[] = [];
let telemetryList: DriverTelemetry[] = [];
let centralPickedPoint: { pos: LngLat; street: string } | null = null;
let lastTelemetryPushMs = 0;
const cloud = new CloudSyncService();
let centralDashboard: CentralDashboard | null = null;

function refreshEventPool() {
  const seasonal = getSeasonalExpectedEvents(nowDate());
  const nowMs = nowDate().getTime();
  manualEvents = manualEvents.filter((e) => e.estimatedEnd > nowMs - 4 * 3600000);
  const activeCloud = cloudEvents.filter((e) => e.estimatedEnd > nowMs - 4 * 3600000);

  const ids = new Set<string>();
  const merged: Opportunity[] = [];
  for (const e of [...activeCloud, ...manualEvents, ...seasonal]) {
    if (!ids.has(e.id)) {
      ids.add(e.id);
      merged.push(e);
    }
  }
  events = merged;
}
refreshEventPool();

let reports: TrafficReport[] = load<TrafficReport[]>('reports', []).filter((r) => r.expiresAt > Date.now());
let trips: TripRecord[] = load<TripRecord[]>('trips', []);
let gnvState: GnvState = load<GnvState>('gnv_state', DEFAULT_GNV_STATE);
let lastPosRecorded: LngLat | null = null;

let weather: Weather | null = null;
const voice = new Voice();
voice.enabled = settings.voice;
const speechLog: string[] = [];
voice.onSpeak = (txt) => {
  speechLog.unshift(`[${new Date().toLocaleTimeString('pt-BR')}] ${txt}`);
  if (speechLog.length > 40) speechLog.pop();
  if (activeTab === 'lab') renderDrawer();
};

const loc = new LocationProvider(RIO_CENTER);
const mapView = new MapView('map', RIO_CENTER);

let nav: NavSession | null = null;
let previewState: {
  routes: Route[];
  selected: number;
  kind: NavKind;
  label: string;
  dest: LngLat;
} | null = null;
let rerouting = false;
let lastCommandText = '';
let activeTab: 'map' | 'radar' | 'ganhos' | 'lab' = 'map';
let deadAlertDismissedUntil = 0;
const announcedEvents = new Set<string>();
const warnedHazards = new Set<string>();

// Taxímetro e odômetro vazio
let activeTrip: {
  start: number;
  distanceM: number;
  stoppedSec: number;
  lastFixTs: number;
  lastPos: LngLat;
  pickupZone: string;
} | null = null;
let emptyMetersSinceLastTrip = 0;
let lastEmptyPos: LngLat | null = null;

/* ---------------- Helpers de tempo e clima ---------------- */

function nowDate(): Date {
  return new Date(Date.now() + settings.clockOffsetMin * 60000);
}

function effectiveRainLevel(): 0 | 1 | 2 {
  if (settings.rainOverride === 'on') return 2;
  if (settings.rainOverride === 'off') return 0;
  return weather?.rainLevel ?? 0;
}

function driverPos(): LngLat {
  return loc.last?.pos ?? RIO_CENTER;
}

function scoreCtx(driver: LngLat = driverPos()) {
  const now = nowDate();
  reports = reports.filter((r) => r.expiresAt > Date.now());
  return {
    now,
    rainLevel: effectiveRainLevel(),
    driver,
    events,
    reports,
  };
}

function allScoredZones(driver: LngLat = driverPos()): ScoredZone[] {
  const ctx = scoreCtx(driver);
  return [...rankZones(ctx), ...eventZones(ctx)].sort((a, b) => b.score - a.score);
}

/* ---------------- Elementos DOM ---------------- */

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function toast(msg: string) {
  const d = document.createElement('div');
  d.textContent = msg;
  $('toast').appendChild(d);
  setTimeout(() => d.remove(), 3300);
}

function setCommand(text: string, mode: 'normal' | 'rain' | 'alert' = 'normal') {
  lastCommandText = text;
  $('cmd-text').textContent = text;
  const box = $('command');
  box.classList.toggle('rain', mode === 'rain');
  box.classList.toggle('alert', mode === 'alert');
}

/* ---------------- Atualização de Mapa e Painéis ---------------- */

function refreshTacticalState() {
  const now = nowDate();
  refreshEventPool();
  const shift = getShift(now);
  const cal = getCalendarDayInfo(now);
  const rain = effectiveRainLevel();
  const compactTime = shift.timeRange.replace(/00/g, '').replace(/\s+/g, '');
  $('shift-badge').textContent = `🕒 ${compactTime}`;
  $('shift-badge').title = `${shift.timeRange} · ${shift.title}`;
  $('clock').textContent = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  // Chip de Calendário Civil & Sazonalidade
  const calChip = $('calendar-chip');
  calChip.className = '';
  if (cal.holidayToday) {
    calChip.textContent = `🎉 Feriado: ${cal.holidayToday.name}`;
    calChip.classList.add('holiday');
  } else if (cal.classification === 'HOLIDAY_EVE') {
    calChip.textContent = `🧳 Véspera: ${cal.holidayTomorrow?.name ?? 'Feriadão'}`;
    calChip.classList.add('eve');
  } else if (cal.isEnemSunday) {
    calChip.textContent = `🎓 Domingo de ENEM`;
    calChip.classList.add('enem');
  } else {
    calChip.textContent = `📅 ${cal.isSunday ? 'Domingo' : cal.isSaturday ? 'Sábado' : 'Dia útil'}`;
  }
  calChip.title = `${cal.tacticalSummary} · Shoppings fecham às ${cal.shoppingClosingHour}h`;

  const wChip = $('weather-chip');
  if (rain > 0) {
    wChip.textContent = `🌧️ Modo Chuva (×${rain === 2 ? '2,5' : '1,6'})`;
  } else if (weather) {
    wChip.textContent = `☀️ ${Math.round(weather.temperature)}°C`;
  } else {
    wChip.textContent = '☀️ Seco';
  }

  const scored = allScoredZones();
  mapView.setZones(scored);
  mapView.setDangerZones(RIO_DANGER_ZONES);
  mapView.setGasStations(RIO_GNV_STATIONS, (s) => showGnvManagerModal(s.id));
  mapView.setReports(reports);
  mapView.setEvents(events, (ev) => showEventModal(ev));
  updateGnvChip();

  // Melhores zonas na barra rápida
  const topZones = scored.filter((z) => z.potential >= 4.5).slice(0, 5);
  $('best-zones').innerHTML = topZones
    .map(
      (z) => `
      <button data-zone="${z.zone.id}" style="border-left-color:${zoneColor(z.potential)}">
        <b>⭐ ${z.score.toFixed(1)} · ${z.zone.name}</b>
        <span>${formatDistance(z.parts.distKm * 1000)} · ${z.zone.speedKmh} km/h</span>
      </button>`,
    )
    .join('');

  $('best-zones')
    .querySelectorAll<HTMLButtonElement>('button[data-zone]')
    .forEach((btn) => {
      btn.onclick = () => {
        const z = scored.find((s) => s.zone.id === btn.dataset.zone);
        if (z) void previewRouteTo(z.zone.pos, z.zone.name, 'destino');
      };
    });

  if (!nav && !previewState) {
    const best = scored[0];
    const holidayPrefix = cal.classification === 'HOLIDAY' || cal.classification === 'HOLIDAY_EVE' || cal.isEnemSunday
      ? `[${cal.tacticalSummary}] `
      : '';
    const cmd = best
      ? `${holidayPrefix}Turno: ${shift.title}. ${shift.veteranDirective} Melhor polo agora: ${best.zone.name} (Score ${best.score.toFixed(1)}).`
      : `${shift.title}: ${shift.veteranDirective}`;
    setCommand(cmd, rain > 0 ? 'rain' : 'normal');
  }

  checkUpcomingEvents(now);
}

/* ---------------- Radar de Eventos & Convocação Automática ---------------- */

function checkUpcomingEvents(now: Date) {
  const pos = driverPos();
  for (const ev of events) {
    if (announcedEvents.has(ev.id)) continue;
    const minToEnd = (ev.estimatedEnd - now.getTime()) / 60000;
    const distKm = haversine(pos, ev.escape) / 1000;
    if (minToEnd > 5 && minToEnd <= 45 && distKm <= 12) {
      announcedEvents.add(ev.id);
      triggerEventConvocation(ev, Math.round(minToEnd));
      break;
    }
  }
}

function triggerEventConvocation(ev: Opportunity, minToEnd: number) {
  voice.beep('alert');
  const msg = `Convocação de evento! Fim de show em ${minToEnd} minutos em ${ev.venueName} com ${ev.expectedCrowd.toLocaleString('pt-BR')} pessoas. Posicionar na esquina de escape.`;
  voice.speak(msg, true);
  setCommand(ev.driverInstruction, 'alert');

  const ov = $('overlay');
  ov.classList.remove('hidden');
  ov.innerHTML = `
    <div class="alert-box call">
      <h2>🔔 CONVOCAÇÃO DE EVENTO</h2>
      <p><b>${ev.venueName}</b> termina em <b>${minToEnd} min</b> (~${ev.expectedCrowd.toLocaleString('pt-BR')} pessoas).</p>
      <p style="font-size:14px">${ev.driverInstruction}</p>
      <div class="row">
        <button id="ov-dismiss" class="big ghost">Ignorar</button>
        <button id="ov-go" class="big yellow">IR PARA ESQUINA DE ESCAPE ▶</button>
      </div>
    </div>
  `;
  $('ov-dismiss').onclick = () => ov.classList.add('hidden');
  $('ov-go').onclick = () => {
    ov.classList.add('hidden');
    void startNavigationTo([driverPos(), ev.escape], 'evento', `Escape: ${ev.venueName}`);
  };
}

function showEventModal(ev: Opportunity) {
  const ov = $('overlay');
  ov.classList.remove('hidden');
  ov.innerHTML = `
    <div class="alert-box call">
      <h2>🎤 ${ev.venueName}</h2>
      <p><b>Horário de Ouro: ${hhmm(ev.goldenArrival)}</b> · Fim: ${hhmm(ev.estimatedEnd)} · Público: ~${ev.expectedCrowd.toLocaleString('pt-BR')}</p>
      <p style="font-size:14px">${ev.driverInstruction}</p>
      <div class="row">
        <button id="ov-close" class="big ghost">Fechar</button>
        <button id="ov-cal" class="big ghost">📅 Agenda</button>
        <button id="ov-route" class="big yellow">Ir p/ Escape ▶</button>
      </div>
    </div>
  `;
  $('ov-close').onclick = () => ov.classList.add('hidden');
  $('ov-cal').onclick = () => window.open(googleCalendarUrl(ev), '_blank');
  $('ov-route').onclick = () => {
    ov.classList.add('hidden');
    void startNavigationTo([driverPos(), ev.escape], 'evento', `Escape: ${ev.venueName}`);
  };
}

function googleCalendarUrl(ev: Opportunity): string {
  const fmt = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `🚕 [POSICIONAR AGORA] ${ev.venueName} (${ev.expectedCrowd} pessoas)`,
    dates: `${fmt(ev.goldenArrival)}/${fmt(ev.estimatedEnd)}`,
    details: `🔥 SCORE: ${ev.demandScore}/100\n🧭 ${ev.driverInstruction}`,
    location: `${ev.escape[1]},${ev.escape[0]}`,
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

/* ---------------- Alerta de Zona Morta ---------------- */

function triggerDeadZoneAlert(verdict = deadZoneCheck(driverPos(), scoreCtx())) {
  const hot = verdict.nearestHot ?? allScoredZones()[0];
  voice.beep('danger');
  const msg = `Alerta de Zona Morta! Probabilidade de passageiro inferior a ${Math.max(5, verdict.chancePct)} por cento. Não rode devagar batendo lata. Siga rota expressa de fuga para ${hot?.zone.name ?? 'corredor comercial'}.`;
  voice.speak(msg, true);
  setCommand(msg, 'alert');

  const ov = $('overlay');
  ov.classList.remove('hidden');
  ov.innerHTML = `
    <div class="alert-box dead">
      <h2>⚠️ VOCÊ ESTÁ EM ZONA MORTA</h2>
      <p>Índice de retorno <b>${verdict.returnIndex.toFixed(2)}</b> (Chance de passageiro <b>&lt; ${Math.max(8, verdict.chancePct)}%</b>).</p>
      <p><b>NÃO RODE DEVAGAR AQUI.</b> Pise no acelerador e saia imediatamente para <b>${hot?.zone.name ?? 'o corredor mais próximo'}</b>.</p>
      <div class="row">
        <button id="dead-ignore" class="big ghost">Ignorar 5 min</button>
        <button id="dead-escape" class="big yellow">ROTA DE FUGA ▶</button>
      </div>
    </div>
  `;
  $('dead-ignore').onclick = () => {
    deadAlertDismissedUntil = Date.now() + 5 * 60000;
    ov.classList.add('hidden');
  };
  $('dead-escape').onclick = () => {
    deadAlertDismissedUntil = Date.now() + 5 * 60000;
    ov.classList.add('hidden');
    if (hot) void startNavigationTo([driverPos(), hot.zone.pos], 'fuga', `Fuga → ${hot.zone.name}`);
  };
}

/* ---------------- Rotas, Pesca e Navegação Turn-by-Turn ---------------- */

function syncBottomPanels() {
  $('idle-panel').classList.toggle('hidden', !!nav || !!previewState);
  $('preview-panel').classList.toggle('hidden', !previewState);
  $('nav-panel').classList.toggle('hidden', !nav);
  $('maneuver').classList.toggle('hidden', !nav);
  document.body.classList.toggle('nav-active', !!nav);
  if (!nav) {
    $('lanes').classList.add('hidden');
    $('then').classList.add('hidden');
  }
}

function routeColor(kind: NavKind): string {
  switch (kind) {
    case 'pesca': return '#22c55e';
    case 'fuga': return '#f97316';
    case 'evento': return '#a855f7';
    case 'corrida': return '#facc15';
    default: return '#3b82f6';
  }
}

async function previewRouteTo(dest: LngLat, label: string, kind: NavKind = 'destino') {
  try {
    toast('Calculando rotas…');
    const routes = await fetchRoutes([driverPos(), dest], {
      base: settings.osrmBase,
      alternatives: true,
      bearing: loc.last?.heading,
    });
    previewState = { routes, selected: 0, kind, label, dest };
    renderPreview();
  } catch (e: any) {
    toast(e?.message || 'Erro ao calcular rota');
  }
}

function renderPreview() {
  if (!previewState) return;
  syncBottomPanels();
  const { routes, selected, label, kind, dest } = previewState;
  const chosen = routes[selected];
  mapView.setRoute(chosen, routeColor(kind));
  mapView.setAlternatives(routes, selected);
  mapView.fitRoute(chosen);

  $('preview-title').textContent = `Destino: ${label}`;
  $('alts').innerHTML = routes
    .map(
      (r, idx) => {
        const hasCongestion = reports.some(
          (rp) => (rp.type === 'HEAVY_TRAFFIC' || rp.type === 'ROAD_CLOSED') && r.geometry.some((pt) => haversine(pt, rp.pos) < 220),
        );
        const rSafety = evaluateRouteSafety(r.geometry);
        const trafficBadge = hasCongestion ? ' · 🚗 Retenção' : ' · 🟢 Livre';
        const safetyBadge = rSafety.isSafe ? ' · 🛡️ Seguro' : ' · ⚠️ Risco';
        return `
        <button data-alt="${idx}" class="${idx === selected ? 'sel' : ''}">
          <span><b>Rota ${idx + 1}</b> · ${formatDuration(r.duration)}${trafficBadge}${safetyBadge}</span>
          <span>${formatDistance(r.distance)}</span>
        </button>`;
      },
    )
    .join('');

  $('alts')
    .querySelectorAll<HTMLButtonElement>('button[data-alt]')
    .forEach((b) => {
      b.onclick = () => {
        if (!previewState) return;
        previewState.selected = Number(b.dataset.alt);
        renderPreview();
      };
    });

  // Avisa se o destino cai em zona morta ou se há bloqueios/trânsito/blitz na rota
  const destVerdict = deadZoneCheck(dest, scoreCtx(dest));
  const hazardsOnRoute = reports.filter((rp) => chosen.geometry.some((pt) => haversine(pt, rp.pos) < 220));
  const blitzOnRoute = hazardsOnRoute.filter((rp) => rp.type === 'BLITZ');
  const closedOnRoute = hazardsOnRoute.filter((rp) => rp.type === 'ROAD_CLOSED');
  const trafficOnRoute = hazardsOnRoute.filter((rp) => rp.type === 'HEAVY_TRAFFIC');

  // Avaliação de Áreas de Risco e Comunidades
  const chosenSafety = evaluateRouteSafety(chosen.geometry);

  const warns: string[] = [];
  if (!chosenSafety.isSafe) {
    warns.push(chosenSafety.warningMessage!);
    const hasSafeAlt = routes.some((r, idx) => idx !== selected && evaluateRouteSafety(r.geometry).isSafe);
    if (hasSafeAlt) {
      warns.push('💡 Dica do Veterano: Selecione a Rota com 🛡️ Seguro para contornar a comunidade pela via expressa.');
    }
  } else if (chosenSafety.nearbyZones.length) {
    warns.push(chosenSafety.warningMessage!);
  }

  if (destVerdict.dead) {
    warns.push(`⚠️ Destino em Zona Morta (retorno ${(destVerdict.returnIndex * 100).toFixed(0)}%). Prepare rota de extração após desembarque.`);
  }
  if (closedOnRoute.length) {
    warns.push(`⛔ Interdição CET-Rio/Waze no trajeto (${closedOnRoute[0].street}).`);
  }
  if (trafficOnRoute.length) {
    warns.push(`🚗 Engarrafamento severo no trajeto (${trafficOnRoute[0].street}). Previsão de atraso.`);
  }
  if (blitzOnRoute.length) {
    warns.push(`🚨 Alerta de Blitz próximo ao trajeto (${blitzOnRoute[0].street}).`);
  }

  // Avaliação de Combustível e Autonomia de GNV
  const gnvEval = evaluateRouteGnv(chosen.distance / 1000, gnvState, driverPos());
  if (gnvEval.warning) {
    warns.push(gnvEval.warning);
  }
  const f = gnvEval.fuelEstimate;
  warns.push(`⛽ Consumo estimado: ~${f.volumeM3} m³ (R$ ${f.costGnv.toFixed(2)}) · Economia de R$ ${f.savings.toFixed(2)} vs gasolina.`);

  $('preview-warn').textContent = warns.join(' ');
}

async function startNavigationTo(waypoints: LngLat[], kind: NavKind, label: string, precomputed?: Route) {
  try {
    const route =
      precomputed ??
      (
        await fetchRoutes(waypoints, {
          base: settings.osrmBase,
          alternatives: false,
          bearing: loc.last?.heading,
        })
      )[0];
    previewState = null;
    mapView.setAlternatives([], 0);
    activateNavSession(new NavSession(route, kind, label));
  } catch (e: any) {
    toast(e?.message || 'Falha ao iniciar navegação');
  }
}

function activateNavSession(session: NavSession) {
  nav = session;
  warnedHazards.clear();
  const mv = $('maneuver');
  mv.className = session.kind;
  mapView.follow = true;
  mapView.setRoute(session.route, routeColor(session.kind));
  loc.followLine(session.route.geometry);
  if (loc.mode === 'sim') {
    loc.simSpeedKmh = session.kind === 'pesca' ? getShift(nowDate()).targetSpeedKmh : session.kind === 'fuga' ? 55 : 42;
    loc.simPlaying = true;
  }
  syncBottomPanels();
  if (loc.last) onLocationFix(loc.last);
}

function stopNavigation(silent = false) {
  nav = null;
  previewState = null;
  warnedHazards.clear();
  loc.simPlaying = false;
  loc.followLine(null);
  mapView.setRoute(null);
  mapView.setAlternatives([], 0);
  syncBottomPanels();
  refreshTacticalState();
  if (!silent) voice.speak('Navegação encerrada.');
}

/** Constrói Circuito de Pesca passando pelos 3 melhores polos + retorno (loop tático). */
async function startFishingRoute() {
  // Sincroniza dados abertos Waze & COR-Rio de forma autônoma antes de calcular a rota
  void cloud.syncOpenTrafficFeeds();

  const start = driverPos();
  const scored = allScoredZones(start).filter((z) => z.potential >= 4 && !z.zone.id.startsWith('evt:'));
  const picked: ScoredZone[] = [];
  for (const cand of scored) {
    if (picked.length >= 3) break;
    if (haversine(start, cand.zone.pos) > 9000 && picked.length > 0) continue;
    if (picked.every((p) => haversine(p.zone.pos, cand.zone.pos) > 450)) {
      picked.push(cand);
    }
  }
  if (!picked.length && scored[0]) picked.push(scored[0]);
  const waypoints: LngLat[] = [start, ...picked.map((p) => p.zone.pos)];
  const shift = getShift(nowDate());
  const names = picked.map((p) => p.zone.name).join(' → ');
  const msg = `Rota de Pesca ativada por ${picked[0]?.zone.name ?? 'corredor comercial'}. ${picked[0]?.zone.lane ?? shift.targetLane}, mantenha ${picked[0]?.zone.speedKmh ?? shift.targetSpeedKmh} quilômetros por hora.`;
  voice.speak(msg, true);
  setCommand(`🎣 Circuito de Pesca: ${names}. ${picked[0]?.zone.tip ?? shift.veteranDirective}`);
  await startNavigationTo(waypoints, 'pesca', `Pesca: ${picked[0]?.zone.name ?? 'Circuito'}`);
}

let initialCenteringDone = false;

/* ---------------- Loop de GPS / Simulador ---------------- */

function onLocationFix(fix: Fix) {
  if (!initialCenteringDone && !fix.simulated) {
    initialCenteringDone = true;
    mapView.recenter(fix.pos, false);
    toast('📍 GPS Real conectado com sucesso!');
  }
  const kmh = Math.round(fix.speed * 3.6);
  $('speed-val').textContent = String(kmh);
  const shift = getShift(nowDate());
  const overSpeed = nav?.kind === 'pesca' && kmh > shift.targetSpeedKmh + 8;
  $('speed').classList.toggle('over', overSpeed);
  $('sim-badge').classList.toggle('hidden', !fix.simulated);

  // Odômetro de corrida ou km vazio
  if (activeTrip) {
    const dt = Math.max(0, (fix.ts - activeTrip.lastFixTs) / 1000);
    const d = haversine(activeTrip.lastPos, fix.pos);
    if (d < 250) activeTrip.distanceM += d;
    if (fix.speed < 1.2 && dt < 10) activeTrip.stoppedSec += dt;
    activeTrip.lastFixTs = fix.ts;
    activeTrip.lastPos = fix.pos;
    updateTripBar();
  } else {
    if (lastEmptyPos) {
      const d = haversine(lastEmptyPos, fix.pos);
      if (d < 250) emptyMetersSinceLastTrip += d;
    }
    lastEmptyPos = fix.pos;
  }

  // Atualiza consumo de GNV no odômetro
  if (lastPosRecorded) {
    const moved = haversine(lastPosRecorded, fix.pos);
    if (moved >= 3 && moved < 1000) {
      const gnvUp = updateGnvOdometer(gnvState, moved);
      gnvState = gnvUp.state;
      if (gnvUp.dotDropped) {
        save('gnv_state', gnvState);
        updateGnvChip();
        if (gnvUp.newDots === 0) {
          voice.speak('Atenção: GNV entrou na reserva! Procure um posto para abastecer.', true);
          toast('🔴 GNV NA RESERVA! Procure um posto.');
        } else {
          toast(`⛽ Bolinha de GNV baixou: ${gnvUp.newDots} bolinhas restantes.`);
        }
      }
    }
  }
  lastPosRecorded = fix.pos;

  mapView.updateCar(fix.pos, fix.heading, fix.speed, !!nav);

  // Se estiver navegando, atualiza manobra, faixas, ETA e recalcula se sair da rota
  if (nav) {
    const u = nav.update(fix.pos, fix.speed, fix.accuracy, fix.heading);
    const maneuverTarget = u.next ?? u.step;
    $('mv-icon').innerHTML = maneuverIcon(maneuverTarget.maneuver, 58);
    $('mv-dist').textContent = formatDistance(u.distToManeuver);
    $('mv-text').textContent = maneuverTarget.instruction;

    const lanes = u.next?.lanes ?? u.step?.lanes;
    const lanesEl = $('lanes');
    if (lanes?.length && u.distToManeuver < 500) {
      lanesEl.innerHTML = lanesHtml(lanes);
      lanesEl.classList.remove('hidden');
    } else {
      lanesEl.classList.add('hidden');
    }

    const thenEl = $('then');
    if (u.then && u.next && u.then.startDist - u.next.startDist < 150 && u.distToManeuver < 350) {
      thenEl.textContent = `Depois: ${u.then.instruction}`;
      thenEl.classList.remove('hidden');
    } else {
      thenEl.classList.add('hidden');
    }

    const eta = new Date(Date.now() + u.remainingTime * 1000);
    $('nav-eta').textContent = eta.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    $('nav-time').textContent = formatDuration(u.remainingTime);
    $('nav-dist').textContent = formatDistance(u.remainingDist);
    $('nav-kind').textContent = `${nav.label} · ${u.step.name || 'Siga na via'}`;

    // Comando comportamental por zona durante rota de pesca
    if (nav.kind === 'pesca') {
      const nearZone = allScoredZones(fix.pos)[0];
      if (nearZone && haversine(fix.pos, nearZone.zone.pos) < 550) {
        setCommand(behaviorCommand(nearZone, shift, effectiveRainLevel()));
      }
    }

    // Alerta de ocorrências à frente na rota (Blitz, Engarrafamento, Interdição)
    for (const h of reports) {
      if (warnedHazards.has(h.id)) continue;
      const dist = haversine(fix.pos, h.pos);
      if (dist >= 150 && dist <= 750 && nav.route.geometry.some((pt) => haversine(pt, h.pos) < 180)) {
        warnedHazards.add(h.id);
        const meta = REPORT_META[h.type];
        const msg = `${meta.label} a ${Math.round(dist)} metros na ${h.street}.`;
        voice.speak(`Atenção: ${msg}`, true);
        toast(`${meta.emoji} ${msg}`);
        break;
      }
    }

    // Alerta de aproximação de áreas de risco e comunidades com barricadas
    for (const dz of RIO_DANGER_ZONES) {
      const d = haversine(fix.pos, dz.center);
      if (d <= dz.radiusMeters + 350 && !warnedHazards.has(dz.id)) {
        warnedHazards.add(dz.id);
        const msg = `Alerta de Segurança: Aproximação de ${dz.name}. Mantenha-se na pista principal expressa.`;
        voice.speak(msg, true);
        toast(`🛡️ ${dz.name}: Não corte caminho por dentro.`);
        break;
      }
    }

    for (const cue of u.cues) voice.speak(cue);

    if (u.arrived) {
      if (nav.kind === 'pesca') {
        toast('Circuito concluído — reiniciando pesca nos polos quentes');
        void startFishingRoute();
      } else {
        stopNavigation(true);
      }
      return;
    }

    if (u.offRoute && !rerouting) {
      rerouting = true;
      nav.resetOffRoute();
      voice.speak('Recalculando rota.', true);
      toast('Fora da rota — recalculando…');
      const remaining = nav.remainingWaypoints(u.legIndex);
      const kind = nav.kind;
      const label = nav.label;
      fetchRoutes([fix.pos, ...remaining], { base: settings.osrmBase, bearing: fix.heading })
        .then((rs) => activateNavSession(new NavSession(rs[0], kind, label)))
        .catch(() => toast('Falha ao recalcular'))
        .finally(() => {
          rerouting = false;
        });
    }
  } else if (!activeTrip && Date.now() > deadAlertDismissedUntil) {
    // Proteção automática contra Zona Morta quando vazio
    const v = deadZoneCheck(fix.pos, scoreCtx(fix.pos));
    if (v.dead && fix.speed > 2) {
      deadAlertDismissedUntil = Date.now() + 90000;
      triggerDeadZoneAlert(v);
    }
  }

  // Envia telemetria ao vivo para o Supabase (throttled a cada 6s)
  if (Date.now() - lastTelemetryPushMs > 6000) {
    lastTelemetryPushMs = Date.now();
    pushCurrentTelemetry(fix);
  }
}

function pushCurrentTelemetry(fix?: Fix) {
  const pos = fix?.pos ?? driverPos();
  const speedKmh = fix ? Math.round(fix.speed * 3.6) : 0;
  const heading = fix?.heading ?? 0;
  const status: DriverTelemetry['status'] = activeTrip
    ? 'ON_TRIP'
    : nav?.kind === 'evento'
      ? 'EVENT_INTERCEPT'
      : nav?.kind === 'pesca'
        ? 'FISHING'
        : 'IDLE';
  const totalFareToday = trips.reduce((s, t) => s + t.fare, 0);
  const paidKmToday = trips.reduce((s, t) => s + t.distanceKm, 0);
  const emptyKmToday =
    trips.reduce((s, t) => s + t.emptyKmBefore, 0) +
    Math.round(emptyMetersSinceLastTrip / 100) / 10;

  const safetyCheck = checkCurrentPositionSafety(pos);
  const shiftTitle = safetyCheck.inDangerZone
    ? `⚠️ EM ÁREA DE RISCO (${safetyCheck.zone?.neighborhood})`
    : getShift(nowDate()).title;

  void cloud.pushDriverTelemetry({
    driverId: 'demo-taxi-07',
    driverName: 'Táxi Demo #07 · Showcase RJ',
    pos,
    speedKmh,
    heading,
    status,
    currentShift: shiftTitle,
    activeDestination: nav?.label ?? null,
    totalFareToday,
    tripsCountToday: trips.length,
    paidKmToday,
    emptyKmToday,
    recentTrips: trips.slice(0, 12),
  });
}

/* ---------------- Estimador Tarifário e Finalização de Corrida ---------------- */

function startPassengerTrip() {
  const pos = driverPos();
  const near = allScoredZones(pos)[0];
  activeTrip = {
    start: Date.now(),
    distanceM: 0,
    stoppedSec: 0,
    lastFixTs: Date.now(),
    lastPos: pos,
    pickupZone: near && haversine(pos, near.zone.pos) < 1200 ? near.zone.name : 'Maçaneta / Rua',
  };
  $('trip-bar').classList.remove('hidden');
  $('btn-trip').classList.add('hidden');
  updateTripBar();
  pushCurrentTelemetry();
  voice.beep('ok');
  voice.speak('Passageiro a bordo. Estimador de custos e margem da corrida iniciado.');
}

function currentFare(): number {
  if (!activeTrip) return 0;
  const { flag, perKm, perHourStopped } = settings.tariff;
  return flag + (activeTrip.distanceM / 1000) * perKm + (activeTrip.stoppedSec / 3600) * perHourStopped;
}

function updateTripBar() {
  if (!activeTrip) return;
  const fare = currentFare();
  const min = Math.max(1, Math.round((Date.now() - activeTrip.start) / 60000));
  $('trip-fare').textContent = `R$ ${fare.toFixed(2).replace('.', ',')}`;
  $('trip-km').textContent = `${(activeTrip.distanceM / 1000).toFixed(1).replace('.', ',')} km`;
  $('trip-time').textContent = `${min} min`;
}

function finishPassengerTrip() {
  if (!activeTrip) return;
  const pos = driverPos();
  const fare = Math.round(currentFare() * 100) / 100;
  const rec: TripRecord = {
    id: `tr_${Date.now()}`,
    start: activeTrip.start,
    end: Date.now(),
    fare,
    distanceKm: Math.round((activeTrip.distanceM / 100) ) / 10,
    emptyKmBefore: Math.round(emptyMetersSinceLastTrip / 100) / 10,
    pickupZone: activeTrip.pickupZone,
    dropoff: pos,
    shiftId: getShift(nowDate()).id,
  };
  trips.unshift(rec);
  save('trips', trips);
  activeTrip = null;
  emptyMetersSinceLastTrip = 0;
  $('trip-bar').classList.add('hidden');
  $('btn-trip').classList.remove('hidden');
  if (nav?.kind === 'corrida' || nav?.kind === 'destino') stopNavigation(true);
  pushCurrentTelemetry();

  const currentShiftObj = getShift(nowDate());
  void cloud.recordTripLog(rec, currentShiftObj.title);

  toast(`Corrida registrada: R$ ${fare.toFixed(2).replace('.', ',')}`);

  // Checagem imediata de Zona Morta no desembarque (seção 5.2 do Blueprint)
  const verdict = deadZoneCheck(pos, scoreCtx(pos));
  if (verdict.dead) {
    triggerDeadZoneAlert(verdict);
  } else {
    voice.speak(`Corrida encerrada: ${fare.toFixed(0)} reais. Você está em área ativa. Toque em Iniciar Rota de Pesca para emendar a próxima.`);
  }
}

/* ---------------- Reportes P2P de 1 Toque & Gestão de Bloqueios ---------------- */

async function addReportAt(type: ReportType, pos: LngLat = driverPos()) {
  const meta = REPORT_META[type];
  const street = await reverseGeocode(pos);
  const r: TrafficReport = {
    id: `rp_${Date.now()}`,
    type,
    pos,
    street,
    createdAt: Date.now(),
    expiresAt: Date.now() + meta.ttlMin * 60000,
  };
  reports.unshift(r);
  save('reports', reports);
  void cloud.publishHazard(r, 'motorista');
  refreshTacticalState();
  voice.beep('alert');
  voice.speak(`${meta.label} registrado em ${street}.`);
  toast(`${meta.emoji} ${meta.label}: ${street}`);
}

function removeReport(id: string) {
  const target = reports.find((x) => x.id === id);
  reports = reports.filter((x) => x.id !== id);
  save('reports', reports);
  void cloud.deleteHazard(id);
  refreshTacticalState();
  if (target) {
    voice.beep('ok');
    voice.speak(`Alerta de ${REPORT_META[target.type].label} removido. Via liberada.`);
    toast(`Alerta removido: ${target.street}`);
  }

  // Se houver navegação ativa, recalcula para aproveitar a via liberada
  if (nav && loc.last) {
    const remaining = nav.remainingWaypoints(0);
    const kind = nav.kind;
    const label = nav.label;
    fetchRoutes([loc.last.pos, ...remaining], { base: settings.osrmBase, bearing: loc.last.heading })
      .then((rs) => activateNavSession(new NavSession(rs[0], kind, label)))
      .catch(() => void 0);
  }
}

function showReportDetailsModal(r: TrafficReport) {
  const meta = REPORT_META[r.type];
  const ov = $('overlay');
  ov.classList.remove('hidden');
  const elapsedMin = Math.max(1, Math.round((Date.now() - r.createdAt) / 60000));
  ov.innerHTML = `
    <div class="alert-box" style="background:var(--panel);border:2px solid ${meta.color};text-align:left;color:var(--text)">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <span style="font-size:32px">${meta.emoji}</span>
        <div>
          <h2 style="margin:0;font-size:20px;color:var(--text)">${meta.label}</h2>
          <small class="dim-text">${r.street}</small>
        </div>
      </div>
      <p style="font-size:14px;margin:8px 0">Registrado às ${new Date(r.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} (${elapsedMin} min atrás).</p>
      <p class="subtext">Este bloqueio está ativo no seu copiloto para evitar vias engarrafadas ou fiscalizações.</p>
      <div class="row" style="margin-top:14px">
        <button id="rep-close" class="big ghost">Voltar ao Mapa</button>
        <button id="rep-remove" class="big danger">🗑️ Desfazer / Limpar Alerta</button>
      </div>
    </div>
  `;
  $('rep-close').onclick = () => ov.classList.add('hidden');
  $('rep-remove').onclick = () => {
    ov.classList.add('hidden');
    removeReport(r.id);
  };
}

/* ---------------- Monitor de GNV & Gestão de Combustível ---------------- */

function updateGnvChip() {
  const chip = $('gnv-chip');
  if (!chip) return;
  const autonomy = calculateRemainingAutonomy(gnvState);
  chip.classList.remove('reserve', 'low');
  if (gnvState.dots === 0) {
    chip.classList.add('reserve');
    chip.innerHTML = `⛽ 🔴 ~${autonomy}km`;
    chip.title = `GNV na Reserva (~${autonomy} km)! Clique para gerenciar ou abastecer.`;
  } else if (gnvState.dots === 1) {
    chip.classList.add('low');
    chip.innerHTML = `⛽ 1/4 · ~${autonomy}km`;
    chip.title = `Autonomia baixa (~${autonomy} km). Clique para gerenciar ou abastecer.`;
  } else {
    const dotsStr = '🟢'.repeat(gnvState.dots);
    chip.innerHTML = `⛽ ${dotsStr} ~${autonomy}km`;
    chip.title = `Cilindro com ${gnvState.dots} bolinhas (~${autonomy} km restantes). Clique para gerenciar.`;
  }
}

function showGnvManagerModal(selectedStationId?: string) {
  const ov = $('overlay');
  ov.classList.remove('hidden');
  const autonomy = calculateRemainingAutonomy(gnvState);
  const nearestStations = findNearestGnvStations(driverPos(), 4);

  ov.innerHTML = `
    <div class="alert-box" style="background:var(--panel);border:2px solid #10b981;text-align:left;color:var(--text);max-height:88vh;overflow-y:auto">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;border-bottom:1px solid var(--line);padding-bottom:8px">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:28px">⛽</span>
          <div>
            <h2 style="margin:0;font-size:18px;color:var(--text)">Monitor de GNV & Combustível</h2>
            <small class="dim-text">Calibrador do painel e postos do Rio</small>
          </div>
        </div>
        <button id="gnv-close" class="ghost" style="padding:4px 10px;font-size:16px">✕</button>
      </div>

      <!-- MANÔMETRO DE BOLINHAS -->
      <div class="card" style="margin-bottom:12px;background:#064e3b18;border:1px solid #05966955">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <span style="font-size:13px;font-weight:700">Nível no Manômetro de LED:</span>
          <b style="font-size:16px;color:#10b981">~${autonomy} km de autonomia</b>
        </div>
        <div style="display:grid;grid-template-columns:repeat(5, 1fr);gap:4px;margin-bottom:8px">
          ${[4, 3, 2, 1, 0].map((d) => `
            <button data-set-dot="${d}" style="padding:10px 2px;font-size:11px;font-weight:800;border-radius:10px;background:${gnvState.dots === d ? '#10b981' : '#1e293b'};color:${gnvState.dots === d ? '#022c22' : '#94a3b8'};border:1px solid ${gnvState.dots === d ? '#34d399' : '#334155'}">
              ${d === 0 ? '🔴 Res' : `${d} 🟢`}
            </button>
          `).join('')}
        </div>
        <div style="display:flex;justify-content:space-between;font-size:11px" class="dim-text">
          <span>Rodados nesta bolinha: <b>${gnvState.kmSinceDotChange.toFixed(1)} km</b></span>
          <span>Desde último abastecimento: <b>${gnvState.kmSinceRefuel.toFixed(1)} km</b></span>
        </div>
      </div>

      <!-- REGISTRAR ABASTECIMENTO -->
      <div class="card" style="margin-bottom:12px">
        <h3 style="margin-top:0;font-size:14px">⛽ Registrar Abastecimento</h3>
        <div style="display:flex;gap:8px;margin-bottom:8px">
          <label style="flex:1;font-size:11px">
            Valor Total (R$)
            <input id="refuel-cost" type="number" step="1" placeholder="Ex: 55" value="55" />
          </label>
          <label style="width:125px;font-size:11px">
            Preço (R$/m³)
            <input id="refuel-price" type="number" step="0.01" placeholder="Ex: 4.19" value="${gnvState.defaultPricePerM3.toFixed(2)}" />
          </label>
        </div>
        <button id="btn-save-refuel" class="huge green" style="padding:10px;font-size:14px;border-radius:10px">
          ✔ Abasteci (Completar Tanque)
        </button>
      </div>

      <!-- POSTOS RECOMENDADOS -->
      <div>
        <h3 style="margin:8px 0;font-size:14px">⭐ Postos de GNV Recomendados por Perto</h3>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${nearestStations.map((s) => {
            const isSel = s.id === selectedStationId;
            return `
              <div class="alert-list-item" style="border-left-color:${s.pressureBar >= 220 ? '#10b981' : '#f59e0b'};background:${isSel ? '#10b98122' : ''}">
                <div style="flex:1">
                  <div style="display:flex;align-items:center;gap:6px">
                    <b style="font-size:13px">${s.name}</b>
                    ${s.pressureBar >= 220 ? '<span style="font-size:10px;background:#065f46;color:#6ee7b7;padding:1px 5px;border-radius:4px;font-weight:800">220 BAR</span>' : ''}
                  </div>
                  <small class="dim-text" style="display:block">${s.address} · <b>~${(s.distanceM / 1000).toFixed(1)} km</b></small>
                  <small style="color:#10b981;font-weight:700">GNV R$ ${s.pricePerM3.toFixed(2)}/m³ ${s.isOpen24h ? '· 24h' : ''}</small>
                  <p style="margin:4px 0 0;font-size:11px;color:var(--muted);font-style:italic">${s.tacticalTip}</p>
                </div>
                <button data-nav-station="${s.id}" class="green" style="padding:6px 10px;font-size:12px;font-weight:800;align-self:center">
                  🧭 Ir
                </button>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    </div>
  `;

  $('gnv-close').onclick = () => ov.classList.add('hidden');

  ov.querySelectorAll<HTMLButtonElement>('button[data-set-dot]').forEach((btn) => {
    btn.onclick = () => {
      const d = parseInt(btn.dataset.setDot || '4') as GnvDots;
      gnvState.dots = d;
      gnvState.kmSinceDotChange = 0;
      save('gnv_state', gnvState);
      updateGnvChip();
      showGnvManagerModal(selectedStationId);
      toast(`Cilindro ajustado para ${d === 0 ? 'RESERVA' : `${d} bolinhas`}`);
    };
  });

  $('btn-save-refuel').onclick = () => {
    const cost = parseFloat(($('refuel-cost') as HTMLInputElement).value) || 55;
    const price = parseFloat(($('refuel-price') as HTMLInputElement).value) || 4.19;
    const nearest = nearestStations[0]?.name || 'Posto de GNV';
    const result = recordRefuel(gnvState, cost, 4, nearest, price);
    gnvState = result.state;
    save('gnv_state', gnvState);
    void cloud.recordRefuelLog(result.refuel);
    updateGnvChip();
    ov.classList.add('hidden');
    toast(`Abastecimento de R$ ${cost.toFixed(2)} registrado! Tanque cheio.`);
    if (activeTab === 'ganhos') renderDrawer();
  };

  ov.querySelectorAll<HTMLButtonElement>('button[data-nav-station]').forEach((btn) => {
    btn.onclick = () => {
      const s = RIO_GNV_STATIONS.find((x) => x.id === btn.dataset.navStation);
      if (s) {
        ov.classList.add('hidden');
        void previewRouteTo(s.pos, s.name, 'pesca');
      }
    };
  });
}

/* ---------------- Consultor de Destino Alternativo do Veterano ---------------- */

function checkVeteranoAlternativeAdvice(
  dest: LngLat,
  label: string,
  onProceed: (chosenDest: LngLat, chosenLabel: string) => void,
) {
  // Se estiver com passageiro pagante no taxímetro, não interfere: o passageiro escolhe o destino!
  if (activeTrip) {
    onProceed(dest, label);
    return;
  }

  const driver = driverPos();
  const targetDistM = haversine(driver, dest);
  const targetDistKm = targetDistM / 1000;

  // Avalia o índice de retorno do destino que o motorista pretendia ir
  const targetVerdict = deadZoneCheck(dest, scoreCtx(dest));

  // Se o destino pretendido é frio/morto (retorno < 0.38) e tem mais de 2.0 km de deslocamento
  if (targetVerdict.returnIndex < 0.38 && targetDistKm >= 2.0) {
    const allScored = allScoredZones(driver);
    const alternatives = allScored
      .filter((s) => {
        if (s.potential < 6.5) return false;
        const d = haversine(driver, s.zone.pos) / 1000;
        // Zonas quentes com distância próxima (+/- 2.5 km ou até 1.25x da que ele já ia rodar)
        return Math.abs(d - targetDistKm) < 3.0 || (d <= targetDistKm * 1.25 && d >= targetDistKm * 0.4);
      })
      .slice(0, 2);

    if (alternatives.length > 0) {
      showVeteranoAlternativeModal(dest, label, targetDistKm, targetVerdict, alternatives, onProceed);
      return;
    }
  }

  // Destino original já é razoável ou não há alternativa viável próxima: segue direto
  onProceed(dest, label);
}

function showVeteranoAlternativeModal(
  origDest: LngLat,
  origLabel: string,
  origDistKm: number,
  targetVerdict: ReturnType<typeof deadZoneCheck>,
  alternatives: ScoredZone[],
  onProceed: (chosenDest: LngLat, chosenLabel: string) => void,
) {
  voice.beep('alert');
  const ov = $('overlay');
  ov.classList.remove('hidden');

  voice.speak(`Atenção: seu destino em ${origLabel} tem baixa probabilidade de retorno. Com a mesma distância, o polo ${alternatives[0].zone.name} é muito mais lucrativo.`);

  ov.innerHTML = `
    <div class="alert-box call" style="background:var(--panel);border:2px solid var(--yellow);text-align:left;max-width:480px;color:var(--text);box-shadow:0 12px 40px rgba(0,0,0,0.5)">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <span style="font-size:28px">💡</span>
        <div>
          <h2 style="margin:0;font-size:19px;color:var(--yellow)">Consultor do Taxista Veterano</h2>
          <small class="dim-text">Mesma quilometragem, muito mais passageiros</small>
        </div>
      </div>
      <p style="font-size:14px;margin:6px 0">
        Você pretendia ir para <b>${origLabel}</b> (~${origDistKm.toFixed(1)} km · Chance de retorno: <b>&lt; ${Math.max(5, targetVerdict.chancePct)}%</b>).
      </p>
      <p class="subtext" style="margin:4px 0 10px">
        Rodando <b>praticamente a mesma distância</b>, veja onde há giro alto agora:
      </p>
      
      <div style="display:flex;flex-direction:column;gap:8px;margin:8px 0">
        ${alternatives
          .map(
            (alt, idx) => `
          <div class="card-event" style="border-left:4px solid ${zoneColor(alt.potential)};padding:10px;margin-top:0">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <b>⭐ ${alt.score.toFixed(1)} · ${alt.zone.name}</b>
              <span style="font-size:12px;font-weight:800;color:var(--yellow)">${formatDistance(alt.parts.distKm * 1000)}</span>
            </div>
            <div class="subtext" style="margin:4px 0">${alt.zone.lane} · ${alt.zone.tip}</div>
            <button data-alt-pick="${idx}" class="green" style="margin-top:6px;width:100%;padding:10px;font-size:13px;font-weight:900">
              IR PARA ESTE POLO RECOMENDADO ▶
            </button>
          </div>
        `,
          )
          .join('')}
      </div>

      <div class="row" style="margin-top:10px">
        <button id="btn-keep-original" class="big ghost" style="font-size:13px">
          Manter destino original (${origLabel})
        </button>
      </div>
    </div>
  `;

  $('btn-keep-original').onclick = () => {
    ov.classList.add('hidden');
    onProceed(origDest, origLabel);
  };

  ov.querySelectorAll<HTMLButtonElement>('button[data-alt-pick]').forEach((b) => {
    b.onclick = () => {
      ov.classList.add('hidden');
      const pick = alternatives[Number(b.dataset.altPick)];
      onProceed(pick.zone.pos, pick.zone.name);
    };
  });
}

/* ---------------- Gaveta das Abas (Radar, Ganhos, Laboratório de Testes) ---------------- */

function switchTab(tab: typeof activeTab) {
  activeTab = tab;
  document.querySelectorAll<HTMLButtonElement>('#tabs button').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  if (tab === 'map') {
    $('drawer').classList.add('hidden');
    return;
  }
  $('drawer').classList.remove('hidden');
  renderDrawer();
}

function renderDrawer() {
  const body = $('drawer-body');
  if (activeTab === 'radar') {
    $('drawer-title').textContent = '🎤 Radar & Dispersões Ativas';
    const cal = getCalendarDayInfo(nowDate());
    const yearHolidays = getHolidaysForYear(nowDate().getFullYear())
      .filter((h) => {
        const hDate = new Date(h.dateStr + 'T23:59:59');
        return hDate >= nowDate();
      })
      .slice(0, 4);

    const syncLabel = cloud.connected
      ? cloud.isSandboxMode
        ? `🟢 Sandbox Showcase Ativo · Sincronia entre abas (${cloud.lastSyncMs ? new Date(cloud.lastSyncMs).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : 'ativa'})`
        : `🟢 Conectado à Central · Sincronia ao vivo (${cloud.lastSyncMs ? new Date(cloud.lastSyncMs).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : 'ativa'})`
      : '🟡 Inicializando barramento da Central...';

    body.innerHTML = `
      <!-- STATUS DE CONEXÃO COM A CENTRAL SUPABASE -->
      <div class="card" style="border-left: 5px solid var(--green);display:flex;justify-content:space-between;align-items:center;gap:8px">
        <div>
          <b style="font-size:13px">${syncLabel}</b>
          <small class="dim-text" style="display:block">Recebendo shows, eventos e interdições automaticamente da Torre de Controle.</small>
        </div>
        <button id="btn-open-central-radar" class="ghost" style="padding:8px 10px;font-size:12px;font-weight:800;white-space:nowrap">🖥️ Painel Central</button>
      </div>

      <!-- PILAR 1: OPORTUNIDADES E DISPERSÕES ATIVAS HOJE -->
      <div class="card">
        <h3>🎤 Oportunidades & Dispersões Ativas (${events.length})</h3>
        ${
          events.length === 0
            ? `
          <p class="dim-text" style="font-size:13px;line-height:1.4">
            Nenhum show ou grande dispersão agendada para as próximas horas. O copiloto está operando pela matriz tática de hospitais, corporativo e terminais. Assim que a Central publicar um evento, ele aparecerá aqui e no mapa automaticamente!
          </p>
        `
            : events
                .map(
                  (e) => {
                    const opBadge = e.operationalStatus
                      ? `<span class="pill ${e.operationalStatus.includes('POSICIONAR') || e.operationalStatus.includes('ATIVA') ? 'hot' : 'gold'}">${e.operationalStatus}</span>`
                      : '';
                    const platBadge = e.platform ? `<span class="pill">${e.platform.toUpperCase()}</span>` : '';
                    const linkBadge = e.sourceUrl
                      ? `<a href="${e.sourceUrl}" target="_blank" rel="noopener noreferrer" class="pill" style="text-decoration:none;background:rgba(59,130,246,0.18);color:#60a5fa;border:1px solid rgba(59,130,246,0.4)">🔗 Ingressos / Fonte ↗</a>`
                      : '';
                    return `
          <div class="card-event">
            <div class="meta" style="flex-wrap:wrap">
              ${opBadge}
              ${platBadge}
              ${linkBadge}
              <span class="pill gold">⏰ Posicionar ${hhmm(e.goldenArrival)}</span>
              <span class="pill hot">🏁 Fim ${hhmm(e.estimatedEnd)}</span>
              <span class="pill">👥 ~${e.expectedCrowd.toLocaleString('pt-BR')}</span>
              <span class="pill">🔥 Score ${e.demandScore}</span>
            </div>
            <h3 style="margin:6px 0">${e.title}</h3>
            <p style="margin:4px 0"><b>Esquina de Escape:</b> ${e.escapeCorner}</p>
            <p class="subtext" style="margin:6px 0">${e.driverInstruction}</p>
            <div class="row" style="margin-top:8px">
              <button data-ev-route="${e.id}" class="big green">🧭 IR PARA ESQUINA DE ESCAPE ▶</button>
              <button data-ev-cal="${e.id}" class="ghost" style="flex:0 0 auto;padding:10px 14px" title="Salvar lembrete na agenda">📅</button>
            </div>
          </div>
        `;
                  },
                )
                .join('')
        }
      </div>

      <!-- PILAR 2: CALENDÁRIO CIVIL E SAZONALIDADE ESPERADA -->
      <div class="card" style="border-left: 5px solid var(--yellow)">
        <div class="meta">
          <span class="pill gold">${cal.isSunday ? 'Domingo' : cal.isSaturday ? 'Sábado' : 'Dia útil comercial'}</span>
          <span class="pill">🛍️ Shoppings fecham às ${cal.shoppingClosingHour}h</span>
          ${cal.isEnemSunday ? '<span class="pill hot">🎓 Domingo de ENEM</span>' : ''}
          ${cal.holidayToday ? `<span class="pill hot">🎉 Feriado: ${cal.holidayToday.name}</span>` : ''}
          ${cal.classification === 'HOLIDAY_EVE' ? `<span class="pill eve">🧳 Véspera de Feriado</span>` : ''}
        </div>
        <h3 style="margin-top:6px">🧠 Diagnóstico Sazonal do Dia</h3>
        <p style="font-size:14px;margin:4px 0"><b>${cal.tacticalSummary}</b></p>

        <h4 style="margin:10px 0 6px;font-size:13px;color:var(--yellow)">Próximos Feriados no Rio:</h4>
        <div style="font-size:12px;display:flex;flex-direction:column;gap:6px">
          ${yearHolidays
            .map(
              (h) => `
            <div><b>${h.day}/${String(h.month).padStart(2, '0')} - ${h.name}</b>: <span class="dim-text">${h.impactNote}</span></div>
          `,
            )
            .join('')}
        </div>
      </div>
    `;

    $('btn-open-central-radar').onclick = () => openCentralMode();

    body.querySelectorAll<HTMLButtonElement>('button[data-ev-route]').forEach((b) => {
      b.onclick = () => {
        const ev = events.find((x) => x.id === b.dataset.evRoute);
        if (!ev) return;
        switchTab('map');
        void startNavigationTo([driverPos(), ev.escape], 'evento', `Escape: ${ev.venueName}`);
      };
    });
    body.querySelectorAll<HTMLButtonElement>('button[data-ev-cal]').forEach((b) => {
      b.onclick = () => {
        const ev = events.find((x) => x.id === b.dataset.evCal);
        if (ev) window.open(googleCalendarUrl(ev), '_blank');
      };
    });
    return;
  }

  if (activeTab === 'ganhos') {
    $('drawer-title').textContent = '💰 Ganhos & Eficiência do Turno';
    const totalFare = trips.reduce((s, t) => s + t.fare, 0);
    const totalPaidKm = trips.reduce((s, t) => s + t.distanceKm, 0);
    const totalEmptyKm = trips.reduce((s, t) => s + t.emptyKmBefore, 0);
    const totalHours = Math.max(0.25, trips.reduce((s, t) => s + (t.end - t.start) / 3600000, 0));
    const rPerHour = trips.length ? totalFare / totalHours : 0;
    const emptyRatio = totalPaidKm + totalEmptyKm > 0 ? (totalEmptyKm / (totalPaidKm + totalEmptyKm)) * 100 : 0;

    const totalRefuelsCost = gnvState.refuels.reduce((s, r) => s + r.totalCost, 0);
    const netProfit = totalFare - totalRefuelsCost;
    const totalKmDriven = totalPaidKm + totalEmptyKm;
    const costPerKm = totalKmDriven > 0 ? totalRefuelsCost / totalKmDriven : 0;

    const byShift = SHIFTS.map((sh) => {
      const sum = trips.filter((t) => t.shiftId === sh.id).reduce((s, t) => s + t.fare, 0);
      return { title: sh.timeRange, sum };
    });
    const maxShift = Math.max(50, ...byShift.map((b) => b.sum));

    body.innerHTML = `
      <div class="grid2">
        <div class="card stat"><b>R$ ${totalFare.toFixed(2).replace('.', ',')}</b><small>Faturamento (${trips.length} corridas)</small></div>
        <div class="card stat"><b>R$ ${rPerHour.toFixed(0)}/h</b><small>Ganho por hora em corrida</small></div>
        <div class="card stat"><b>${totalPaidKm.toFixed(1)} km</b><small>Km pagos rodados</small></div>
        <div class="card stat"><b>${emptyRatio.toFixed(0)}% vazio</b><small>${totalEmptyKm.toFixed(1)} km batendo lata</small></div>
      </div>

      <div class="card" style="border: 2px solid #10b981; background: #064e3b15;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <h3 style="margin:0;color:#10b981;display:flex;align-items:center;gap:6px">
            ⛽ Lucro Líquido Real (Descontando GNV)
          </h3>
          <button id="btn-quick-refuel" class="green" style="padding:4px 10px;font-size:12px;font-weight:800">
            + Abastecer
          </button>
        </div>
        <div class="grid2" style="margin-bottom:8px">
          <div class="stat"><b style="color:#10b981">R$ ${netProfit.toFixed(2).replace('.', ',')}</b><small>Lucro Limpo no Bolso</small></div>
          <div class="stat"><b>R$ ${totalRefuelsCost.toFixed(2).replace('.', ',')}</b><small>Gasto em Combustível</small></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:12px" class="dim-text">
          <span>Custo médio: <b>R$ ${costPerKm.toFixed(2)}/km</b></span>
          <span>Autonomia atual: <b>~${calculateRemainingAutonomy(gnvState)} km</b></span>
        </div>
        ${gnvState.refuels.length ? `
          <div style="margin-top:8px;border-top:1px solid var(--line);padding-top:6px;font-size:11px">
            <span class="dim-text">Últimos abastecimentos:</span>
            ${gnvState.refuels.slice(0, 3).map((r) => `
              <div style="display:flex;justify-content:space-between;padding:2px 0">
                <span>⛽ ${r.stationName} (${new Date(r.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })})</span>
                <b>- R$ ${r.totalCost.toFixed(2)} (~${r.volumeM3} m³)</b>
              </div>
            `).join('')}
          </div>
        ` : ''}
      </div>

      <div class="card">
        <h3>➕ Registrar corrida avulsa (maçaneta)</h3>
        <div class="row">
          <input id="tr-fare" type="number" step="1" placeholder="Valor R$ (ex: 32)" />
          <input id="tr-km" type="number" step="0.5" placeholder="Km (ex: 6.5)" />
          <button id="tr-add" class="green" style="padding:0 18px;font-weight:800">Salvar</button>
        </div>
      </div>

      <div class="card">
        <h3>📊 Faturamento por Faixa da Matriz Veterana</h3>
        <div class="bars">
          ${byShift
            .map(
              (b) => `
            <div class="bar">
              <span>${b.title}</span>
              <div><i style="width:${Math.max(4, (b.sum / maxShift) * 100)}%"></i></div>
              <b>R$ ${b.sum.toFixed(0)}</b>
            </div>`,
            )
            .join('')}
        </div>
      </div>

      <div class="card">
        <h3>🚨 Bloqueios e Alertas Ativos na Cidade</h3>
        ${reports.length === 0 ? `
          <p class="dim-text" style="font-size:13px">Nenhuma blitz ou bloqueio ativo no momento.</p>
        ` : `
          <div style="display:flex;flex-direction:column;gap:6px">
            ${reports.map((r) => {
              const meta = REPORT_META[r.type];
              const minLeft = Math.max(1, Math.round((r.expiresAt - Date.now()) / 60000));
              return `
                <div class="alert-list-item" style="border-left-color:${meta.color}">
                  <div>
                    <b>${meta.emoji} ${meta.label}</b>
                    <small class="dim-text" style="display:block">${r.street} (expira em ~${minLeft} min)</small>
                  </div>
                  <button data-rep-del="${r.id}" class="danger" style="padding:6px 12px;font-size:12px;font-weight:700">Remover</button>
                </div>
              `;
            }).join('')}
          </div>
        `}
      </div>

      <div class="card">
        <h3>🧾 Últimas corridas</h3>
        ${
          trips.length
            ? trips
                .slice(0, 12)
                .map(
                  (t) => `<p><b>R$ ${t.fare.toFixed(2).replace('.', ',')}</b> · ${t.distanceKm} km · ${t.pickupZone} (${new Date(t.end).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })})</p>`,
                )
                .join('')
            : '<p>Nenhuma corrida registrada ainda.</p>'
        }
      </div>

      <div style="margin-top:12px">
        <button id="btn-clear-shift" class="ghost" style="width:100%;padding:12px;font-weight:800;font-size:13px;border-radius:12px;color:#f87171;border:1px solid #ef444455">
          🧹 Limpar Faturamento / Iniciar Novo Turno
        </button>
      </div>
    `;

    $('tr-add').onclick = () => {
      const fare = parseFloat(($('tr-fare') as HTMLInputElement).value);
      const km = parseFloat(($('tr-km') as HTMLInputElement).value) || 5;
      if (!fare || fare <= 0) {
        toast('Informe o valor da corrida');
        return;
      }
      const now = Date.now();
      const currentShiftObj = getShift(nowDate());
      const newTrip: TripRecord = {
        id: `tr_${now}`,
        start: now - 15 * 60000,
        end: now,
        fare,
        distanceKm: km,
        emptyKmBefore: Math.round(emptyMetersSinceLastTrip / 100) / 10,
        pickupZone: allScoredZones()[0]?.zone.name ?? 'Corredor Comercial',
        dropoff: driverPos(),
        shiftId: currentShiftObj.id,
      };
      trips.unshift(newTrip);
      emptyMetersSinceLastTrip = 0;
      save('trips', trips);
      void cloud.recordTripLog(newTrip, currentShiftObj.title);
      pushCurrentTelemetry();
      renderDrawer();
      toast('Corrida adicionada!');
    };

    const clearShiftBtn = $('btn-clear-shift');
    if (clearShiftBtn) {
      clearShiftBtn.onclick = async () => {
        if (!confirm('Deseja realmente zerar o faturamento e as corridas acumuladas deste turno?')) return;
        trips = [];
        save('trips', trips);
        emptyMetersSinceLastTrip = 0;
        gnvState.kmSinceRefuel = 0;
        save('gnv_state', gnvState);
        await cloud.clearTripsLog();
        pushCurrentTelemetry();
        renderDrawer();
        toast('🧹 Turno zerado com sucesso! Pronto para nova jornada.');
      };
    }

    const qRefuel = $('btn-quick-refuel');
    if (qRefuel) qRefuel.onclick = () => showGnvManagerModal();

    body.querySelectorAll<HTMLButtonElement>('button[data-rep-del]').forEach((b) => {
      b.onclick = () => {
        const id = b.dataset.repDel;
        if (id) {
          removeReport(id);
          renderDrawer();
        }
      };
    });
    return;
  }

  /* ---------------- ABA DE TESTES (LABORATÓRIO DE CAMPO) ---------------- */
  $('drawer-title').textContent = '🧪 Área de Testes & Simulador (Rio)';
  const now = nowDate();
  const shift = getShift(now);
  const verdict = deadZoneCheck(driverPos(), scoreCtx());

  body.innerHTML = `
    <div class="card" style="border-left:5px solid #10b981;display:flex;justify-content:space-between;align-items:center;gap:10px">
      <div>
        <b style="font-size:14px">📲 Instalar App no Celular (Tela Cheia)</b>
        <small class="dim-text" style="display:block">Cria ícone nativo na tela inicial e oculta a barra do Chrome.</small>
      </div>
      <button id="lab-install-pwa" class="green" style="padding:10px 14px;font-size:12px;font-weight:800;white-space:nowrap">📲 Instalar</button>
    </div>

    <div class="card">
      <h3>🎬 Cenários Táticos de 1 Toque (Rio de Janeiro)</h3>
      <p style="font-size:12px">Teleporta o táxi, ajusta o relógio/clima e aciona a inteligência veterana em tempo real:</p>
      <div class="scenarios">
        <button data-sc="hosp">🏥 09h15 · Circuito Hospitais (Copa D'Or / Samaritano)</button>
        <button data-sc="maracana">🎸 Saída de Show no Maracanã (Simulação 62 mil)</button>
        <button data-sc="enem">🎓 Domingo ENEM · 12h15 Corrida Portões UERJ</button>
        <button data-sc="holiday_eve">🧳 Véspera de Feriadão · 16h30 Rodoviária/SDU</button>
        <button data-sc="rain_metro">🌧️ 18h15 + Chuva Forte · Saída Metrô Botafogo</button>
        <button data-sc="dead_centro">⚠️ 23h20 · Desembarque em Zona Morta (Centro vazio)</button>
        <button data-sc="sdu_lunch">✈️ 12h30 · Almoço Executivo & Santos Dumont</button>
        <button data-sc="lapa_night">🍻 02h25 · 1ª Onda de Saída da Lapa</button>
      </div>
    </div>

    <div class="card">
      <h3>🛰️ Fonte de Localização & Velocidade do Simulador</h3>
      <div class="seg">
        <button data-loc="sim" class="${loc.mode === 'sim' ? 'on' : ''}">🧪 Simulador</button>
        <button data-loc="gps" class="${loc.mode === 'gps' ? 'on' : ''}">📡 GPS Real do Aparelho</button>
      </div>
      <div class="row" style="margin-top:8px">
        <label style="flex:1">Velocidade (${loc.simSpeedKmh} km/h)
          <input id="lab-speed" type="range" min="15" max="90" step="5" value="${loc.simSpeedKmh}" />
        </label>
        <label style="flex:1">Multiplicador (${loc.simMultiplier}×)
          <div class="seg">
            ${[1, 2, 5, 10]
              .map((m) => `<button data-mult="${m}" class="${loc.simMultiplier === m ? 'on' : ''}">${m}×</button>`)
              .join('')}
          </div>
        </label>
      </div>
      <div class="row" style="margin-top:8px">
        <button id="lab-pause" class="ghost">${loc.simPlaying ? '⏸ Pausar carro' : '▶ Mover carro na rota'}</button>
        <button id="lab-offroute" class="ghost">↩️ Forçar Desvio (Recálculo)</button>
      </div>
      <p class="subtext" style="font-size:12px">💡 Dica: clique com o botão direito (ou toque longo) em qualquer rua do mapa para teleportar o táxi ou traçar rota.</p>
    </div>

    <div class="card">
      <h3>⏰ Relógio Virtual & Modo Chuva</h3>
      <p>Horário simulado: <b>${now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</b> · Turno: <b>${shift.title}</b></p>
      <div class="seg">
        <button data-hour="7">07h</button>
        <button data-hour="9.5">09h30</button>
        <button data-hour="12.5">12h30</button>
        <button data-hour="15.5">15h30</button>
        <button data-hour="18">18h</button>
        <button data-hour="21.5">21h30</button>
        <button data-hour="1">01h</button>
        <button data-hour="real" class="${settings.clockOffsetMin === 0 ? 'on' : ''}">Real</button>
      </div>
      <label style="margin-top:8px">Clima / Gatilho de Chuva
        <div class="seg">
          <button data-rain="auto" class="${settings.rainOverride === 'auto' ? 'on' : ''}">Auto (Open-Meteo)</button>
          <button data-rain="off" class="${settings.rainOverride === 'off' ? 'on' : ''}">☀️ Seco (×1,0)</button>
          <button data-rain="on" class="${settings.rainOverride === 'on' ? 'on' : ''}">🌧️ Chuva (×2,5)</button>
        </div>
      </label>
    </div>

    <div class="card">
      <h3>📐 Inspetor da Fórmula H3 & Diagnóstico Local</h3>
      <p>Índice de retorno no ponto atual: <b>${verdict.returnIndex.toFixed(2)}</b> (${verdict.dead ? '🔴 ZONA MORTA' : '🟢 ZONA ATIVA'}, chance ~${verdict.chancePct}%)</p>
      ${allScoredZones()
        .slice(0, 4)
        .map(
          (z) =>
            `<p style="font-size:12px"><b>${z.score.toFixed(1)}</b> · ${z.zone.name} <span class="dim-text">(B=${z.parts.base.toFixed(1)} E=${z.parts.event.toFixed(1)} V=${z.parts.transport.toFixed(1)} ×M=${z.parts.mClima} / dist=${z.parts.distKm.toFixed(1)}km)</span></p>`,
        )
        .join('')}
    </div>

    <div class="card">
      <h3>🔊 Histórico de Comandos de Voz</h3>
      <div class="log">${speechLog.length ? speechLog.join('\n') : 'Nenhuma fala emitida ainda.'}</div>
    </div>
  `;

  const labInstallBtn = document.getElementById('lab-install-pwa');
  if (labInstallBtn) {
    labInstallBtn.onclick = async () => {
      if (deferredPwaPrompt) {
        deferredPwaPrompt.prompt();
        const choice = await deferredPwaPrompt.userChoice;
        if (choice?.outcome === 'accepted') {
          toast('📲 Instalando Taxi Copilot no seu aparelho...');
        }
        deferredPwaPrompt = null;
      } else {
        showInstallGuideModal();
      }
    };
  }

  // Handlers de Cenários
  body.querySelectorAll<HTMLButtonElement>('button[data-sc]').forEach((b) => {
    b.onclick = () => runScenario(b.dataset.sc!);
  });

  body.querySelectorAll<HTMLButtonElement>('button[data-loc]').forEach((b) => {
    b.onclick = () => {
      loc.setMode(b.dataset.loc as 'sim' | 'gps');
      renderDrawer();
    };
  });

  $('lab-speed').oninput = (ev) => {
    loc.simSpeedKmh = Number((ev.target as HTMLInputElement).value);
    renderDrawer();
  };

  body.querySelectorAll<HTMLButtonElement>('button[data-mult]').forEach((b) => {
    b.onclick = () => {
      loc.simMultiplier = Number(b.dataset.mult);
      renderDrawer();
    };
  });

  $('lab-pause').onclick = () => {
    loc.simPlaying = !loc.simPlaying;
    renderDrawer();
  };

  $('lab-offroute').onclick = () => {
    const p = driverPos();
    // Desloca ~120m lateralmente para disparar detecção de fora de rota
    loc.teleport([p[0] + 0.0014, p[1] + 0.0011]);
    if (nav && loc.last) {
      nav.update(loc.last.pos, 12, 5, loc.last.heading);
      nav.update(loc.last.pos, 12, 5, loc.last.heading);
      onLocationFix(loc.last);
    }
    switchTab('map');
  };

  body.querySelectorAll<HTMLButtonElement>('button[data-hour]').forEach((b) => {
    b.onclick = () => {
      const val = b.dataset.hour!;
      if (val === 'real') {
        settings.clockOffsetMin = 0;
      } else {
        const targetH = parseFloat(val);
        const real = new Date();
        const realMin = real.getHours() * 60 + real.getMinutes();
        settings.clockOffsetMin = Math.round(targetH * 60 - realMin);
      }
      save('settings', settings);
      refreshTacticalState();
      renderDrawer();
    };
  });

  body.querySelectorAll<HTMLButtonElement>('button[data-rain]').forEach((b) => {
    b.onclick = () => {
      settings.rainOverride = b.dataset.rain as Settings['rainOverride'];
      save('settings', settings);
      refreshTacticalState();
      renderDrawer();
      if (settings.rainOverride === 'on') {
        voice.speak('Modo Chuva ativado! Multiplicador 2 vírgula 5. Redirecionando para saídas de metrô e marquises de shopping.');
      }
    };
  });
}

function setSimulatedHour(hourFloat: number) {
  const real = new Date();
  const realMin = real.getHours() * 60 + real.getMinutes();
  settings.clockOffsetMin = Math.round(hourFloat * 60 - realMin);
  save('settings', settings);
}

function runScenario(id: string) {
  stopNavigation(true);
  switchTab('map');
  loc.setMode('sim');

  switch (id) {
    case 'hosp': {
      setSimulatedHour(9.25);
      settings.rainOverride = 'off';
      loc.teleport([-43.1893, -22.9655]); // Copa D'Or
      refreshTacticalState();
      mapView.recenter(driverPos(), false);
      void startFishingRoute();
      break;
    }
    case 'maracana': {
      const mVenue = RIO_VENUES.find((v) => v.id === 'maracana')!;
      const now = nowDate();
      const ev = parseFlyer({
        rawText: 'Final no Maracanã lotado! Término às 23h45',
        venueName: mVenue.name,
        venue: mVenue.pos,
        escape: mVenue.escape,
        escapeCorner: mVenue.escapeCorner,
        crowd: 65000,
        baseDate: now,
      });
      ev.estimatedEnd = now.getTime() + 25 * 60000;
      ev.goldenArrival = now.getTime();
      events = [ev, ...events.filter((e) => e.id !== ev.id)];
      loc.teleport([-43.2180, -22.9220]); // Tijuca / Praça Saens Peña
      refreshTacticalState();
      triggerEventConvocation(ev, 25);
      break;
    }
    case 'enem': {
      setSimulatedHour(12.25);
      settings.rainOverride = 'off';
      loc.teleport([-43.2355, -22.9125]); // UERJ Maracanã
      const enemDate = new Date('2026-11-08T12:15:00'); // 2º domingo de novembro
      const enemEvents = getSeasonalExpectedEvents(enemDate);
      if (enemEvents.length) {
        events = [...enemEvents, ...events.filter((e) => !e.id.startsWith('enem_'))];
        triggerEventConvocation(enemEvents[0], 45);
      }
      refreshTacticalState();
      mapView.recenter(driverPos(), false);
      break;
    }
    case 'holiday_eve': {
      setSimulatedHour(16.5);
      settings.rainOverride = 'off';
      loc.teleport([-43.2095, -22.8995]); // Rodoviária Novo Rio
      const eveEvents = getSeasonalExpectedEvents(new Date('2026-11-14T16:30:00')); // Véspera de Proclamação da República
      if (eveEvents.length) {
        events = [...eveEvents, ...events.filter((e) => !e.id.startsWith('eve_'))];
      }
      refreshTacticalState();
      mapView.recenter(driverPos(), false);
      void startFishingRoute();
      break;
    }
    case 'rain_metro': {
      setSimulatedHour(18.25);
      settings.rainOverride = 'on';
      loc.teleport([-43.1845, -22.9510]); // Metrô Botafogo
      refreshTacticalState();
      mapView.recenter(driverPos(), false);
      void startFishingRoute();
      break;
    }
    case 'dead_centro': {
      setSimulatedHour(23.35);
      settings.rainOverride = 'off';
      // Ponto afastado em área portuária/industrial vazia à noite
      loc.teleport([-43.2125, -22.8815]);
      refreshTacticalState();
      mapView.recenter(driverPos(), false);
      triggerDeadZoneAlert();
      break;
    }
    case 'sdu_lunch': {
      setSimulatedHour(12.5);
      settings.rainOverride = 'off';
      loc.teleport([-43.1770, -22.9045]); // Av. Rio Branco
      refreshTacticalState();
      mapView.recenter(driverPos(), false);
      void startFishingRoute();
      break;
    }
    case 'lapa_night': {
      setSimulatedHour(2.4);
      settings.rainOverride = 'off';
      loc.teleport([-43.1797, -22.9132]); // Arcos da Lapa
      refreshTacticalState();
      mapView.recenter(driverPos(), false);
      void startFishingRoute();
      break;
    }
  }
}

/* ---------------- Busca de Endereços (Autocomplete) ---------------- */

let searchAbort: AbortController | null = null;
let searchTimer: number | null = null;

function setupSearch() {
  const input = $('search') as HTMLInputElement;
  const resultsEl = $('results');

  input.oninput = () => {
    const q = input.value.trim();
    if (searchTimer) clearTimeout(searchTimer);
    if (q.length < 3) {
      resultsEl.innerHTML = '';
      return;
    }
    searchTimer = window.setTimeout(async () => {
      searchAbort?.abort();
      searchAbort = new AbortController();
      try {
        const places = await searchPlaces(q, driverPos(), searchAbort.signal);
        renderSearchResults(places);
      } catch {
        /* ignore abort */
      }
    }, 280);
  };

  function renderSearchResults(places: Place[]) {
    resultsEl.innerHTML = places
      .map(
        (p, i) => `
        <button data-place="${i}">
          <b>${p.label}</b>
          <small>${p.detail || `${formatDistance(haversine(driverPos(), p.pos))} de distância`}</small>
        </button>`,
      )
      .join('');
    resultsEl.querySelectorAll<HTMLButtonElement>('button[data-place]').forEach((b) => {
      b.onclick = () => {
        const chosen = places[Number(b.dataset.place)];
        resultsEl.innerHTML = '';
        input.value = '';
        checkVeteranoAlternativeAdvice(chosen.pos, chosen.label, (dest, lbl) => {
          void previewRouteTo(dest, lbl, activeTrip ? 'corrida' : 'destino');
        });
      };
    });
  }
}

/* ---------------- Central de Operações (Torre de Controle PC) ---------------- */

function openCentralMode() {
  $('splash').classList.add('hidden');
  $('drawer').classList.add('hidden');
  document.body.classList.add('central-mode');
  $('central-dock').classList.remove('hidden');
  centralDashboard?.render();
  setTimeout(() => mapView.map.resize(), 100);
}

function closeCentralMode() {
  document.body.classList.remove('central-mode');
  $('central-dock').classList.add('hidden');
  setTimeout(() => mapView.map.resize(), 100);
}

function showDispatcherMessageModal(msg: DispatcherMessage) {
  voice.beep('alert');
  voice.speak(`Mensagem da Central: ${msg.message}`, true);

  const ov = $('overlay');
  ov.classList.remove('hidden');
  ov.innerHTML = `
    <div class="alert-box call" style="background:var(--panel);border:2px solid var(--yellow);text-align:left;max-width:460px;color:var(--text);box-shadow:0 12px 40px rgba(0,0,0,0.6)">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <span style="font-size:30px">📻</span>
        <div>
          <h2 style="margin:0;font-size:19px;color:var(--yellow)">Ordem da Central de Operações</h2>
          <small class="dim-text">Recebido às ${new Date(msg.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</small>
        </div>
      </div>
      <p style="font-size:16px;font-weight:700;margin:10px 0">${msg.message}</p>
      <div class="row" style="margin-top:14px">
        <button id="msg-close" class="big ghost">Ciente</button>
        ${
          msg.targetPos
            ? `<button id="msg-go" class="big green">🧭 Ir p/ ${msg.targetLabel || 'Destino'} ▶</button>`
            : ''
        }
      </div>
    </div>
  `;
  $('msg-close').onclick = () => ov.classList.add('hidden');
  const goBtn = document.getElementById('msg-go');
  if (goBtn && msg.targetPos) {
    goBtn.onclick = () => {
      ov.classList.add('hidden');
      void startNavigationTo(
        [driverPos(), msg.targetPos!],
        'pesca',
        msg.targetLabel || 'Ordem da Central',
      );
    };
  }
}

/* ---------------- Menu de Clique Longo no Mapa ---------------- */

function showContextMenu(pos: LngLat, screen: { x: number; y: number }) {
  const menu = $('ctxmenu');
  menu.style.left = `${Math.min(window.innerWidth - 240, Math.max(8, screen.x))}px`;
  menu.style.top = `${Math.min(window.innerHeight - 270, Math.max(8, screen.y))}px`;
  menu.classList.remove('hidden');
  menu.innerHTML = `
    <button id="cm-pick">📍 Selecionar Ponto p/ Central</button>
    <button id="cm-nav">🧭 Navegar até aqui</button>
    <button id="cm-gnv">⛽ Postos de GNV por Perto</button>
    <button id="cm-tp">🚕 Teleportar táxi para cá (Sim)</button>
    <button id="cm-blitz">🚨 Reportar Blitz aqui</button>
    <button id="cm-dead">🚧 Marcar Rua Morta aqui</button>
    <button id="cm-close" class="dim-text">Cancelar</button>
  `;
  const hide = () => menu.classList.add('hidden');
  $('cm-gnv').onclick = () => {
    hide();
    showGnvManagerModal();
  };
  $('cm-pick').onclick = async () => {
    hide();
    const street = await reverseGeocode(pos);
    centralPickedPoint = { pos, street };
    toast(`📍 Ponto selecionado na Central: ${street}`);
    centralDashboard?.render();
  };
  $('cm-nav').onclick = async () => {
    hide();
    const label = await reverseGeocode(pos);
    checkVeteranoAlternativeAdvice(pos, label, (dest, lbl) => {
      void previewRouteTo(dest, lbl, activeTrip ? 'corrida' : 'destino');
    });
  };
  $('cm-tp').onclick = () => {
    hide();
    loc.setMode('sim');
    loc.teleport(pos);
    refreshTacticalState();
    toast('Táxi teleportado!');
  };
  $('cm-blitz').onclick = () => {
    hide();
    void addReportAt('BLITZ', pos);
  };
  $('cm-dead').onclick = () => {
    hide();
    void addReportAt('DEAD_ZONE', pos);
  };
  $('cm-close').onclick = hide;
}

/* ---------------- Inicialização ---------------- */

function applyTheme(theme: 'dark' | 'light') {
  settings.theme = theme;
  save('settings', settings);
  document.body.classList.toggle('light-theme', theme === 'light');
  mapView.setTheme(theme);
  const btn = $('btn-theme');
  if (btn) {
    btn.textContent = theme === 'light' ? '🌙' : '☀️';
    btn.title = theme === 'light' ? 'Alternar para Modo Escuro' : 'Alternar para Modo Claro (Alto Contraste)';
  }
}

function bindEvents() {
  $('btn-theme').onclick = () => {
    const next = settings.theme === 'light' ? 'dark' : 'light';
    applyTheme(next);
    toast(next === 'light' ? '☀️ Modo Claro ativado (Alto contraste solar)' : '🌙 Modo Escuro ativado');
  };

  $('btn-start').onclick = () => {
    voice.unlock();
    void requestScreenWakeLock();
    $('splash').classList.add('hidden');
    // Na edição Showcase, inicia no Modo Simulador GPS por padrão para reprodutibilidade imediata
    loc.setMode('sim');
    const shift = getShift(nowDate());
    toast('🧪 Modo Simulador GPS ativado (Showcase Demo)');
    voice.speak(`Modo de demonstração ativado. Turno atual: ${shift.title}. ${shift.veteranDirective}`);
  };

  $('btn-start-central').onclick = () => {
    voice.unlock();
    openCentralMode();
  };

  $('central-close').onclick = () => {
    closeCentralMode();
  };

  $('btn-voice').onclick = () => {
    voice.enabled = !voice.enabled;
    settings.voice = voice.enabled;
    save('settings', settings);
    $('btn-voice').textContent = voice.enabled ? '🔊' : '🔇';
    toast(voice.enabled ? 'Voz ativada' : 'Voz silenciada');
  };
  $('btn-voice').textContent = voice.enabled ? '🔊' : '🔇';

  $('btn-repeat').onclick = () => {
    if (lastCommandText) voice.speak(lastCommandText, true);
  };

  $('btn-recenter').onclick = () => {
    mapView.recenter(driverPos(), !!nav);
  };

  $('gnv-chip').onclick = (e) => {
    e.stopPropagation();
    showGnvManagerModal();
  };

  $('command').onclick = () => {
    const isExp = $('command').classList.toggle('expanded');
    const icon = document.getElementById('cmd-expand-btn');
    if (icon) icon.textContent = isExp ? '▲' : '▼';
  };

  const sheetHandle = document.getElementById('sheet-handle');
  if (sheetHandle) {
    sheetHandle.onclick = () => {
      const isMin = $('sheet').classList.toggle('minimized');
      const lbl = document.getElementById('sheet-handle-label');
      if (lbl) {
        lbl.textContent = isMin ? '▲ Expandir painel tático' : '▼ Minimizar painel · Ver mapa';
      }
    };
  }

  $('btn-pesca').onclick = () => void startFishingRoute();
  $('btn-trip').onclick = () => startPassengerTrip();
  $('btn-trip-end').onclick = () => finishPassengerTrip();

  $('btn-preview-cancel').onclick = () => {
    previewState = null;
    mapView.setRoute(null);
    mapView.setAlternatives([], 0);
    syncBottomPanels();
  };

  $('btn-preview-go').onclick = () => {
    if (!previewState) return;
    const { routes, selected, kind, label, dest } = previewState;
    void startNavigationTo([driverPos(), dest], kind, label, routes[selected]);
  };

  $('btn-nav-stop').onclick = () => stopNavigation();
  $('btn-nav-overview').onclick = () => {
    if (nav) mapView.fitRoute(nav.route);
  };

  document.querySelectorAll<HTMLButtonElement>('button[data-report]').forEach((b) => {
    b.onclick = () => void addReportAt(b.dataset.report as ReportType);
  });

  document.querySelectorAll<HTMLButtonElement>('#tabs button').forEach((b) => {
    b.onclick = () => switchTab(b.dataset.tab as typeof activeTab);
  });

  $('drawer-close').onclick = () => switchTab('map');

  mapView.onLongPress = (pos, pt) => showContextMenu(pos, pt);
  mapView.onReportClick = (r) => showReportDetailsModal(r);
  mapView.onAltClick = (idx) => {
    if (!previewState) return;
    previewState.selected = idx;
    renderPreview();
  };
  document.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest('#ctxmenu')) $('ctxmenu').classList.add('hidden');
  });

  setupSearch();
}

let wakeLockSentinel: any = null;

async function requestScreenWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLockSentinel = await (navigator as any).wakeLock.request('screen');
    }
  } catch {
    /* silencioso se não suportado */
  }
}

let deferredPwaPrompt: any = null;

function showInstallGuideModal() {
  const ov = $('overlay');
  ov.classList.remove('hidden');
  ov.innerHTML = `
    <div class="alert-box" style="background:var(--panel);border:2px solid #10b981;text-align:left;max-width:440px;color:var(--text)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:28px">📲</span>
          <div>
            <h2 style="margin:0;font-size:18px;color:var(--text)">Instalar App no Celular</h2>
            <small class="dim-text">Tela cheia sem barra de navegador</small>
          </div>
        </div>
        <button id="pwa-guide-close" class="ghost" style="padding:4px 10px">✕</button>
      </div>
      <div class="card" style="margin-bottom:10px;border-left:4px solid #10b981">
        <b style="font-size:14px;display:block;margin-bottom:4px">🤖 No Android (Chrome / Samsung / Edge):</b>
        <ol style="margin:4px 0;padding-left:18px;font-size:13px;line-height:1.5">
          <li>Toque nos <b>3 pontinhos (⋮)</b> no canto superior direito do Chrome (ao lado do endereço).</li>
          <li>Toque em <b>"Instalar aplicativo"</b> ou <b>"Adicionar à tela inicial"</b>.</li>
          <li>Confirme em <b>Instalar</b> — o ícone 🚕 <b>Taxi Copilot</b> aparecerá junto aos seus aplicativos!</li>
        </ol>
      </div>
      <div class="card" style="margin-bottom:12px;border-left:4px solid #3b82f6">
        <b style="font-size:14px;display:block;margin-bottom:4px">🍎 No iPhone (Safari):</b>
        <ol style="margin:4px 0;padding-left:18px;font-size:13px;line-height:1.5">
          <li>Toque no ícone <b>Compartilhar (⬆️)</b> na barra inferior.</li>
          <li>Role e toque em <b>"Adicionar à Tela de Início"</b>.</li>
        </ol>
      </div>
      <button id="pwa-guide-ok" class="big green">Entendi!</button>
    </div>
  `;
  $('pwa-guide-close').onclick = () => ov.classList.add('hidden');
  $('pwa-guide-ok').onclick = () => ov.classList.add('hidden');
}

function setupPwa() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => void 0);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && wakeLockSentinel) {
      void requestScreenWakeLock();
    }
  });

  const installBtn = document.getElementById('btn-install-pwa');

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPwaPrompt = e;
    installBtn?.classList.remove('hidden');
  });

  if (installBtn) {
    installBtn.onclick = async () => {
      if (deferredPwaPrompt) {
        deferredPwaPrompt.prompt();
        const choice = await deferredPwaPrompt.userChoice;
        if (choice?.outcome === 'accepted') {
          toast('📲 Instalando Taxi Copilot no seu aparelho...');
        }
        deferredPwaPrompt = null;
      } else {
        showInstallGuideModal();
      }
    };
  }
}

async function boot() {
  bindEvents();
  setupPwa();
  applyTheme(settings.theme || 'dark');

  centralDashboard = new CentralDashboard({
    cloud,
    getEvents: () => events,
    getHazards: () => reports,
    getTelemetry: () => telemetryList,
    getPickedPoint: () => centralPickedPoint,
    focusMapOn: (pos, zoom = 15) => {
      mapView.follow = false;
      mapView.map.easeTo({ center: pos, zoom, duration: 700 });
    },
    toast,
    nowDate,
    onClearShift: () => {
      trips = [];
      save('trips', trips);
      emptyMetersSinceLastTrip = 0;
      gnvState.kmSinceRefuel = 0;
      save('gnv_state', gnvState);
      pushCurrentTelemetry();
      if (activeTab === 'ganhos') renderDrawer();
    },
  });

  loc.onFix(onLocationFix);
  loc.onError = (msg) => toast(msg);
  loc.startSimTimer();

  await mapView.ready;
  refreshTacticalState();

  // Inicia sincronia em tempo real com o banco Supabase
  void cloud.start({
    onTripsLogChange: () => {
      centralDashboard?.render();
    },
    onEventsChange: (list, newlyAdded) => {
      cloudEvents = list;
      refreshTacticalState();
      if (activeTab === 'radar') renderDrawer();
      centralDashboard?.render();
      if (newlyAdded && !document.body.classList.contains('central-mode')) {
        voice.beep('ok');
        voice.speak(
          `Nova oportunidade publicada pela Central: ${newlyAdded.venueName}. Horário de ouro às ${hhmm(newlyAdded.goldenArrival)}.`,
        );
        toast(`🎤 Novo evento da Central: ${newlyAdded.title}`);
      }
    },
    onHazardsChange: (list, newlyAdded) => {
      reports = list;
      save('reports', reports);
      refreshTacticalState();
      if (activeTab === 'ganhos') renderDrawer();
      centralDashboard?.render();
      if (newlyAdded && !document.body.classList.contains('central-mode')) {
        const originLabel = newlyAdded.id.startsWith('wz_')
          ? 'Waze'
          : newlyAdded.id.startsWith('cor_')
            ? 'COR-Rio'
            : 'Central';
        voice.beep('alert');
        voice.speak(`Alerta ${originLabel}: ${REPORT_META[newlyAdded.type].label} em ${newlyAdded.street}.`);
        toast(`${REPORT_META[newlyAdded.type].emoji} [${originLabel}] ${newlyAdded.street}`);
      }
    },
    onTelemetryChange: (list) => {
      telemetryList = list;
      centralDashboard?.render();
    },
    onDispatcherMessage: (msg) => {
      if (!document.body.classList.contains('central-mode')) {
        showDispatcherMessageModal(msg);
      }
    },
    onStatusChange: (connected, lastSyncMs) => {
      centralDashboard?.updateSyncBadge(connected, lastSyncMs);
      if (activeTab === 'radar') renderDrawer();
    },
  });

  // Se abrir com ?central=1 na URL, entra direto na Torre de Controle
  if (new URLSearchParams(window.location.search).get('central') === '1') {
    openCentralMode();
  }

  fetchWeather(RIO_CENTER)
    .then((w) => {
      weather = w;
      refreshTacticalState();
    })
    .catch(() => void 0);

  // Sincronização autônoma de trânsito aberto (Waze / COR-Rio) no boot
  void cloud.syncOpenTrafficFeeds();

  setInterval(() => refreshTacticalState(), 30000);

  // Varredura autônoma periódica de Waze & COR-Rio (a cada 6 minutos, com throttle interno)
  setInterval(() => {
    void cloud.syncOpenTrafficFeeds();
  }, 6 * 60000);
}

void boot();

// Expõe objetos no window para inspeção rápida no console/testes
(window as any).copilot = {
  RIO_ZONES,
  RIO_VENUES,
  loc,
  mapView,
  cloud,
  openCentralMode,
  closeCentralMode,
  runScenario,
  startFishingRoute,
  triggerDeadZoneAlert,
};
