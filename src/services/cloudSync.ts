/**
 * Camada de Sincronização Híbrida (Showcase Sandbox & Supabase Realtime Adapter).
 *
 * Na edição de Portfólio (Showcase Edition), este serviço opera por padrão em
 * **Modo Demo / Sandbox Independente (`DEMO_SANDBOX`)**:
 *  - Zero conexão com servidores ou telemetria de produção (100% isolado e privado).
 *  - Barramento em tempo real entre abas via `BroadcastChannel` + `localStorage` isolado.
 *  - Base demonstrativa pré-populada com corridas sintéticas, abastecimentos, eventos
 *    com Horário de Ouro dinâmico e ocorrências de trânsito demonstrativas.
 *
 * Caso `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` sejam fornecidos no `.env`,
 * o adaptador ativa automaticamente o canal WebSocket PostgreSQL Realtime.
 */
import { createClient, type SupabaseClient, type RealtimeChannel } from '@supabase/supabase-js';
import type { EventCategory, Opportunity, TrafficReport, TripRecord } from '../engine/types';
import type { RefuelRecord } from '../engine/gnvTracker';
import type { LngLat } from '../engine/geo';
import { load, save } from './store';

const ENV_SUPABASE_URL = (import.meta as any).env?.VITE_SUPABASE_URL || '';
const ENV_SUPABASE_KEY = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || '';

export interface DriverTelemetry {
  driverId: string;
  driverName: string;
  pos: LngLat;
  speedKmh: number;
  heading: number;
  status: 'IDLE' | 'FISHING' | 'ON_TRIP' | 'EVENT_INTERCEPT';
  currentShift: string;
  activeDestination: string | null;
  totalFareToday: number;
  tripsCountToday: number;
  paidKmToday: number;
  emptyKmToday: number;
  recentTrips: TripRecord[];
  updatedAt: number;
}

export interface DispatcherMessage {
  id: string;
  message: string;
  priority: 'normal' | 'urgent';
  targetPos?: LngLat;
  targetLabel?: string;
  createdAt: number;
}

export interface TaxiTripLog {
  id: string;
  driverId: string;
  driverName: string;
  startTime: number;
  endTime: number;
  durationMin: number;
  fare: number;
  distanceKm: number;
  emptyKmBefore: number;
  pickupZone: string;
  dropoffLng?: number;
  dropoffLat?: number;
  shiftId: string;
  shiftName: string;
  estimatedGnvCost: number;
  netProfit: number;
  createdAt?: number;
}

export interface TaxiRefuelLog {
  id: string;
  driverId: string;
  timestamp: number;
  totalCost: number;
  volumeM3: number;
  pricePerM3: number;
  stationName: string;
  dotsBefore: number;
  dotsAfter: number;
  createdAt?: number;
}

export interface CloudSyncCallbacks {
  onEventsChange?: (events: Opportunity[], newlyAdded?: Opportunity) => void;
  onHazardsChange?: (hazards: TrafficReport[], newlyAdded?: TrafficReport) => void;
  onTelemetryChange?: (telemetry: DriverTelemetry[]) => void;
  onTripsLogChange?: () => void;
  onDispatcherMessage?: (msg: DispatcherMessage) => void;
  onStatusChange?: (connected: boolean, lastSyncMs: number) => void;
}

/* =====================================================================
 * GERADORES DE DADOS SINTÉTICOS (MODO SHOWCASE / PORTFÓLIO)
 * ===================================================================== */

