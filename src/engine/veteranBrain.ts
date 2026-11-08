/**
 * Cérebro do Taxista Veterano — versão Rio de Janeiro.
 *
 * Porta a matriz horária do blueprint (seção 5.1) e a fórmula de score preditivo (seção 6):
 *   Score(H,t) = (B_hora + E_saida + V_transporte) * M_clima / (1 + α·T_engarrafamento + β·D_distancia)
 *
 * As zonas são curadas manualmente (coordenadas aproximadas — validar em campo).
 * Próximo passo natural: calcular B_hora a partir da densidade de POIs do OpenStreetMap (Overpass).
 */
import { haversine, type LngLat } from './geo';
import type { Opportunity, TrafficReport } from './types';
import { getCalendarDayInfo, getSeasonalCategoryMultiplier, type CalendarDayInfo } from './calendarEngine';

export type ZoneCategory =
  | 'HOSPITAL' | 'CORPORATIVO' | 'GASTRONOMIA' | 'MERCADO' | 'TERMINAL' | 'METRO'
  | 'TEATRO' | 'SHOPPING' | 'BOEMIA' | 'HOTEL' | 'RESIDENCIAL_NOBRE';

export type ShiftId =
  | 'EARLY_RESIDENTIAL' | 'HOSPITALS_AND_CLINICS' | 'CORPORATE_LUNCH' | 'MARKETS_AND_TERMINALS'
  | 'METRO_EXITS_RUSH' | 'NIGHT_LEISURE' | 'LATE_NIGHT';

export interface Shift {
  id: ShiftId;
  startMin: number;
  endMin: number;
  timeRange: string;
  title: string;
  amateurMistake: string;
  veteranDirective: string;
  targetSpeedKmh: number;
  targetLane: string;
  /** peso base (0..10) de cada categoria neste turno */
  weights: Record<ZoneCategory, number>;
}

const w = (o: Partial<Record<ZoneCategory, number>>): Record<ZoneCategory, number> => ({
  HOSPITAL: 0, CORPORATIVO: 0, GASTRONOMIA: 0, MERCADO: 0, TERMINAL: 0, METRO: 0,
  TEATRO: 0, SHOPPING: 0, BOEMIA: 0, HOTEL: 0, RESIDENCIAL_NOBRE: 0, ...o,
});

