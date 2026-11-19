import type { MarcacaoNsfwLog, MotivoAnalise } from "../../src/types";
import { ErroPercepcao } from "../../src/erros";

export interface InfoVisao {
  online: boolean;
  /** URL base do backend consultado (para diagnostico da interface). */
  backend?: string;
  /** Modelo de visao configurado (NEURO_MODEL ou o padrao do servidor). */
  solicitado?: string;
  /** Modelo efetivamente usado (o solicitado ou o melhor disponivel). */
  modelo: string;
  modelos: string[];
  carregados: string[];
  erro: string;
}

export interface PreparacaoVisao {
  modelo?: string;
  carregado?: boolean;
  carregandoMs?: number;
}

export interface EventoVisao {
  type?: string;
  response?: string;
  descricao?: string;
  modelo?: string;
  snapshot?: string;
  erro?: string;
  tokens?: number;
  ms?: number;
  tipo?: string;
  papel?: "base" | "delta";
  semMudanca?: boolean;
  /** Marcacoes NSFW (caixas normalizadas) quando o subsistema rodou. */
  nsfw?: MarcacaoNsfwLog[];
}

export interface PayloadVisao {
  /** Imagem unica (compatibilidade). Ignorada quando `imagens` e informado. */
  imagem?: string;
  /** Varias imagens, na ordem em que devem ser interpretadas (ciclo multiframe). */
  imagens?: string[];
  /** Frames que originaram as imagens; vinculam a inferencia aos ciclos no log. */
  frameIds?: string[];
  /** Prompt explicito, substituindo o padrao do servidor. */
  prompt?: string;
  snapshot?: string;
  /** Instante ISO da captura do frame (antes da inferencia). */
  capturadoEm?: string;
  modelo?: string;
  anterior?: string;
  modo?: "roteiro" | "descricao";
  roteiro?: string;
  base?: boolean;
  /** Razao que acionou esta analise (fluxo orientado a eventos). */
  motivo?: MotivoAnalise;
  /**
   * Marcacoes NSFW (caixas normalizadas) do frame. Presente mesmo vazio quando
   * o subsistema esta ativo; `undefined` = desligado.
   */
  nsfw?: MarcacaoNsfwLog[];
  /**
   * NSFW ativo no fluxo multiframe (as marcacoes ja vao no prompt/contexto).
   * Sinaliza ao servidor para usar exclusivamente o `MODELO_NSFW`.
   */
  nsfwAtivo?: boolean;
  /**
   * Contexto/metadado declarado (nome do clipe, anotacao do usuario). O prompt
   * o trata como declaracao, nunca como observacao visual; identidade de genero
   * so entra por aqui.
   */
  contexto?: string;
}

export interface ResultadoVisao {
  evento: EventoVisao | null;
  parcial: string;
}

export class ErroEventoVisao extends ErroPercepcao {
  constructor(mensagem: string) {
    super("visao", mensagem);
    this.name = "ErroEventoVisao";
  }
}

export async function exigirRespostaOk(resposta: Response, msgPadrao: string): Promise<void> {
  if (!resposta.ok) {
    const corpo = (await resposta.json().catch(() => null)) as { erro?: string } | null;
    throw new ErroPercepcao("armazenamento", corpo?.erro ?? `${msgPadrao} (${resposta.status})`);
  }
}