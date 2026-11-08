/**
 * Motor de Calendário Civil, Sazonalidade Urbana & Eventos Esperados (Zero-Token).
 *
 * Não consome tokens de IA nem depende de chamadas pagas de API:
 * - Calcula matematicamente feriados nacionais e do Rio de Janeiro (fixos e móveis).
 * - Identifica Vésperas de Feriado (picos de terminais rodoviários/aeroportos e mercados).
 * - Detecta eventos cívicos previsíveis com meses de antecedência (ENEM, Réveillon, Carnaval).
 * - Ajusta a matriz de comportamento do taxista (ex: domingo o shopping fecha às 21h, feriado no Centro é zona morta).
 */

import type { Opportunity } from './types';

export interface Holiday {
  name: string;
  dateStr: string; // YYYY-MM-DD
  day: number;
  month: number; // 1..12
  isNational: boolean;
  isRioStateOrCity: boolean;
  impactNote: string;
}

export type DayClassification =
  | 'COMMERCIAL_WEEKDAY'  // Dia útil comercial comum
  | 'HOLIDAY_EVE'         // Véspera de feriado (15h às 21h: aeroportos, rodoviária, mercados abarrotados)
  | 'HOLIDAY'             // Feriado civil (Centro financeiro deserto; orla/lazer bombando)
  | 'WEEKEND_COMMON'      // Fim de semana comum (sábado / domingo)
  | 'LONG_WEEKEND_RETURN' // Noite de domingo ou feriado: volta de viagem (desembarques cheios)
  ;

export interface CalendarDayInfo {
  date: Date;
  classification: DayClassification;
  holidayToday: Holiday | null;
  holidayTomorrow: Holiday | null;
  isSunday: boolean;
  isSaturday: boolean;
  isEnemSunday: boolean;
  shoppingClosingHour: number; // 22h dia comum, 21h domingo/feriado
  tacticalSummary: string;
}

/**
 * Algoritmo determinístico de Meeus/Gauss para cálculo da Páscoa cristã
 * Válido para qualquer ano do calendário gregoriano (100% offline, zero tokens).
 */
export function calculateEaster(year: number): { day: number; month: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { day, month };
}

function addDaysToDate(d: Date, days: number): Date {
  const res = new Date(d);
  res.setDate(res.getDate() + days);
  return res;
}

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Retorna todos os feriados civis (nacionais + Rio de Janeiro) para um determinado ano.
 */
export function getHolidaysForYear(year: number): Holiday[] {
  const list: Holiday[] = [];

  const add = (day: number, month: number, name: string, isRio: boolean, note: string) => {
    const d = new Date(year, month - 1, day);
    list.push({
      name,
      dateStr: fmtDate(d),
      day,
      month,
      isNational: !isRio,
      isRioStateOrCity: isRio,
      impactNote: note,
    });
  };

  // 1. Feriados Fixos Nacionais
  add(1, 1, 'Confraternização Universal (Ano Novo)', false, 'Madrugada de retorno do Réveillon. Centro deserto.');
  add(21, 4, 'Tiradentes', false, 'Feriado nacional. Centro sem movimento; orla e polo gastronômico ativos.');
  add(1, 5, 'Dia Mundial do Trabalho', false, 'Comércio de rua fechado. Shoppings e parques concentram passageiros.');
  add(7, 9, 'Independência do Brasil', false, 'Desfiles cívicos e praias lotadas se fizer sol.');
  add(12, 10, 'Nossa Senhora Aparecida / Dia das Crianças', false, 'Polos de lazer infantil, Quinta da Boa Vista e shoppings.');
  add(2, 11, 'Finados', false, 'Movimento matutino para cemitérios (Caju, São João Batista).');
  add(15, 11, 'Proclamação da República', false, 'Feriado nacional. Potencial de feriadão prolongado.');
  add(20, 11, 'Dia da Consciência Negra (Zumbi dos Palmares)', false, 'Feriado nacional (Lei 14.759).');
  add(25, 12, 'Natal', false, 'Tarde e noite com famílias reunidas. Manhã deserta.');

  // 2. Feriados Fixos Rio de Janeiro (Estado e Município)
  add(20, 1, 'São Sebastião (Padroeiro da Cidade do Rio)', true, 'Feriado municipal no Rio. Centro fechado; praias e Zona Sul ativas.');
  add(23, 4, 'São Jorge (Feriado Estadual RJ)', true, 'Feriado estadual. Missas da madrugada (Quintino/Centro) e feijoadas.');

  // 3. Feriados Móveis baseados na Páscoa
  const easter = calculateEaster(year);
  const easterDate = new Date(year, easter.month - 1, easter.day);

  // Carnaval: Terça-feira (Páscoa - 47 dias)
  const carnavalTue = addDaysToDate(easterDate, -47);
  add(carnavalTue.getDate(), carnavalTue.getMonth() + 1, 'Terça-feira de Carnaval', false, 'Pico absoluto: Sambódromo, blocos de rua e turismo.');

  // Sexta-feira Santa: Paixão de Cristo (Páscoa - 2 dias)
  const goodFriday = addDaysToDate(easterDate, -2);
  add(goodFriday.getDate(), goodFriday.getMonth() + 1, 'Sexta-feira Santa (Paixão de Cristo)', false, 'Centro completamente fechado; restaurantes de peixe/mariscos cheios.');

  // Corpus Christi: Quinta-feira (Páscoa + 60 dias)
  const corpusChristi = addDaysToDate(easterDate, 60);
  add(corpusChristi.getDate(), corpusChristi.getMonth() + 1, 'Corpus Christi', false, 'Feriado com altíssima taxa de emenda para sexta-feira.');

  return list;
}

