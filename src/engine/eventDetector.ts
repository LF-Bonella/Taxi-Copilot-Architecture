/**
 * Detector de Eventos Zero-Token (porta do ZeroTokenEventDetector.kt).
 * Lê legenda do Instagram / OCR de flyer / JSON-LD com regex + heurística de término do veterano.
 */
import type { LngLat } from './geo';
import type { EventCategory, Opportunity } from './types';

export const CATEGORY_META: Record<EventCategory, { label: string; durationMin: number; defaultCrowd: number }> = {
  TEATRO: { label: 'Teatro / Musical', durationMin: 110, defaultCrowd: 1200 },
  STANDUP: { label: 'Stand-up Comedy', durationMin: 90, defaultCrowd: 800 },
  SHOW_ESTADIO: { label: 'Show em Arena / Estádio', durationMin: 165, defaultCrowd: 45000 },
  SHOW_NOTURNO: { label: 'Show / Casa Noturna', durationMin: 210, defaultCrowd: 3500 },
  SAMBA_TARDE: { label: 'Roda de Samba / Tarde', durationMin: 300, defaultCrowd: 2500 },
  CONGRESSO: { label: 'Congresso / Convenções', durationMin: 480, defaultCrowd: 6000 },
  BALADA: { label: 'Festa / Balada', durationMin: 360, defaultCrowd: 2000 },
};

export interface Venue {
  id: string;
  name: string;
  pos: LngLat;
  escape: LngLat;
  escapeCorner: string;
  capacity: number;
}

/** Principais casas de evento do Rio — esquinas de escape aproximadas, validar em campo. */
export const RIO_VENUES: Venue[] = [
  { id: 'maracana', name: 'Maracanã', pos: [-43.2302, -22.9122], escape: [-43.2262, -22.9166], escapeCorner: 'Rua São Francisco Xavier, sentido Tijuca (evite a Radial Oeste)', capacity: 70000 },
  { id: 'engenhao', name: 'Estádio Nilton Santos (Engenhão)', pos: [-43.2922, -22.8932], escape: [-43.2895, -22.8915], escapeCorner: 'Rua José dos Reis, afastado do portão principal', capacity: 45000 },
  { id: 'farmasi', name: 'Farmasi Arena (Parque Olímpico)', pos: [-43.3940, -22.9767], escape: [-43.3905, -22.9740], escapeCorner: 'Av. Embaixador Abelardo Bueno, após o retorno do Parque Olímpico', capacity: 15000 },
  { id: 'qualistage', name: 'Qualistage', pos: [-43.3651, -22.9837], escape: [-43.3625, -22.9822], escapeCorner: 'Pista lateral da Av. Ayrton Senna, sentido Linha Amarela', capacity: 8000 },
  { id: 'riocentro', name: 'Riocentro', pos: [-43.4130, -22.9784], escape: [-43.4095, -22.9768], escapeCorner: 'Av. Salvador Allende, faixa livre após o portão', capacity: 20000 },
  { id: 'vivorio', name: 'Vivo Rio', pos: [-43.1713, -22.9165], escape: [-43.1735, -22.9140], escapeCorner: 'Av. Infante Dom Henrique altura do MAM, sentido Centro', capacity: 4000 },
  { id: 'circovoador', name: 'Circo Voador', pos: [-43.1802, -22.9135], escape: [-43.1830, -22.9125], escapeCorner: 'Rua Riachuelo esquina com Rua do Lavradio', capacity: 2000 },
  { id: 'municipal', name: 'Theatro Municipal', pos: [-43.1765, -22.9090], escape: [-43.1760, -22.9100], escapeCorner: 'Av. Rio Branco esquina com Rua Evaristo da Veiga', capacity: 2200 },
  { id: 'cidadeartes', name: 'Cidade das Artes', pos: [-43.3665, -22.9990], escape: [-43.3690, -22.9985], escapeCorner: 'Pista lateral da Av. das Américas, sentido Recreio', capacity: 1800 },
  { id: 'sambodromo', name: 'Sambódromo', pos: [-43.1965, -22.9116], escape: [-43.1925, -22.9095], escapeCorner: 'Rua Frei Caneca, longe da Presidente Vargas', capacity: 70000 },
];

