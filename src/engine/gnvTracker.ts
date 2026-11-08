/**
 * Módulo de Monitoramento de GNV (Gás Natural Veicular) e Postos Estratégicos (Rio de Janeiro).
 * 
 * Modela fielmente a realidade do taxista carioca:
 * 1. Manômetro de "bolinhas" de LED (4 verdes + 1 reserva vermelha).
 * 2. Cálculo determinístico de consumo por odômetro do GPS (km rodados).
 * 3. Previsão de autonomia e custo de combustível por corrida (R$ e m³).
 * 4. Catálogo georreferenciado dos postos de GNV estratégicos no Rio (preço/m³, pressão de 220 bar, 24h).
 * 5. Abatimento do custo de abastecimento no Lucro Líquido Real do turno.
 * 6. Alerta do Taxista Veterano se a rota exceder a autonomia ou se entrar na reserva.
 * 
 * Custo operacional: R$ 0,00 (Zero-Token, local e instantâneo).
 */
import { haversine, type LngLat } from './geo';

export type GnvDots = 0 | 1 | 2 | 3 | 4; // 0 = Reserva (vermelha), 1 a 4 = bolinhas verdes

export interface GnvStation {
  id: string;
  name: string;
  brand: 'BR' | 'Shell' | 'Ipiranga' | 'Ale' | 'Bandeira Branca';
  neighborhood: string;
  address: string;
  pos: LngLat;
  pricePerM3: number; // Preço do m³ em R$
  pressureBar: number; // Pressão da bomba (ex: 220 bar = máxima/rende mais; 200 normal; 180 fraca)
  isOpen24h: boolean;
  isVeteranPick: boolean; // Ponto com selo de aprovação dos veteranos
  tacticalTip: string;
}

export interface RefuelRecord {
  id: string;
  timestamp: number;
  totalCost: number; // Valor total pago em R$
  volumeM3: number; // Volume abastecido em m³
  pricePerM3: number;
  stationName: string;
  dotsBefore: GnvDots;
  dotsAfter: GnvDots;
}

export interface GnvState {
  dots: GnvDots;
  kmSinceDotChange: number;
  kmSinceRefuel: number;
  cylinderCapacityM3: number; // Padrão: 15 ou 16 m³
  kmPerM3: number; // Média de consumo no trânsito do Rio: ~12.5 km/m³
  defaultPricePerM3: number; // Preço médio de referência no Rio: R$ 4.29
  refuels: RefuelRecord[];
}

export const DEFAULT_GNV_STATE: GnvState = {
  dots: 4,
  kmSinceDotChange: 0,
  kmSinceRefuel: 0,
  cylinderCapacityM3: 15,
  kmPerM3: 12.5,
  defaultPricePerM3: 4.29,
  refuels: [],
};

/**
 * Catálogo Georreferenciado dos Postos de GNV Mais Procurados por Taxistas no Rio de Janeiro.
 * Conhecidos por alta pressão (220 bar), funcionamento 24h e preço competitivo.
 */
