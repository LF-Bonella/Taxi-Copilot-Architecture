# Guia de Utilização & Demonstração · Taxi Copilot (Showcase)

Manual prático para avaliadores de portfólio, testes no Simulador de Laboratório e operação dos módulos de Motorista e Central de Operações.

---

## Parte 1: Explorando o Modo Demonstração (Simulador Interativo)

A edição **Showcase** inicia pronta para avaliação em qualquer computador ou celular, sem necessidade de estar fisicamente no Rio de Janeiro:

1. **Iniciando a Demo:**
   - Na tela inicial, clique em **`▶ INICIAR DEMO (COCKPIT SIMULADO)`**.
   - O aplicativo ativa automaticamente o **Modo Simulador GPS (`🧪 SIM`)** centralizado no Rio de Janeiro.
2. **Testando Cenários Reais com 1 Toque:**
   - Toque na aba **`🧪 Testes`** na barra inferior.
   - Em **🎬 Cenários Táticos de 1 Toque**, escolha qualquer situação real (ex.: *🏥 09h15 · Circuito Hospitais*, *🎸 Saída de Show no Maracanã*, *🌧️ 18h15 + Chuva Forte no Metrô* ou *⚠️ 23h20 · Desembarque em Zona Morta*).
   - O simulador teleporta o veículo, ajusta o relógio virtual e o clima, calcula a rota via OSRM e inicia a condução simulada com orientações por voz.
3. **Teleporte e Interação Livre no Mapa:**
   - Clique com o **botão direito do mouse** (no PC) ou faça um **toque longo** (no celular) em qualquer rua do mapa para abrir o menu contextual:
     - `🧭 Navegar até aqui` (com avaliação do Consultor Veterano e corredores seguros).
     - `🚕 Teleportar táxi para cá (Sim)`.
     - `⛽ Postos de GNV por Perto`.
     - `🚨 Reportar Blitz / Rua Morta`.

---

## Parte 2: Cockpit do Motorista (Mobile PWA)

### 1. Monitor de GNV & Gestão de Combustível
- No topo da tela, o botão **`⛽ 🟢🟢🟢🟢 ~187km`** exibe a autonomia estimada do cilindro.
- Ao clicar nele, o motorista pode:
  - Ajustar com 1 toque o nível atual do manômetro de LED do veículo (`4🟢`, `3🟢`, `2🟢`, `1🟢` ou `🔴 Res`).
  - Registrar um abastecimento informando o valor total em reais, o que atualiza automaticamente o cálculo de **Lucro Líquido Real** na aba de Ganhos.
  - Consultar os **Postos de GNV recomendados mais próximos**, com destaque para postos 24h e compressores de **220 BAR** (que proporcionam maior autonomia por abastecimento).

### 2. Rota de Pesca Inteligente
- Quando o veículo está livre, o botão **`▶ ROTA DE PESCA`** consulta a Matriz Horária Veterana (combinando hora do dia, calendário civil de feriados e condição de chuva) e traça um circuito passando pelos 3 polos de maior pontuação próximos ao veículo.

### 3. Heurística de Corredores Arteriais (Apoio à Decisão Viária)
- Ao pesquisar um destino ou selecionar um polo, o sistema solicita alternativas de rota ao OSRM e avalia cada geometria:
  - Rotas que permanecem nas vias principais recebem o selo **`🛡️ Seguro`** (`🟢 CORREDOR SEGURO`).
  - Rotas que sugerem atalhos por perímetros mapeados como sensíveis exibem o aviso preventivo **`⚠️ Risco`** e recomendam a alternativa pelas vias expressas (Linha Vermelha, Av. Brasil, Linha Amarela, Autoestrada Lagoa-Barra).
- **Aviso Importante de Segurança Viária:** As zonas geográficas mapeadas são **heurísticas informativas de apoio à decisão**, não garantias absolutas de segurança. O sistema tem caráter consultivo e nunca substitui a avaliação local do motorista, as normas de trânsito ou a sinalização oficial.

### 4. Estimador de Corrida & Controle Financeiro
- Ao embarcar um passageiro, toque em **`🚖 PASSAGEIRO`**.
- O painel exibe o **Estimador de Corrida**, que calcula em tempo real a tarifa estimada com base na distância percorrida e no tempo retido em trânsito.
- Ao clicar em **`FINALIZAR`**, a corrida é registrada no histórico, o custo proporcional de GNV é deduzido para apurar a margem líquida e o sistema verifica automaticamente se o desembarque ocorreu em uma **Zona Morta**, sugerindo rota imediata de reposicionamento se necessário.
- *Nota Legal:* Este módulo destina-se exclusivamente à **estimativa de custos e controle financeiro gerencial do turno**, não substituindo o taxímetro físico regulamentado e aferido pelo IPEM/INMETRO.

---

## Parte 3: Central de Operações (Torre de Controle Desktop)

Para abrir a Central de Operações, clique em **`🖥️ ABRIR CENTRAL DE OPERAÇÕES`** na tela inicial (ou acesse a aba `🎤 Radar` → `🖥️ Painel Central`, ou adicione `?central=1` à URL).

1. **Aba `🎤 Eventos & Radar`:**
   - Visualize os eventos ativos com cálculo automático do **Horário de Ouro** ($25\text{ a }35\text{ min}$ antes do término estimado) e **Esquinas de Escape**.
   - Utilize o **Decodificador de Flyers** (texto livre/Instagram) ou o **Importador Schema.org / JSON-LD** para cadastrar novos eventos instantaneamente.
2. **Aba `🚨 Rádio & Bloqueios`:**
   - Transmita mensagens de voz e destinos táticos diretamente para o Cockpit do Motorista (experimente abrir duas janelas lado a lado para ver a mensagem chegar em tempo real via `BroadcastChannel`!).
   - Injete ocorrências demonstrativas clicando em **`🏛️ COR-Rio (Dados Abertos)`** ou **`📡 Simulador Feed Trânsito`**.
3. **Aba `🚕 Telemetria Demo`:**
   - Acompanhe em tempo real a posição, velocidade, status operacional e resumo de quilometragem paga vs. vazia do veículo simulado (`Táxi Demo #07 · Showcase RJ`).
4. **Aba `📊 Planilha & Gestão`:**
   - Audite a tabela contábil pré-populada com corridas sintéticas contendo horário, bairro de embarque, turno, distância, valor bruto, custo estimado de GNV e lucro líquido.
   - Clique em **`📥 Exportar CSV`** para baixar a planilha formatada para Microsoft Excel, Google Sheets ou Power BI.
   - Clique em **`⚡ Restaurar Demo`** a qualquer momento para recarregar os dados sintéticos originais.
