import type { LngLat } from './geo';

export type EventCategory =
  | 'TEATRO' | 'STANDUP' | 'SHOW_ESTADIO' | 'SHOW_NOTURNO' | 'SAMBA_TARDE' | 'CONGRESSO' | 'BALADA';

export interface Opportunity {
  id: string;
  title: string;
  venueName: string;
  category: EventCategory;
  /** local do evento */
  venue: LngLat;
  /** esquina de escape (onde o táxi deve se posicionar) */
  escape: LngLat;
  escapeCorner: string;
  eventStart: number; // epoch ms
  estimatedEnd: number;
  goldenArrival: number; // 25 min antes do fim
  expectedCrowd: number;
  demandScore: number; // 0..100
  driverInstruction: string;
  source: 'curadoria' | 'flyer' | 'json-ld';
  operationalStatus?: string;
  platform?: string;
  sourceUrl?: string;
}

export type ReportType = 'BLITZ' | 'ROAD_CLOSED' | 'DEAD_ZONE' | 'HEAVY_TRAFFIC';

export interface TrafficReport {
  id: string;
  type: ReportType;
  pos: LngLat;
  street: string;
  createdAt: number;
  expiresAt: number;
}

export const REPORT_META: Record<ReportType, { label: string; emoji: string; ttlMin: number; color: string }> = {
  BLITZ: { label: 'Blitz / Comando policial', emoji: '🚨', ttlMin: 120, color: '#ef4444' },
  ROAD_CLOSED: { label: 'Rua bloqueada', emoji: '⛔', ttlMin: 360, color: '#dc2626' },
  DEAD_ZONE: { label: 'Rua vazia / Zona morta', emoji: '🚧', ttlMin: 24 * 60, color: '#f97316' },
  HEAVY_TRAFFIC: { label: 'Engarrafamento severo', emoji: '🚗', ttlMin: 60, color: '#f59e0b' },
};

export interface TripRecord {
  id: string;
  start: number;
  end: number;
  fare: number;
  distanceKm: number;
  /** km rodados vazio desde a corrida anterior */
  emptyKmBefore: number;
  pickupZone: string;
  dropoff: LngLat;
  shiftId: string;
}