export const RIO_GNV_STATIONS: GnvStation[] = [
  {
    id: 'gnv_radial_oeste',
    name: 'Posto Shell Radial Oeste (Maracanã)',
    brand: 'Shell',
    neighborhood: 'Maracanã / Tijuca',
    address: 'Av. Pres. Castelo Branco, Radial Oeste',
    pos: [-43.2280, -22.9120],
    pricePerM3: 4.19,
    pressureBar: 220,
    isOpen24h: true,
    isVeteranPick: true,
    tacticalTip: 'Ponto clássico dos taxistas. Pressão máxima de 220 bar (faz o cilindro render ~15 km a mais) e 6 bicos com vazão rápida.',
  },
  {
    id: 'gnv_brasil_bonsucesso',
    name: 'Posto Ipiranga Av. Brasil (Bonsucesso)',
    brand: 'Ipiranga',
    neighborhood: 'Bonsucesso',
    address: 'Av. Brasil, pista lateral sentido Centro (altura Fiocruz)',
    pos: [-43.2510, -22.8680],
    pricePerM3: 3.99,
    pressureBar: 220,
    isOpen24h: true,
    isVeteranPick: true,
    tacticalTip: 'Preço campeão. Excelente parada antes de subir a Linha Vermelha ou Linha Amarela.',
  },
  {
    id: 'gnv_bicalho_centro',
    name: 'Posto BR Francisco Bicalho (Santo Cristo)',
    brand: 'BR',
    neighborhood: 'Santo Cristo / Centro',
    address: 'Av. Francisco Bicalho, próx. Rodoviária',
    pos: [-43.2050, -22.9020],
    pricePerM3: 4.25,
    pressureBar: 215,
    isOpen24h: true,
    isVeteranPick: true,
    tacticalTip: 'Recarga estratégica antes de pegar a Ponte Rio-Niterói ou após corridas no Centro/Porto.',
  },
  {
    id: 'gnv_botafogo_mena',
    name: 'Posto Shell Botafogo (Mena Barreto)',
    brand: 'Shell',
    neighborhood: 'Botafogo',
    address: 'Rua Mena Barreto, 100',
    pos: [-43.1910, -22.9530],
    pricePerM3: 4.69,
    pressureBar: 200,
    isOpen24h: true,
    isVeteranPick: true,
    tacticalTip: 'Único GNV 24h de fácil acesso na Zona Sul. Preço mais alto, mas salva a madrugada sem ter que descer ao Maracanã.',
  },
  {
    id: 'gnv_barra_alvorada',
    name: 'Posto BR Av. das Américas (Barra da Tijuca)',
    brand: 'BR',
    neighborhood: 'Barra da Tijuca',
    address: 'Av. das Américas, próx. Terminal Alvorada',
    pos: [-43.3720, -22.9990],
    pricePerM3: 4.39,
    pressureBar: 215,
    isOpen24h: true,
    isVeteranPick: true,
    tacticalTip: 'Indispensável após desembarcar passageiro na Barra para não bater lata na reserva até a Zona Sul.',
  },
  {
    id: 'gnv_fundao_vermelha',
    name: 'Posto Ipiranga Linha Vermelha (Ilha / Fundão)',
    brand: 'Ipiranga',
    neighborhood: 'Ilha do Fundão',
    address: 'Saída Linha Vermelha km 7, sentido Centro',
    pos: [-43.2350, -22.8520],
    pricePerM3: 4.15,
    pressureBar: 220,
    isOpen24h: true,
    isVeteranPick: true,
    tacticalTip: 'Salva-vidas na saída de corridas do Galeão. Sem filas durante a tarde.',
  },
  {
    id: 'gnv_tijuca_bonfim',
    name: 'Posto BR Tijuca (Conde de Bonfim)',
    brand: 'BR',
    neighborhood: 'Tijuca',
    address: 'Rua Conde de Bonfim, próx. Metrô Uruguai',
    pos: [-43.2350, -22.9300],
    pricePerM3: 4.45,
    pressureBar: 205,
    isOpen24h: true,
    isVeteranPick: false,
    tacticalTip: 'Atendimento ágil para quem opera no miolo Tijuca / Usina / Grajaú.',
  },
  {
    id: 'gnv_intendente_valqueire',
    name: 'Posto Ale Intendente Magalhães (Campinho)',
    brand: 'Ale',
    neighborhood: 'Campinho / Valqueire',
    address: 'Estrada Intendente Magalhães',
    pos: [-43.3550, -22.8870],
    pricePerM3: 4.09,
    pressureBar: 210,
    isOpen24h: true,
    isVeteranPick: true,
    tacticalTip: 'Eixo tradicional do subúrbio. Ótimo preço e ponto de encontro da Zona Norte com Zona Oeste.',
  },
  {
    id: 'gnv_brasil_guadalupe',
    name: 'Posto Ipiranga Av. Brasil (Guadalupe)',
    brand: 'Ipiranga',
    neighborhood: 'Guadalupe',
    address: 'Av. Brasil, sentido Baixada / Campo Grande',
    pos: [-43.3700, -22.8350],
    pricePerM3: 3.95,
    pressureBar: 220,
    isOpen24h: true,
    isVeteranPick: true,
    tacticalTip: 'Preço mais barato da Av. Brasil com 220 bar. Ideal no retorno para a Zona Oeste.',
  },
  {
    id: 'gnv_senna_gardenia',
    name: 'Posto Shell Av. Ayrton Senna (Gardênia Azul)',
    brand: 'Shell',
    neighborhood: 'Jacarepaguá',
    address: 'Av. Ayrton Senna, próx. Linha Amarela (Saída 8)',
    pos: [-43.3610, -22.9650],
    pricePerM3: 4.29,
    pressureBar: 215,
    isOpen24h: true,
    isVeteranPick: true,
    tacticalTip: 'Posição estratégica entre Barra e Linha Amarela. Conveniência e recarga rápida.',
  },
];

