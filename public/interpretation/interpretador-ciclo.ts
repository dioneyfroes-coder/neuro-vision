import type { InterpretadorMultimodal } from "./contracts";
import type { PacoteCiclo } from "../../src/domain/cycle";
import type { ResultadoInterpretacao } from "../../src/domain/interpretation";
import {
  montarContextoCiclo,
  type ContextoCicloSerializavel,
  type LimitesContexto,
  LIMITES_CONTEXTO_PADRAO,
} from "./contexto";
import { montarPromptInterpretacao } from "./prompt";
import { normalizarInterpretacao } from "./normalizar";

/**
 * Transporte: envia `RequisicaoMultimodal` ao servidor/backend e devolve texto.
 * Implementado no lado cliente atraves de `descreverFrame` (transporte-servidor).
 */
export interface RequisicaoMultimodal {
  imagens: string[];
  prompt: string;
  contexto: ContextoCicloSerializavel;
  modelo?: string;
}

export interface RespostaMultimodal {
  texto: string;
  modelo?: string;
  tokens?: number;
  duracaoMs?: number;
}

export type EnviarMultimodal = (
  requisicao: RequisicaoMultimodal,
  sinal?: AbortSignal
) => Promise<RespostaMultimodal>;

export interface DependenciasInterpretadorCiclo {
  enviar: EnviarMultimodal;
  modelo?: string;
  limites?: Partial<LimitesContexto>;
  agora?: () => number;
}

/**
 * Implementacao concreta de `InterpretadorMultimodal` (Etapa 7 do roteiro).
 *
 * 1. Monta contexto estruturado a partir de `PacoteCiclo` (resumo por frame,
 *    poucos pontos relevantes, eventos temporais, sinalizacao de indisponibilidade).
 * 2. Constrói prompt com narrativa cronologica, evidencias e incertezas.
 * 3. Envia imagens na ordem correta ao backend (atraves do transporte).
 * 4. Normaliza a resposta em `ResultadoInterpretacao`.
 *
 * O transporte e injetavel (testes com fake). O interpreter nao captura webcam.
 */
export class InterpretadorCiclo implements InterpretadorMultimodal {
  private readonly enviar: EnviarMultimodal;
  private readonly modeloAtual: string | null;
  private readonly limites: LimitesContexto;
  private readonly agora: () => number;

  constructor(deps: DependenciasInterpretadorCiclo) {
    this.enviar = deps.enviar;
    this.modeloAtual = deps.modelo ?? null;
    this.limites = { ...LIMITES_CONTEXTO_PADRAO, ...deps.limites };
    this.agora = deps.agora ?? (() => performance.now());
  }

  get modelo(): string | null {
    return this.modeloAtual;
  }

  async interpretar(pacote: PacoteCiclo, sinal?: AbortSignal): Promise<ResultadoInterpretacao> {
    const { imagens, contexto } = montarContextoCiclo(pacote, this.limites);
    const prompt = montarPromptInterpretacao(contexto);
    const inicio = this.agora();
    const resposta = await this.enviar(
      {
        imagens,
        prompt,
        contexto,
        modelo: this.modeloAtual ?? undefined,
      },
      sinal
    );
    const duracaoMs = resposta.duracaoMs ?? Math.round(this.agora() - inicio);
    const resultado = normalizarInterpretacao(resposta.texto, resposta.modelo ?? this.modeloAtual ?? undefined);
    return { ...resultado, duracaoMs };
  }
}
