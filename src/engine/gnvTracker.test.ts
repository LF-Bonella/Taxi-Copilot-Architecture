import { describe, expect, it } from 'vitest';
import {
  calculateRemainingAutonomy,
  DEFAULT_GNV_STATE,
  estimateTripFuel,
  evaluateRouteGnv,
  findNearestGnvStations,
  getBaseAutonomyForDots,
  recordRefuel,
  RIO_GNV_STATIONS,
  updateGnvOdometer,
  type GnvState,
} from './gnvTracker';

describe('Monitor de GNV & Combustível do Taxista Veterano (Zero-Token)', () => {
  it('calcula a autonomia base de acordo com as bolinhas de LED do painel', () => {
    expect(getBaseAutonomyForDots(4)).toBeGreaterThanOrEqual(180);
    expect(getBaseAutonomyForDots(3)).toBeGreaterThanOrEqual(130);
    expect(getBaseAutonomyForDots(2)).toBeGreaterThanOrEqual(85);
    expect(getBaseAutonomyForDots(1)).toBeGreaterThanOrEqual(40);
    expect(getBaseAutonomyForDots(0)).toBeLessThanOrEqual(25); // Reserva 🔴
  });

  it('deduz quilometragem rodada da autonomia estimada restante', () => {
    const state: GnvState = {
      ...DEFAULT_GNV_STATE,
      dots: 2,
      kmSinceDotChange: 15, // rodou 15 km com 2 bolinhas
    };
    const autonomy = calculateRemainingAutonomy(state);
    // Base de 2 bolinhas é 90 km. 90 - 15 = 75 km.
    expect(autonomy).toBe(75);
  });

  it('estima com precisão o custo em GNV vs Gasolina e a economia real por corrida', () => {
    // Corrida de 12.5 km com consumo de 12.5 km/m³ e preço de R$ 4,29/m³
    const estimate = estimateTripFuel(12.5, 12.5, 4.29);
    expect(estimate.volumeM3).toBe(1.0);
    expect(estimate.costGnv).toBe(4.29);
    expect(estimate.costGasoline).toBeGreaterThan(7.0); // Gasolina sai mais cara
    expect(estimate.savings).toBeGreaterThan(2.5);
  });

  it('atualiza o odômetro e rebaixa a bolinha de LED quando atinge o limiar de consumo', () => {
    const initialState: GnvState = {
      ...DEFAULT_GNV_STATE,
      dots: 4,
      kmSinceDotChange: 0,
      kmSinceRefuel: 0,
    };

    // Rodando 20 km (ainda dentro da 1ª bolinha de ~46.8 km)
    const step1 = updateGnvOdometer(initialState, 20000);
    expect(step1.dotDropped).toBe(false);
    expect(step1.newDots).toBe(4);
    expect(step1.state.kmSinceDotChange).toBe(20);

    // Rodando mais 30 km (total 50 km > 46.8 km de limiar da bolinha)
    const step2 = updateGnvOdometer(step1.state, 30000);
    expect(step2.dotDropped).toBe(true);
    expect(step2.newDots).toBe(3); // Baixou para 3 bolinhas!
    expect(step2.state.dots).toBe(3);
  });

  it('registra abastecimento, reseta o hodômetro e atualiza o histórico financeiro', () => {
    const state: GnvState = {
      ...DEFAULT_GNV_STATE,
      dots: 1,
      kmSinceDotChange: 35,
      kmSinceRefuel: 140,
    };

    const { state: updated, refuel } = recordRefuel(state, 58.5, 4, 'Posto Shell Radial Oeste', 4.19);
    expect(updated.dots).toBe(4);
    expect(updated.kmSinceDotChange).toBe(0);
    expect(updated.kmSinceRefuel).toBe(0);
    expect(updated.refuels.length).toBe(1);
    expect(refuel.totalCost).toBe(58.5);
    expect(refuel.volumeM3).toBeCloseTo(13.96, 1);
  });

  it('encontra os postos de GNV mais próximos ordenados por distância', () => {
    // Posição no Maracanã
    const maracanaPos: [number, number] = [-43.2300, -22.9125];
    const nearest = findNearestGnvStations(maracanaPos, 3);

    expect(nearest.length).toBe(3);
    expect(nearest[0].id).toBe('gnv_radial_oeste'); // Radial Oeste fica a menos de 500m
    expect(nearest[0].distanceM).toBeLessThan(1000);
    expect(nearest[0].pressureBar).toBe(220); // 220 bar
  });

  it('emite alerta tático quando a rota ultrapassa a autonomia ou está na reserva', () => {
    const reserveState: GnvState = {
      ...DEFAULT_GNV_STATE,
      dots: 0, // Reserva 🔴
      kmSinceDotChange: 5,
    };

    const evalReserve = evaluateRouteGnv(15, reserveState, [-43.2280, -22.9120]);
    expect(evalReserve.warning).toContain('RESERVA');

    const lowState: GnvState = {
      ...DEFAULT_GNV_STATE,
      dots: 1, // ~45 km de base
      kmSinceDotChange: 20, // sobram ~25 km
    };

    // Rota longa de 35 km (ex: Centro para Recreio) excede os 25 km restantes
    const evalLong = evaluateRouteGnv(35, lowState, [-43.2050, -22.9020]);
    expect(evalLong.isSufficient).toBe(false);
    expect(evalLong.warning).toContain('excede a autonomia');
  });

  it('contém os postos estratégicos clássicos do Rio catalogados', () => {
    expect(RIO_GNV_STATIONS.length).toBeGreaterThanOrEqual(10);
    const hasRadialOeste = RIO_GNV_STATIONS.some((s) => s.id === 'gnv_radial_oeste');
    const hasBrasil = RIO_GNV_STATIONS.some((s) => s.id === 'gnv_brasil_bonsucesso');
    const hasBotafogo = RIO_GNV_STATIONS.some((s) => s.id === 'gnv_botafogo_mena');
    expect(hasRadialOeste).toBe(true);
    expect(hasBrasil).toBe(true);
    expect(hasBotafogo).toBe(true);
  });
});
