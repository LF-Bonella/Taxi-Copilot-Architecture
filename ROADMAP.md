# Roadmap & Protocolo de Validação em Campo · Taxi Copilot

Este documento descreve o protocolo estruturado de validação progressiva do produto em ambiente real, as limitações técnicas conhecidas da arquitetura atual e as próximas evoluções planejadas.

---

## 1. Protocolo de Validação Progressiva em Campo

A transição do ambiente de laboratório/simulador para o uso cotidiano no veículo segue um protocolo de **4 estágios progressivos**, priorizando a segurança viária e a zero distração ao volante:

1. **Estágio 1 — Validação Estática (Veículo Estacionado):**
   - Verificação da precisão do bloqueio de tela (`Screen Wake Lock API`), legibilidade sob luz diurna/noturna, calibração inicial do manômetro de GNV e clareza da síntese de voz (`Web Speech API`) no sistema de áudio/Bluetooth do veículo parado.
2. **Estágio 2 — Trajetos Conhecidos em Paralelo (Shadow Testing):**
   - Execução do aplicativo em trajetos habituais já dominados pelo motorista, operando em paralelo à navegação convencional para validar o tempo de resposta do recálculo de rota OSRM e a precisão das sugestões de Corredores Seguros sem depender exclusivamente da ferramenta.
3. **Estágio 3 — Aferição Financeira e Energética (GNV vs. Faturamento):**
   - Comparação sistemática, ao final do turno, entre a quilometragem medida pelo odômetro GPS do aplicativo, o rebaixamento real das luzes do manômetro físico de GNV e os valores aferidos no taxímetro regulamentado.
4. **Estágio 4 — Calibração de Alertas e Ergonomia Cognitiva:**
   - Coleta de feedback do motorista sobre a frequência de alertas sonoros, utilidade prática das janelas de *Horário de Ouro* em saídas de eventos e ajustes de pesos na Matriz Horária de 7 Turnos.

> ⚠️ **Princípio Inegociável de Segurança:** O aplicativo foi projetado para ser configurado antes da partida ou nos intervalos de parada em ponto/estacionamento. Nenhuma funcionalidade deve exigir digitação ou manipulação da tela com o veículo em movimento.

---

## 2. Limitações Técnicas Conhecidas

- **Dependência de Serviços Geoespaciais Públicos:** Na configuração padrão sem chaves pagas, o roteamento utiliza a instância pública de demonstração do OSRM (`router.project-osrm.org`), a geocodificação utiliza Photon/Nominatim e os mapas vetoriais utilizam OpenFreeMap. Em cenários de alta escala comercial, recomenda-se hospedar instância própria de OSRM/Valhalla e servidor de tiles dedicado.
- **Geometria Radial nas Heurísticas de Atenção (`safetyZones.ts`):** Atualmente, os perímetros de atenção viária são modelados como círculos geodésicos (centro $[lng, lat]$ + raio em metros via Haversine). Embora extremamente rápidos ($< 1\text{ ms}$), raios circulares são aproximações geométricas que podem ser refinadas com polígonos GeoJSON exatos (`Point-in-Polygon`).
- **Fontes de Trânsito em Tempo Real:** Endpoints públicos não documentados de aplicativos de trânsito comunitário frequentemente aplicam bloqueios HTTP 403/CORS. Por essa razão, a arquitetura oficializa a ingestão via **Dados Abertos Municipais (API COR-Rio / CET-Rio)** combinada ao reporte direto pela Central de Operações.

---

## 3. Próximas Melhorias Planejadas (Backlog de Engenharia)

- [ ] **Geofencing Poligonal (GeoJSON + Indexação H3):** Substituir os raios circulares de `safetyZones.ts` por malhas hexagonais Uber H3 (resolução 8 e 9) e polígonos de bairros oficiais do Data.Rio.
- [ ] **Cache Offline de Tiles Vetoriais (IndexedDB / Service Worker):** Permitir o pré-carregamento da malha viária da Região Metropolitana do Rio de Janeiro para renderização de mapa 100% offline.
- [ ] **Dashboard Pós-Turno de Eficiência Operacional:** Gráficos comparativos semanais de índice de ocupação ($\text{km pagos} / \text{km totais}$), receita média por hora e retorno real por polo recomendado.
- [ ] **Integração com Comandos de Voz por Microfone (`SpeechRecognition`):** Permitir que o motorista reporte bloqueios ou inicie a Rota de Pesca apenas por comando de voz, sem tocar na tela.