export const SHIFTS: Shift[] = [
  {
    id: 'EARLY_RESIDENTIAL', startMin: 330, endMin: 510, timeRange: '05h30 – 08h30',
    title: 'Residenciais nobres & hotéis',
    amateurMistake: 'Fica no Centro esperando — as pessoas estão indo para lá, não saindo de lá.',
    veteranDirective: 'Rode Leblon, Lagoa, Jardim Oceânico e porta de hotel executivo. Corrida longa para Santos Dumont, Galeão e Centro.',
    targetSpeedKmh: 35, targetLane: 'Faixa central, de olho nas saídas de garagem',
    weights: w({ RESIDENCIAL_NOBRE: 9, HOTEL: 9, TERMINAL: 6, HOSPITAL: 4, METRO: 3, BOEMIA: 2, CORPORATIVO: 1, MERCADO: 1, GASTRONOMIA: 0.5 }),
  },
  {
    id: 'HOSPITALS_AND_CLINICS', startMin: 510, endMin: 690, timeRange: '08h30 – 11h30',
    title: 'Portas de hospitais & exames',
    amateurMistake: 'Continua rodando em avenida engarrafada queimando combustível.',
    veteranDirective: 'Circuito nas portas dos hospitais e laboratórios (exame em jejum acaba ~09h30). Idoso e pós-consulta sai de táxi, nunca de ônibus.',
    targetSpeedKmh: 28, targetLane: 'Faixa da direita (BRS/táxi)',
    weights: w({ HOSPITAL: 9.5, TERMINAL: 6, CORPORATIVO: 5, HOTEL: 5, MERCADO: 4, RESIDENCIAL_NOBRE: 4, METRO: 3, SHOPPING: 3, GASTRONOMIA: 2, BOEMIA: 0.5 }),
  },
  {
    id: 'CORPORATE_LUNCH', startMin: 690, endMin: 870, timeRange: '11h30 – 14h30',
    title: 'Torres corporativas & polos gastronômicos',
    amateurMistake: 'Para para almoçar exatamente quando o executivo sai para almoço e reunião.',
    veteranDirective: 'Centro (Rio Branco), Porto Maravilha, Botafogo e Barra empresarial. Seu almoço fica para 14h30.',
    targetSpeedKmh: 30, targetLane: 'Faixa da direita, colado na calçada',
    weights: w({ CORPORATIVO: 9, GASTRONOMIA: 9, HOSPITAL: 6, TERMINAL: 6, SHOPPING: 5, MERCADO: 4, HOTEL: 4, METRO: 3, RESIDENCIAL_NOBRE: 2, BOEMIA: 1 }),
  },
  {
    id: 'MARKETS_AND_TERMINALS', startMin: 870, endMin: 1020, timeRange: '14h30 – 17h00',
    title: 'Supermercados & desembarques',
    amateurMistake: 'Roda vazio no calor do horário de vale sem saber para onde ir.',
    veteranDirective: 'Supermercado de bairro nobre, Rodoviária Novo Rio e desembarque do Santos Dumont. Quem tem sacola pesada ou mala não pega ônibus.',
    targetSpeedKmh: 30, targetLane: 'Faixa da direita, perto da saída de carrinhos',
    weights: w({ MERCADO: 9, TERMINAL: 8.5, SHOPPING: 7, HOSPITAL: 6, CORPORATIVO: 5, HOTEL: 5, METRO: 4, GASTRONOMIA: 3, RESIDENCIAL_NOBRE: 2, BOEMIA: 1, TEATRO: 1 }),
  },
  {
    id: 'METRO_EXITS_RUSH', startMin: 1020, endMin: 1200, timeRange: '17h00 – 20h00',
    title: 'Saídas de metrô (tiro rápido)',
    amateurMistake: 'Entra no engarrafamento da Perimetral/Linha Vermelha e faz 1 corrida por hora.',
    veteranDirective: 'Fique na saída do metrô do bairro de DESTINO (Botafogo, Siqueira Campos, General Osório, Jardim Oceânico). Corridas curtas de R$ 15–25, 4 a 5 por hora.',
    targetSpeedKmh: 25, targetLane: 'Baia de táxi / faixa de desembarque',
    weights: w({ METRO: 9.5, TERMINAL: 7, CORPORATIVO: 6, SHOPPING: 6, MERCADO: 5, HOSPITAL: 4, GASTRONOMIA: 4, HOTEL: 4, BOEMIA: 4, TEATRO: 3, RESIDENCIAL_NOBRE: 2 }),
  },
  {
    id: 'NIGHT_LEISURE', startMin: 1200, endMin: 1440, timeRange: '20h00 – 00h00',
    title: 'Teatros, fechamento de shopping & bares',
    amateurMistake: 'Vai para casa ou fica parado em ponto de shopping vazio depois das 22h.',
    veteranDirective: '21h30 porta de teatro. 22h00 fechamento de shopping (funcionário e último cliente). 23h00 Lapa, Baixo Gávea e Botafogo. Centro financeiro à noite é ZONA MORTA.',
    targetSpeedKmh: 30, targetLane: 'Faixa da direita com a luz de teto acesa',
    weights: w({ TEATRO: 9, BOEMIA: 9, SHOPPING: 8.5, GASTRONOMIA: 7, TERMINAL: 6, HOTEL: 5, METRO: 3, HOSPITAL: 2, MERCADO: 2, RESIDENCIAL_NOBRE: 1, CORPORATIVO: 0.5 }),
  },
  {
    id: 'LATE_NIGHT', startMin: 0, endMin: 330, timeRange: '00h00 – 05h30',
    title: 'Madrugada: boêmia & hotéis',
    amateurMistake: 'Fica rodando em rua deserta, com risco de assalto.',
    veteranDirective: 'Posicione-se em polo boêmio iluminado (Lapa, Copacabana, Baixo Gávea) ou porta de hotel 24h. Ondas de saída de balada: 02h30 e 04h45.',
    targetSpeedKmh: 40, targetLane: 'Ponto fixo iluminado / saída estratégica',
    weights: w({ BOEMIA: 8, HOTEL: 5, TERMINAL: 4, GASTRONOMIA: 3, HOSPITAL: 2, RESIDENCIAL_NOBRE: 0.5 }),
  },
];

