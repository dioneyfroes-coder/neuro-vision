/**
 * Avaliação de iluminação e oclusão (Fase 7) — regra pura, sem I/O e sem relógio.
 *
 * Os roteiros sintéticos em `tests/qualidade-eventos.test.ts` provam que a
 * política reage a contraluz/oclusão com `baixa_confianca`. Esta camada mede se
 * essa reação acontece no tempo certo quando existe verdade-base anotada, e
 * distingue três estados: `APROVADO`, `REPROVADO` e `INCONCLUSIVO` (sem dados
 * revisados). Nenhum número é inventado quando a anotação é rascunho.
 */

export { CONDICOES_ALVO, CLASSES_POLITICA_INCORRETA } from "./avaliacao-condicoes/tipos";
export type {
  CondicaoAlvo,
  ClassificacaoEvento,
  IntervaloCondicao,
  AnotacaoCondicao,
  AnotacaoClipCondicoes,
  EventoCondicao,
  OpcoesAvaliacaoCondicoes,
  CorrespondenciaCondicao,
  ResultadoCondicao,
  VereditoCondicoes,
  ResultadoAvaliacaoCondicoes,
} from "./avaliacao-condicoes/tipos";
export { ehCondicaoAlvo, sobreposicaoComAnotacao, avaliarCondicoes } from "./avaliacao-condicoes/avaliacao";
