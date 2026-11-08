import { describe, expect, it } from 'vitest';
import { getShift, rankZones, deadZoneCheck, RIO_CENTER } from './veteranBrain';
import { parseFlyer, parseJsonLd, RIO_VENUES, hhmm } from './eventDetector';
import {
  calculateEaster,
  getHolidaysForYear,
  getCalendarDayInfo,
  isEnemDate,
  getSeasonalExpectedEvents,
  getSeasonalCategoryMultiplier,
} from './calendarEngine';
import { buildInstruction } from '../nav/osrm';
import { NavSession } from '../nav/navigator';
import { cumulativeDistances, type LngLat } from './geo';
import { evaluateRouteSafety, checkCurrentPositionSafety, SAFE_ROUTING_GUIDELINES } from './safetyZones';
import {
  CloudSyncService,
  buildSyntheticShowcaseEvents,
  buildSyntheticShowcaseTrips,
} from '../services/cloudSync';

describe('Cérebro do Taxista Veterano (Rio de Janeiro)', () => {
  it('seleciona turnos corretos ao longo do dia', () => {
    expect(getShift(new Date('2026-11-06T06:30:00')).id).toBe('EARLY_RESIDENTIAL');
    expect(getShift(new Date('2026-11-06T09:15:00')).id).toBe('HOSPITALS_AND_CLINICS');
    expect(getShift(new Date('2026-11-06T12:30:00')).id).toBe('CORPORATE_LUNCH');
    expect(getShift(new Date('2026-11-06T15:30:00')).id).toBe('MARKETS_AND_TERMINALS');
    expect(getShift(new Date('2026-11-06T18:15:00')).id).toBe('METRO_EXITS_RUSH');
    expect(getShift(new Date('2026-11-06T22:00:00')).id).toBe('NIGHT_LEISURE');
    expect(getShift(new Date('2026-11-06T02:00:00')).id).toBe('LATE_NIGHT');
  });

  it('prioriza hospitais às 09h30 e saídas de metrô às 18h15 com chuva', () => {
    const morning = rankZones({
      now: new Date('2026-11-06T09:30:00'),
      rainLevel: 0,
      driver: [-43.188, -22.958],
      events: [],
      reports: [],
    });
    expect(morning[0].zone.category).toBe('HOSPITAL');

    const rushRain = rankZones({
      now: new Date('2026-11-06T18:15:00'),
      rainLevel: 2,
      driver: [-43.1845, -22.951],
      events: [],
      reports: [],
    });
    expect(rushRain[0].zone.category).toBe('METRO');
    expect(rushRain[0].parts.mClima).toBe(2.5);
  });

  it('detecta Zona Morta fora de corredores ativos e indica polo mais próximo', () => {
    const verdict = deadZoneCheck([-43.2125, -22.8815], {
      now: new Date('2026-11-06T23:30:00'),
      rainLevel: 0,
      events: [],
      reports: [],
    });
    expect(verdict.dead).toBe(true);
    expect(verdict.returnIndex).toBeLessThan(0.25);
    expect(verdict.nearestHot).toBeDefined();
  });
});

describe('Detector de Eventos Zero-Token', () => {
  it('calcula Horário de Ouro exatamente 25 minutos antes do término', () => {
    const maracana = RIO_VENUES[0];
    const opp = parseFlyer({
      rawText: 'Turnê no Maracanã! Abertura: 19h | Início 21h00 | Término às 23h45',
      venueName: maracana.name,
      venue: maracana.pos,
      escape: maracana.escape,
      escapeCorner: maracana.escapeCorner,
      baseDate: new Date('2026-11-06T12:00:00'),
    });
    expect(hhmm(opp.estimatedEnd)).toBe('23:45');
    expect(hhmm(opp.goldenArrival)).toBe('23:20');
    expect(opp.category).toBe('SHOW_ESTADIO');
  });

  it('decodifica Schema.org JSON-LD de sites de ingressos', () => {
    const sample = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'MusicEvent',
      name: 'Show no Vivo Rio',
      startDate: '2026-11-06T21:00:00-03:00',
      endDate: '2026-11-06T23:30:00-03:00',
      location: {
        '@type': 'Place',
        name: 'Vivo Rio',
        geo: { latitude: -22.9165, longitude: -43.1713 },
      },
      offers: { availability: 'https://schema.org/SoldOut' },
    });
    const list = parseJsonLd(sample);
    expect(list).toHaveLength(1);
    expect(list[0].demandScore).toBe(99);
    expect(hhmm(list[0].goldenArrival)).toBe('23:05');
  });
});