export function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

export function getShift(d: Date): Shift {
  const m = minutesOfDay(d);
  return SHIFTS.find((s) => m >= s.startMin && m < s.endMin) ?? SHIFTS[SHIFTS.length - 1];
}

/** Picos finos dentro do turno (ex.: teatro 21h30, shopping 22h, bares 23h, ondas de balada). */
const MICRO_PEAKS: { cat: ZoneCategory; min: number; sigma: number }[] = [
  { cat: 'TEATRO', min: 21 * 60 + 30, sigma: 35 },
  { cat: 'SHOPPING', min: 22 * 60, sigma: 30 },
  { cat: 'BOEMIA', min: 23 * 60 + 30, sigma: 70 },
  { cat: 'BOEMIA', min: 24 * 60 + 2 * 60 + 30, sigma: 40 }, // 02h30
  { cat: 'BOEMIA', min: 24 * 60 + 4 * 60 + 45, sigma: 40 }, // 04h45
  { cat: 'HOSPITAL', min: 9 * 60 + 30, sigma: 60 },
  { cat: 'METRO', min: 18 * 60 + 30, sigma: 60 },
];

function microPeakFactor(cat: ZoneCategory, m: number, cal?: CalendarDayInfo): number {
  const peaks = MICRO_PEAKS.map((p) => {
    // Domingo ou feriado: shopping fecha às 21h em vez de 22h
    if (p.cat === 'SHOPPING' && cal?.shoppingClosingHour === 21) {
      return { ...p, min: 21 * 60 };
    }
    return p;
  }).filter((p) => p.cat === cat);

  if (!peaks.length) return 1;
  let best = 0;
  for (const p of peaks) {
    for (const mm of [m, m + 1440]) {
      const g = Math.exp(-((mm - p.min) ** 2) / (2 * p.sigma ** 2));
      best = Math.max(best, g);
    }
  }
  return 0.65 + 0.45 * best; // 0.65 fora do pico, até 1.10 no pico
}

export function isWeekend(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 6;
}

export interface Zone {
  id: string;
  name: string;
  category: ZoneCategory;
  pos: LngLat;
  speedKmh: number;
  lane: string;
  tip: string;
}

const Z = (id: string, name: string, category: ZoneCategory, lat: number, lng: number, speedKmh: number, lane: string, tip: string): Zone =>
  ({ id, name, category, pos: [lng, lat], speedKmh, lane, tip });