export function buildSyntheticShowcaseEvents(baseNow = Date.now()): Opportunity[] {
  const min = 60000;
  const hr = 3600000;
  const fmtHm = (ms: number) =>
    new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  const defs = [
    {
      id: 'demo_ev_vivorio',
      title: 'Festival de Música Brasileira · Vivo Rio (Demo)',
      venueName: 'Vivo Rio (Aterro do Flamengo)',
      category: 'SHOW_NOTURNO' as EventCategory,
      venue: [-43.17142, -22.91389] as LngLat,
      escape: [-43.17142, -22.91389] as LngLat,
      escapeCorner: 'Av. Beira-Mar (altura da passarela do MAM, sentido Zona Sul)',
      startOffset: -110 * min,
      endOffset: 32 * min,
      leadMin: 25,
      crowd: 3500,
      score: 96,
      platform: 'vivorio-demo',
      instructionCore:
        'Evite o retorno interno do MAM. Posicione-se na faixa direita da Av. Beira-Mar sentido Zona Sul.',
    },
    {
      id: 'demo_ev_maracana',
      title: 'Clássico Carioca · Estádio do Maracanã (Demo)',
      venueName: 'Estádio do Maracanã',
      category: 'SHOW_ESTADIO' as EventCategory,
      venue: [-43.23018, -22.91216] as LngLat,
      escape: [-43.23418, -22.91025] as LngLat,
      escapeCorner: 'Rua São Francisco Xavier esq. Eurico Rabelo (Sentido Rebouças)',
      startOffset: -60 * min,
      endOffset: 65 * min,
      leadMin: 35,
      crowd: 54000,
      score: 99,
      platform: 'maracana-demo',
      instructionCore:
        'Entorno imediato com interdição viária planejada. Aguarde na Rua São Francisco Xavier com saída limpa para o Túnel Rebouças.',
    },
    {
      id: 'demo_ev_qualistage',
      title: 'Turnê Nacional Pop Rock · Qualistage (Demo)',
      venueName: 'Qualistage (Via Parque · Barra)',
      category: 'SHOW_NOTURNO' as EventCategory,
      venue: [-43.36521, -22.98395] as LngLat,
      escape: [-43.36521, -22.98395] as LngLat,
      escapeCorner: 'Pista lateral da Av. Ayrton Senna (80m após saída Sul)',
      startOffset: -30 * min,
      endOffset: 2.2 * hr,
      leadMin: 25,
      crowd: 4000,
      score: 92,
      platform: 'ticketmaster-demo',
      instructionCore:
        'Aguarde na agulha da pista lateral da Av. Ayrton Senna para rápido acesso à Linha Amarela ou Av. das Américas.',
    },
    {
      id: 'demo_ev_expomag',
      title: 'Congresso Médico & Saúde Digital · ExpoMag (Demo)',
      venueName: 'ExpoMag (Cidade Nova)',
      category: 'CONGRESSO' as EventCategory,
      venue: [-43.20542, -22.91081] as LngLat,
      escape: [-43.20542, -22.91081] as LngLat,
      escapeCorner: 'Rua Beatriz Larragoiti Lucas (Sentido SDU / Zona Sul)',
      startOffset: -4 * hr,
      endOffset: 3.5 * hr,
      leadMin: 25,
      crowd: 2400,
      score: 89,
      platform: 'expomag-demo',
      instructionCore:
        'Demanda corporativa de alto tíquete com deslocamento frequente para o Aeroporto Santos Dumont e rede hoteleira.',
    },
  ];

  return defs.map((d) => {
    const startMs = baseNow + d.startOffset;
    const endMs = baseNow + d.endOffset;
    const goldenMs = endMs - d.leadMin * min;
    return {
      id: d.id,
      title: d.title,
      venueName: d.venueName,
      category: d.category,
      venue: d.venue,
      escape: d.escape,
      escapeCorner: d.escapeCorner,
      eventStart: startMs,
      estimatedEnd: endMs,
      goldenArrival: goldenMs,
      expectedCrowd: d.crowd,
      demandScore: d.score,
      driverInstruction: `[POSICIONAR ÀS ${fmtHm(goldenMs)}] ${d.instructionCore} | Dispersão prevista: ~${d.crowd.toLocaleString('pt-BR')} pessoas às ${fmtHm(endMs)}.`,
      source: 'curadoria',
      platform: d.platform,
    };
  });
}

