import type { MarcacaoNsfwLog } from "../types";
import type { PerfilDescricaoCorporal } from "../nsfw-prompt";

export type ModoAnalise = "descricao" | "roteiro";

export interface OpcoesGerarDescricao {
  modelo?: string;
  prompt?: string;
  /** URL base do backend (sobrepoe `NEURO_BASE_URL`). */
  baseUrl?: string;
  timeoutMs?: number;
  modo?: ModoAnalise;
  roteiro?: string;
  base?: boolean;
  /** Cancela o fetch do backend de visao (ex.: cliente desconectou do stream). */
  signal?: AbortSignal;
  /** Chave enviada como `Authorization: Bearer` no backend. */
  apiKey?: string;
  /**
   * Marcacoes NSFW do classificador local. Presente (mesmo vazio) = subsistema
   * ativo: o prompt padrao ganha a instrucao explicita de descrever conteudo
   * adulto sem eufemismos/censura. `undefined` = desligado.
   */
  nsfw?: MarcacaoNsfwLog[];
  /**
   * Perfil de descricao corporal (Fase 2). `neutro` e opt-in e independente de
   * `INSTRUCAO_NSFW`: usa marcacoes como evidencia, mas pede linguagem anatomica
   * neutra. `undefined` preserva o comportamento atual.
   */
  perfilCorporal?: PerfilDescricaoCorporal;
  /**
   * IDs dos frames enviados. No frame unico, o unico item vira o `frameId` do
   * bloco do perfil; no multiframe o prompt explicito ja traz o proprio bloco.
   */
  frameIds?: string[];
  /**
   * Contexto/metadado declarado por quem enviou a midia (nome do clipe,
   * anotacao do usuario). Vai para o prompt como declaracao, nunca como
   * observacao visual; e o unico caminho para uma identidade de genero
   * declarada. So tem efeito com o NSFW ativo.
   */
  contexto?: string;
}

export const PROMPT_ANALISE_PROFUNDA =
  "Analise cuidadosamente a imagem inteira antes de responder, incluindo primeiro plano e fundo. " +
  "Descreva em detalhe as pessoas, objetos, aparencia, roupas, postura, acoes visiveis, " +
  "interacoes, relacoes espaciais, texto legivel, iluminacao e elementos relevantes da cena. " +
  "Considere tambem objetos pequenos, parcialmente ocultos ou sendo segurados. " +
  "Diferencie observacao direta de incerteza; nao invente detalhes nem revele raciocinio interno. " +
  "Nao reduza a resposta a uma legenda curta: forneca uma analise visual completa e especifica.";

/**
 * Observacao independente: cada foto e descrita do zero, sem enviar a descricao
 * anterior. Alimentar o texto antigo faz um modelo pequeno "colar" a descricao
 * anterior em vez de olhar a imagem atual (era a principal causa da analise
 * parecer atrasada em relacao ao que estava na tela). A comparacao entre fotos
 * passa a ser feita no cliente (`diferencaDeTextos`), e nao pelo modelo.
 */
export const PROMPT_DESCRICAO =
  "Voce observa UMA foto da webcam, tirada agora. Descreva objetivamente o que aparece NESTA imagem: " +
  "pessoas, objetos (inclusive o que estiver sendo segurado ou mostrado), cores, postura e disposicao. " +
  "Baseie-se somente no que ve na imagem; nao cite fotos, descricoes ou momentos anteriores. " +
  "Responda em portugues.";

export function montarPromptDescricao(): string {
  return `${PROMPT_DESCRICAO}\n\n${PROMPT_ANALISE_PROFUNDA}`;
}

export const PROMPT_ROTEIRO_BASE =
  "Voce ve o PRIMEIRO frame de uma webcam. Descreva a cena em " +
  "portugues: pessoas, objetos, disposicao, cores, iluminacao, postura e possiveis acoes. " +
  "Baseie-se somente nos elementos visiveis.";

/**
 * Delta do roteiro: continua sendo uma observacao independente da foto atual.
 * Antes o prompt mandava comparar com o roteiro acumulado e responder
 * "INALTERADO" quando nada mudasse; com um modelo 3B isso produzia oscilacao e
 * alucinacao (ex.: "a iluminacao mudou" repetido). Agora cada beat descreve so
 * o que esta na imagem, e o cliente decide se o beat repete o anterior.
 */
export const PROMPT_ROTEIRO_DELTA =
  "Voce observa UMA foto da webcam, tirada agora. Descreva o que ha NESTA imagem " +
  "(pessoas, objetos, o que estiver sendo segurado ou mostrado). " +
  "Baseie-se somente no que ve agora; nao repita nem compare com fotos anteriores.";

export function montarPromptRoteiro(base: boolean, _roteiro?: string): string {
  return `${base ? PROMPT_ROTEIRO_BASE : PROMPT_ROTEIRO_DELTA}\n\n${PROMPT_ANALISE_PROFUNDA}`;
}
