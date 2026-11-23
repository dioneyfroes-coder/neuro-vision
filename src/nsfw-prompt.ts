/**
 * Instrucoes e formatacao de conteudo **NSFW experimental** compartilhadas pelo
 * cliente (`public/interpretation/prompt.ts`) e pelo servidor (`src/visao.ts`).
 *
 * Modulo **puro** (sem SDK, sem `node:*`): o cliente precisa montar o mesmo
 * bloco de prompt sem puxar `src/env.ts`, que depende de `node:fs`.
 *
 * Regra do produto: quando o classificador NSFW esta ativo, a informacao +18
 * nao pode ser descartada, suavizada nem omitida. O modelo recebe as marcacoes
 * como evidencia observada e e instruido a descrever o conteudo adulto de forma
 * explicita, sem eufemismos e sem recusa.
 *
 * A instrucao tambem separa **evidencia** de **inferencia**: marcacao nao e
 * veredito, ausencia de marcacao nao prova ausencia de conteudo adulto e a
 * imagem sempre prevalece sobre a caixa do detector.
 */

export type { MarcacaoNsfwVisivel, QuadroNsfwPrompt } from "./nsfw-prompt/tipos";
export { MODELO_NSFW, resolverModeloVisao, INSTRUCAO_NSFW, INSTRUCAO_ACAO_MULTIFRAME, blocoAcaoMultiframe } from "./nsfw-prompt/instrucoes";
export { descreverRotuloNsfw, normalizarCaixaNsfw, normalizarMarcacoesNsfw, formatarMarcacoesNsfw, resumirMarcacoesNsfw } from "./nsfw-prompt/marcacoes";
export { LIMITE_CONTEXTO_DECLARADO, normalizarContextoDeclarado, blocoContextoDeclarado, blocoNsfwPrompt } from "./nsfw-prompt/contexto";
export {
  classificarMarcacoesNsfw,
  classificarRotuloNsfw,
  contemPropostaCena,
  ePropostaCena,
  INSTRUCAO_PROPOSTA_CENA_NSFW,
  ROTULOS_ACAO_NSFW,
  ROTULOS_ANATOMIA_NSFW,
  type ClassificacaoClasseNsfw,
  type EscopoClasseNsfw,
  type MarcacaoNsfwClassificada,
  type TipoClasseNsfw,
  type UsoPermitidoNsfw,
} from "./domain/nsfw-classificacao-rotulo";
export {
  enriquecerMarcacoesTemporais,
  formatarTempoMarcacaoNsfw,
  ordenarMarcacoesTemporais,
  type MarcacaoNsfwTemporal,
  type TempoFrameNsfw,
} from "./domain/nsfw-marcacao-temporal";
export {
  resumirEvidenciaTemporalNsfw,
  sinalNsfwDoFrame,
  type EvidenciaNsfwPorFrame,
  type ResumoEvidenciaTemporalNsfw,
} from "./domain/nsfw-evidencia-temporal";
export {
  INSTRUCAO_CORPO_NEUTRO,
  PERFIS_DESCRICAO_CORPORAL,
  blocoCorpoNeutro,
  blocoPerfilCorporal,
  normalizarPerfilDescricaoCorporal,
  resolverPerfilDescricaoCorporal,
  type PerfilDescricaoCorporal,
} from "./nsfw-prompt/perfil-corporal";
