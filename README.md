# Taxi Copilot · Rio de Janeiro — SHOWCASE 🚕

[![Vitest](https://img.shields.io/badge/vitest-21%20passed-brightgreen.svg)](./TESTING.md)
[![TypeScript](https://img.shields.io/badge/typescript-strict%20clean-blue.svg)](./tsconfig.json)
[![PWA](https://img.shields.io/badge/PWA-offline--ready%20%2B%20wake--lock-10b981.svg)](./public/manifest.webmanifest)
[![Engine](https://img.shields.io/badge/decision%20core-deterministic%20%28zero--LLM--token%29-f59e0b.svg)](./ARCHITECTURE.md)
[![Sandbox](https://img.shields.io/badge/mode-100%25%20synthetic%20showcase-8b5cf6.svg)](./src/services/cloudSync.ts)

⚠️ **Nota: Este é um repositório de portfólio demonstrativo (Showcase Edition).**
Este projeto é a versão pública e autossuficiente ("Vitrine Arquitetural") do **Taxi Copilot**, disponibilizada com o objetivo de demonstrar engenharia de produto ponta a ponta, desenvolvimento geoespacial, arquitetura *Local-First* e integração de sistemas em tempo real.
- **Isolamento Total de Privacidade:** Esta edição opera por padrão em **Modo Sandbox Independente** com dados 100% fictícios/sintéticos e simulador GPS integrado, sem qualquer conexão ou telemetria compartilhada com a edição privada de operação real.
- **Transparência de Desenvolvimento:** *Desenvolvimento assistido por ferramentas de IA (Antigravity / LLMs), com concepção funcional a partir de necessidade real de usuário, levantamento de requisitos, integração de arquitetura, revisão técnica, testes automatizados e validação iterativa conduzidos pelo desenvolvedor.*
- **Todos os direitos são reservados (All Rights Reserved).** Nenhuma licença é concedida para uso comercial, modificação ou redistribuição sem autorização expressa.

---

## 🎯 De um Problema Real a um Produto Funcional (*Product Case Study*)

Diferente de exercícios abstratos de programação, o **Taxi Copilot** nasceu de uma necessidade concreta observada no cotidiano de um **taxista profissional da família no Rio de Janeiro**.

Durante uma conversa sobre os desafios diários da profissão, ficou evidente um problema clássico de fragmentação cognitiva e operacional: o motorista não queria — e não podia, por questões de segurança e atenção ao trânsito — alternar entre cinco aplicativos diferentes para checar o trânsito, procurar horários de término de shows, lembrar feriados móveis, estimar a autonomia restante do cilindro de GNV e calcular o lucro líquido descontando o combustível. **Ele precisava sentar no carro, iniciar o turno e contar com um único copiloto tático de baixa fricção.**

### Ciclo de Engenharia de Produto Executado

| Competência | Evidência Prática no Projeto |
| :--- | :--- |
| **Product Discovery** | Entrevista e observação direta das dores reais de um motorista de táxi no Rio de Janeiro (giro vazio, dispersão de eventos, autonomia de GNV e atalhos inseguros de GPS). |
| **Requirements Engineering** | Tradução de heurísticas empíricas da profissão ("sabedoria de praça") em regras matemáticas determinísticas, matrizes horárias de 7 turnos e janelas de posicionamento (*Horário de Ouro*). |
| **Software Integration** | Orquestração de mapas vetoriais WebGL (`MapLibre GL`), roteamento (`OSRM`), geocodificação (`Photon`/`Nominatim`), meteorologia (`Open-Meteo`), síntese de voz (`Web Speech API`) e sincronização em tempo real (`BroadcastChannel` / `Supabase Realtime`). |
| **Iterative Mobile UI/UX** | Reformulação completa do layout após testes em smartphone: substituição de painéis densos de desktop por *bottom sheets* retráteis, alvos de toque ampliados, alto contraste solar e bloqueio de hibernação de tela (`Screen Wake Lock API`). |

---

## 🏗️ As 5 Dimensões Arquiteturais do Sistema

### 1. Geolocalização, Cartografia Vetorial & Navegação Turn-by-Turn
- Renderização vetorial fluida a 60 FPS via **MapLibre GL** e **OpenFreeMap / OpenStreetMap**, com alternância instantânea entre tema noturno e modo diurno de alto contraste solar.
- Roteamento completo via **OSRM** com geometria de alternativas, detecção automática de desvio de rota (*off-route snapping* $> 48\text{ m}$), recálculo dinâmico e instruções naturais em português via **Web Speech API**.
- **Simulador de Laboratório Integrado (`LocationProvider`):** Permite testar qualquer rota, velocidade ($15\text{ a }90\text{ km/h}$ com multiplicador até $10\times$) e teleporte por clique longo diretamente no navegador, sem depender de deslocamento físico.

### 2. Motor de Inteligência Operacional Determinístico (*Zero-LLM-Token Core*)
- **Matriz Horária de 7 Faixas (`veteranBrain.ts`):** Pondera dinamicamente 36 polos reais do Rio de Janeiro ao longo das 24 horas (saídas residenciais matutinas, circuito de hospitais, almoço executivo/SDU, terminais rodoviários, saídas de metrô no *rush*, gastronomia noturna e boemia na Lapa).
- **Gatilho Meteorológico (`weather.ts`):** Consome precipitação em tempo real via Open-Meteo e aplica multiplicadores automáticos ($\times 1{,}6$ em chuva moderada e $\times 2{,}5$ em chuva forte) para priorizar estações de metrô e marquises de shoppings.
- **Calendário Civil & Sazonalidade (`calendarEngine.ts`):** Algoritmo determinístico (*Computus* de Meeus/Jones/Butcher) que calcula feriados móveis (Carnaval, Páscoa, Corpus Christi), feriados cariocas (São Sebastião, São Jorge) e domingos de aplicação do ENEM.
- **Detector de Zona Morta & Consultor de Alternativas:** Calcula o índice de retorno no ponto de desembarque; se o motorista cair em área de baixa demanda ($< 25\%$), sugere rota imediata de extração para o corredor ativo mais próximo.

### 3. Heurística Geoespacial de Corredores Arteriais (`safetyZones.ts`)
- Motores genéricos de navegação frequentemente sugerem atalhos por vias secundárias restritas para economizar poucos minutos de retenção.
- O módulo avalia geometricamente cada vértice $[lng, lat]$ das rotas do OSRM via fórmula de **Haversine** contra perímetros mapeados de atenção viária, rotulando as opções como `🟢 Corredor Seguro` ou `⚠️ Área de Risco` e recomendando a permanência em vias arteriais expressas (Linha Vermelha, Av. Brasil, Linha Amarela, Lagoa-Barra).
- *Nota de Responsabilidade:* As zonas configuradas operam estritamente como heurísticas informativas de apoio à decisão, jamais substituindo a sinalização oficial ou o julgamento local do motorista.

### 4. Estimador Tarifário, Monitor de GNV & Gestão Financeira (`gnvTracker.ts`)
- **Manômetro Digital de Bolinhas de LED:** Interface de 1 toque que espelha o marcador físico do cilindro de GNV (`4🟢`, `3🟢`, `2🟢`, `1🟢`, `🔴 Reserva`), debitando a quilometragem percorrida no GPS e rebaixando os níveis automaticamente ($\approx 46{,}8\text{ km}$ por nível em cilindro de $15\text{ m}^3$).
- **Catálogo Georreferenciado de Postos (220 BAR):** Mapa dos postos tradicionais do Rio com indicação de pressão de abastecimento, funcionamento 24h e preço por $\text{m}^3$.
- **Estimador de Custos e Controle Financeiro da Corrida:** Calcula a estimativa de tarifa, desconta o custo proporcional de GNV e apura a **margem líquida real** do turno (ferramenta gerencial de estimativa, complementar ao taxímetro físico regulamentado).

### 5. Central de Operações (Desktop) & Sincronização Híbrida (`cloudSync.ts`)
- **Torre de Controle (`?central=1`):** Painel gerencial para computador com radar de eventos, decodificador de flyers/JSON-LD, rádio de despacho por voz, monitor de telemetria e **Planilha Contábil com exportação `.CSV`** (compatível com Excel e Power BI).
- **Arquitetura Dual-Mode (Sandbox / Cloud):** Na edição Showcase, sincroniza instantaneamente entre abas via `BroadcastChannel` + `localStorage` isolado com dados sintéticos pré-carregados; em ambientes configurados com credenciais, conecta-se via WebSockets ao **Supabase Realtime (PostgreSQL)**.

---

## 🧠 Decisões de Engenharia (*Architecture Decision Records*)

1. **Por que MapLibre GL + OSRM em vez de depender exclusivamente da Google Maps Platform?**
   - APIs proprietárias de mapas e rotas cobram por milhar de requisições (*Dynamic Maps*, *Directions API* e *Places Autocomplete*), o que inviabilizaria financeiramente um aplicativo de uso contínuo (8 a 12 horas diárias com recálculos constantes) para um profissional autônomo. A combinação **MapLibre GL + OpenFreeMap + OSRM** oferece renderização WebGL customizável sem bloqueio de chave de faturamento.
2. **Por que utilizar heurísticas determinísticas locais em vez de chamar um LLM a cada decisão?**
   - Um motorista em movimento a $50\text{ km/h}$ percorre $13{,}8\text{ metros por segundo}$. Consultas a LLMs introduzem latência de rede de $1{,}5\text{ s a }4\text{ s}$, custo recorrente por token e risco de alucinação geográfica. O núcleo determinístico do Taxi Copilot avalia 36 polos, clima, calendário civil e geometria de rotas em **menos de $5\text{ ms}$** diretamente no dispositivo, funcionando inclusive dentro de túneis (Rebouças, Santa Bárbara, Zuzu Angel) sem sinal celular.
3. **Por que separar a Central de Operações (Desktop) da interface do motorista (Mobile PWA)?**
   - Operações analíticas — como auditar planilhas de corridas, exportar relatórios CSV, importar schemas JSON-LD de casas de show e monitorar ocorrências da cidade — exigem tela ampla e teclado. Separar essas funções na **Central de Operações** permitiu manter o cockpit mobile enxuto, focado em leitura rápida de 1 segundo e comandos de voz.
4. **Como o feedback de uso real levou à reformulação da interface mobile?**
   - Nos primeiros testes em tela de smartphone, a sobreposição de cartões reduzia a área útil do mapa. A interface foi redesenhada com uma *bottom sheet* colapsável de 1 toque (`▼ Minimizar painel · Ver mapa`), pílulas compactas no topo e síntese vocal ativa para que o motorista absorva a recomendação sem precisar ler parágrafos.
5. **Como a preocupação com falsos positivos moldou a arquitetura do Radar de Eventos?**
   - Eventos genéricos ou sem âncora geográfica precisa geravam ruído na tomada de decisão. O pipeline de eventos (`rj_event_harvester.py` e `eventDetector.ts`) foi reestruturado com filtro de relevância, dicionário estrito de **Esquinas de Escape** georreferenciadas (posicionando o carro no contrafluxo dos bloqueios da CET-Rio) e cálculo determinístico do **Horário de Ouro** ($25\text{ a }35\text{ minutos}$ antes do encerramento estimado).

---

## 🔒 Duas Versões, Dois Propósitos

| Característica | **Taxi Copilot — Showcase Edition (Este Repositório)** | **Taxi Copilot — Private Edition (Uso Particular)** |
| :--- | :--- | :--- |
| **Público-Alvo** | Recrutadores técnicos, engenheiros de software e avaliação de portfólio. | Operação diária particular de um taxista autônomo da família. |
| **Dados & Telemetria** | **100% Sintéticos/Fictícios** (`Táxi Demo #07`, histórico simulado). | Telemetria e histórico operacional privados. |
| **Persistência Padrão** | **Sandbox Local Independente** (`BroadcastChannel` + `localStorage` isolado). | Banco de dados PostgreSQL + Supabase Realtime em nuvem. |
| **Localização Padrão** | **Modo Simulador GPS Interativo** (pronto para teste em qualquer PC/celular). | GPS físico de alta precisão do dispositivo no painel do veículo. |
| **Credenciais / `.env`** | Nenhuma chave privada incluída; executa *out-of-the-box* após `npm install`. | Variáveis de ambiente e políticas RLS restritas ao ambiente privado. |

---

## 🛠️ Stack Tecnológico & Competências Demonstradas

| Categoria | Tecnologias e Conceitos Implementados |
| :--- | :--- |
| **Desenvolvimento Web & UI** | TypeScript (Strict Mode), ES2022, HTML5 Semântico, CSS3 Custom Properties, Vite 8 |
| **Cartografia Digital & GIS** | MapLibre GL JS (WebGL), OpenStreetMap / OpenFreeMap, GeoJSON, Polilinhas e Bounding Boxes |
| **Geolocalização & Roteamento** | Browser Geolocation API, Simulador de Trajetos, OSRM Routing Engine, Fórmula de Haversine |
| **Sincronização & Backend** | Arquitetura Dual-Mode (`BroadcastChannel` Sandbox + Supabase PostgreSQL / Realtime WebSockets) |
| **Automação & Dados (ETL)** | Python 3.11, BeautifulSoup4, Regex, Extração Schema.org / JSON-LD, Indexação Espacial H3, Exportação CSV |
| **Mobile Web (PWA)** | Web App Manifest, Service Worker, Screen Wake Lock API, Web Speech API (TTS + Web Audio Synth) |
| **Qualidade & CI/CD** | Vitest (21 testes unitários automatizados), TypeScript Strict Typecheck, GitHub Actions CI, Deploy Netlify/Vercel |

---

## 🚀 Como Executar a Demonstração (Quickstart Reproduzível)

A edição Showcase não requer chaves de API nem configuração de banco de dados — basta instalar e rodar:

```bash
# 1. Instalar dependências
npm install

# 2. Iniciar o servidor de desenvolvimento interativo
npm run dev
# Acesse http://localhost:5173 no navegador
```

### Validando Qualidade, Tipagem e Build
```bash
# Verificação estática de tipos (TypeScript Strict)
npm run typecheck

# Executar suíte de 21 testes unitários automatizados (Vitest)
npm test

# Gerar pacote otimizado de produção (Vite Build)
npm run build
```

> 💡 **Dica para Avaliadores:** Ao abrir a aplicação, clique em **`▶ INICIAR DEMO (COCKPIT SIMULADO)`** e acesse a aba **`🧪 Testes`** na barra inferior para disparar com 1 toque os **8 Cenários Táticos do Rio de Janeiro** (Circuito de Hospitais, Saída de Show no Maracanã, Domingo de ENEM, Modo Chuva Forte no Metrô, Alerta de Zona Morta, etc.), ou abra **`🖥️ ABRIR CENTRAL DE OPERAÇÕES`** para testar a planilha financeira e exportação CSV com dados sintéticos!

---

## 📚 Documentação de Engenharia do Repositório

Para facilitar a avaliação técnica e arquitetural, a documentação está organizada nos seguintes documentos:

- 📐 **[ARCHITECTURE.md](./ARCHITECTURE.md)** — Diagramas de componentes, modelagem matemática (Haversine, Score Espaço-Temporal, Consumo de GNV) e arquitetura de sincronização.
- ✨ **[FEATURES.md](./FEATURES.md)** — Matriz transparente separando funcionalidades concluídas/testadas, recursos simulados no modo Showcase e itens em validação de campo.
- 🧪 **[TESTING.md](./TESTING.md)** — Relatório da suíte de testes Vitest, cobertura de regras de negócio, validação de build e pipeline de Integração Contínua (GitHub Actions).
- 📖 **[USER_GUIDE.md](./USER_GUIDE.md)** — Manual de utilização do Cockpit do Motorista, do Simulador de Laboratório e da Central de Operações.
- 🗺️ **[ROADMAP.md](./ROADMAP.md)** — Protocolo de validação progressiva em campo, limitações técnicas conhecidas e próximas evoluções.
- 🤝 **[CREDITS.md](./CREDITS.md)** & **[CHANGELOG.md](./CHANGELOG.md)** — Proveniência de bibliotecas, APIs abertas e histórico de versões.

---

## 📄 Licença
Copyright (c) 2026 Luiz Bonella. **Todos os direitos reservados.**
Código disponibilizado publicamente apenas para fins de demonstração de portfólio e avaliação técnica. Consulte o arquivo [LICENSE](./LICENSE).