export function buildSyntheticShowcaseHazards(baseNow = Date.now()): TrafficReport[] {
  const hr = 3600000;
  return [
    {
      id: 'cor_demo_reboucas',
      type: 'ROAD_CLOSED',
      street: 'Túnel Rebouças (Faixa reversível em manutenção preventiva CET-Rio · Demo)',
      pos: [-43.20810, -22.94920],
      createdAt: baseNow - 25 * 60000,
      expiresAt: baseNow + 3 * hr,
    },
    {
      id: 'wz_demo_vermelha',
      type: 'HEAVY_TRAFFIC',
      street: 'Linha Vermelha (Altura Caju · Retenção sentido Centro · Demo)',
      pos: [-43.21850, -22.88310],
      createdAt: baseNow - 15 * 60000,
      expiresAt: baseNow + 2 * hr,
    },
    {
      id: 'cor_demo_maracana',
      type: 'ROAD_CLOSED',
      street: 'Entorno do Maracanã (Esquema especial Rua Prof. Eurico Rabelo · Demo)',
      pos: [-43.23418, -22.91025],
      createdAt: baseNow - 40 * 60000,
      expiresAt: baseNow + 4 * hr,
    },
  ];
}

export function buildSyntheticShowcaseTrips(baseNow = Date.now()): TaxiTripLog[] {
  const min = 60000;
  const hr = 3600000;
  const raw = [
    {
      id: 'demo_tr_1',
      agoMin: 380,
      durMin: 22,
      fare: 42.5,
      distKm: 11.2,
      emptyKm: 1.4,
      pickupZone: 'Tijuca · Praça Saens Peña',
      shiftId: 'EARLY_RESIDENTIAL',
      shiftName: '06h00 - 09h00 · Saída Residencial',
    },
    {
      id: 'demo_tr_2',
      agoMin: 310,
      durMin: 18,
      fare: 34.0,
      distKm: 7.8,
      emptyKm: 0.9,
      pickupZone: "Hospital Copa D'Or (Copacabana)",
      shiftId: 'HOSPITALS_AND_CLINICS',
      shiftName: '09h00 - 11h30 · Circuito de Hospitais',
    },
    {
      id: 'demo_tr_3',
      agoMin: 250,
      durMin: 16,
      fare: 31.5,
      distKm: 6.9,
      emptyKm: 1.1,
      pickupZone: 'Hospital Samaritano (Botafogo)',
      shiftId: 'HOSPITALS_AND_CLINICS',
      shiftName: '09h00 - 11h30 · Circuito de Hospitais',
    },
    {
      id: 'demo_tr_4',
      agoMin: 185,
      durMin: 28,
      fare: 58.0,
      distKm: 14.6,
      emptyKm: 1.8,
      pickupZone: 'Aeroporto Santos Dumont (SDU)',
      shiftId: 'CORPORATE_LUNCH',
      shiftName: '11h30 - 14h30 · Almoço Executivo & SDU',
    },
    {
      id: 'demo_tr_5',
      agoMin: 130,
      durMin: 19,
      fare: 36.8,
      distKm: 8.4,
      emptyKm: 1.2,
      pickupZone: 'Rodoviária Novo Rio (Desembarque)',
      shiftId: 'MARKETS_AND_TERMINALS',
      shiftName: '14h30 - 17h00 · Mercados & Terminais',
    },
    {
      id: 'demo_tr_6',
      agoMin: 75,
      durMin: 24,
      fare: 47.2,
      distKm: 10.5,
      emptyKm: 0.8,
      pickupZone: 'Metrô Botafogo (Saída São Clemente)',
      shiftId: 'METRO_EXITS_RUSH',
      shiftName: '17h00 - 20h00 · Rush & Saídas de Metrô',
    },
    {
      id: 'demo_tr_7',
      agoMin: 35,
      durMin: 21,
      fare: 44.0,
      distKm: 9.6,
      emptyKm: 1.0,
      pickupZone: 'Leblon · Rua Dias Ferreira',
      shiftId: 'NIGHT_LEISURE',
      shiftName: '20h00 - 00h30 · Gastronomia & Teatros',
    },
  ];

  return raw.map((r) => {
    const endTime = baseNow - r.agoMin * min;
    const startTime = endTime - r.durMin * min;
    const gnvCost = Math.round((r.distKm / 12.5) * 4.29 * 100) / 100;
    const netProfit = Math.round((r.fare - gnvCost) * 100) / 100;
    return {
      id: r.id,
      driverId: 'demo-taxi-07',
      driverName: 'Táxi Demo #07 · Showcase RJ',
      startTime,
      endTime,
      durationMin: r.durMin,
      fare: r.fare,
      distanceKm: r.distKm,
      emptyKmBefore: r.emptyKm,
      pickupZone: r.pickupZone,
      shiftId: r.shiftId,
      shiftName: r.shiftName,
      estimatedGnvCost: gnvCost,
      netProfit,
      createdAt: endTime - hr * 0,
    };
  });
}