/**
 * Verifica se a data é um dos dois primeiros domingos de novembro (Datas típicas do ENEM).
 */
export function isEnemDate(d: Date): boolean {
  if (d.getMonth() !== 10) return false; // Novembro = mês 10 (0-indexed)
  if (d.getDay() !== 0) return false;    // Domingo
  const day = d.getDate();
  // 1º domingo: dias 1 a 7; 2º domingo: dias 8 a 14
  return day >= 1 && day <= 14;
}

/**
 * Retorna o diagnóstico completo de calendário civil para o dia informado.
 */
export function getCalendarDayInfo(d: Date = new Date()): CalendarDayInfo {
  const year = d.getFullYear();
  const holidays = getHolidaysForYear(year);

  const todayStr = fmtDate(d);
  const tomorrow = addDaysToDate(d, 1);
  const tomorrowStr = fmtDate(tomorrow);

  const holidayToday = holidays.find((h) => h.dateStr === todayStr) ?? null;
  const holidayTomorrow = holidays.find((h) => h.dateStr === tomorrowStr) ?? null;

  const dayOfWeek = d.getDay();
  const isSunday = dayOfWeek === 0;
  const isSaturday = dayOfWeek === 6;
  const isEnem = isEnemDate(d);

  let classification: DayClassification = 'COMMERCIAL_WEEKDAY';
  let tacticalSummary = '';

  if (holidayToday) {
    classification = 'HOLIDAY';
    tacticalSummary = `Feriado: ${holidayToday.name}. Centro comercial em baixa; foco em orla, hotéis e polos de lazer.`;
  } else if (holidayTomorrow) {
    // Véspera de feriado (ex: quinta pré-feriado na sexta, ou sábado antes de domingo/feriado)
    classification = 'HOLIDAY_EVE';
    tacticalSummary = `Véspera de Feriado (${holidayTomorrow.name}). Demanda crítica em Aeroportos (SDU/GIG), Rodoviária Novo Rio e Supermercados a partir das 15h.`;
  } else if (dayOfWeek === 5) {
    // Sexta-feira comum
    tacticalSummary = 'Sexta-feira comercial. Happy hours e restaurantes executivos a partir das 17h; teatros e boêmia à noite.';
  } else if (isSunday) {
    classification = 'WEEKEND_COMMON';
    tacticalSummary = isEnem
      ? 'Domingo de ENEM! 11h às 12h45: corrida para polos de prova (portões fecham 13h em ponto). 17h30: dispersão massiva.'
      : 'Domingo carioca: orla, feiras matinais e retorno de lazer. Shoppings fecham mais cedo (21h).';
  } else if (isSaturday) {
    classification = 'WEEKEND_COMMON';
    tacticalSummary = 'Sábado: polos de compras (Saara até 14h, Barra/Zona Sul o dia todo) e gastronomia/noite.';
  } else {
    tacticalSummary = 'Dia útil comercial: matriz tradicional de hospitais, almoço corporativo e metrôs.';
  }

  const shoppingClosingHour = isSunday || classification === 'HOLIDAY' ? 21 : 22;

  return {
    date: d,
    classification,
    holidayToday,
    holidayTomorrow,
    isSunday,
    isSaturday,
    isEnemSunday: isEnem,
    shoppingClosingHour,
    tacticalSummary,
  };
}

