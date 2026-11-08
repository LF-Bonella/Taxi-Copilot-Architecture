# Relatório de Testes, Qualidade e Validação · Taxi Copilot

Este documento detalha a suíte de testes automatizados, a verificação estática de tipos e os procedimentos para reprodução independente da qualidade do código.

---

## 1. Resumo dos Indicadores de Qualidade

| Verificação | Ferramenta | Comando | Resultado Atual |
| :--- | :--- | :--- | :--- |
| **Testes Unitários e de Integração** | Vitest 5.1 | `npm test` | ✅ **21 testes aprovados** (2 suítes, 0 falhas) |
| **Verificação Estática de Tipos** | TypeScript 7 (`strict: true`) | `npm run typecheck` | ✅ **0 erros / 0 avisos** (`noUnusedLocals`, `noUnusedParameters`) |
| **Validação de Build de Produção** | Vite 8 Production Bundle | `npm run build` | ✅ **Compilação limpa** (~940 ms, chunks WebGL + PWA gerados) |
| **Integração Contínua (CI)** | GitHub Actions | `.github/workflows/ci.yml` | ✅ **Pipeline configurado** (Node 20 · Typecheck + Vitest + Build) |

---

## 2. Cobertura da Suíte Automatizada (Vitest)

A suíte automatizada é dividida em dois arquivos de especificação principais que validam os motores determinísticos sem dependência de rede externa:

### 2.1 `src/engine/veteran.test.ts` (13 Testes)
1. **Matriz Horária (`veteranBrain.ts`):**
   - Verifica a transição exata entre as 7 faixas operacionais ao longo das 24h (`EARLY_RESIDENTIAL`, `HOSPITALS_AND_CLINICS`, `CORPORATE_LUNCH`, `MARKETS_AND_TERMINALS`, `METRO_EXITS_RUSH`, `NIGHT_LEISURE`, `LATE_NIGHT`).
   - Valida a priorização de hospitais às 09h30 e o disparo do multiplicador climático ($\times 2{,}5$) para estações de metrô às 18h15 sob chuva forte.
   - Comprova a detecção de **Zona Morta** (índice de retorno $< 0{,}25$) em áreas industriais/portuárias esvaziadas à noite e a indicação do polo quente de extração mais próximo.
2. **Detector de Eventos & Horário de Ouro (`eventDetector.ts`):**
   - Valida o *parser* de flyers por expressões regulares e o cálculo do **Horário de Ouro** exatamente $25\text{ minutos}$ antes do término estimado.
   - Valida a decodificação de blocos estruturados `Schema.org / JSON-LD` (`@type: MusicEvent`) e atribuição de *Demand Score* máximo para eventos esgotados (`SoldOut`).
3. **Navegação Turn-by-Turn (`navigator.ts` & `osrm.ts`):**
   - Verifica a geração de instruções naturais em português com concordância gramatical correta para logradouros femininos e masculinos (*"Vire à direita na Avenida Atlântica"*, *"Continue no Túnel Rebouças"*).
   - Simula o deslocamento sobre uma polilinha de múltiplos segmentos verificando o disparo de avisos vocais de manobra e detecção de chegada ao destino (`arrived = true`).
4. **Calendário Civil, Sazonalidade e Heurística Viária (`calendarEngine.ts` & `safetyZones.ts`):**
   - Comprova o algoritmo de *Computus* para a Páscoa de 2026 (05 de abril) e a geração de feriados móveis e municipais do Rio (São Sebastião, São Jorge, Carnaval, Consciência Negra).
   - Valida a detecção automática dos domingos de aplicação do **ENEM** e geração das janelas táticas de abertura/fechamento de portões (UERJ/UFRJ).
   - Testa os multiplicadores sazonais de véspera de feriado ($\times 2{,}2$ em terminais rodoviários/aeroportos) e queda de demanda em centros corporativos em feriados ($\le 0{,}1$).
   - Comprova a intersecção geométrica de rotas que cortam perímetros sensíveis (ex.: atalho pelo Complexo da Maré rotulado como `⚠️ ÁREA DE RISCO`) versus rotas arteriais limpas (`🟢 CORREDOR SEGURO`).
5. **Modo Showcase Sandbox (`cloudSync.ts`):**
   - Verifica a inicialização autônoma do `CloudSyncService` em modo Sandbox (`isSandboxMode = true`) quando nenhuma credencial externa é fornecida.
   - Valida a integridade matemática das corridas e eventos sintéticos gerados para demonstração (garantindo `goldenArrival < estimatedEnd` e `netProfit = fare - estimatedGnvCost`).

### 2.2 `src/engine/gnvTracker.test.ts` (8 Testes)
1. Verifica a curva de autonomia base por nível do manômetro de LED (`4🟢` $\ge 180\text{ km}$ até `0🔴 Reserva` $\le 25\text{ km}$).
2. Valida o abatimento contínuo da quilometragem percorrida na autonomia restante.
3. Comprova o cálculo comparativo de custo por corrida entre **GNV e Gasolina** e a economia líquida gerada.
4. Simula o hodômetro dinâmico rebaixando automaticamente o nível do manômetro ao cruzar o limiar de $\approx 46{,}8\text{ km}$ por nível.
5. Verifica o registro de abastecimento, zeramento de hodômetro parcial e conversão de valor pago em volume ($\text{m}^3$).
6. Valida a busca geoespacial dos postos de GNV mais próximos ordenados por distância Haversine e identificação de compressores **220 BAR**.
7. Comprova o disparo de alerta preventivo quando a distância de uma rota solicitada excede a autonomia atual do cilindro.
8. Verifica a integridade do catálogo georreferenciado de postos estratégicos 24h do Rio de Janeiro.

---

## 3. Como Reproduzir os Testes Localmente

Qualquer avaliador pode reproduzir integralmente os testes em menos de 30 segundos:

```bash
# 1. Instalar dependências limpas
npm ci

# 2. Executar o verificador estático do TypeScript
npm run typecheck

# 3. Executar a suíte Vitest
npm test

# 4. Executar o build de produção
npm run build
```

 Saída esperada do comando `npm test`:
```text
 RUN  v5.1.0
 ✓ src/engine/gnvTracker.test.ts (8 tests)
 ✓ src/engine/veteran.test.ts (13 tests)

 Test Files  2 passed (2)
      Tests  21 passed (21)
```
