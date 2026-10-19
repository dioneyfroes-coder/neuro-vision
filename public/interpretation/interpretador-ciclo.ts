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
  /**
   * Modelo de visao a usar. Pode ser uma funcao, resolvida a cada
   * interpretacao — assim trocar o modelo na interface durante a sessao
   * multiframe tem efeito imediato e o `modelo` registrado em cada entrada
   * (`/api/log`) e o que realmente rodou (garantia de mesmo modelo da Etapa 9).
   */
  modelo?: string | (() => string | undefined | null);
  limites?: Partial<LimitesContexto>;
  /**
   * Inclui os dados locais no contexto multimodal. `false` (variante B) envia
   * apenas as imagens + cronologia. Padrao: `true`.
   */
  incluirDadosLocais?: boolean;
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
  private readonly obterModelo: () => string | null;
  private readonly limites: LimitesContexto;
  private readonly incluirDadosLocais: boolean;
  private readonly agora: () => number;

  constructor(deps: DependenciasInterpretadorCiclo) {
    this.enviar = deps.enviar;
    const modelo = deps.modelo;
    this.obterModelo =
      typeof modelo === "function" ? () => modelo() ?? null : () => modelo ?? null;
    this.limites = { ...LIMITES_CONTEXTO_PADRAO, ...deps.limites };
    this.incluirDadosLocais = deps.incluirDadosLocais ?? true;
    this.agora = deps.agora ?? (() => performance.now());
  }

  get modelo(): string | null {
    return this.obterModelo();
  }

  async interpretar(pacote: PacoteCiclo, sinal?: AbortSignal): Promise<ResultadoInterpretacao> {
    const { imagens, contexto } = montarContextoCiclo(pacote, this.limites, {
      incluirDadosLocais: this.incluirDadosLocais,
    });
    const prompt = montarPromptInterpretacao(contexto);
    const modelo = this.obterModelo();
    const inicio = this.agora();
    const resposta = await this.enviar(
      {
        imagens,
        prompt,
        contexto,
        modelo: modelo ?? undefined,
      },
      sinal
    );
    const duracaoMs = resposta.duracaoMs ?? Math.round(this.agora() - inicio);
    const resultado = normalizarInterpretacao(resposta.texto, resposta.modelo ?? modelo ?? undefined);
    return { ...resultado, duracaoMs };
  }
}