/**
 * Multiplicadores de categoria ajustados pela sazonalidade civil/feriados.
 */
export function getSeasonalCategoryMultiplier(
  category: string,
  cal: CalendarDayInfo,
  hourOfDay: number,
): number {
  const isEve = cal.classification === 'HOLIDAY_EVE';
  const isHol = cal.classification === 'HOLIDAY';

  switch (category) {
    case 'TERMINAL': // Rodoviária Novo Rio, Santos Dumont, Galeão
      if (isEve && hourOfDay >= 14 && hourOfDay <= 22) return 2.2; // Véspera de feriadão explode
      if (isHol && hourOfDay >= 17) return 1.6; // Noite de feriado: volta de viagem
      if (cal.isSunday && hourOfDay >= 17) return 1.5;
      return 1.0;

    case 'MERCADO': // Supermercados e atacadistas
      if (isEve && hourOfDay >= 15 && hourOfDay <= 21) return 1.9; // Compras para o feriado
      if (isHol) return 0.5; // Feriado muitos fecham ou abrem reduzido
      if (cal.isSaturday && hourOfDay >= 10 && hourOfDay <= 16) return 1.4;
      return 1.0;

    case 'CORPORATIVO': // Centro financeiro, torres corporativas
      if (isHol) return 0.08; // Centro financeiro vira ZONA MORTA total em feriados
      if (cal.isSunday) return 0.1;
      if (cal.isSaturday) return 0.3;
      if (isEve && hourOfDay >= 16) return 0.5; // Executivos saem mais cedo em véspera
      return 1.0;

    case 'HOSPITAL':
      if (isHol || cal.isSunday) return 0.5; // Ambulatórios e exames em jejum não funcionam
      return 1.0;

    case 'SHOPPING':
      if (isHol) return 1.3;
      if (cal.isSunday) return 1.25;
      return 1.0;

    case 'GASTRONOMIA':
    case 'BOEMIA':
      if (isEve) return 1.4; // Quinta ou véspera vira "quinta com cara de sexta"
      if (isHol && hourOfDay >= 12 && hourOfDay <= 18) return 1.35;
      return 1.0;

    case 'METRO':
      if (isHol || cal.isSunday) return 0.6;
      return 1.0;

    default:
      return 1.0;
  }
}

/**
 * Gera eventos sazonais e cívicos REAIS esperados para o dia de hoje (Zero-Token).
 * Ex: Domingos de ENEM, Vésperas de Feriadão, Réveillon, etc.
 * Não inventa eventos fictícios do nada se o dia for uma data comum.
 */