describe('Navegação Turn-by-Turn & Instruções em Português', () => {
  it('gera instruções naturais em português com gênero correto de logradouro', () => {
    expect(
      buildInstruction({
        name: 'Avenida Atlântica',
        maneuver: { type: 'turn', modifier: 'right', location: RIO_CENTER, bearingAfter: 90 },
      }),
    ).toBe('Vire à direita na Avenida Atlântica');

    expect(
      buildInstruction({
        name: 'Túnel Rebouças',
        maneuver: { type: 'continue', modifier: 'straight', location: RIO_CENTER, bearingAfter: 0 },
      }),
    ).toBe('Continue no Túnel Rebouças');
  });

  it('acompanha progresso na rota e dispara avisos de manobra', () => {
    const geom: LngLat[] = [
      [-43.18, -22.95],
      [-43.18, -22.948],
      [-43.178, -22.948],
    ];
    const cum = cumulativeDistances(geom);
    const session = new NavSession(
      {
        distance: cum[2],
        duration: 60,
        geometry: geom,
        cum,
        legEnds: [cum[2]],
        waypoints: [geom[0], geom[2]],
        steps: [
          {
            distance: cum[1],
            duration: 30,
            name: 'Rua Voluntários da Pátria',
            maneuver: { type: 'depart', location: geom[0], bearingAfter: 0 },
            startIndex: 0,
            startDist: 0,
            leg: 0,
            instruction: 'Siga na Rua Voluntários da Pátria',
          },
          {
            distance: cum[2] - cum[1],
            duration: 30,
            name: 'Rua Real Grandeza',
            maneuver: { type: 'turn', modifier: 'right', location: geom[1], bearingAfter: 90 },
            startIndex: 1,
            startDist: cum[1],
            leg: 0,
            instruction: 'Vire à direita na Rua Real Grandeza',
          },
        ],
      },
      'pesca',
      'Teste',
    );

    const u1 = session.update(geom[0], 8);
    expect(u1.cues[0]).toContain('Siga na Rua Voluntários da Pátria');
    const u2 = session.update(geom[2], 0);
    expect(u2.arrived).toBe(true);
  });
});