export function buildSyntheticShowcaseRefuels(baseNow = Date.now()): TaxiRefuelLog[] {
  return [
    {
      id: 'demo_ref_1',
      driverId: 'demo-taxi-07',
      timestamp: baseNow - 4 * 3600000,
      totalCost: 54.8,
      volumeM3: 13.08,
      pricePerM3: 4.19,
      stationName: 'Posto Shell Radial Oeste (220 BAR · Demo)',
      dotsBefore: 1,
      dotsAfter: 4,
      createdAt: baseNow - 4 * 3600000,
    },
  ];
}

/* =====================================================================
 * SERVIÇO PRINCIPAL DE SINCRONIZAÇÃO (SANDBOX + SUPABASE ADAPTER)
 * ===================================================================== */

export class CloudSyncService {
  public readonly isSandboxMode: boolean;
  public client: SupabaseClient | null = null;
  public channel: RealtimeChannel | null = null;
  private bus: BroadcastChannel | null = null;
  private callbacks: CloudSyncCallbacks = {};
  private knownEventIds = new Set<string>();
  private knownHazardIds = new Set<string>();
  public connected = false;
  public lastSyncMs = 0;
  public lastOpenFeedSyncMs = 0;

  constructor(url = ENV_SUPABASE_URL, key = ENV_SUPABASE_KEY) {
    this.isSandboxMode = !url || !key;
    if (!this.isSandboxMode) {
      this.client = createClient(url, key, {
        auth: { persistSession: false },
      });
    } else if (typeof BroadcastChannel !== 'undefined') {
      this.bus = new BroadcastChannel('taxi-copilot-showcase-bus');
      this.bus.onmessage = (ev) => this.handleSandboxBroadcast(ev.data);
    }
    this.ensureSandboxSeeded();
  }