export function getSeasonalExpectedEvents(d: Date = new Date()): Opportunity[] {
  const cal = getCalendarDayInfo(d);
  const events: Opportunity[] = [];
  const base = new Date(d);

  const atHour = (h: number, m: number): number => {
    const dt = new Date(base);
    dt.setHours(h, m, 0, 0);
    return dt.getTime();
  };

  // 1. ENEM (Exame Nacional do Ensino Médio - 1º e 2º domingos de novembro)
  if (cal.isEnemSunday) {
    // Entrada: portões fecham às 13h00 em ponto. Pico de corrida entre 11h15 e 12h45.
    events.push({
      id: `enem_uerj_in_${fmtDate(d)}`,
      title: '🎓 ENEM: Corrida Entrada Portões (UERJ / Maracanã)',
      venueName: 'UERJ (Polo Universitário Maracanã)',
      category: 'CONGRESSO',
      venue: [-43.2355, -22.9125],
      escape: [-43.2330, -22.9140],
      escapeCorner: 'Rua São Francisco Xavier esquina com Rua Morais e Silva',
      eventStart: atHour(11, 0),
      estimatedEnd: atHour(13, 0),
      goldenArrival: atHour(11, 30),
      expectedCrowd: 12000,
      demandScore: 98,
      driverInstruction: 'ENEM ENTRADA: Portões fecham às 13h00 em ponto. Passageiros desesperados por atraso. Mantenha rotas fora de vias travadas.',
      source: 'curadoria',
    });

    // Saída: encerramento das provas às 18h30
    events.push({
      id: `enem_uerj_out_${fmtDate(d)}`,
      title: '🎓 ENEM: Saída Geral dos Estudantes (UERJ)',
      venueName: 'UERJ (Polo Universitário Maracanã)',
      category: 'CONGRESSO',
      venue: [-43.2355, -22.9125],
      escape: [-43.2330, -22.9140],
      escapeCorner: 'Rua São Francisco Xavier sentido Praça da Bandeira / Tijuca',
      eventStart: atHour(13, 0),
      estimatedEnd: atHour(18, 30),
      goldenArrival: atHour(18, 5), // 25 min antes!
      expectedCrowd: 14000,
      demandScore: 95,
      driverInstruction: 'SAÍDA ENEM 18h30: Milhares de estudantes sem bateria e com cansaço extremo pegam táxi para Tijuca, Méier e Central.',
      source: 'curadoria',
    });

    events.push({
      id: `enem_puc_out_${fmtDate(d)}`,
      title: '🎓 ENEM: Saída dos Estudantes (PUC-Rio / Gávea)',
      venueName: 'PUC-Rio (Gávea)',
      category: 'CONGRESSO',
      venue: [-43.2325, -22.9785],
      escape: [-43.2310, -22.9765],
      escapeCorner: 'Praça Santos Dumont / Rua Marquês de São Vicente',
      eventStart: atHour(13, 0),
      estimatedEnd: atHour(18, 30),
      goldenArrival: atHour(18, 5),
      expectedCrowd: 6500,
      demandScore: 92,
      driverInstruction: 'SAÍDA ENEM PUC: Estudantes para Leblon, Ipanema, Barra e Jardim Botânico. Fique na Praça Santos Dumont.',
      source: 'curadoria',
    });
  }

  // 2. Véspera de Feriadão: Operação Embarque Rodoviária e Aeroportos
  if (cal.classification === 'HOLIDAY_EVE') {
    const holName = cal.holidayTomorrow?.name ?? 'Feriadão';
    events.push({
      id: `eve_novorio_${fmtDate(d)}`,
      title: `🧳 Operação Viagem: Rodoviária Novo Rio (${holName})`,
      venueName: 'Rodoviária Novo Rio',
      category: 'CONGRESSO',
      venue: [-43.2095, -22.8995],
      escape: [-43.2110, -22.9015],
      escapeCorner: 'Av. Rodrigues Alves / Rua Santo Cristo (fuja do nó da Francisco Bicalho)',
      eventStart: atHour(15, 0),
      estimatedEnd: atHour(21, 30),
      goldenArrival: atHour(16, 30),
      expectedCrowd: 28000,
      demandScore: 97,
      driverInstruction: `VÉSPERA DE FERIADO: Pessoas com malas pesadas indo viajar. Corridas de toda a Zona Sul e Tijuca para a Rodoviária.`,
      source: 'curadoria',
    });

    events.push({
      id: `eve_sdu_${fmtDate(d)}`,
      title: `✈️ Ponte Aérea / Feriadão: Aeroporto Santos Dumont`,
      venueName: 'Aeroporto Santos Dumont',
      category: 'CONGRESSO',
      venue: [-43.1640, -22.9110],
      escape: [-43.1660, -22.9125],
      escapeCorner: 'Trevo do MAM / Praça Salgado Filho',
      eventStart: atHour(15, 0),
      estimatedEnd: atHour(21, 0),
      goldenArrival: atHour(16, 0),
      expectedCrowd: 18000,
      demandScore: 96,
      driverInstruction: `VÉSPERA DE FERIADO: Executivos e turistas embarcando e desembarcando. Tíquete médio alto para Barra e Zona Sul.`,
      source: 'curadoria',
    });
  }

  // 3. Feriado: Retorno de Viagens (Noite de Feriado)
  if (cal.classification === 'HOLIDAY') {
    events.push({
      id: `hol_return_${fmtDate(d)}`,
      title: `🚌 Retorno do Feriado: Rodoviária Novo Rio`,
      venueName: 'Rodoviária Novo Rio (Desembarque)',
      category: 'CONGRESSO',
      venue: [-43.2095, -22.8995],
      escape: [-43.2080, -22.8980],
      escapeCorner: 'Plataforma de Desembarque / Rua Equador',
      eventStart: atHour(17, 0),
      estimatedEnd: atHour(23, 0),
      goldenArrival: atHour(18, 30),
      expectedCrowd: 32000,
      demandScore: 98,
      driverInstruction: 'RETORNO DE FERIADO: Ônibus interestaduais desembarcando lotados. Fila de táxi esgotando rapidamente.',
      source: 'curadoria',
    });
  }

  return events;
}
