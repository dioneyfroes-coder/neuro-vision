# Fase 4 — Interações e ações

Esta fase transforma sinais já observáveis em um **histórico de ações**, sem criar um formato concorrente e sem transformar falha de percepção, `indisponivel`, `naoAmostrado` ou oclusão em ausência observada.

## O que está implementado

- **Mão ↔ pessoa:** `associarMaosAPessoas()` usa punho/landmark 0, punhos COCO 9/10, lateralidade e continuidade. A associação é heurística de proximidade: quando ambígua, a mão fica sem `pessoaEntidadeId`.
- **Mão ↔ objeto:** `montarAmostrasPresenca()` propaga `pessoaEntidadeId` para `AmostraInteracao`, e `DetectorInteracao` mantém o par mão↔objeto com `entidadeId` estável. Amostras sem dimensões ou com subsistema indisponível são abstenção, não ausência.
- **Natureza da interação:** `naturezaInteracao()` separa `proximidade`, `contato` (sobreposição sustentada) e `manipulacao` (`confirmado` com deslocamento observado do objeto).
- **Pego/deixado:** `transicaoPosse()` só emite `pego` na primeira promoção a `confirmado` com continuidade válida. `deixado` exige encerramento por `sem_sinal`, grau máximo `confirmado`, continuidade válida e objeto visto estável por `framesParaEncerrar`. `oclusao`, `periodo_cego`, `indisponivel` e hipótese nunca geram `deixado`.
- **Estado anterior/posterior:** `estadosDeMudancaCena()` e `estadosObservadosParaEvento()` reaproveitam `MudancaCena.estadoAnterior/estadoAtual` apenas quando o estado foi de fato observado, no mesmo objeto/sessão e dentro da janela do evento. `EventoTemporal.estado` continua sendo o ciclo de vida — nunca o estado físico.
- **Contrato aditivo:** `EventoTemporal` ganha `pessoaEntidadeId`, `naturezaInteracao`, `transicaoPosse`, `estadoAnterior` e `estadoPosterior`, todos opcionais. Eventos antigos permanecem válidos.
- **Persistência:** `montarEventoTemporal()` aceita apenas os valores conhecidos e continua derivando `statusEvidencia` no servidor; o cliente não é autoritativo.
- **Linha do tempo:** `carregarLinhaDoTempo()` consome `api.listarEventosTemporais()` e `api.listarMudancasCena()`, mostrando natureza, posse, pessoa e par anterior/posterior com o suporte derivado pelo servidor.
- **Harness de qualidade:** `parsearEventos()` aceita `logs/eventos-temporais.jsonl` (`inicioEm`), o comparador publica `atraso` com amostras, média, p95, mínimo e máximo; sem amostra o valor é `N/A` (`null`), nunca zero.

## Evidência determinística

Cobertura local: `tests/fase4-acoes.test.ts`, `tests/interacao.test.ts`, `tests/interacao-integracao.test.ts`, `tests/server-memoria-temporal/utilitarios.test.ts` e `tests/scripts/avaliar-qualidade/`. Elas provam a serialização, a abstenção em ambiguidade/oclusão/indisponibilidade, a associação mão↔pessoa no motor real e a preservação dos campos na persistência.

Isso **não** prova precisão nem atraso em câmera real. Ver [`pendencias.md`](./pendencias.md#fase-4--validação-real-de-ações).
