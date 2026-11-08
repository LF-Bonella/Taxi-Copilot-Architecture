/**
 * Fonte de localização: GPS real (navigator.geolocation) ou SIMULADOR (laboratório de testes).
 * O simulador dirige pela rota ativa na velocidade escolhida, permitindo testar a navegação
 * inteira no computador.
 */
import { bearing, cumulativeDistances, haversine, pointAlong, snapToLine, type LngLat } from '../engine/geo';

export interface Fix {
  pos: LngLat;
  /** m/s */
  speed: number;
  heading: number | null;
  accuracy: number;
  ts: number;
  simulated: boolean;
}

export type LocationMode = 'gps' | 'sim';
type Listener = (f: Fix) => void;

export class LocationProvider {
  mode: LocationMode = 'gps';
  last: Fix | null = null;
  gpsError: string | null = null;
  onError?: (msg: string) => void;
  private listeners: Listener[] = [];
  private watchId: number | null = null;

  // --- simulador ---
  simSpeedKmh = 40;
  simMultiplier = 1;
  simPlaying = false;
  private simPos: LngLat;
  private simHeading = 0;
  private simLine: LngLat[] | null = null;
  private simCum: number[] = [];
  private simAlong = 0;
  private timer: number | null = null;

  constructor(start: LngLat) {
    this.simPos = start;
  }

  onFix(cb: Listener) {
    this.listeners.push(cb);
  }

  private emit(f: Fix) {
    // calcula rumo pelo deslocamento quando o GPS não informa
    if (f.heading == null && this.last && haversine(this.last.pos, f.pos) > 4) f.heading = bearing(this.last.pos, f.pos);
    else if (f.heading == null && this.last) f.heading = this.last.heading;
    this.last = f;
    this.listeners.forEach((l) => l(f));
  }

  setMode(mode: LocationMode) {
    this.mode = mode;
    if (mode === 'gps') {
      this.stopSimTimer();
      this.startGps();
    } else {
      this.stopGps();
      if (this.last) this.simPos = this.last.pos;
      this.startSimTimer();
    }
  }

  private startGps() {
    if (!('geolocation' in navigator)) {
      this.gpsError = 'Este dispositivo não suporta GPS.';
      this.onError?.(this.gpsError);
      this.setMode('sim');
      return;
    }
    this.stopGps();

    const handleSuccess = (p: GeolocationPosition) => {
      this.gpsError = null;
      this.emit({
        pos: [p.coords.longitude, p.coords.latitude],
        speed: p.coords.speed ?? 0,
        heading: p.coords.heading != null && !isNaN(p.coords.heading) && (p.coords.speed ?? 0) > 1 ? p.coords.heading : null,
        accuracy: p.coords.accuracy,
        ts: p.timestamp,
        simulated: false,
      });
    };

    const handleError = (e: GeolocationPositionError) => {
      this.gpsError =
        e.code === e.PERMISSION_DENIED ? 'Permissão de localização negada pelo usuário.' :
        e.code === e.TIMEOUT ? 'GPS sem sinal de satélite no momento.' : 'GPS temporariamente indisponível.';
      this.onError?.(this.gpsError);
      // Se falhar o GPS real, ativa o simulador para o app não ficar cego
      if (!this.last) {
        this.setMode('sim');
      }
    };

    // Tentativa rápida inicial
    navigator.geolocation.getCurrentPosition(handleSuccess, handleError, {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 10000,
    });

    // Monitoramento contínuo em alta precisão
    this.watchId = navigator.geolocation.watchPosition(
      handleSuccess,
      handleError,
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 },
    );
  }

  private stopGps() {
    if (this.watchId != null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
  }

  /* ---------------- Simulador ---------------- */

  startSimTimer() {
    this.stopSimTimer();
    this.timer = window.setInterval(() => this.simTick(0.5), 500);
    this.simTick(0);
  }

  private stopSimTimer() {
    if (this.timer != null) clearInterval(this.timer);
    this.timer = null;
  }

  /** Teleporta o carro simulado (clique longo no mapa). */
  teleport(p: LngLat) {
    this.simPos = p;
    if (this.simLine) this.simAlong = snapToLine(this.simLine, this.simCum, p).distAlong;
    if (this.mode === 'sim') this.simTick(0);
  }

  /** Define a linha que o simulador vai percorrer (normalmente a rota ativa). */
  followLine(line: LngLat[] | null) {
    this.simLine = line && line.length > 1 ? line : null;
    if (this.simLine) {
      this.simCum = cumulativeDistances(this.simLine);
      const s = snapToLine(this.simLine, this.simCum, this.simPos);
      // começa do ponto mais próximo da rota (se estiver perto), senão do início
      this.simAlong = s.distFromLine < 80 ? s.distAlong : 0;
    }
  }

  private simTick(dtSec: number) {
    if (this.mode !== 'sim') return;
    let speed = 0;
    if (this.simPlaying && this.simLine) {
      const total = this.simCum[this.simCum.length - 1];
      speed = this.simSpeedKmh / 3.6;
      this.simAlong = Math.min(total, this.simAlong + speed * this.simMultiplier * dtSec);
      const p = pointAlong(this.simLine, this.simCum, this.simAlong);
      this.simPos = p.point;
      this.simHeading = p.bearing;
      if (this.simAlong >= total) speed = 0;
    }
    this.emit({ pos: this.simPos, speed, heading: this.simHeading, accuracy: 5, ts: Date.now(), simulated: true });
  }
}
