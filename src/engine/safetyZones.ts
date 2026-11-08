/**
 * Módulo de Heurística Geoespacial de Corredores Arteriais (Rio de Janeiro).
 * Avalia geometricamente alternativas de rotas retornadas pelo motor OSRM contra
 * perímetros urbanos mapeados como de atenção operacional, sugerindo a priorização
 * de eixos arteriais expressos (Linha Vermelha, Av. Brasil, Linha Amarela, Lagoa-Barra).
 *
 * NOTA TÉCNICA: As zonas geográficas abaixo constituem heurísticas determinísticas de
 * apoio à decisão (processamento geométrico local < 1 ms via Haversine), não substituindo
 * a sinalização viária oficial, condições em tempo real ou a avaliação local do condutor.
 */
import { haversine, type LngLat } from './geo';

export type DangerSeverity = 'CRITICAL' | 'HIGH';

export interface DangerZone {
  id: string;
  name: string;
  neighborhood: string;
  center: LngLat; // [lng, lat]
  radiusMeters: number;
  severity: DangerSeverity;
  tacticalAlert: string;
  safeCorridorAdvice: string;
}

export interface RouteSafetyAssessment {
  isSafe: boolean;
  crossedZones: DangerZone[];
  nearbyZones: { zone: DangerZone; distanceM: number }[];
  warningMessage?: string;
  recommendedTag: '🟢 CORREDOR SEGURO' | '⚠️ ÁREA DE RISCO';
}

/**
 * Catálogo Georreferenciado de Perímetros de Atenção Viária no Rio de Janeiro.
 * Utilizado pela heurística geométrica para sinalizar desvios por vias secundárias
 * e priorizar corredores expressos principais.
 */
export const RIO_DANGER_ZONES: DangerZone[] = [
  {
    id: 'risk_mare',
    name: 'Complexo da Maré (Entorno Linha Vermelha / Av. Brasil)',
    neighborhood: 'Maré / Bonsucesso',
    center: [-43.2450, -22.8610],
    radiusMeters: 950,
    severity: 'CRITICAL',
    tacticalAlert: 'Heurística viária: evite atalhos internos sugeridos por motores genéricos de rota para desviar de retenções.',
    safeCorridorAdvice: 'Priorize a permanência nas faixas principais dos corredores expressos (Linha Vermelha / Av. Brasil).',
  },
  {
    id: 'risk_alemao_penha',
    name: 'Complexo do Alemão e Penha (Entorno Estrada do Itararé)',
    neighborhood: 'Penha / Olaria / Ramos',
    center: [-43.2750, -22.8550],
    radiusMeters: 1100,
    severity: 'CRITICAL',
    tacticalAlert: 'Perímetro com histórico de restrições viárias em vias secundárias adjacentes.',
    safeCorridorAdvice: 'Utilize os corredores arteriais da Av. Brasil ou Linha Amarela para transpor a região.',
  },
  {
    id: 'risk_jacarezinho_manguinhos',
    name: 'Jacarezinho / Manguinhos',
    neighborhood: 'Zona Norte',
    center: [-43.2550, -22.8880],
    radiusMeters: 750,
    severity: 'CRITICAL',
    tacticalAlert: 'Evite desvios por vias locais secundárias entre a Av. Dom Hélder Câmara e a Linha Amarela.',
    safeCorridorAdvice: 'Priorize o fluxo contínuo pela Av. Dom Hélder Câmara ou Linha Amarela.',
  },
  {
    id: 'risk_chapadao_pedreira',
    name: 'Complexo do Chapadão / Pedreira',
    neighborhood: 'Pavuna / Costa Barros / Guadalupe',
    center: [-43.3750, -22.8250],
    radiusMeters: 1250,
    severity: 'CRITICAL',
    tacticalAlert: 'Perímetro de atenção severa; desaconselhado o uso de rotas secundárias de atalho.',
    safeCorridorAdvice: 'Contorne pelos eixos rodoviários principais: Rodovia Presidente Dutra (BR-116) ou Av. Brasil.',
  },
  {
    id: 'risk_vila_alianca',
    name: 'Vila Aliança / Senador Camará',
    neighborhood: 'Bangu / Senador Camará',
    center: [-43.4900, -22.8750],
    radiusMeters: 850,
    severity: 'CRITICAL',
    tacticalAlert: 'Evite travessias por vias internas residenciais para ligação rápida com a Av. Santa Cruz.',
    safeCorridorAdvice: 'Permaneça na Av. Brasil até os viadutos arteriais principais de acesso.',
  },
  {
    id: 'risk_cidade_de_deus',
    name: 'Cidade de Deus (Entorno Saída 8 Linha Amarela)',
    neighborhood: 'Jacarepaguá',
    center: [-43.3600, -22.9510],
    radiusMeters: 800,
    severity: 'HIGH',
    tacticalAlert: 'Atenção a desvios por vias locais secundárias nas imediações da Saída 8.',
    safeCorridorAdvice: 'Siga pelos eixos arteriais da Estrada dos Bandeirantes ou Av. Ayrton Senna.',
  },
  {
    id: 'risk_dende_ilha',
    name: 'Morro do Dendê (Acessos Internos)',
    neighborhood: 'Ilha do Governador',
    center: [-43.2080, -22.8050],
    radiusMeters: 700,
    severity: 'HIGH',
    tacticalAlert: 'Desvio secundário frequentemente sugerido após saída do Aeroporto do Galeão.',
    safeCorridorAdvice: 'Permaneça no eixo principal da Estrada do Galeão e Estrada da Cacuia.',
  },
  {
    id: 'risk_rocinha_interna',
    name: 'Rocinha (Acessos Internos e Vielas)',
    neighborhood: 'São Conrado / Gávea',
    center: [-43.2480, -22.9880],
    radiusMeters: 750,
    severity: 'HIGH',
    tacticalAlert: 'Vias internas estreitas com baixa fluidez e restrições de manobra.',
    safeCorridorAdvice: 'Utilize a Autoestrada Lagoa-Barra e o Túnel Zuzu Angel para travessia Zona Sul / Barra.',
  },
  {
    id: 'risk_macacos_vila_isabel',
    name: 'Morro dos Macacos (Encosta Alta)',
    neighborhood: 'Vila Isabel',
    center: [-43.2550, -22.9150],
    radiusMeters: 650,
    severity: 'HIGH',
    tacticalAlert: 'Evite vias íngremes secundárias fora do eixo comercial do bairro.',
    safeCorridorAdvice: 'Mantenha-se nas avenidas arteriais 28 de Setembro ou Teodoro da Silva.',
  },
  {
    id: 'risk_juramento_vicente',
    name: 'Morro do Juramento (Entorno Vicente de Carvalho)',
    neighborhood: 'Vicente de Carvalho',
    center: [-43.3100, -22.8600],
    radiusMeters: 700,
    severity: 'HIGH',
    tacticalAlert: 'Evite vias transversais secundárias no entorno imediato do viaduto.',
    safeCorridorAdvice: 'Siga pelo corredor principal do BRT Transcarioca / Av. Vicente de Carvalho.',
  },
];

