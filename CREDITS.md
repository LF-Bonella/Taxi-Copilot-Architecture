# CREDITS & PROVENANCE

Este arquivo reconhece todas as bibliotecas de código aberto, provedores de dados geoespaciais e integrações de infraestrutura que viabilizaram a construção do **Taxi Copilot (Showcase Edition)**.

## 🚀 Runtimes, Bundlers e Qualidade
* **TypeScript (Strict Mode)**: Superset tipado do JavaScript responsável pela segurança estática de tipos nas entidades geoespaciais, matrizes de turnos e contratos de sincronização.
* **Vite**: Ferramenta de build e servidor de desenvolvimento de alta velocidade com empacotamento otimizado para Progressive Web Applications (PWA).
* **Vitest**: Framework de testes unitários ultrarrápido utilizado para validar as 21 especificações do motor determinístico, calendário civil, geometria de rotas e odômetro de GNV.

## 🗺️ Cartografia Digital & Motores Geoespaciais
* **MapLibre GL JS** (`maplibre-gl`): Motor open-source de renderização de mapas vetoriais acelerado por GPU (WebGL), responsável pela exibição fluida de rotas, zonas de calor, postos de GNV e perímetros viários a 60 FPS.
* **OpenStreetMap & OpenFreeMap**: Fontes de dados cartográficos colaborativos e tiles vetoriais abertos utilizados nos estilos *Dark* (noturno) e *Positron/Bright* (alto contraste solar).
* **OSRM (Open Source Routing Machine)**: Motor de roteamento em grafos viários utilizado para o cálculo de trajetos rápidos, geometria de polilinhas, instruções passo a passo (*Turn-by-Turn*) e alternativas de rota.
* **Photon (Komoot) & Nominatim**: Serviços de geocodificação direta (*autocomplete* de endereços) e geocodificação reversa baseados na malha do OpenStreetMap.

## 🌐 APIs de Contexto Urbano, Sincronização & Web APIs
* **Open-Meteo API**: Serviço meteorológico aberto sem exigência de chave para detecção de precipitação em tempo real no Rio de Janeiro, acionando os multiplicadores automáticos do Modo Chuva.
* **COR-Rio (Centro de Operações e Resiliência da Prefeitura do Rio)**: Referência de dados abertos municipais para esquemas especiais de trânsito da CET-Rio e interdições programadas.
* **Supabase (`@supabase/supabase-js`) & BroadcastChannel API**: Camada de sincronização em tempo real; opera de forma 100% autônoma via `BroadcastChannel` + `localStorage` no Modo Showcase Sandbox e suporta conexão WebSocket PostgreSQL Realtime em ambientes configurados.
* **Web Speech API & Web Audio API**: Síntese vocal nativa em português (`speechSynthesis`) e geração procedural de alertas sonoros sem arquivos de áudio externos.
* **Screen Wake Lock API & Service Workers**: Recursos nativos de PWA para instalação mobile em tela cheia e manutenção da tela ativa no painel do veículo.

## 📐 Algoritmos e Modelagem Matemática
* **Algoritmo de Meeus/Jones/Butcher (*Computus*)**: Implementado em `calendarEngine.ts` para cálculo exato e perpétuo da data da Páscoa e feriados móveis (Carnaval, Quarta-Feira de Cinzas e Corpus Christi) sem dependência de APIs externas.
* **Fórmula Geodésica de Haversine & Projeção Ortogonal em Polilinhas**: Implementadas em `geo.ts` para cálculo de distâncias esféricas, *snapping* de rota e avaliação geométrica de corredores arteriais em microssegundos.

---
*(Desenvolvido com assistência de ferramentas de IA no estúdio Antigravity, com concepção funcional a partir de necessidade real de usuário, levantamento de requisitos, integração de sistemas, revisão técnica, testes e validação conduzidos por Luiz Bonella).*