/** Zonas curadas do Rio de Janeiro (coordenadas aproximadas). */
export const RIO_ZONES: Zone[] = [
  // Hospitais
  Z('h_copador', "Copa D'Or / Copacabana", 'HOSPITAL', -22.9655, -43.1893, 28, 'Faixa da direita', 'Saída de consulta e alta hospitalar. Olhe a calçada da Figueiredo de Magalhães.'),
  Z('h_samaritano', 'Samaritano / Botafogo', 'HOSPITAL', -22.9496, -43.1871, 25, 'Faixa da direita', 'Rua Bambina e arredores: pacientes idosos e acompanhantes.'),
  Z('h_barrador', "Barra D'Or", 'HOSPITAL', -22.9768, -43.3655, 30, 'Pista lateral', 'Pista lateral da Ayrton Senna, porta de emergência e ambulatório.'),
  Z('h_quintador', "Quinta D'Or / São Cristóvão", 'HOSPITAL', -22.9040, -43.2210, 28, 'Faixa da direita', 'Polo médico da Zona Norte; corrida para Tijuca e Centro.'),
  Z('h_inca', 'INCA / Praça da Cruz Vermelha', 'HOSPITAL', -22.9105, -43.1870, 25, 'Faixa da direita', 'Pacientes em tratamento saem fragilizados — passageiro certo de táxi.'),
  // Corporativo
  Z('c_centro', 'Centro Financeiro / Av. Rio Branco', 'CORPORATIVO', -22.9045, -43.1770, 30, 'Faixa da direita (BRS)', 'Torres corporativas. Voucher de empresa e corrida para Santos Dumont.'),
  Z('c_porto', 'Porto Maravilha / Praça Mauá', 'CORPORATIVO', -22.8965, -43.1820, 30, 'Pista local', 'Escritórios novos e museus. Corrida para aeroporto e Zona Sul.'),
  Z('c_botafogo', 'Torres de Botafogo (Praia de Botafogo)', 'CORPORATIVO', -22.9445, -43.1820, 30, 'Pista local', 'Empresas de energia e tecnologia. Ticket médio alto.'),
  Z('c_barra', 'Centros Empresariais da Barra', 'CORPORATIVO', -22.9995, -43.3560, 35, 'Pista lateral da Av. das Américas', 'Saídas de garagem dos centros empresariais.'),
  // Gastronomia
  Z('g_leblon', 'Leblon / Dias Ferreira', 'GASTRONOMIA', -22.9842, -43.2258, 25, 'Devagar, junto ao meio-fio', 'Restaurantes de alto padrão: almoço executivo e jantar.'),
  Z('g_centro', 'Ouvidor / Travessa do Comércio', 'GASTRONOMIA', -22.9020, -43.1745, 25, 'Faixa da direita', 'Almoço executivo do Centro.'),
  Z('g_barra', 'Barra / Olegário Maciel', 'GASTRONOMIA', -23.0080, -43.3080, 25, 'Faixa da direita', 'Bares e restaurantes do Jardim Oceânico.'),
  // Mercados
  Z('m_leblon', 'Supermercados Ataulfo de Paiva', 'MERCADO', -22.9845, -43.2215, 25, 'Faixa da direita', 'Cliente com sacola pesada e carrinho.'),
  Z('m_barra', 'Supermercados Armando Lombardi', 'MERCADO', -23.0060, -43.3150, 28, 'Faixa da direita', 'Compras grandes de condomínio.'),
  Z('m_tijuca', 'Supermercados Conde de Bonfim', 'MERCADO', -22.9255, -43.2340, 25, 'Faixa da direita', 'Idosos com compras na Tijuca.'),
  // Terminais
  Z('t_sdu', 'Aeroporto Santos Dumont (Pista Externa Amarelinho)', 'TERMINAL', -22.9110, -43.1640, 20, 'Pista externa em frente ao Bossa Nova Mall', 'REGRAS SDU: Fique estritamente na fila de táxis convencionais (meio-fio externo). Cooperativas especiais (Cootramo/Aerotaxi) dominam guichês internos. Proibido parar no piso superior de embarque ou abordar no saguão (multa gravíssima CET-Rio/Guarda Municipal).'),
  Z('t_gig', 'Galeão – Terminal 2 (Fila Oficial Amarelinho)', 'TERMINAL', -22.8135, -43.2470, 20, 'Piso Térreo / Pista Externa T2 (Fila Amarelinho SMTR)', 'REGRAS GALEÃO: Embarque gerenciado pela SMTR na pista externa do piso térreo. Não aborde passageiros no saguão interno (área restrita de cooperativas com tarifa pré-paga) nem pare em baias de app.'),
  Z('t_novorio', 'Rodoviária Novo Rio', 'TERMINAL', -22.8995, -43.2095, 20, 'Baia de táxi', 'Passageiro com mala chegando de viagem.'),
  // Metrô
  Z('mt_botafogo', 'Metrô Botafogo', 'METRO', -22.9510, -43.1845, 20, 'Baia / faixa de desembarque', 'Saída São Clemente: tiro curto para Humaitá e Jardim Botânico.'),
  Z('mt_siqueira', 'Metrô Siqueira Campos', 'METRO', -22.9668, -43.1868, 20, 'Baia / faixa de desembarque', 'Copacabana interna: corridas curtas e rápidas.'),
  Z('mt_gosorio', 'Metrô General Osório', 'METRO', -22.9848, -43.1975, 20, 'Baia / faixa de desembarque', 'Ipanema e Lagoa: tiro rápido.'),
  Z('mt_jdoceanico', 'Metrô Jardim Oceânico', 'METRO', -23.0068, -43.3110, 20, 'Baia / faixa de desembarque', 'Integração BRT: passageiro para condomínios da Barra.'),
  Z('mt_saenspena', 'Metrô Saens Peña', 'METRO', -22.9245, -43.2330, 20, 'Baia / faixa de desembarque', 'Tijuca: corridas curtas para o Alto da Boa Vista e Grajaú.'),
  Z('mt_largomachado', 'Metrô Largo do Machado', 'METRO', -22.9310, -43.1785, 20, 'Baia / faixa de desembarque', 'Laranjeiras e Cosme Velho.'),
  // Teatros
  Z('te_municipal', 'Theatro Municipal / Cinelândia', 'TEATRO', -22.9090, -43.1765, 20, 'Esquina de escape', 'Público A/B e idoso: casal que prefere táxi.'),
  Z('te_cidadeartes', 'Cidade das Artes', 'TEATRO', -22.9990, -43.3665, 25, 'Pista lateral', 'Concertos e espetáculos; saída concentrada.'),
  Z('te_leblon', 'Teatros do Leblon', 'TEATRO', -22.9835, -43.2200, 20, 'Faixa da direita', 'Saída de espetáculo próxima ao Shopping Leblon.'),
  // Shoppings
  Z('s_riosul', 'Shopping Rio Sul', 'SHOPPING', -22.9568, -43.1770, 20, 'Saída de pedestres', 'Fechamento 22h: funcionários e últimos clientes.'),
  Z('s_barra', 'BarraShopping', 'SHOPPING', -22.9997, -43.3585, 25, 'Ponto de táxi externo', 'Maior shopping da cidade; fechamento 22h.'),
  Z('s_leblon', 'Shopping Leblon', 'SHOPPING', -22.9828, -43.2172, 20, 'Saída Afrânio de Melo Franco', 'Público de alto poder aquisitivo.'),
  Z('s_tijuca', 'Shopping Tijuca', 'SHOPPING', -22.9230, -43.2365, 20, 'Saída principal', 'Fechamento 22h: corrida curta para a Grande Tijuca.'),
  Z('s_botafogo', 'Botafogo Praia Shopping', 'SHOPPING', -22.9475, -43.1825, 20, 'Saída Praia de Botafogo', 'Cinema e restaurantes: saída das sessões.'),
  // Boêmia
  Z('b_lapa', 'Lapa / Arcos', 'BOEMIA', -22.9132, -43.1797, 20, 'Esquina iluminada', 'Fique em esquina iluminada, nunca em rua escura lateral.'),
  Z('b_baixogavea', 'Baixo Gávea', 'BOEMIA', -22.9755, -43.2290, 20, 'Faixa da direita', 'Público universitário e de alto padrão.'),
  Z('b_botafogo', 'Botafogo (Nelson Mandela / Voluntários)', 'BOEMIA', -22.9530, -43.1895, 20, 'Faixa da direita', 'Polo de bares do Baixo Botafogo.'),
  Z('b_copacabana', 'Copacabana (Av. Atlântica)', 'BOEMIA', -22.9780, -43.1880, 25, 'Pista junto aos quiosques', 'Turistas saindo dos quiosques e hotéis.'),
  Z('b_ipanema', 'Ipanema (Farme de Amoedo)', 'BOEMIA', -22.9845, -43.2000, 20, 'Faixa da direita', 'Bares e turistas.'),
  // Hotéis
  Z('ho_copacabana', 'Hotéis da Av. Atlântica', 'HOTEL', -22.9672, -43.1786, 25, 'Porta dos hotéis', 'Executivos e turistas para aeroporto.'),
  Z('ho_barra', 'Hotéis da Barra (Av. Lúcio Costa)', 'HOTEL', -23.0115, -43.3300, 30, 'Pista lateral', 'Turismo de negócios e eventos do Riocentro.'),
  // Residenciais nobres
  Z('r_leblon', 'Leblon residencial', 'RESIDENCIAL_NOBRE', -22.9875, -43.2235, 30, 'Faixa central, saídas de garagem', 'Saída para trabalho e aeroporto.'),
  Z('r_lagoa', 'Lagoa / Jardim Botânico', 'RESIDENCIAL_NOBRE', -22.9700, -43.2130, 30, 'Faixa central', 'Executivos para Centro e aeroportos.'),
  Z('r_barra', 'Condomínios da Barra', 'RESIDENCIAL_NOBRE', -23.0100, -43.3000, 35, 'Portaria dos condomínios', 'Corrida longa para Centro e Galeão.'),
  Z('r_tijuca', 'Tijuca / Grajaú residencial', 'RESIDENCIAL_NOBRE', -22.9220, -43.2450, 30, 'Faixa central', 'Saída para trabalho no Centro.'),
  Z('r_flamengo', 'Flamengo / Laranjeiras', 'RESIDENCIAL_NOBRE', -22.9350, -43.1800, 30, 'Faixa central', 'Corrida curta para o Centro e Santos Dumont.'),
];