  private ensureSandboxSeeded() {
    if (!this.isSandboxMode) return;
    const seeded = load<boolean>('sandbox_seeded_v1', false);
    if (!seeded) {
      const now = Date.now();
      save('db_events', buildSyntheticShowcaseEvents(now));
      save('db_hazards', buildSyntheticShowcaseHazards(now));
      const synthTrips = buildSyntheticShowcaseTrips(now);
      save('db_trips_log', synthTrips);
      save('db_refuels_log', buildSyntheticShowcaseRefuels(now));

      // Também popula as corridas locais iniciais se estiverem vazias
      const localTrips: TripRecord[] = synthTrips.map((t) => ({
        id: t.id,
        start: t.startTime,
        end: t.endTime,
        fare: t.fare,
        distanceKm: t.distanceKm,
        emptyKmBefore: t.emptyKmBefore,
        pickupZone: t.pickupZone,
        dropoff: [-43.1845, -22.9510] as LngLat,
        shiftId: t.shiftId as any,
      }));
      save('trips', localTrips);

      const initialTelemetry: DriverTelemetry = {
        driverId: 'demo-taxi-07',
        driverName: 'Táxi Demo #07 · Showcase RJ',
        pos: [-43.1845, -22.9510],
        speedKmh: 38,
        heading: 45,
        status: 'FISHING',
        currentShift: 'Demonstração Showcase (Simulador Ativo)',
        activeDestination: 'Circuito Zona Sul / Botafogo',
        totalFareToday: synthTrips.reduce((s, x) => s + x.fare, 0),
        tripsCountToday: synthTrips.length,
        paidKmToday: Math.round(synthTrips.reduce((s, x) => s + x.distanceKm, 0) * 10) / 10,
        emptyKmToday: Math.round(synthTrips.reduce((s, x) => s + x.emptyKmBefore, 0) * 10) / 10,
        recentTrips: localTrips,
        updatedAt: now,
      };
      save('db_telemetry', [initialTelemetry]);
      save('sandbox_seeded_v1', true);
    }
  }

  private handleSandboxBroadcast(payload: any) {
    if (!payload || typeof payload !== 'object') return;
    this.touchSync();
    switch (payload.type) {
      case 'EVENTS_UPDATED':
        void this.refreshEvents(true);
        break;
      case 'HAZARDS_UPDATED':
        void this.refreshHazards(true);
        break;
      case 'TELEMETRY_UPDATED':
        void this.refreshTelemetry();
        break;
      case 'TRIPS_UPDATED':
        this.callbacks.onTripsLogChange?.();
        break;
      case 'DISPATCHER_MSG':
        if (payload.msg) {
          this.callbacks.onDispatcherMessage?.(payload.msg as DispatcherMessage);
        }
        break;
    }
  }

  private broadcast(type: string, extra: Record<string, unknown> = {}) {
    try {
      this.bus?.postMessage({ type, ...extra });
    } catch {
      /* ignore */
    }
  }

  public async start(callbacks: CloudSyncCallbacks): Promise<void> {
    this.callbacks = callbacks;
    this.connected = true;
    await this.fetchInitialState();
    this.touchSync();
  }

  private touchSync() {
    this.lastSyncMs = Date.now();
    this.callbacks.onStatusChange?.(this.connected, this.lastSyncMs);
  }

  public async fetchInitialState(): Promise<void> {
    await Promise.all([
      this.refreshEvents(false),
      this.refreshHazards(false),
      this.refreshTelemetry(),
    ]);
    this.touchSync();
  }

  public async refreshEvents(notifyNew = false): Promise<Opportunity[]> {
    let list = load<Opportunity[]>('db_events', []);
    if (!list.length) {
      list = buildSyntheticShowcaseEvents(Date.now());
      save('db_events', list);
    }
    list.sort((a, b) => a.goldenArrival - b.goldenArrival);

    let newlyAdded: Opportunity | undefined;
    if (notifyNew) {
      newlyAdded = list.find((e) => !this.knownEventIds.has(e.id));
    }
    this.knownEventIds = new Set(list.map((e) => e.id));
    this.touchSync();
    this.callbacks.onEventsChange?.(list, newlyAdded);
    return list;
  }

  public async refreshHazards(notifyNew = false): Promise<TrafficReport[]> {
    const now = Date.now();
    let list = load<TrafficReport[]>('db_hazards', []).filter((h) => h.expiresAt > now);
    if (!list.length) {
      list = buildSyntheticShowcaseHazards(now);
      save('db_hazards', list);
    }

    let newlyAdded: TrafficReport | undefined;
    if (notifyNew) {
      newlyAdded = list.find((h) => !this.knownHazardIds.has(h.id));
    }
    this.knownHazardIds = new Set(list.map((h) => h.id));
    this.touchSync();
    this.callbacks.onHazardsChange?.(list, newlyAdded);
    return list;
  }