/**
 * Retorna a autonomia base em km para cada nível de bolinhas no cilindro padrão carioca.
 */
export function getBaseAutonomyForDots(dots: GnvDots, cylinderCapacityM3 = 15, kmPerM3 = 12.5): number {
  const maxAutonomy = cylinderCapacityM3 * kmPerM3; // ~187.5 km
  switch (dots) {
    case 4:
      return Math.round(maxAutonomy); // ~187 km
    case 3:
      return Math.round(maxAutonomy * 0.72); // ~135 km
    case 2:
      return Math.round(maxAutonomy * 0.48); // ~90 km
    case 1:
      return Math.round(maxAutonomy * 0.24); // ~45 km
    case 0:
      return Math.round(maxAutonomy * 0.10); // ~18 km (Reserva 🔴)
  }
}

/**
 * Calcula a autonomia estimada restante em km, descontando os km rodados no odômetro.
 */
export function calculateRemainingAutonomy(state: GnvState): number {
  const base = getBaseAutonomyForDots(state.dots, state.cylinderCapacityM3, state.kmPerM3);
  const remaining = base - state.kmSinceDotChange;
  return Math.max(0, Math.round(remaining));
}

/**
 * Estima o custo de combustível (GNV) e volume consumido para uma corrida ou deslocamento.
 */
export function estimateTripFuel(
  distanceKm: number,
  kmPerM3 = 12.5,
  pricePerM3 = 4.29,
): { volumeM3: number; costGnv: number; costGasoline: number; savings: number } {
  const volumeM3 = distanceKm / Math.max(1, kmPerM3);
  const costGnv = volumeM3 * pricePerM3;
  // Na gasolina no trânsito urbano do Rio: ~9.5 km/l com gasolina a R$ 6.19
  const volumeGasL = distanceKm / 9.5;
  const costGasoline = volumeGasL * 6.19;
  const savings = Math.max(0, costGasoline - costGnv);

  return {
    volumeM3: Math.round(volumeM3 * 10) / 10,
    costGnv: Math.round(costGnv * 100) / 100,
    costGasoline: Math.round(costGasoline * 100) / 100,
    savings: Math.round(savings * 100) / 100,
  };
}

/**
 * Atualiza o odômetro de GNV com os novos metros percorridos pelo GPS.
 * Se atingir o limiar de consumo da bolinha, rebaixa o nível e sinaliza.
 */