export const RIO_CENTER: LngLat = [-43.1964, -22.9519];

export interface ScoreContext {
  now: Date;
  /** 0 = seco, 1 = chuva fraca, 2 = chuva moderada/forte */
  rainLevel: 0 | 1 | 2;
  driver?: LngLat;
  events: Opportunity[];
  reports: TrafficReport[];
}

export interface ScoreParts {
  base: number; event: number; transport: number; mClima: number; traffic: number; distKm: number;
}

export interface ScoredZone {
  zone: Zone;
  /** score sem penalidade de distância (potencial da área) */
  potential: number;
  /** score final, ranqueado para o motorista */
  score: number;
  parts: ScoreParts;
}

export const ALPHA_TRAFFIC = 0.25;
export const BETA_DISTANCE = 0.15;

export function climateMultiplier(rainLevel: 0 | 1 | 2): number {
  return rainLevel === 2 ? 2.5 : rainLevel === 1 ? 1.6 : 1.0;
}

/** Pulso de fim de evento: sobe exponencialmente antes do término e zera 40 min depois. */
export function eventPulse(opp: Opportunity, now: number): number {
  const m = (now - opp.estimatedEnd) / 60000; // minutos relativos ao fim (negativo = antes)
  let f = 0;
  if (m >= -60 && m <= 0) f = Math.exp(m / 12);
  else if (m > 0 && m <= 40) f = 1 - m / 40;
  const peak = Math.min(10, 3 + Math.log10(Math.max(10, opp.expectedCrowd)) * 1.6);
  return peak * f;
}