  public async refreshTelemetry(): Promise<DriverTelemetry[]> {
    const list = load<DriverTelemetry[]>('db_telemetry', []);
    this.touchSync();
    this.callbacks.onTelemetryChange?.(list);
    return list;
  }

  /** Publica ou atualiza um evento tático no Sandbox / Banco */
  public async publishEvent(opp: Opportunity): Promise<boolean> {
    const list = load<Opportunity[]>('db_events', []).filter((x) => x.id !== opp.id);
    list.push(opp);
    save('db_events', list);
    this.knownEventIds.add(opp.id);
    await this.refreshEvents(false);
    this.broadcast('EVENTS_UPDATED');
    return true;
  }

  /** Remove um evento tático do Sandbox / Banco */
  public async deleteEvent(id: string): Promise<boolean> {
    this.knownEventIds.delete(id);
    const list = load<Opportunity[]>('db_events', []).filter((x) => x.id !== id);
    save('db_events', list);
    await this.refreshEvents(false);
    this.broadcast('EVENTS_UPDATED');
    return true;
  }

  /** Executa a Varredura Tática Demonstrativa de Eventos RJ */
  public async runAutomatedHarvester(now: Date = new Date()): Promise<number> {
    const fresh = buildSyntheticShowcaseEvents(now.getTime());
    const current = load<Opportunity[]>('db_events', []);
    const map = new Map<string, Opportunity>();
    for (const item of [...current, ...fresh]) {
      map.set(item.id, item);
    }
    const merged = Array.from(map.values());
    save('db_events', merged);
    await this.refreshEvents(false);
    this.broadcast('EVENTS_UPDATED');
    return fresh.length;
  }

  /** Publica um bloqueio/blitz no Sandbox */
  public async publishHazard(
    report: TrafficReport,
    _origin: 'motorista' | 'central' = 'motorista',
  ): Promise<boolean> {
    this.knownHazardIds.add(report.id);
    const list = load<TrafficReport[]>('db_hazards', []).filter((x) => x.id !== report.id);
    list.unshift(report);
    save('db_hazards', list);
    await this.refreshHazards(false);
    this.broadcast('HAZARDS_UPDATED');
    return true;
  }

  /** Remove um bloqueio/blitz do Sandbox */
  public async deleteHazard(id: string): Promise<boolean> {
    this.knownHazardIds.delete(id);
    const list = load<TrafficReport[]>('db_hazards', []).filter((x) => x.id !== id);
    save('db_hazards', list);
    await this.refreshHazards(false);
    this.broadcast('HAZARDS_UPDATED');
    return true;
  }

  /** Publica múltiplos bloqueios em lote */
  public async batchPublishHazards(
    reports: TrafficReport[],
    _origin: 'motorista' | 'central' = 'central',
  ): Promise<number> {
    if (!reports.length) return 0;
    const current = load<TrafficReport[]>('db_hazards', []);
    const map = new Map<string, TrafficReport>();
    for (const r of [...current, ...reports]) {
      this.knownHazardIds.add(r.id);
      map.set(r.id, r);
    }
    save('db_hazards', Array.from(map.values()));
    await this.refreshHazards(false);
    this.broadcast('HAZARDS_UPDATED');
    return reports.length;
  }

