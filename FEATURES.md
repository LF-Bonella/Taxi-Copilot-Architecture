# Catálogo e Status de Funcionalidades · Taxi Copilot

Para garantir total transparência técnica de engenharia, este documento separa as funcionalidades do projeto em três categorias claras: **(1) Concluídas e Validadas em Testes/Preview**, **(2) Simuladas no Modo Showcase (Sandbox Sintético)** e **(3) Em Validação Progressiva de Campo**.

---

## 1. ✅ Funcionalidades Concluídas e Validadas (Testes Automatizados & Preview)

Estes módulos possuem cobertura de testes unitários automatizados via **Vitest**, validação estática **TypeScript Strict** e verificação interativa no ambiente Web/PWA:

| Módulo | Arquivo Principal | Descrição Técnica | Status |
| :--- | :--- | :--- | :--- |
| **Matriz Horária de 7 Turnos** | [`src/engine/veteranBrain.ts`](./src/engine/veteranBrain.ts) | Seleção automática de turno e pontuação determinística de 36 polos do Rio de Janeiro conforme hora, distância e clima. | ✅ Testado (Vitest + Preview) |
| **Motor de Calendário Civil** | [`src/engine/calendarEngine.ts`](./src/engine/calendarEngine.ts) | Cálculo algorítmico (*Computus*) de Páscoa, Carnaval, Corpus Christi, feriados estaduais/municipais do RJ, vésperas e domingos de ENEM. | ✅ Testado (Vitest + Preview) |
| **Detector de Zona Morta & Alternativas** | [`src/engine/veteranBrain.ts`](./src/engine/veteranBrain.ts) | Identificação imediata de áreas de baixo retorno ($< 25\%$) no desembarque e sugestão de polos quentes de distância equivalente. | ✅ Testado (Vitest + Preview) |
| **Radar de Eventos & Horário de Ouro** | [`src/engine/eventDetector.ts`](./src/engine/eventDetector.ts) | Extração de horários via Regex (flyers) e Schema.org (`JSON-LD`), calculando posicionamento tático $25\text{ a }35\text{ min}$ antes do término. | ✅ Testado (Vitest + Preview) |
| **Heurística de Corredores Arteriais** | [`src/engine/safetyZones.ts`](./src/engine/safetyZones.ts) | Verificação geométrica via Haversine das polilinhas do OSRM para sinalizar desvios por áreas de risco e priorizar vias expressas. | ✅ Testado (Vitest + Preview) |
| **Monitor de GNV & Autonomia** | [`src/engine/gnvTracker.ts`](./src/engine/gnvTracker.ts) | Manômetro digital de 4 níveis + reserva, odômetro dinâmico por GPS, catálogo de postos 220 BAR e trava de autonomia por rota. | ✅ Testado (Vitest + Preview) |
| **Navegação Turn-by-Turn em Português** | [`src/nav/navigator.ts`](./src/nav/navigator.ts) & [`osrm.ts`](./src/nav/osrm.ts) | Acompanhamento de rota vetorial, instruções naturais com concordância de gênero de logradouro, indicação de faixas e recálculo automático. | ✅ Testado (Vitest + Preview) |
| **Simulador GPS de Laboratório** | [`src/services/location.ts`](./src/services/location.ts) | Simulador de condução sobre a polilinha da rota com controle de velocidade ($15\text{–}90\text{ km/h}$), multiplicador ($1\times\text{–}10\times$), teleporte e 8 cenários de 1 toque. | ✅ Validado no Preview |
| **Planilha Contábil & Exportador CSV** | [`src/ui/centralDashboard.ts`](./src/ui/centralDashboard.ts) | Consolidação de faturamento bruto, custo estimado de GNV, margem líquida e geração de arquivo `.csv` compatível com Excel/BI. | ✅ Validado no Preview |

---

## 2. 🧪 Funcionalidades Demonstrativas no Modo Showcase (Sandbox Sintético)

Na edição pública de portfólio (**Showcase Edition**), os módulos abaixo operam com dados sintéticos e barramentos locais para permitir avaliação imediata sem expor dados privados ou exigir credenciais externas:

| Recurso | Comportamento na Edição Showcase |
| :--- | :--- |
| **Barramento Realtime (`cloudSync.ts`)** | Opera via `BroadcastChannel('taxi-copilot-showcase-bus')` + `localStorage` isolado (`taxi_showcase:*`). Permite abrir o Cockpit e a Central de Operações em duas abas e testar a sincronização em tempo real sem banco externo. |
| **Frota & Histórico Demonstrativo** | Inicializa automaticamente o veículo fictício **`Táxi Demo #07 · Showcase RJ`** com 7 corridas sintéticas distribuídas pelos turnos do Rio e abastecimentos de GNV pré-calculados. |
| **Ingestão de Ocorrências Viárias (COR-Rio / Padrão Waze CCP)** | Demonstra a normalização de esquemas de interdições abertas da Prefeitura (COR-Rio / CET-Rio) e o *parser* de alertas no formato JSON Waze CCP utilizando cargas sintéticas reproduzíveis. |
| **Scripts Python de Curadoria (`scripts/`)** | Configurados em modo *Dry-Run* local por padrão quando variáveis de ambiente não estão presentes, gerando artefatos JSON de inspeção sem realizar escrita externa. |

---

## 3. 🚕 Funcionalidades em Validação Progressiva de Campo

Itens implementados na arquitetura que dependem de aferição empírica continuada durante turnos reais no veículo:

- **Calibração Fina da Curva de Consumo de GNV ($\eta$):** Ajuste empírico da média de $12{,}5\text{ km/m}^3$ conforme variações de pressão de abastecimento ($180\text{ bar vs }220\text{ bar}$), uso intenso de ar-condicionado no verão carioca e topografia.
- **Ergonomia Acústica e Visual em Trânsito Real:** Avaliação do volume e frequência dos alertas de voz (`Web Speech API`) e legibilidade dos cartões sob incidência solar direta no suporte de painel.
- **Heurística de Estimativa Tarifária:** Aferição comparativa entre o **Estimador de Custos e Controle Financeiro da Corrida** do aplicativo (baseado em GPS + tempo retido) e os valores finais apurados pelo taxímetro físico regulamentado pelo IPEM/INMETRO.