export function updateGnvOdometer(
  state: GnvState,
  deltaMeters: number,
): { state: GnvState; dotDropped: boolean; newDots: GnvDots } {
  const deltaKm = deltaMeters / 1000;
  const updatedKmSinceDotChange = state.kmSinceDotChange + deltaKm;
  const updatedKmSinceRefuel = state.kmSinceRefuel + deltaKm;

  const kmThresholdPerDot = (state.cylinderCapacityM3 * state.kmPerM3) / 4; // ~46.8 km por bolinha

  let dotDropped = false;
  let newDots = state.dots;

  // Se rodou mais que o limiar de uma bolinha e ainda não está na reserva (0)
  if (updatedKmSinceDotChange >= kmThresholdPerDot && state.dots > 0) {
    newDots = (state.dots - 1) as GnvDots;
    dotDropped = true;
    return {
      state: {
        ...state,
        dots: newDots,
        kmSinceDotChange: updatedKmSinceDotChange - kmThresholdPerDot,
        kmSinceRefuel: updatedKmSinceRefuel,
      },
      dotDropped,
      newDots,
    };
  }

  return {
    state: {
      ...state,
      kmSinceDotChange: updatedKmSinceDotChange,
      kmSinceRefuel: updatedKmSinceRefuel,
    },
    dotDropped: false,
    newDots: state.dots,
  };
}

/**
 * Registra um abastecimento completo ou parcial.
 */
export function recordRefuel(
  state: GnvState,
  cost: number,
  dotsAfter: GnvDots = 4,
  stationName = 'Posto de GNV',
  pricePerM3 = 4.19,
): { state: GnvState; refuel: RefuelRecord } {
  const volumeM3 = cost > 0 && pricePerM3 > 0 ? cost / pricePerM3 : state.cylinderCapacityM3;
  const refuel: RefuelRecord = {
    id: `gnv_${Date.now()}`,
    timestamp: Date.now(),
    totalCost: cost,
    volumeM3: Math.round(volumeM3 * 10) / 10,
    pricePerM3,
    stationName,
    dotsBefore: state.dots,
    dotsAfter,
  };

  const updated: GnvState = {
    ...state,
    dots: dotsAfter,
    kmSinceDotChange: 0,
    kmSinceRefuel: 0,
    refuels: [refuel, ...state.refuels],
  };

  return { state: updated, refuel };
}

/**
 * Encontra os postos de GNV mais próximos do táxi.
 */
export function findNearestGnvStations(currentPos: LngLat, limit = 4): (GnvStation & { distanceM: number })[] {
  return RIO_GNV_STATIONS.map((s) => ({
    ...s,
    distanceM: Math.round(haversine(currentPos, s.pos)),
  }))
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, limit);
}

/**
 * Avalia se a rota proposta é segura em relação ao consumo de combustível.
 */
export function evaluateRouteGnv(
  routeDistanceKm: number,
  state: GnvState,
  currentPos: LngLat,
): {
  isSufficient: boolean;
  remainingAutonomyKm: number;
  fuelEstimate: ReturnType<typeof estimateTripFuel>;
  warning?: string;
  nearestStation?: GnvStation & { distanceM: number };
} {
  const remainingAutonomyKm = calculateRemainingAutonomy(state);
  const fuelEstimate = estimateTripFuel(routeDistanceKm, state.kmPerM3, state.defaultPricePerM3);
  const nearest = findNearestGnvStations(currentPos, 1)[0];

  if (state.dots === 0 || remainingAutonomyKm < 20) {
    return {
      isSufficient: remainingAutonomyKm >= routeDistanceKm,
      remainingAutonomyKm,
      fuelEstimate,
      warning: `🔴 GNV NA RESERVA (~${remainingAutonomyKm} km restantes). Risco de queimar gasolina cara. Abasteça antes no ${nearest ? `${nearest.name} (~${(nearest.distanceM / 1000).toFixed(1)} km - R$ ${nearest.pricePerM3.toFixed(2)}/m³)` : 'posto mais próximo'}.`,
      nearestStation: nearest,
    };
  }

  if (routeDistanceKm > remainingAutonomyKm) {
    return {
      isSufficient: false,
      remainingAutonomyKm,
      fuelEstimate,
      warning: `⚠️ Rota de ${routeDistanceKm.toFixed(1)} km excede a autonomia atual do GNV (~${remainingAutonomyKm} km). Recomendado abastecer no ${nearest ? nearest.name : 'posto'} no caminho.`,
      nearestStation: nearest,
    };
  }

  return {
    isSufficient: true,
    remainingAutonomyKm,
    fuelEstimate,
    nearestStation: nearest,
  };
}