const END_TIME = /(?:t[eé]rmino|fim|encerramento|at[eé])\s*[:\-]?\s*(?:[aà]s?\s*)?(\d{1,2})\s*(?:h|:)?\s*(\d{2})?/i;
const START_TIME = /(?:show|in[ií]cio|come[cç]a|abertura|hor[aá]rio|port[aã]o)\s*[:\-]?\s*(?:[aà]s\s*)?(\d{1,2})\s*(?:h|:)?\s*(\d{2})?/i;
const DATE_DMY = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/;

export function classifyCategory(text: string): EventCategory {
  const t = text.toLowerCase();
  const has = (...ws: string[]) => ws.some((w) => t.includes(w));
  if (has('teatro', 'peça', 'musical', 'ópera', 'balé', 'ballet')) return 'TEATRO';
  if (has('stand-up', 'stand up', 'comédia', 'humor')) return 'STANDUP';
  if (has('estádio', 'arena', 'maracanã', 'engenhão', 'nilton santos', 'turnê', 'festival')) return 'SHOW_ESTADIO';
  if (has('samba', 'pagode', 'feijoada')) return 'SAMBA_TARDE';
  if (has('congresso', 'simpósio', 'expo', 'feira', 'riocentro', 'convenç')) return 'CONGRESSO';
  if (has('open bar', ' dj', 'rave', 'balada', 'club', 'baile')) return 'BALADA';
  return 'SHOW_NOTURNO';
}

const pad = (n: number) => String(n).padStart(2, '0');
export const hhmm = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export interface FlyerInput {
  rawText: string;
  venueName: string;
  venue: LngLat;
  escape?: LngLat;
  escapeCorner: string;
  crowd?: number;
  /** data-base (o dia do evento). Padrão: hoje. */
  baseDate?: Date;
  source?: Opportunity['source'];
}

export function parseFlyer(input: FlyerInput): Opportunity {
  const category = classifyCategory(`${input.rawText} ${input.venueName}`);
  const meta = CATEGORY_META[category];
  const crowd = input.crowd ?? meta.defaultCrowd;

  const base = new Date(input.baseDate ?? new Date());
  const dm = input.rawText.match(DATE_DMY);
  if (dm && !input.baseDate) {
    const day = +dm[1], month = +dm[2] - 1;
    if (day >= 1 && day <= 31 && month >= 0 && month <= 11) {
      base.setMonth(month, day);
      if (dm[3]) base.setFullYear(dm[3].length === 2 ? 2000 + +dm[3] : +dm[3]);
    }
  }

  const start = new Date(base);
  const sm = input.rawText.match(START_TIME);
  if (sm && +sm[1] <= 23) start.setHours(+sm[1], sm[2] ? +sm[2] : 0, 0, 0);
  else if (!input.baseDate) start.setHours(21, 0, 0, 0); // padrão veterano: show noturno às 21h

  const end = new Date(start);
  const em = input.rawText.match(END_TIME);
  if (em && +em[1] <= 23) {
    end.setHours(+em[1], em[2] ? +em[2] : 0, 0, 0);
    if (end <= start) end.setDate(end.getDate() + 1); // virou a madrugada
  } else {
    end.setTime(start.getTime() + meta.durationMin * 60000);
  }

  const golden = end.getTime() - 25 * 60000;
  const demandScore = Math.round(Math.max(40, Math.min(99, (crowd / 60) * 1.4)) * 10) / 10;
  const instruction =
    `PARE DE RODAR VAZIO ÀS ${hhmm(golden)}. Posicione-se na esquina de escape: ${input.escapeCorner}. ` +
    `Dispersão prevista de ~${crowd.toLocaleString('pt-BR')} pessoas às ${hhmm(end.getTime())}. ` +
    'Não entre no funil da portaria principal; aguarde no meio-fio de dispersão.';

  return {
    id: `evt_${input.venueName.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 12)}_${golden}`,
    title: `Saída: ${input.venueName} (${meta.label})`,
    venueName: input.venueName,
    category,
    venue: input.venue,
    escape: input.escape ?? input.venue,
    escapeCorner: input.escapeCorner,
    eventStart: start.getTime(),
    estimatedEnd: end.getTime(),
    goldenArrival: golden,
    expectedCrowd: crowd,
    demandScore,
    driverInstruction: instruction,
    source: input.source ?? 'flyer',
  };
}

