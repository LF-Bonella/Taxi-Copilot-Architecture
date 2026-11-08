/**
 * Central de Operações / Torre de Controle (Visão do Operador no PC).
 * Gerencia o banco de dados Supabase em tempo real:
 *  - Publicação e exclusão de Oportunidades & Shows (tactical_events)
 *  - Decodificador de Flyers e JSON-LD (desacoplados do app do motorista)
 *  - Injeção remota de Bloqueios/Blitz e Transmissão de Rádio/Voz (city_hazards & dispatcher_messages)
 *  - Monitoramento ao vivo da Telemetria e Ganhos do Táxi na rua (driver_telemetry)
 */
import type { LngLat } from '../engine/geo';
import {
  RIO_VENUES,
  curatedDemoEvents,
  hhmm,
  parseFlyer,
  parseJsonLd,
} from '../engine/eventDetector';
import {
  REPORT_META,
  type Opportunity,
  type ReportType,
  type TrafficReport,
} from '../engine/types';
import { RIO_ZONES } from '../engine/veteranBrain';
import type { CloudSyncService, DriverTelemetry, TaxiTripLog, TaxiRefuelLog } from '../services/cloudSync';
import { reverseGeocode } from '../services/geocode';

export interface CentralDashboardDeps {
  cloud: CloudSyncService;
  getEvents: () => Opportunity[];
  getHazards: () => TrafficReport[];
  getTelemetry: () => DriverTelemetry[];
  getPickedPoint: () => { pos: LngLat; street: string } | null;
  focusMapOn: (pos: LngLat, zoom?: number) => void;
  toast: (msg: string) => void;
  nowDate: () => Date;
  onClearShift?: () => void;
}

export class CentralDashboard {
  private activeTab: 'events' | 'dispatch' | 'telemetry' | 'analytics' = 'events';
  private deps: CentralDashboardDeps;
  private cachedTripsLog: TaxiTripLog[] = [];
  private cachedRefuelsLog: TaxiRefuelLog[] = [];
  private loadingAnalytics = false;

  constructor(deps: CentralDashboardDeps) {
    this.deps = deps;
    this.bindNav();
  }

  private bindNav() {
    document
      .querySelectorAll<HTMLButtonElement>('.central-nav button[data-ctab]')
      .forEach((btn) => {
        btn.onclick = () => {
          this.activeTab = (btn.dataset.ctab as 'events' | 'dispatch' | 'telemetry' | 'analytics') || 'events';
          document
            .querySelectorAll('.central-nav button')
            .forEach((b) => b.classList.toggle('active', b === btn));
          this.render();
        };
      });
  }