  /** Simula a ingestão de incidentes viários no padrão Waze CCP (Dados Sintéticos Demo) */
  public async syncWazeHazards(): Promise<number> {
    const now = Date.now();
    const wazeAlerts: TrafficReport[] = [
      {
        id: 'wz_demo_reboucas_acc',
        type: 'ROAD_CLOSED',
        street: 'Túnel Rebouças (Galeria Central · Simulação Feed Waze CCP)',
        pos: [-43.20810, -22.94920],
        createdAt: now,
        expiresAt: now + 2 * 3600000,
      },
      {
        id: 'wz_demo_brasil_pm',
        type: 'BLITZ',
        street: 'Av. Brasil (Altura Bonsucesso · Simulação Fiscalização)',
        pos: [-43.25620, -22.86430],
        createdAt: now,
        expiresAt: now + 2.5 * 3600000,
      },
      {
        id: 'wz_demo_vermelha_jam',
        type: 'HEAVY_TRAFFIC',
        street: 'Linha Vermelha (Altura Caju · Retenção Simulada)',
        pos: [-43.21850, -22.88310],
        createdAt: now,
        expiresAt: now + 1.5 * 3600000,
      },
    ];

    return await this.batchPublishHazards(wazeAlerts, 'central');
  }

  /** Simula ocorrências do COR-Rio / CET-Rio (Dados Abertos Municipais) */
  public async syncCorRioHazards(): Promise<number> {
    const now = Date.now();
    const corAlerts: TrafficReport[] = [
      {
        id: 'cor_demo_sambodromo',
        type: 'ROAD_CLOSED',
        street: 'Entorno do Sambódromo / Apoteose (Esquema CET-Rio · Dados Abertos)',
        pos: [-43.19700, -22.91220],
        createdAt: now,
        expiresAt: now + 6 * 3600000,
      },
      {
        id: 'cor_demo_maracana',
        type: 'ROAD_CLOSED',
        street: 'Entorno do Maracanã (Interdição Rua Prof. Eurico Rabelo · CET-Rio)',
        pos: [-43.23418, -22.91025],
        createdAt: now,
        expiresAt: now + 4 * 3600000,
      },
      {
        id: 'cor_demo_amarela',
        type: 'HEAVY_TRAFFIC',
        street: 'Linha Amarela (Saída 4 Del Castilho · Manutenção COR-Rio)',
        pos: [-43.27980, -22.87950],
        createdAt: now,
        expiresAt: now + 3 * 3600000,
      },
    ];

    return await this.batchPublishHazards(corAlerts, 'central');
  }

  public async syncOpenTrafficFeeds(
    force = false,
  ): Promise<{ wazeCount: number; corCount: number; skipped?: boolean }> {
    const now = Date.now();
    if (!force && this.lastOpenFeedSyncMs > 0 && now - this.lastOpenFeedSyncMs < 4 * 60000) {
      return { wazeCount: 0, corCount: 0, skipped: true };
    }
    this.lastOpenFeedSyncMs = now;

    const [wazeCount, corCount] = await Promise.all([
      this.syncWazeHazards(),
      this.syncCorRioHazards(),
    ]);

    return { wazeCount, corCount };
  }

  /** Atualiza a telemetria sintética do veículo simulado no Sandbox */
  public async pushDriverTelemetry(t: Omit<DriverTelemetry, 'updatedAt'>): Promise<void> {
    const entry: DriverTelemetry = {
      ...t,
      driverId: 'demo-taxi-07',
      driverName: 'Táxi Demo #07 · Showcase RJ',
      updatedAt: Date.now(),
    };
    save('db_telemetry', [entry]);
    await this.refreshTelemetry();
    this.broadcast('TELEMETRY_UPDATED');
  }

  /** Envia um comando de voz/texto da Central para o Cockpit (via BroadcastChannel no modo Demo) */
  public async sendDispatcherMessage(
    message: string,
    priority: 'normal' | 'urgent' = 'normal',
    targetPos?: LngLat,
    targetLabel?: string,
  ): Promise<boolean> {
    const msg: DispatcherMessage = {
      id: `msg_${Date.now()}`,
      message,
      priority,
      targetPos,
      targetLabel,
      createdAt: Date.now(),
    };
    this.broadcast('DISPATCHER_MSG', { msg });
    this.callbacks.onDispatcherMessage?.(msg);
    return true;
  }