/** Extrai eventos de JSON-LD (schema.org/Event) colado de Sympla, Eventim, Ingresse, Fever... */
export function parseJsonLd(json: string, fallbackEscape?: Venue): Opportunity[] {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    // aceita HTML com <script type="application/ld+json">
    const m = json.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/i);
    if (!m) return [];
    try { data = JSON.parse(m[1]); } catch { return []; }
  }
  const items: any[] = [];
  const walk = (n: any) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(walk);
    if (n['@graph']) walk(n['@graph']);
    const t = n['@type'];
    if ((typeof t === 'string' && /Event$/.test(t)) || (Array.isArray(t) && t.some((x: string) => /Event$/.test(x)))) items.push(n);
  };
  walk(data);

  return items.flatMap((ev) => {
    const loc = Array.isArray(ev.location) ? ev.location[0] : ev.location ?? {};
    const geo = loc.geo ?? {};
    const lat = parseFloat(geo.latitude), lng = parseFloat(geo.longitude);
    const venueName: string = loc.name ?? ev.name ?? 'Evento';
    const known = RIO_VENUES.find((v) => venueName.toLowerCase().includes(v.name.toLowerCase().split(' ')[0].toLowerCase()));
    const venue: LngLat | undefined = Number.isFinite(lat) && Number.isFinite(lng) ? [lng, lat] : known?.pos ?? fallbackEscape?.pos;
    if (!venue || !ev.startDate) return [];
    const start = new Date(ev.startDate);
    if (isNaN(start.getTime())) return [];
    const offers = Array.isArray(ev.offers) ? ev.offers : ev.offers ? [ev.offers] : [];
    const soldOut = offers.some((o: any) => /SoldOut/i.test(o.availability ?? ''));
    const category = classifyCategory(`${ev.name ?? ''} ${ev.description ?? ''} ${venueName}`);
    const crowd = known?.capacity ?? CATEGORY_META[category].defaultCrowd;
    const opp = parseFlyer({
      rawText: `${ev.name ?? ''} ${ev.description ?? ''}`.replace(START_TIME, '').replace(END_TIME, ''),
      venueName,
      venue,
      escape: known?.escape,
      escapeCorner: known?.escapeCorner ?? 'Esquina de escoamento a ~150 m da portaria',
      crowd: soldOut ? Math.round(crowd * 1.1) : crowd,
      baseDate: start,
      source: 'json-ld',
    });
    if (ev.endDate) {
      const end = new Date(ev.endDate).getTime();
      if (!isNaN(end) && end > opp.eventStart) {
        opp.estimatedEnd = end;
        opp.goldenArrival = end - 25 * 60000;
      }
    }
    if (soldOut) opp.demandScore = 99;
    return [opp];
  });
}

/** Eventos de demonstração, relativos ao horário atual (mesma lógica dos seeds do app Android). */
export function curatedDemoEvents(now: Date = new Date()): Opportunity[] {
  const v = (id: string) => RIO_VENUES.find((x) => x.id === id)!;
  const at = (offsetMin: number) => new Date(now.getTime() + offsetMin * 60000);
  const mk = (venue: Venue, rawText: string, startOffsetMin: number, endOffsetMin: number, crowd: number): Opportunity => {
    const o = parseFlyer({ rawText, venueName: venue.name, venue: venue.pos, escape: venue.escape, escapeCorner: venue.escapeCorner, crowd, baseDate: at(startOffsetMin), source: 'curadoria' });
    o.estimatedEnd = at(endOffsetMin).getTime();
    o.goldenArrival = o.estimatedEnd - 25 * 60000;
    o.driverInstruction = o.driverInstruction
      .replace(/ÀS \d\d:\d\d/, `ÀS ${hhmm(o.goldenArrival)}`)
      .replace(/pessoas às \d\d:\d\d/, `pessoas às ${hhmm(o.estimatedEnd)}`);
    return o;
  };
  return [
    mk(v('maracana'), 'Festival de rock no Maracanã. Ingressos esgotados.', -120, 70, 62000),
    mk(v('municipal'), 'Ópera no Theatro Municipal. Público A/B.', -60, 45, 2000),
    mk(v('riocentro'), 'Congresso de Cardiologia no Riocentro. Vouchers corporativos.', -300, 240, 9000),
    mk(v('circovoador'), 'Baile com DJ convidado no Circo Voador.', 300, 640, 2000),
  ];
}