  public updateSyncBadge(connected: boolean, lastSyncMs: number) {
    const el = document.getElementById('central-sync-badge');
    if (!el) return;
    const modeLabel = this.deps.cloud.isSandboxMode ? 'SANDBOX DEMO' : 'SUPABASE REALTIME';
    if (connected) {
      const timeStr = lastSyncMs
        ? new Date(lastSyncMs).toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          })
        : 'agora';
      el.textContent = `🟢 ${modeLabel} · SYNC ${timeStr}`;
      el.classList.remove('offline');
    } else {
      el.textContent = `🔴 RECONECTANDO (${modeLabel})...`;
      el.classList.add('offline');
    }
  }

  public render() {
    const dock = document.getElementById('central-dock');
    if (!dock || dock.classList.contains('hidden')) return;
    const body = document.getElementById('central-body');
    if (!body) return;

    if (this.activeTab === 'events') {
      this.renderEventsTab(body);
    } else if (this.activeTab === 'dispatch') {
      this.renderDispatchTab(body);
    } else if (this.activeTab === 'telemetry') {
      this.renderTelemetryTab(body);
    } else {
      void this.renderAnalyticsTab(body);
    }
  }

  private renderEventsTab(body: HTMLElement) {
    const events = this.deps.getEvents();
    const picked = this.deps.getPickedPoint();
    const now = this.deps.nowDate();
    const defaultStart = new Date(now.getTime() + 30 * 60000);
    const defaultEnd = new Date(now.getTime() + 95 * 60000);
    const fmtTime = (d: Date) =>
      `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

    body.innerHTML = `
      <!-- BANCO DE EVENTOS ATIVOS NO SUPABASE -->
      <div class="card" style="border-left: 5px solid var(--blue)">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap">
          <h3 style="margin:0">☁️ Oportunidades no Banco (${events.length})</h3>
          <div class="row" style="gap:6px">
            <button id="ct-run-harvester" class="green" style="padding:6px 12px;font-size:11px;font-weight:900">🤖 Varredura Automática RJ</button>
            <button id="ct-seed-demo" class="ghost" style="padding:6px 8px;font-size:11px;font-weight:800">⚡ Semear 3</button>
          </div>
        </div>
        <p class="subtext" style="margin:4px 0 8px">
          Eventos curados automaticamente (Sympla/Eventim/Arenas RJ) com Esquinas de Escape calculadas pelo Cérebro Veterano.
        </p>

        ${
          events.length === 0
            ? `<p class="dim-text" style="font-size:13px;padding:8px 0">Nenhum evento ativo cadastrado no banco. Clique no botão acima "🤖 Varredura Automática RJ" para disparar a curadoria imediata.</p>`
            : `<div style="display:flex;flex-direction:column;gap:8px">
                ${events
                  .map(
                    (e) => {
                      const nowMs = now.getTime();
                      const statusPill = e.operationalStatus
                        ? (e.operationalStatus.includes('POSICIONAR') || e.operationalStatus.includes('ATIVA')
                            ? `<span class="pill hot">${e.operationalStatus}</span>`
                            : `<span class="pill gold">${e.operationalStatus}</span>`)
                        : nowMs >= e.goldenArrival && nowMs <= e.estimatedEnd + 45 * 60000
                          ? '<span class="pill hot">🔥 POSICIONAR AGORA (SAÍDA ATIVA)</span>'
                          : nowMs >= e.goldenArrival - 60 * 60000 && nowMs < e.goldenArrival
                            ? '<span class="pill gold">⏳ PREPARAR DESLOCAMENTO</span>'
                            : '<span class="pill">📅 AGENDADO HOJE</span>';

                      const platBadge = e.platform ? `<span class="pill">${e.platform.toUpperCase()}</span>` : '';
                      const dateBadge = `<span class="pill">📅 ${new Date(e.eventStart).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}</span>`;
                      const linkPill = e.sourceUrl
                        ? `<a href="${e.sourceUrl}" target="_blank" rel="noopener noreferrer" class="pill" style="text-decoration:none;background:rgba(59,130,246,0.18);color:#60a5fa;border:1px solid rgba(59,130,246,0.4)">🔗 Ingressos / Fonte ↗</a>`
                        : '';

                      return `
                        <div class="card-event" style="margin-top:0">
                          <div class="meta" style="flex-wrap:wrap">
                            ${statusPill}
                            ${platBadge}
                            ${dateBadge}
                            ${linkPill}
                            <span class="pill gold">⏰ Ouro ${hhmm(e.goldenArrival)}</span>
                            <span class="pill hot">🏁 Fim ${hhmm(e.estimatedEnd)}</span>
                            <span class="pill">👥 ~${e.expectedCrowd.toLocaleString('pt-BR')}</span>
                            <span class="pill">🔥 Score ${e.demandScore}</span>
                          </div>
                          <h3 style="margin:4px 0;font-size:15px">${e.title}</h3>
                          <p style="font-size:12px;margin:2px 0"><b>Escape Tático:</b> ${e.escapeCorner}</p>
                          <p class="subtext" style="font-size:11px;margin:2px 0">${e.driverInstruction}</p>
                          <div class="row" style="margin-top:8px">
                            <button data-ct-focus="${e.id}" class="ghost" style="padding:7px;font-size:12px">🗺️ Ver no Mapa</button>
                            ${e.sourceUrl ? `<a href="${e.sourceUrl}" target="_blank" rel="noopener noreferrer" class="ghost" style="padding:7px 10px;font-size:12px;text-decoration:none;display:inline-flex;align-items:center;gap:4px">🎟️ Abrir Venda / Fonte ↗</a>` : ''}
                            <button data-ct-del-ev="${e.id}" class="danger" style="padding:7px;font-size:12px">🗑️ Excluir</button>
                          </div>
                        </div>
                      `;
                    },
                  )
                  .join('')}
              </div>`
        }
      </div>

      <!-- CADASTRO DIRETO DE EVENTO / SHOW -->
      <div class="card" style="border-left: 5px solid var(--green)">
        <h3>➕ Publicar Novo Evento / Show para o Motorista</h3>
        <label>Local / Arena do Evento
          <select id="ct-venue">
            ${RIO_VENUES.map(
              (v) =>
                `<option value="${v.id}">${v.name} (~${v.capacity.toLocaleString('pt-BR')} lug.)</option>`,
            ).join('')}
            ${
              picked
                ? `<option value="__picked__" selected>📍 Ponto selecionado no mapa (${picked.street})</option>`
                : `<option value="__picked__">📍 Usar ponto clicado no mapa (clique c/ botão direito no mapa)</option>`
            }
          </select>
        </label>

        <label style="margin-top:8px">Nome do Evento / Show
          <input id="ct-title" type="text" placeholder="Ex: Show Caetano & Bethânia / Flamengo x Palmeiras" />
        </label>

        <div class="grid2" style="margin-top:8px">
          <label>Início do Evento
            <input id="ct-start" type="time" value="${fmtTime(defaultStart)}" />
          </label>
          <label>Término Previsto (Dispersão)
            <input id="ct-end" type="time" value="${fmtTime(defaultEnd)}" />
          </label>
        </div>

        <div class="grid2" style="margin-top:8px">
          <label>Público Estimado
            <input id="ct-crowd" type="number" step="500" value="${RIO_VENUES[0].capacity}" />
          </label>
          <label>Esquina de Escape Sugerida
            <input id="ct-escape" type="text" value="${RIO_VENUES[0].escapeCorner}" />
          </label>
        </div>

        <div class="row" style="margin-top:10px">
          <button id="ct-publish-direct" class="big green">🚀 PUBLICAR NO RADAR DO MOTORISTA</button>
        </div>
      </div>

      <!-- DECODIFICADOR DE FLYER / INSTAGRAM (EXCLUSIVO DA CENTRAL) -->
      <div class="card">
        <h3>📸 Decodificar Flyer / Legenda do Instagram</h3>
        <p class="subtext">Cole o texto do post; o motor calcula o Horário de Ouro (25 min antes do fim) e publica no Supabase.</p>
        <label style="margin-top:6px">Arena / Casa de Show
          <select id="ct-fl-venue">
            ${RIO_VENUES.map((v) => `<option value="${v.id}">${v.name}</option>`).join('')}
          </select>
        </label>
        <label style="margin-top:6px">Texto do flyer ou legenda
          <textarea id="ct-fl-text" rows="2" placeholder="Ex: Hoje! Abertura 20h | Show principal às 21h30 término às 23h45"></textarea>
        </label>
        <div class="row" style="margin-top:8px">
          <button id="ct-fl-add" class="big yellow">⚡ Extrair & Publicar no Supabase</button>
        </div>
      </div>

      <!-- IMPORTADOR JSON-LD (SYMPLA / EVENTIM / INGRESSE) -->
      <div class="card">
        <h3>🎟️ Importar Schema.org / JSON-LD (Sympla, Eventim, Ingresse)</h3>
        <textarea id="ct-jl-text" rows="2" placeholder='Cole <script type="application/ld+json"> ou JSON de evento'></textarea>
        <div class="row" style="margin-top:8px">
          <button id="ct-jl-sample" class="ghost">Carregar Exemplo</button>
          <button id="ct-jl-add" class="green">Importar p/ Supabase</button>
        </div>
      </div>
    `;

    // Atualizar capacidade e esquina ao mudar o select de venue
    const venueSelect = document.getElementById('ct-venue') as HTMLSelectElement;
    venueSelect.onchange = () => {
      const v = RIO_VENUES.find((x) => x.id === venueSelect.value);
      if (v) {
        (document.getElementById('ct-crowd') as HTMLInputElement).value = String(v.capacity);
        (document.getElementById('ct-escape') as HTMLInputElement).value = v.escapeCorner;
      } else if (venueSelect.value === '__picked__' && picked) {
        (document.getElementById('ct-crowd') as HTMLInputElement).value = '5000';
        (document.getElementById('ct-escape') as HTMLInputElement).value = `Arredores de ${picked.street}`;
      }
    };

    // Disparar Varredura Automatizada RJ (Sympla, Eventim, Polos Táticos)
    const runHarvesterBtn = document.getElementById('ct-run-harvester');
    if (runHarvesterBtn) {
      runHarvesterBtn.onclick = async () => {
        (runHarvesterBtn as HTMLButtonElement).disabled = true;
        (runHarvesterBtn as HTMLButtonElement).textContent = '🔄 Varrendo RJ...';
        try {
          const count = await this.deps.cloud.runAutomatedHarvester(this.deps.nowDate());
          this.deps.toast(`🤖 Varredura Concluída! ${count} eventos sincronizados no Supabase.`);
          this.render();
        } catch (e) {
          this.deps.toast('Erro ao rodar varredura.');
        } finally {
          (runHarvesterBtn as HTMLButtonElement).disabled = false;
          (runHarvesterBtn as HTMLButtonElement).textContent = '🤖 Varredura Automática RJ';
        }
      };
    }

    // Semear 3 eventos de teste no Supabase
    document.getElementById('ct-seed-demo')!.onclick = async () => {
      const demos = curatedDemoEvents(this.deps.nowDate()).slice(0, 3);
      for (const d of demos) {
        await this.deps.cloud.publishEvent(d);
      }
      this.deps.toast('⚡ 3 eventos reais publicados no Supabase!');
      this.render();
    };

    // Publicar evento direto
    document.getElementById('ct-publish-direct')!.onclick = async () => {
      const vId = venueSelect.value;
      const pickedPt = this.deps.getPickedPoint();
      const v = RIO_VENUES.find((x) => x.id === vId) ?? RIO_VENUES[0];

      const venuePos: LngLat = vId === '__picked__' && pickedPt ? pickedPt.pos : v.pos;
      const escapePos: LngLat = vId === '__picked__' && pickedPt ? pickedPt.pos : v.escape;
      const venueName = vId === '__picked__' && pickedPt ? pickedPt.street : v.name;

      const rawTitle = (document.getElementById('ct-title') as HTMLInputElement).value.trim();
      const startStr = (document.getElementById('ct-start') as HTMLInputElement).value || '21:00';
      const endStr = (document.getElementById('ct-end') as HTMLInputElement).value || '23:30';
      const crowd =
        parseInt((document.getElementById('ct-crowd') as HTMLInputElement).value, 10) || 5000;
      const escapeCorner =
        (document.getElementById('ct-escape') as HTMLInputElement).value.trim() || v.escapeCorner;

      const opp = parseFlyer({
        rawText: `${rawTitle || venueName} início às ${startStr} término às ${endStr}`,
        venueName,
        venue: venuePos,
        escape: escapePos,
        escapeCorner,
        crowd,
        baseDate: this.deps.nowDate(),
        source: 'curadoria',
      });
      if (rawTitle) {
        opp.title = `${rawTitle} (${venueName})`;
      }

      const ok = await this.deps.cloud.publishEvent(opp);
      if (ok) {
        this.deps.toast(`🚀 Publicado no Supabase! Ouro às ${hhmm(opp.goldenArrival)}`);
        this.deps.focusMapOn(opp.escape, 15);
        this.render();
      } else {
        this.deps.toast('Erro ao publicar no Supabase');
      }
    };

    // Decodificar flyer e salvar no Supabase
    document.getElementById('ct-fl-add')!.onclick = async () => {
      const vId = (document.getElementById('ct-fl-venue') as HTMLSelectElement).value;
      const v = RIO_VENUES.find((x) => x.id === vId) ?? RIO_VENUES[0];
      const raw =
        (document.getElementById('ct-fl-text') as HTMLTextAreaElement).value.trim() ||
        'Show principal início 21h término 23h30';
      const opp = parseFlyer({
        rawText: raw,
        venueName: v.name,
        venue: v.pos,
        escape: v.escape,
        escapeCorner: v.escapeCorner,
        crowd: v.capacity,
        baseDate: this.deps.nowDate(),
        source: 'flyer',
      });
      const ok = await this.deps.cloud.publishEvent(opp);
      if (ok) {
        this.deps.toast(`✅ Flyer publicado no Supabase! Ouro às ${hhmm(opp.goldenArrival)}`);
        this.render();
      }
    };

    // JSON-LD exemplo e importação
    document.getElementById('ct-jl-sample')!.onclick = () => {
      const nowMs = this.deps.nowDate().getTime();
      (document.getElementById('ct-jl-text') as HTMLTextAreaElement).value = JSON.stringify(
        {
          '@context': 'https://schema.org',
          '@type': 'MusicEvent',
          name: 'Show Especial no Qualistage (Esgotado)',
          startDate: new Date(nowMs - 60 * 60000).toISOString(),
          endDate: new Date(nowMs + 40 * 60000).toISOString(),
          location: {
            '@type': 'Place',
            name: 'Qualistage',
            geo: { '@type': 'GeoCoordinates', latitude: -22.9837, longitude: -43.3651 },
          },
          offers: { '@type': 'Offer', availability: 'https://schema.org/SoldOut' },
        },
        null,
        2,
      );
    };

    document.getElementById('ct-jl-add')!.onclick = async () => {
      const raw = (document.getElementById('ct-jl-text') as HTMLTextAreaElement).value.trim();
      const parsed = parseJsonLd(raw, RIO_VENUES[0]);
      if (!parsed.length) {
        this.deps.toast('JSON-LD inválido ou sem @type Event');
        return;
      }
      for (const p of parsed) {
        await this.deps.cloud.publishEvent(p);
      }
      this.deps.toast(`✅ ${parsed.length} evento(s) publicado(s) no Supabase!`);
      this.render();
    };

    // Ações nos eventos listados
    body.querySelectorAll<HTMLButtonElement>('button[data-ct-focus]').forEach((b) => {
      b.onclick = () => {
        const ev = events.find((x) => x.id === b.dataset.ctFocus);
        if (ev) this.deps.focusMapOn(ev.escape, 15.5);
      };
    });

    body.querySelectorAll<HTMLButtonElement>('button[data-ct-del-ev]').forEach((b) => {
      b.onclick = async () => {
        const id = b.dataset.ctDelEv;
        if (!id) return;
        await this.deps.cloud.deleteEvent(id);
        this.deps.toast('🗑️ Evento removido do Supabase');
        this.render();
      };
    });
  }

  private renderDispatchTab(body: HTMLElement) {
    const hazards = this.deps.getHazards();
    const picked = this.deps.getPickedPoint();

    body.innerHTML = `
      <!-- TRANSMISSÃO DE RÁDIO / ORDEM DIRETA PARA O COCKPIT -->
      <div class="card" style="border-left: 5px solid var(--yellow)">
        <h3>📻 Rádio da Central · Comando de Voz p/ Motorista</h3>
        <p class="subtext">Envie um aviso que será lido em voz alta no celular do taxista na hora.</p>

        <label style="margin-top:6px">Mensagem para o Motorista
          <textarea id="ct-msg-text" rows="2" placeholder="Ex: Atenção! Forte fluxo de desembarque agora no Santos Dumont, siga para a pista externa."></textarea>
        </label>

        <label style="margin-top:6px">Anexar Destino Tático (Opcional - cria botão "Ir Agora" na tela dele)
          <select id="ct-msg-dest">
            <option value="">— Apenas aviso de voz/texto (sem rota anexa) —</option>
            ${
              picked
                ? `<option value="__picked__" selected>📍 Ponto selecionado no mapa (${picked.street})</option>`
                : ''
            }
            ${RIO_ZONES.slice(0, 18)
              .map((z) => `<option value="${z.id}">🎯 ${z.name} (${z.category})</option>`)
              .join('')}
          </select>
        </label>

        <div class="row" style="margin-top:8px">
          <button id="ct-send-msg" class="big yellow">🔊 TRANSMITIR PARA O TÁXI AGORA</button>
        </div>

        <h4 style="margin:12px 0 6px;font-size:12px;color:var(--yellow)">Disparos Rápidos de 1 Toque:</h4>
        <div class="scenarios">
          <button data-qmsg="🌧️ Alerta da Central: Chuva forte entrando na Zona Sul. Priorize saídas de metrô e shoppings imediatamente!">🌧️ Alerta de Chuva</button>
          <button data-qmsg="✈️ Informe da Central: Atrasos e fila cheia no desembarque do Santos Dumont. Excelente giro agora!" data-qzone="sdu">✈️ Corrida SDU</button>
          <button data-qmsg="🏥 Informe da Central: Giro alto de altas médicas nos hospitais de Botafogo e Copacabana." data-qzone="copa_dor">🏥 Giro Hospitais</button>
          <button data-qmsg="⚠️ Alerta da Central: Evite a Avenida Brasil e Linha Vermelha agora devido a retenção severa.">⚠️ Alerta Vias Expressas</button>
        </div>
      </div>

      <!-- INJETOR REMOTO DE BLOQUEIOS / INTERDIÇÕES -->
      <div class="card" style="border-left: 5px solid var(--red)">
        <h3>⛔ Injetar Bloqueio / Blitz no Mapa do Motorista</h3>
        <p class="subtext">
          ${
            picked
              ? `📍 Alvo atual no mapa: <b>${picked.street}</b> (${picked.pos[1].toFixed(4)}, ${picked.pos[0].toFixed(4)})`
              : `💡 Dica: clique com o botão direito em qualquer rua do mapa ao lado para escolher o ponto exato da interdição.`
          }
        </p>
        <div class="reports" style="margin-top:8px">
          <button data-ct-hazard="BLITZ">🚨<span>Injetar Blitz</span></button>
          <button data-ct-hazard="ROAD_CLOSED">⛔<span>Interdição</span></button>
          <button data-ct-hazard="HEAVY_TRAFFIC">🚗<span>Trânsito</span></button>
          <button data-ct-hazard="DEAD_ZONE">🚧<span>Zona Morta</span></button>
        </div>
      </div>

      <!-- LISTA DE BLOQUEIOS ATIVOS NO SANDBOX / BANCO -->
      <div class="card">
        <div class="row-between" style="align-items:center;margin-bottom:6px;gap:6px;flex-wrap:wrap">
          <h3 style="margin:0">🚨 Bloqueios & Alertas (${hazards.length})</h3>
          <div style="display:flex;gap:6px">
            <button id="ct-sync-cor" class="green" style="padding:5px 9px;font-size:11px;font-weight:800">🏛️ COR-Rio (Dados Abertos)</button>
            <button id="ct-sync-waze" class="ghost" style="padding:5px 9px;font-size:11px;font-weight:800">📡 Simulador Feed Trânsito</button>
          </div>
        </div>
        <p class="dim-text" style="font-size:11px;margin:2px 0 8px">
          ⚡ Ingestão demonstrativa de ocorrências municipais (COR-Rio) e feed sintético no esquema Waze CCP.
        </p>
        ${
          hazards.length === 0
            ? `<p class="dim-text" style="font-size:13px">Nenhuma blitz ou interdição ativa no banco.</p>`
            : `<div style="display:flex;flex-direction:column;gap:6px">
                ${hazards
                  .map((r) => {
                    const meta = REPORT_META[r.type];
                    const minLeft = Math.max(1, Math.round((r.expiresAt - Date.now()) / 60000));
                    return `
                      <div class="alert-list-item" style="border-left-color:${meta.color}">
                        <div style="cursor:pointer" data-ct-hz-focus="${r.id}">
                          <b>${meta.emoji} ${meta.label}</b>
                          <small class="dim-text" style="display:block">${r.street} (expira em ~${minLeft} min)</small>
                        </div>
                        <button data-ct-hz-del="${r.id}" class="danger" style="padding:6px 12px;font-size:12px;font-weight:700">Remover</button>
                      </div>
                    `;
                  })
                  .join('')}
              </div>`
        }
      </div>
    `;

    // Enviar mensagem personalizada
    document.getElementById('ct-send-msg')!.onclick = async () => {
      const txt = (document.getElementById('ct-msg-text') as HTMLTextAreaElement).value.trim();
      if (!txt) {
        this.deps.toast('Digite uma mensagem para transmitir ao motorista');
        return;
      }
      const destId = (document.getElementById('ct-msg-dest') as HTMLSelectElement).value;
      let targetPos: LngLat | undefined;
      let targetLabel: string | undefined;

      if (destId === '__picked__' && picked) {
        targetPos = picked.pos;
        targetLabel = picked.street;
      } else if (destId) {
        const z = RIO_ZONES.find((x) => x.id === destId);
        if (z) {
          targetPos = z.pos;
          targetLabel = z.name;
        }
      }

      const ok = await this.deps.cloud.sendDispatcherMessage(txt, 'urgent', targetPos, targetLabel);
      if (ok) {
        (document.getElementById('ct-msg-text') as HTMLTextAreaElement).value = '';
        this.deps.toast('📻 Mensagem transmitida para o táxi via Supabase!');
      }
    };

    // Disparos rápidos
    body.querySelectorAll<HTMLButtonElement>('button[data-qmsg]').forEach((b) => {
      b.onclick = async () => {
        const msg = b.dataset.qmsg!;
        const zId = b.dataset.qzone;
        const z = zId ? RIO_ZONES.find((x) => x.id === zId) : undefined;
        await this.deps.cloud.sendDispatcherMessage(msg, 'urgent', z?.pos, z?.name);
        this.deps.toast('📻 Disparo rápido enviado ao motorista!');
      };
    });

    // Injetar bloqueio
    body.querySelectorAll<HTMLButtonElement>('button[data-ct-hazard]').forEach((b) => {
      b.onclick = async () => {
        const type = b.dataset.ctHazard as ReportType;
        const center = this.deps.getPickedPoint();
        const pos: LngLat = center ? center.pos : [-43.1825, -22.9519];
        const street = center ? center.street : await reverseGeocode(pos);
        const now = Date.now();
        const rep: TrafficReport = {
          id: `rep_${now}`,
          type,
          pos,
          street,
          createdAt: now,
          expiresAt: now + REPORT_META[type].ttlMin * 60000,
        };
        await this.deps.cloud.publishHazard(rep, 'central');
        this.deps.focusMapOn(pos, 15);
        this.deps.toast(`${REPORT_META[type].emoji} Injetado no Supabase: ${street}`);
        this.render();
      };
    });

    // Focar ou deletar bloqueio
    body.querySelectorAll<HTMLElement>('[data-ct-hz-focus]').forEach((el) => {
      el.onclick = () => {
        const h = hazards.find((x) => x.id === el.dataset.ctHzFocus);
        if (h) this.deps.focusMapOn(h.pos, 16);
      };
    });

    body.querySelectorAll<HTMLButtonElement>('button[data-ct-hz-del]').forEach((b) => {
      b.onclick = async () => {
        const id = b.dataset.ctHzDel;
        if (!id) return;
        await this.deps.cloud.deleteHazard(id);
        this.deps.toast('Bloqueio removido do Supabase');
        this.render();
      };
    });

    const syncWazeBtn = document.getElementById('ct-sync-waze');
    if (syncWazeBtn) {
      syncWazeBtn.onclick = async () => {
        (syncWazeBtn as HTMLButtonElement).disabled = true;
        (syncWazeBtn as HTMLButtonElement).textContent = '🔄 Puxando Waze...';
        try {
          const count = await this.deps.cloud.syncWazeHazards();
          this.deps.toast(`📡 ${count} alertas Waze RJ sincronizados no Supabase!`);
          this.render();
        } catch {
          this.deps.toast('Erro ao sincronizar alertas Waze.');
        } finally {
          (syncWazeBtn as HTMLButtonElement).disabled = false;
          (syncWazeBtn as HTMLButtonElement).textContent = '📡 Waze RJ';
        }
      };
    }

    const syncCorBtn = document.getElementById('ct-sync-cor');
    if (syncCorBtn) {
      syncCorBtn.onclick = async () => {
        (syncCorBtn as HTMLButtonElement).disabled = true;
        (syncCorBtn as HTMLButtonElement).textContent = '🔄 Puxando COR-Rio...';
        try {
          const count = await this.deps.cloud.syncCorRioHazards();
          this.deps.toast(`🏛️ ${count} ocorrências oficiais do COR-Rio sincronizadas!`);
          this.render();
        } catch {
          this.deps.toast('Erro ao sincronizar dados do COR-Rio.');
        } finally {
          (syncCorBtn as HTMLButtonElement).disabled = false;
          (syncCorBtn as HTMLButtonElement).textContent = '🏛️ COR-Rio (Dados Abertos)';
        }
      };
    }
  }

  private renderTelemetryTab(body: HTMLElement) {
    const list = this.deps.getTelemetry();
    const t = list[0];

    if (!t) {
      body.innerHTML = `
        <div class="card">
          <h3>🚕 Aguardando Sinal de Telemetria...</h3>
          <p class="dim-text">Assim que o aplicativo do motorista estiver ativo, a localização GPS, velocidade, status e ganhos aparecerão aqui em tempo real.</p>
        </div>
      `;
      return;
    }

    const statusBadge: Record<DriverTelemetry['status'], { label: string; cls: string }> = {
      IDLE: { label: '🟢 LIVRE · AGUARDANDO', cls: 'pill' },
      FISHING: { label: '🎣 EM ROTA DE PESCA', cls: 'pill gold' },
      ON_TRIP: { label: '🚕 PASSAGEIRO A BORDO (TAXÍMETRO)', cls: 'pill hot' },
      EVENT_INTERCEPT: { label: '🎤 INDO P/ ESCAPE DE EVENTO', cls: 'pill gold' },
    };

    const st = statusBadge[t.status] || statusBadge.IDLE;
    const totalKm = t.paidKmToday + t.emptyKmToday;
    const emptyPct = totalKm > 0 ? Math.round((t.emptyKmToday / totalKm) * 100) : 0;
    const secAgo = Math.max(0, Math.round((Date.now() - t.updatedAt) / 1000));

    body.innerHTML = `
      <div class="card" style="border-left: 5px solid var(--green)">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <h3 style="margin:0">🚕 ${t.driverName}</h3>
          <span class="${st.cls}">${st.label}</span>
        </div>
        <p class="subtext" style="margin:6px 0">
          Último pacote GPS recebido há <b>${secAgo}s</b> · Turno: <b>${t.currentShift || 'Ativo'}</b>
        </p>
        ${
          t.activeDestination
            ? `<p style="font-size:13px;margin:4px 0">🧭 <b>Destino atual:</b> ${t.activeDestination}</p>`
            : ''
        }
        <div class="row" style="margin-top:8px">
          <button id="ct-follow-taxi" class="big green">🎯 Localizar Táxi no Mapa (${Math.round(t.speedKmh)} km/h)</button>
        </div>
      </div>

      <div class="grid2">
        <div class="card stat">
          <b>R$ ${t.totalFareToday.toFixed(2).replace('.', ',')}</b>
          <small>Faturamento Hoje (${t.tripsCountToday} corridas)</small>
        </div>
        <div class="card stat">
          <b>${Math.round(t.speedKmh)} km/h</b>
          <small>Velocidade Atual no GPS</small>
        </div>
        <div class="card stat">
          <b>${t.paidKmToday.toFixed(1)} km</b>
          <small>Km Pagos Rodados</small>
        </div>
        <div class="card stat">
          <b>${emptyPct}% vazio</b>
          <small>${t.emptyKmToday.toFixed(1)} km batendo lata</small>
        </div>
      </div>

      <div class="card">
        <h3>🧾 Últimas Corridas Sincronizadas do Carro</h3>
        ${
          t.recentTrips.length === 0
            ? `<p class="dim-text" style="font-size:13px">Nenhuma corrida finalizada neste turno ainda.</p>`
            : t.recentTrips
                .map(
                  (tr) => `
                  <p style="font-size:13px;border-bottom:1px solid var(--line);padding:6px 0;margin:0">
                    <b>R$ ${Number(tr.fare).toFixed(2).replace('.', ',')}</b> · ${tr.distanceKm} km · ${tr.pickupZone}
                    <span class="dim-text">(${new Date(tr.end).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })})</span>
                  </p>
                `,
                )
                .join('')
        }
      </div>
    `;

    document.getElementById('ct-follow-taxi')!.onclick = () => {
      this.deps.focusMapOn(t.pos, 15.5);
    };
  }

  private async renderAnalyticsTab(body: HTMLElement) {
    if (this.loadingAnalytics) {
      body.innerHTML = `
        <div class="card">
          <h3>📊 Carregando Planilha & Telemetria do Supabase...</h3>
          <p class="dim-text">Buscando histórico consolidado de corridas e faturamento na nuvem.</p>
        </div>
      `;
      return;
    }

    this.loadingAnalytics = true;
    try {
      const [trips, refuels] = await Promise.all([
        this.deps.cloud.fetchTripsLog(150),
        this.deps.cloud.fetchRefuelsLog(50),
      ]);
      this.cachedTripsLog = trips;
      this.cachedRefuelsLog = refuels;
    } catch {
      /* fallback cache */
    } finally {
      this.loadingAnalytics = false;
    }

    const trips = this.cachedTripsLog;
    const refuels = this.cachedRefuelsLog;

    const totalGross = trips.reduce((s, t) => s + t.fare, 0);
    const totalGnvCost = refuels.reduce((s, r) => s + r.totalCost, 0) || trips.reduce((s, t) => s + t.estimatedGnvCost, 0);
    const totalNetProfit = trips.reduce((s, t) => s + t.netProfit, 0) || (totalGross - totalGnvCost);
    const totalPaidKm = trips.reduce((s, t) => s + t.distanceKm, 0);
    const totalEmptyKm = trips.reduce((s, t) => s + t.emptyKmBefore, 0);
    const totalKm = totalPaidKm + totalEmptyKm;
    const occupancyRate = totalKm > 0 ? Math.round((totalPaidKm / totalKm) * 100) : 0;
    const avgTicket = trips.length > 0 ? totalGross / trips.length : 0;

    const shiftSums = new Map<string, number>();
    for (const t of trips) {
      shiftSums.set(t.shiftName, (shiftSums.get(t.shiftName) || 0) + t.fare);
    }
    let topShift = 'N/A';
    let maxShiftSum = 0;
    for (const [name, sum] of shiftSums) {
      if (sum > maxShiftSum) {
        maxShiftSum = sum;
        topShift = name;
      }
    }

    body.innerHTML = `
      <div class="card" style="border-left: 5px solid #10b981">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <div>
            <h3 style="margin:0">📊 Planilha & Gestão Financeira (Showcase Sandbox)</h3>
            <small class="dim-text">${trips.length} corridas demonstrativas registradas (Dados 100% Sintéticos)</small>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button id="ct-export-csv" class="green" style="padding:6px 12px;font-size:12px;font-weight:800">
              📥 Exportar CSV
            </button>
            <button id="ct-reset-demo" class="ghost" style="padding:6px 10px;font-size:12px;font-weight:700">
              ⚡ Restaurar Demo
            </button>
            <button id="ct-clear-trips" class="danger" style="padding:6px 10px;font-size:12px;font-weight:700">
              🧹 Limpar Base
            </button>
          </div>
        </div>
      </div>

      <div class="grid2">
        <div class="card stat">
          <b style="color:#10b981">R$ ${totalNetProfit.toFixed(2).replace('.', ',')}</b>
          <small>Lucro Líquido Real (${totalGross > 0 ? ((totalNetProfit / totalGross) * 100).toFixed(0) : 0}% margem)</small>
        </div>
        <div class="card stat">
          <b>R$ ${totalGross.toFixed(2).replace('.', ',')}</b>
          <small>Faturamento Bruto Total</small>
        </div>
        <div class="card stat">
          <b>${occupancyRate}% pago</b>
          <small>${totalPaidKm.toFixed(1)} km pagos / ${totalEmptyKm.toFixed(1)} km vazios</small>
        </div>
        <div class="card stat">
          <b>R$ ${avgTicket.toFixed(2).replace('.', ',')}</b>
          <small>Ticket Médio por Corrida</small>
        </div>
      </div>

      <div class="card" style="padding:8px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;font-size:12px" class="dim-text">
          <span>Melhor Turno: <b>${topShift}</b></span>
          <span>Abastecimentos GNV: <b>R$ ${totalGnvCost.toFixed(2).replace('.', ',')}</b></span>
        </div>
        
        <div style="overflow-x:auto;max-height:480px;border:1px solid var(--line);border-radius:10px">
          <table style="width:100%;border-collapse:collapse;font-size:12px;text-align:left">
            <thead style="background:#0f172a;position:sticky;top:0;z-index:2;color:#94a3b8">
              <tr>
                <th style="padding:8px 6px">Horário</th>
                <th style="padding:8px 6px">Embarque</th>
                <th style="padding:8px 6px">Turno</th>
                <th style="padding:8px 6px">Km</th>
                <th style="padding:8px 6px">Bruto</th>
                <th style="padding:8px 6px">GNV</th>
                <th style="padding:8px 6px">Líquido</th>
                <th style="padding:8px 6px;text-align:center">Ação</th>
              </tr>
            </thead>
            <tbody>
              ${trips.length === 0 ? `
                <tr>
                  <td colspan="8" style="padding:24px;text-align:center;color:var(--muted)">
                    Nenhuma corrida registrada na planilha do Supabase ainda. Faça corridas no app para sincronizar!
                  </td>
                </tr>
              ` : trips.map((t, idx) => `
                <tr style="border-bottom:1px solid var(--line);background:${idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)'}">
                  <td style="padding:6px;white-space:nowrap">
                    <b>${new Date(t.endTime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</b>
                    <small class="dim-text" style="display:block">${new Date(t.endTime).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</small>
                  </td>
                  <td style="padding:6px;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${t.pickupZone}">
                    ${t.pickupZone}
                  </td>
                  <td style="padding:6px;white-space:nowrap;font-size:11px" class="dim-text">
                    ${t.shiftName}
                  </td>
                  <td style="padding:6px;white-space:nowrap">
                    <b>${t.distanceKm} km</b>
                    <small class="dim-text" style="display:block">${t.emptyKmBefore} km vazio</small>
                  </td>
                  <td style="padding:6px;white-space:nowrap;font-weight:700">
                    R$ ${t.fare.toFixed(2).replace('.', ',')}
                  </td>
                  <td style="padding:6px;white-space:nowrap;color:#f59e0b">
                    - R$ ${t.estimatedGnvCost.toFixed(2).replace('.', ',')}
                  </td>
                  <td style="padding:6px;white-space:nowrap;color:#10b981;font-weight:800">
                    R$ ${t.netProfit.toFixed(2).replace('.', ',')}
                  </td>
                  <td style="padding:6px;text-align:center">
                    <button data-del-trip="${t.id}" class="danger" style="padding:2px 6px;font-size:10px;border-radius:4px" title="Excluir corrida da planilha">
                      ✕
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    const exportBtn = document.getElementById('ct-export-csv');
    if (exportBtn) {
      exportBtn.onclick = () => {
        if (trips.length === 0) {
          this.deps.toast('Nenhuma corrida para exportar!');
          return;
        }
        const headers = [
          'ID',
          'Data',
          'Horario Inicio',
          'Horario Fim',
          'Duracao (min)',
          'Motorista',
          'Bairro Embarque',
          'Turno Veterano',
          'Km Pagos',
          'Km Vazios',
          'Faturamento Bruto (R$)',
          'Custo GNV (R$)',
          'Lucro Liquido (R$)',
        ];
        const rows = trips.map((t) => [
          t.id,
          new Date(t.startTime).toLocaleDateString('pt-BR'),
          new Date(t.startTime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
          new Date(t.endTime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
          t.durationMin,
          t.driverName,
          `"${t.pickupZone}"`,
          `"${t.shiftName}"`,
          t.distanceKm.toFixed(1).replace('.', ','),
          t.emptyKmBefore.toFixed(1).replace('.', ','),
          t.fare.toFixed(2).replace('.', ','),
          t.estimatedGnvCost.toFixed(2).replace('.', ','),
          t.netProfit.toFixed(2).replace('.', ','),
        ]);
        const csvContent = '\uFEFF' + [headers.join(';'), ...rows.map((r) => r.join(';'))].join('\r\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `taxi_copilot_corridas_${new Date().toISOString().slice(0, 10)}.csv`;
        link.click();
        URL.revokeObjectURL(url);
        this.deps.toast('📥 Planilha CSV exportada com sucesso!');
      };
    }

    const resetDemoBtn = document.getElementById('ct-reset-demo');
    if (resetDemoBtn) {
      resetDemoBtn.onclick = async () => {
        await this.deps.cloud.resetShowcaseDemoData();
        this.loadingAnalytics = false;
        void this.renderAnalyticsTab(body);
        this.deps.toast('⚡ Dados sintéticos do Showcase restaurados!');
      };
    }

    const clearBtn = document.getElementById('ct-clear-trips');
    if (clearBtn) {
      clearBtn.onclick = async () => {
        if (!confirm('Deseja realmente limpar todas as corridas da base do Supabase?')) return;
        await this.deps.cloud.clearTripsLog();
        this.deps.onClearShift?.();
        this.cachedTripsLog = [];
        this.deps.toast('🧹 Base de corridas resetada com sucesso!');
        void this.renderAnalyticsTab(body);
      };
    }

    body.querySelectorAll<HTMLButtonElement>('button[data-del-trip]').forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.dataset.delTrip;
        if (!id) return;
        await this.deps.cloud.deleteTripLog(id);
        this.cachedTripsLog = this.cachedTripsLog.filter((x) => x.id !== id);
        this.deps.toast('Corrida removida da planilha');
        void this.renderAnalyticsTab(body);
      };
    });
  }
}
