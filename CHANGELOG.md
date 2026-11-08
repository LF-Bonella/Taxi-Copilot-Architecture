# Changelog

Todas as alterações notáveis deste projeto estão documentadas neste arquivo.

## [1.5.0-showcase] - 2026-11-08
- **Adicionado:** Edição pública **Showcase (Portfólio)** totalmente desacoplada da operação particular, com **Modo Sandbox Independente** (`BroadcastChannel` + `localStorage` isolado sob o namespace `taxi_showcase:`).
- **Adicionado:** Geradores de dados 100% sintéticos/fictícios (`Táxi Demo #07 · Showcase RJ`, 7 corridas demonstrativas distribuídas pelos turnos do Rio, abastecimentos de GNV em postos 220 BAR e 4 grandes eventos com *Horário de Ouro* dinâmico).
- **Adicionado:** Pipeline de Integração Contínua (`.github/workflows/ci.yml`) executando verificação estática `tsc --noEmit`, suíte de 21 testes unitários `vitest run` e validação de bundle `vite build`.
- **Adicionado:** Documentação arquitetural completa para avaliação técnica de portfólio (`ARCHITECTURE.md`, `FEATURES.md`, `TESTING.md`, `USER_GUIDE.md`, `ROADMAP.md` e `CREDITS.md`).
- **Refinado:** Módulo `safetyZones.ts` revisado como **Heurística Geoespacial de Corredores Arteriais**, substituindo instruções imperativas por diretrizes informativas de apoio à decisão viária.
- **Refinado:** Módulo financeiro apresentado formalmente como **Estimador de Corrida & Controle Financeiro de Turno**, enfatizando seu papel gerencial complementar ao taxímetro regulamentado.

## [1.4.0] - 2026-11-06
- **Adicionado:** **Central de Operações (Torre de Controle Desktop)** com 4 abas integradas: *Eventos & Radar*, *Rádio & Bloqueios*, *Telemetria* e *Planilha & Gestão Financeira*.
- **Adicionado:** Exportador nativo de relatórios financeiros em formato `.CSV` (UTF-8 BOM) compatível com Microsoft Excel, Google Sheets e Power BI.
- **Adicionado:** Pipelines Python de curadoria de eventos (`rj_event_harvester.py`) e ingestão de dados abertos municipais do COR-Rio (`cor_rio_incident_harvester.py`).
- **Melhoria:** Reformulação completa da interface mobile com *bottom sheet* retrátil de 1 toque, pílulas compactas de status e suporte a tema claro/escuro de alto contraste solar.

## [1.3.0] - 2026-11-06
- **Adicionado:** **Monitor de GNV & Gestão de Combustível** (`gnvTracker.ts`) com manômetro digital de 4 níveis + reserva, odômetro dinâmico descontado pelo GPS e catálogo georreferenciado de postos 24h e 220 BAR no Rio de Janeiro.
- **Adicionado:** **Heurística de Corredores Arteriais** (`safetyZones.ts`) para avaliação geométrica das alternativas do OSRM e prevenção de atalhos por vias secundárias restritas.

## [1.2.0] - 2026-11-06
- **Adicionado:** **Motor de Calendário Civil & Sazonalidade Urbana** (`calendarEngine.ts`) com cálculo algorítmico de feriados móveis (*Computus*), feriados cariocas, vésperas de feriadão e domingos de ENEM.
- **Adicionado:** **Consultor de Destino Alternativo do Veterano**, sugerindo polos de alta demanda quando o motorista seleciona um destino vazio de distância equivalente.

## [1.0.0] - 2026-11-06
- **Adicionado:** Núcleo determinístico **Cérebro do Taxista Veterano** (`veteranBrain.ts`) com Matriz Horária de 7 Faixas, 36 polos georreferenciados do Rio de Janeiro, gatilho de chuva Open-Meteo e Detector de Zona Morta.
- **Adicionado:** Navegação *Turn-by-Turn* com MapLibre GL, OSRM, síntese de voz em português e **Simulador GPS de Laboratório** com 8 cenários táticos de 1 toque.