describe('Motor de Calendário Civil & Sazonalidade Urbana (Zero-Token)', () => {
  it('calcula feriados móveis e fixos de 2026', () => {
    const easter = calculateEaster(2026);
    expect(easter).toEqual({ day: 5, month: 4 }); // 05 de Abril de 2026

    const holidays = getHolidaysForYear(2026);
    expect(holidays.some((h) => h.name.includes('São Sebastião'))).toBe(true);
    expect(holidays.some((h) => h.name.includes('São Jorge'))).toBe(true);
    expect(holidays.some((h) => h.name.includes('Consciência Negra'))).toBe(true);
    expect(holidays.some((h) => h.name.includes('Carnaval'))).toBe(true);
  });

  it('detecta domingos de ENEM e gera oportunidades reais de entrada e saída', () => {
    // 08 de novembro de 2026 é o 2º domingo de novembro
    const enemDate = new Date('2026-11-08T10:00:00');
    expect(isEnemDate(enemDate)).toBe(true);

    const cal = getCalendarDayInfo(enemDate);
    expect(cal.isEnemSunday).toBe(true);
    expect(cal.shoppingClosingHour).toBe(21);

    const events = getSeasonalExpectedEvents(enemDate);
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.some((e) => e.title.includes('ENEM'))).toBe(true);
  });

  it('ajusta multiplicadores de categoria em véspera de feriado', () => {
    // 14 de novembro é véspera do feriado de 15 de novembro (Proclamação)
    const eveCal = getCalendarDayInfo(new Date('2026-11-14T16:00:00'));
    expect(eveCal.classification).toBe('HOLIDAY_EVE');

    // Terminal rodoviário/aeroporto sobe na véspera à tarde
    const terminalMult = getSeasonalCategoryMultiplier('TERMINAL', eveCal, 16);
    expect(terminalMult).toBe(2.2);

    // Supermercado sobe na véspera à tarde
    const marketMult = getSeasonalCategoryMultiplier('MERCADO', eveCal, 17);
    expect(marketMult).toBe(1.9);

    // No dia do feriado (15/nov), o centro corporativo cai drasticamente
    const holCal = getCalendarDayInfo(new Date('2026-11-15T11:00:00'));
    const corpMult = getSeasonalCategoryMultiplier('CORPORATIVO', holCal, 11);
    expect(corpMult).toBeLessThan(0.1);
  });

  it('avalia a segurança de rotas e detecta incursões em áreas de risco no Rio', () => {
    // 1. Rota que corta o Complexo da Maré por dentro (tentativa comum de desvio de trânsito perigoso)
    const mareCutRoute: LngLat[] = [
      [-43.2430, -22.8590],
      [-43.2450, -22.8610], // Centro de risco da Maré
      [-43.2470, -22.8630],
    ];
    const dangerAssessment = evaluateRouteSafety(mareCutRoute);
    expect(dangerAssessment.isSafe).toBe(false);
    expect(dangerAssessment.crossedZones.length).toBeGreaterThan(0);
    expect(dangerAssessment.crossedZones[0].id).toBe('risk_mare');
    expect(dangerAssessment.recommendedTag).toBe('⚠️ ÁREA DE RISCO');
    expect(dangerAssessment.warningMessage).toContain('Complexo da Maré');

    // 2. Rota segura na Zona Sul (Copacabana para Ipanema)
    const southZoneRoute: LngLat[] = [
      [-43.1800, -22.9700],
      [-43.1850, -22.9750],
      [-43.1900, -22.9800],
    ];
    const safeAssessment = evaluateRouteSafety(southZoneRoute);
    expect(safeAssessment.isSafe).toBe(true);
    expect(safeAssessment.crossedZones.length).toBe(0);
    expect(safeAssessment.recommendedTag).toBe('🟢 CORREDOR SEGURO');

    // 3. Verificação de posição atual de emergência / geofence
    const insideRisk = checkCurrentPositionSafety([-43.2450, -22.8610]);
    expect(insideRisk.inDangerZone).toBe(true);
    expect(insideRisk.zone?.id).toBe('risk_mare');

    const outsideRisk = checkCurrentPositionSafety([-43.1650, -22.9100]); // Santos Dumont
    expect(outsideRisk.inDangerZone).toBe(false);
    expect(SAFE_ROUTING_GUIDELINES.length).toBeGreaterThanOrEqual(3);
  });
});

describe('Modo Showcase Sandbox & Dados Sintéticos Independentes', () => {
  it('inicializa CloudSyncService em modo Sandbox sem credenciais externas', async () => {
    const sync = new CloudSyncService('', '');
    expect(sync.isSandboxMode).toBe(true);
    const events = await sync.refreshEvents(false);
    expect(events.length).toBeGreaterThanOrEqual(4);
    const trips = await sync.fetchTripsLog();
    expect(trips.length).toBeGreaterThanOrEqual(5);
  });

  it('gera eventos e corridas sintéticas com Horário de Ouro e margem líquida de GNV', () => {
    const now = Date.now();
    const synthEvents = buildSyntheticShowcaseEvents(now);
    expect(synthEvents.every((e) => e.goldenArrival < e.estimatedEnd)).toBe(true);

    const synthTrips = buildSyntheticShowcaseTrips(now);
    expect(synthTrips.every((t) => t.netProfit < t.fare && t.estimatedGnvCost > 0)).toBe(true);
  });
});
