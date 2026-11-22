# Fase 6 — Interpretação multimodal

**Status:** implementação concluída em 2026-11-22. Validação com clipe anotado, backend real e tabela de preços **não foi feita**; ver [`pendencias.md`](./pendencias.md#fase-6--interpretação-multimodal).

Esta fase não substitui o rastreamento local pelo modelo. O modelo recebe o contexto já produzido pelo ciclo e devolve texto estruturado; nada do que ele escreve vira `EventoTemporal`, `statusEvidencia` ou ação observada sem suporte local.

## Checklist canônico

| Item | Onde vive | Verificação |
| --- | --- | --- |
| Política orientada a eventos | `src/domain/politica-multimodal.ts`; `decidirInterpretacao` delega sem mudar seu contrato | `tests/fase6/politica-multimodal.test.ts` |
| Seleção de frames relevantes | `src/domain/selecao-frames.ts`; `montarContextoCiclo` usa `selecaoFrames: "relevancia"` por padrão no interpretador | `tests/fase6/selecao-frames.test.ts`, `tests/fase6/integracao-multimodal.test.ts` |
| Contexto temporal estruturado | `public/interpretation/contexto/montagem.ts`, schema `contexto-1` (Fase 3) | `tests/interpretacao-payload/contexto.test.ts` |
| Validação do schema da resposta | `src/domain/schema-resposta-multimodal.ts`, `resposta-1`; `normalizarInterpretacao` registra `schema` | `tests/fase6/schema-e-evidencia.test.ts` |
| Referências a evidências | `public/interpretation/esquema/validacao.ts` + `src/domain/evidencia-interpretacao.ts` | `tests/fase6/schema-e-evidencia.test.ts`, `tests/fase6/integracao-multimodal.test.ts` |
| Observação vs. inferência | `distincaoEvidencia` e `afirmacoesSemEvidencia` em `ResultadoInterpretacao` | `tests/fase6/schema-e-evidencia.test.ts` |
| Latência e custo por evento | `src/domain/custo-multimodal.ts`; `MetricasCiclo.custoMultimodal` e `tokensMultimodal` | `tests/fase6/custo-e-comparacao.test.ts`, `tests/fase6/integracao-multimodal.test.ts` |
| Comparação com anotação humana | `src/domain/comparacao-multimodal.ts` + `npm run avaliar:multimodal` | `tests/fase6/custo-e-comparacao.test.ts` |

## Regras aditivas e compatíveis

1. **Política.** Os três modos continuam `sob_demanda`, `quando_evento_relevante` e `a_cada_ciclo`. O modo desejável para monitoramento é `quando_evento_relevante`, mas só depois de validação com clipes anotados; até lá o padrão operacional continua `sob_demanda`. Eventos `candidato`/`incerto` não disparam interpretação; falha, oclusão e intervalo cego não são evento de ausência.
2. **Frames.** A relevância usa somente sinais locais já medidos (eventos sustentados, atividade, falha de percepção). Primeiro e último frames são preservados. Sem nenhum sinal, a regra cai exatamente para a amostragem uniforme antiga. O motivo de cada escolha fica em `selecaoFrames.motivos`.
3. **Resposta.** `resposta-1` valida `resumo`, `acoes`, `participantes`, `evidencias`, `incertezas` e `contradicoes` sem biblioteca externa. JSON inválido, `natureza` desconhecida ou confiança fora de `[0,1]` são erros explícitos; o texto bruto continua disponível em `bruto`.
4. **Evidência.** Referências são resolvidas contra IDs reais do contexto (`frameId`, `eventoId`, índice 1-based). Referências inexistentes vão para `evidenciasInvalidas`. Afirmações sem referência válida são removidas dos fatos e preservadas em `afirmacoesSemEvidencia`.
5. **Status.** `statusEvidenciaLocal` é derivado somente da percepção local. `natureza: "inferida"` do modelo nunca altera o status derivado, e `ocluido`/`periodo_cego`/`indisponivel` nunca viram `observado`/ausência.
6. **Telemetria.** `duracaoMs`, `tokens` e `latenciaAteRespostaMultimodalMs` são registrados quando medidos. `custoMultimodal` só calcula valor monetário com `tokensEntrada`/`tokensSaida` e tabela de preços explícita; caso contrário traz `motivoCustoIndisponivel`. Nunca há custo zero ou `N/A` disfarçado de medição. `versaoPrompt` acompanha a chamada.
7. **Comparação.** O harness compara afirmações estruturadas com `afirmacoesEsperadas` da anotação (ou descrições de eventos determináveis). A similaridade é léxica e determinística (acentos/artigos ignorados). `precisao`/`recall` só são preenchidos com anotação `conjunto: "eval"` e `revisao.status: "revisada"`; em qualquer outro caso ficam ausentes com `motivoMetricasIndisponiveis`.

## Como executar a comparação

```bash
npm run avaliar:multimodal -- \
  --anotacao bench/videos/<clipe>.json \
  --respostas logs/respostas-multimodais.jsonl \
  --limite 0.5 --json
```

Cada linha do JSONL deve ser uma interpretação normalizada (`resumo`, `acoes`, `evidencias`, ...) com `duracaoMs`/`tokens` quando medidos. O harness não chama o modelo, não grava vídeo e não cria anotação: ele apenas lê o que já foi coletado. Mesmo com anotação revisada, os números valem somente para aquele conjunto e aquele limite de similaridade.

## Limitações honestas

- Backend local (`http://localhost:1234` / `1235`) não estava disponível durante esta fase; nenhuma resposta real foi coletada aqui.
- `bench/videos/exemplo-anotacao.json` e os rascunhos em `bench/clipes/` não são anotações revisadas; não produzem precisão real.
- Não há tabela de preços configurada, portanto `custoEstimado` permanece ausente e o motivo é `tabela_precos_ausente` (ou `sem_divisao_entrada_saida` quando só o total de tokens é conhecido).
- Latência e custo em condições reais continuam `N/A` até execução com backend real e clipes anotados.
- A seleção por relevância é determinística e local; ela não prova que o modelo entendeu melhor o clipe.
