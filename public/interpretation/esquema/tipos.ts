/**
 * Schema **versionado** do contexto local enviado ao modelo multimodal
 * (Fase 3, itens 1-4, 6 e 7).
 *
 * Substitui os resumos textuais por registros JSON estruturados, com
 * `evidencia` observada pelo detector separada da `inferencia` textual do
 * modelo. Cada registro carrega `frameId`, timestamp e a versao do esquema, de
 * modo que **toda afirmacao relevante pode ser vinculada a um frame e a uma
 * evidencia disponivel** (criterio de saida da Fase 3).
 *
 * Regras:
 * - caixas normalizadas em [0, 1] (relativas as dimensoes do frame);
 * - keypoints corporais **nomeados** (ordem COCO de 17 pontos), com confianca;
 * - maos com lateralidade, gesto/score e landmarks normalizados (compactados);
 * - estado do subsistema (`ok`/`sem_resultado`/`indisponivel`/`nao_carregado`/
 *   `nao_amostrado`) + motivo, nunca lista vazia indistinguivel de falha;
 * - movimento entre frames (deslocamento/direcao), nao so posicao isolada.
 */

export { VERSAO_ESQUEMA_CONTEXTO, NOMES_KEYPOINTS_COCO, KEYPOINTS_ESSENCIAIS } from "./tipos/constantes";
export type {
  EstadoObservado,
  CaixaNormalizada,
  ProximidadeObjeto,
  DeteccoesReduzidas,
  DeteccaoObservada,
  KeypointNomeado,
  PessoaObservada,
  MaoObservada,
  MarcacaoNsfwObservada,
  MovimentoObservado,
  EstadoSubsistemaObservado,
  ObservacaoLocalSerializavel,
} from "./tipos/observacao";
export type {
  EventoTemporalSerializavel,
  GrupoTruncamento,
  TruncamentoContexto,
  InferenciaMultimodalSerializavel,
  ContextoCicloSerializavel,
} from "./tipos/eventos-contexto";
export type { OpcoesSerializacao } from "./tipos/opcoes";
export { OPCOES_SERIALIZACAO_PADRAO } from "./tipos/opcoes";