export function computeScore(parts: Omit<ScoreParts, 'mClima'> & { rainLevel: 0 | 1 | 2 }): number {
  const m = climateMultiplier(parts.rainLevel);
  const num = (parts.base + parts.event + parts.transport) * m;
  const den = 1 + ALPHA_TRAFFIC * parts.traffic + BETA_DISTANCE * parts.distKm;
  return num / den;
}

const RAIN_CATEGORY_BOOST: Partial<Record<ZoneCategory, number>> = { METRO: 1.3, SHOPPING: 1.2, MERCADO: 1.2 };

export function baseWeight(zone: Zone, now: Date): number {
  const shift = getShift(now);
  const cal = getCalendarDayInfo(now);
  const peak = microPeakFactor(zone.category, minutesOfDay(now), cal);
  const seasonal = getSeasonalCategoryMultiplier(zone.category, cal, now.getHours());
  return shift.weights[zone.category] * peak * seasonal;
}

function transportArrivals(zone: Zone, now: Date): number {
  if (zone.category !== 'TERMINAL') return 0;
  const h = now.getHours();
  // Ondas de chegada (proxy até integrar feed de voos/ônibus defasado em +25 min).
  if (h >= 6 && h < 10) return 2;
  if (h >= 17 && h < 23) return 2;
  if (h >= 10 && h < 17) return 1;
  return 0.5;
}

function trafficPenalty(pos: LngLat, reports: TrafficReport[]): number {
  let t = 0;
  for (const r of reports) {
    if (r.type !== 'HEAVY_TRAFFIC' && r.type !== 'ROAD_CLOSED') continue;
    if (haversine(pos, r.pos) < 800) t += 2.5;
  }
  return Math.min(5, t);
}

function deadReportsPenalty(pos: LngLat, reports: TrafficReport[]): number {
  return reports.some((r) => r.type === 'DEAD_ZONE' && haversine(pos, r.pos) < 500) ? 0.4 : 1;
}

