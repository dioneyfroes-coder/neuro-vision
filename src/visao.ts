export { extrairBase64 } from "./provedor";

export type { ModoAnalise, OpcoesGerarDescricao } from "./visao/prompts";
export {
  PROMPT_ANALISE_PROFUNDA,
  PROMPT_DESCRICAO,
  PROMPT_ROTEIRO_BASE,
  PROMPT_ROTEIRO_DELTA,
  montarPromptDescricao,
  montarPromptRoteiro,
} from "./visao/prompts";
export {
  MODELO_PADRAO,
  PREFERENCIA_MODELOS,
  TRADUZIR_HABILITADO_PADRAO,
  ErroVisao,
  normalizarNomeModelo,
  mesmoModelo,
  type OpcoesVisao,
} from "./visao/comum";
export {
  type ModeloEscolhido,
  escolherModelo,
  limparCacheModelo,
  melhorModeloDisponivel,
  modelosInstalados,
} from "./visao/modelos";
export type { OpcoesTraduzir } from "./visao/traducao";
export { deveTraduzir, traduzirTexto } from "./visao/traducao";
export {
  forcarCarregamento,
  memoriaIntrospectavel,
  modeloEmMemoria,
  modelosEmMemoria,
} from "./visao/memoria";
export { gerarDescricaoStream, type ResumoDescricao } from "./visao/descricao";