/**
 * Diretrizes Técnicas de Apoio à Decisão Viária.
 * Substitui instruções imperativas por recomendações informativas de roteamento arterial.
 */
export const SAFE_ROUTING_GUIDELINES = [
  '🛣️ PRIORIDADE ARTERIAL: Prefira vias expressas e avenidas arteriais iluminadas em vez de atalhos residenciais desconhecidos.',
  '🧭 APOIO À DECISÃO: Os perímetros mapeados são heurísticas geométricas e não substituem a sinalização oficial ou avaliação local.',
  '📡 MONITORAMENTO COR-RIO: Consulte interdições oficiais da CET-Rio e do Centro de Operações Rio antes de iniciar deslocamentos longos.',
];

/**
 * Avalia geometricamente se uma polilinha de rota intercepta ou tangencia perímetros de atenção.
 */
export function evaluateRouteSafety(geometry: LngLat[]): RouteSafetyAssessment {
  const crossed: DangerZone[] = [];
  const nearby: { zone: DangerZone; distanceM: number }[] = [];

  for (const zone of RIO_DANGER_ZONES) {
    let minDistance = Infinity;

    for (const pt of geometry) {
      const d = haversine(pt, zone.center);
      if (d < minDistance) {
        minDistance = d;
      }
    }

    if (minDistance <= zone.radiusMeters) {
      crossed.push(zone);
    } else if (minDistance <= zone.radiusMeters + 300) {
      nearby.push({ zone, distanceM: Math.round(minDistance) });
    }
  }

  const isSafe = crossed.length === 0;
  let warningMessage: string | undefined;

  if (crossed.length > 0) {
    const primary = crossed[0];
    warningMessage = `🛡️ CAUTELA VIÁRIA: Rota atravessa o perímetro de ${primary.name}. ${primary.safeCorridorAdvice}`;
  } else if (nearby.length > 0) {
    const primary = nearby[0];
    warningMessage = `⚠️ Atenção: Rota tangencia o perímetro de ${primary.zone.name} (~${primary.distanceM}m). Priorize o corredor arterial expresso.`;
  }

  return {
    isSafe,
    crossedZones: crossed,
    nearbyZones: nearby,
    warningMessage,
    recommendedTag: isSafe ? '🟢 CORREDOR SEGURO' : '⚠️ ÁREA DE RISCO',
  };
}

/**
 * Verifica a posição atual do veículo em relação aos perímetros mapeados pela heurística.
 */
export function checkCurrentPositionSafety(pos: LngLat): { inDangerZone: boolean; zone?: DangerZone; distanceM?: number } {
  for (const zone of RIO_DANGER_ZONES) {
    const d = haversine(pos, zone.center);
    if (d <= zone.radiusMeters) {
      return { inDangerZone: true, zone, distanceM: Math.round(d) };
    }
  }
  return { inDangerZone: false };
}