export function scoreZone(zone: Zone, ctx: ScoreContext): ScoredZone {
  const now = ctx.now.getTime();
  let event = 0;
  for (const e of ctx.events) {
    if (haversine(zone.pos, e.escape) < 1500) event = Math.max(event, eventPulse(e, now) * 0.6);
  }
  const rainBoost = ctx.rainLevel > 0 ? RAIN_CATEGORY_BOOST[zone.category] ?? 1 : 1;
  const base = baseWeight(zone, ctx.now) * rainBoost * deadReportsPenalty(zone.pos, ctx.reports);
  const transport = transportArrivals(zone, ctx.now);
  const traffic = trafficPenalty(zone.pos, ctx.reports);
  const distKm = ctx.driver ? haversine(ctx.driver, zone.pos) / 1000 : 0;
  const parts: ScoreParts = { base, event, transport, traffic, distKm, mClima: climateMultiplier(ctx.rainLevel) };
  const potential = computeScore({ base, event, transport, traffic, distKm: 0, rainLevel: ctx.rainLevel });
  const score = computeScore({ base, event, transport, traffic, distKm, rainLevel: ctx.rainLevel });
  return { zone, potential, score, parts };
}

export function rankZones(ctx: ScoreContext, zones: Zone[] = RIO_ZONES): ScoredZone[] {
  return zones.map((z) => scoreZone(z, ctx)).sort((a, b) => b.score - a.score);
}

/** Zonas dinâmicas a partir de eventos em janela de saída (fim de show). */
export function eventZones(ctx: ScoreContext): ScoredZone[] {
  const now = ctx.now.getTime();
  return ctx.events
    .map((e) => {
      const pulse = eventPulse(e, now);
      const distKm = ctx.driver ? haversine(ctx.driver, e.escape) / 1000 : 0;
      const zone: Zone = {
        id: `evt:${e.id}`, name: `🎤 ${e.venueName}`, category: 'TEATRO', pos: e.escape, speedKmh: 15,
        lane: e.escapeCorner, tip: e.driverInstruction,
      };
      const parts: ScoreParts = { base: 0, event: pulse, transport: 0, traffic: trafficPenalty(e.escape, ctx.reports), distKm, mClima: climateMultiplier(ctx.rainLevel) };
      const potential = computeScore({ ...parts, distKm: 0, rainLevel: ctx.rainLevel });
      const score = computeScore({ ...parts, rainLevel: ctx.rainLevel });
      return { zone, potential: Math.min(10, potential), score: Math.min(10, score), parts };
    })
    .filter((z) => z.parts.event > 0.5);
}

export interface DeadZoneVerdict {
  dead: boolean;
  /** índice de retorno 0..1 (blueprint: < 0.25 = zona morta) */
  returnIndex: number;
  /** chance estimada de passageiro em % */
  chancePct: number;
  nearestHot?: ScoredZone;
}

/**
 * Índice de retorno no ponto atual: potencial das zonas vizinhas, decaindo com a distância.
 * Uma área sem polo ativo a ~1,5 km é zona morta naquele horário.
 */
export function deadZoneCheck(p: LngLat, ctx: ScoreContext): DeadZoneVerdict {
  const all = [...rankZones({ ...ctx, driver: p }), ...eventZones({ ...ctx, driver: p })];
  let best = 0;
  for (const s of all) {
    const d = haversine(p, s.zone.pos);
    const decay = Math.exp(-d / 900);
    best = Math.max(best, s.potential * decay);
  }
  if (ctx.reports.some((r) => r.type === 'DEAD_ZONE' && haversine(p, r.pos) < 400)) best *= 0.5;
  const returnIndex = Math.min(1, best / 10);
  const chancePct = Math.round(Math.min(95, returnIndex * 32 + (returnIndex > 0.25 ? 10 : 0)));
  const nearestHot = all.filter((s) => s.potential >= 6).sort((a, b) => b.score - a.score)[0];
  return { dead: returnIndex < 0.25, returnIndex, chancePct, nearestHot };
}

export function behaviorCommand(s: ScoredZone, shift: Shift, rainLevel: 0 | 1 | 2): string {
  const rain = rainLevel > 0 ? ' Está chovendo: priorize marquises e saídas sem cobertura.' : '';
  return `${s.zone.name}. ${s.zone.lane}, mantenha ${s.zone.speedKmh || shift.targetSpeedKmh} km/h. ${s.zone.tip}${rain}`;
}

export function zoneColor(potential: number): string {
  if (potential >= 8) return '#22c55e';
  if (potential >= 6) return '#a3e635';
  if (potential >= 4) return '#facc15';
  if (potential >= 2) return '#f97316';
  return '#ef4444';
}