  /** Registra uma corrida finalizada na planilha demonstrativa */
  public async recordTripLog(
    trip: TripRecord,
    shiftName: string,
    gnvEstimate?: { costGnv: number; volumeM3: number },
  ): Promise<boolean> {
    const durationMin = Math.max(1, Math.round((trip.end - trip.start) / 60000));
    const gnvCost = gnvEstimate?.costGnv ?? Math.round((trip.distanceKm / 12.5) * 4.29 * 100) / 100;
    const netProfit = Math.round((trip.fare - gnvCost) * 100) / 100;

    const logItem: TaxiTripLog = {
      id: trip.id,
      driverId: 'demo-taxi-07',
      driverName: 'Táxi Demo #07 · Showcase RJ',
      startTime: trip.start,
      endTime: trip.end,
      durationMin,
      fare: trip.fare,
      distanceKm: trip.distanceKm,
      emptyKmBefore: trip.emptyKmBefore,
      pickupZone: trip.pickupZone,
      dropoffLng: trip.dropoff[0],
      dropoffLat: trip.dropoff[1],
      shiftId: trip.shiftId,
      shiftName,
      estimatedGnvCost: gnvCost,
      netProfit,
      createdAt: Date.now(),
    };

    const list = load<TaxiTripLog[]>('db_trips_log', []).filter((x) => x.id !== trip.id);
    list.unshift(logItem);
    save('db_trips_log', list);
    this.callbacks.onTripsLogChange?.();
    this.broadcast('TRIPS_UPDATED');
    return true;
  }

  /** Registra um abastecimento de GNV na planilha demonstrativa */
  public async recordRefuelLog(refuel: RefuelRecord): Promise<boolean> {
    const logItem: TaxiRefuelLog = {
      id: refuel.id,
      driverId: 'demo-taxi-07',
      timestamp: refuel.timestamp,
      totalCost: refuel.totalCost,
      volumeM3: refuel.volumeM3,
      pricePerM3: refuel.pricePerM3,
      stationName: refuel.stationName,
      dotsBefore: refuel.dotsBefore,
      dotsAfter: refuel.dotsAfter,
      createdAt: Date.now(),
    };
    const list = load<TaxiRefuelLog[]>('db_refuels_log', []).filter((x) => x.id !== refuel.id);
    list.unshift(logItem);
    save('db_refuels_log', list);
    this.callbacks.onTripsLogChange?.();
    this.broadcast('TRIPS_UPDATED');
    return true;
  }

  public async fetchTripsLog(limit = 100): Promise<TaxiTripLog[]> {
    const list = load<TaxiTripLog[]>('db_trips_log', []);
    return list.slice(0, limit);
  }

  public async fetchRefuelsLog(limit = 50): Promise<TaxiRefuelLog[]> {
    const list = load<TaxiRefuelLog[]>('db_refuels_log', []);
    return list.slice(0, limit);
  }

  public async deleteTripLog(id: string): Promise<boolean> {
    const list = load<TaxiTripLog[]>('db_trips_log', []).filter((x) => x.id !== id);
    save('db_trips_log', list);
    this.broadcast('TRIPS_UPDATED');
    return true;
  }

  public async clearTripsLog(_driverId = 'demo-taxi-07'): Promise<boolean> {
    save('db_trips_log', []);
    this.broadcast('TRIPS_UPDATED');
    return true;
  }

  /** Restaura os dados sintéticos de demonstração a qualquer momento */
  public async resetShowcaseDemoData(): Promise<void> {
    save('sandbox_seeded_v1', false);
    this.ensureSandboxSeeded();
    await this.fetchInitialState();
    this.callbacks.onTripsLogChange?.();
    this.broadcast('EVENTS_UPDATED');
    this.broadcast('HAZARDS_UPDATED');
    this.broadcast('TELEMETRY_UPDATED');
    this.broadcast('TRIPS_UPDATED');
  }
}
