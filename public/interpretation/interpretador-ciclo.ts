import type { InterpretadorMultimodal } from "./contracts";
import type {
  ConfiguracaoInterpretadorCiclo,
  PacoteCiclo,
} from "../../src/domain/cycle";
import {
  aplicarExigenciaEvidencias,
  type ContextoParaEvidencia,
} from "../../src/domain/evidencia-interpretacao";
import type { ResultadoInterpretacao } from "../../src/domain/interpretation";
import {
  diagnosticarContexto,
  montarContextoCiclo,
  type ContextoCicloSerializavel,
  type LimitesContexto,
  LIMITES_CONTEXTO_PADRAO,
} from "./contexto";
import {
  OPCOES_SERIALIZACAO_PADRAO,
  validarReferencias,
  type OpcoesSerializacao,
} from "./esquema";
import {
  resolverPerfilDescricaoCorporal,
  type PerfilDescricaoCorporal,
} from "../../src/nsfw-prompt";
import { montarPromptInterpretacao, VERSAO_PROMPT_INTERPRETACAO } from "./prompt";
import { normalizarInterpretacao } from "./normalizar";

/**
 * Transporte: envia `RequisicaoMultimodal` ao servidor/backend e devolve texto.
 * Implementado no lado cliente atraves de `descreverFrame` (transporte-servidor).
 */
export interface RequisicaoMultimodal {
  imagens: string[];
  frameIds: string[];
  prompt: string;
  contexto: ContextoCicloSerializavel;
  modelo?: string;
  /** NSFW ativo: o servidor deve usar exclusivamente o `MODELO_NSFW`. */
  nsfwAtivo?: boolean;
  /** Perfil de descricao corporal resolvido para este ciclo. */
  perfilCorporal?: PerfilDescricaoCorporal;
  /** Contexto/metadado declarado (nome do clipe, anotacao do usuario). */
  contextoDeclarado?: string;
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
  /**
   * NSFW ativo. Pode ser uma funcao, resolvida a cada interpretacao (o toggle
   * fica bloqueado durante a sessao, mas a leitura dinamica evita estado velho).
   * Quando `true`, o servidor troca o modelo por `MODELO_NSFW`.
   */
  nsfwAtivo?: boolean | (() => boolean);
  /**
   * Perfil de descricao corporal (Fase 2). `neutro` e opt-in e pode ser lido de
   * forma dinamica; um perfil explicito vence o toggle para permitir comparar
   * prompts com o mesmo conjunto de detectores. Padrao: resolve do `nsfwAtivo`.
   */
  perfilCorporal?: PerfilDescricaoCorporal | (() => PerfilDescricaoCorporal | undefined | null);
  /**
   * Contexto/metadado declarado (nome do clipe, anotacao do usuario). Pode ser
   * uma funcao para refletir a interface a cada interpretacao. Vai ao prompt
   * como declaracao — nunca como observacao visual.
   */
  contextoDeclarado?: string | (() => string | undefined);
  limites?: Partial<LimitesContexto>;
  /**
   * Inclui os dados locais no contexto multimodal. `false` (variante B) envia
   * apenas as imagens + cronologia. Padrao: `true`.
   */
  incluirDadosLocais?: boolean;
  /**
   * Opcoes de serializacao do contexto. A configuracao experimental de maos
   * (P2.1) usa `{ landmarksCompletos: true }` para enviar os 21 landmarks,
   * alem da geometria calculada. O padrao permanece compacto.
   */
  serializacao?: Partial<OpcoesSerializacao>;
  /** Critério de seleção de frames; padrão `relevancia` (Fase 6, item 2). */
  selecaoFrames?: "uniforme" | "relevancia";
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
  private readonly obterNsfwAtivo: () => boolean;
  private readonly obterPerfilCorporal: () => PerfilDescricaoCorporal | undefined | null;
  private readonly obterContextoDeclarado: () => string | undefined;
  private readonly limites: LimitesContexto;
  private readonly incluirDadosLocais: boolean;
  private readonly serializacao?: Partial<OpcoesSerializacao>;
  private readonly selecaoFrames: "uniforme" | "relevancia";
  private readonly agora: () => number;

  constructor(deps: DependenciasInterpretadorCiclo) {
    this.enviar = deps.enviar;
    const modelo = deps.modelo;
    this.obterModelo =
      typeof modelo === "function" ? () => modelo() ?? null : () => modelo ?? null;
    const nsfwAtivo = deps.nsfwAtivo;
    this.obterNsfwAtivo =
      typeof nsfwAtivo === "function" ? nsfwAtivo : () => nsfwAtivo === true;
    const perfilCorporal = deps.perfilCorporal;
    this.obterPerfilCorporal =
      typeof perfilCorporal === "function" ? perfilCorporal : () => perfilCorporal ?? null;
    const contextoDeclarado = deps.contextoDeclarado;
    this.obterContextoDeclarado =
      typeof contextoDeclarado === "function"
        ? () => contextoDeclarado() ?? undefined
        : () => contextoDeclarado ?? undefined;
    this.limites = { ...LIMITES_CONTEXTO_PADRAO, ...deps.limites };
    this.incluirDadosLocais = deps.incluirDadosLocais ?? true;
    this.serializacao = deps.serializacao;
    this.selecaoFrames = deps.selecaoFrames ?? "relevancia";
    this.agora = deps.agora ?? (() => performance.now());
  }

  get modelo(): string | null {
    return this.obterModelo();
  }

  get diagnostico(): ConfiguracaoInterpretadorCiclo {
    return {
      modeloSolicitado: this.obterModelo() ?? undefined,
      incluirDadosLocais: this.incluirDadosLocais,
      limites: { ...this.limites },
      serializacao: {
        ...OPCOES_SERIALIZACAO_PADRAO,
        decimais: this.limites.decimais,
        ...this.serializacao,
      },
      selecaoFrames: this.selecaoFrames,
    };
  }

  async interpretar(pacote: PacoteCiclo, sinal?: AbortSignal): Promise<ResultadoInterpretacao> {
    const { imagens, contexto, selecao } = montarContextoCiclo(pacote, this.limites, {
      incluirDadosLocais: this.incluirDadosLocais,
      serializacao: this.serializacao,
      selecaoFrames: this.selecaoFrames,
    });
    const contextoDeclarado = this.obterContextoDeclarado();
    const nsfwAtivo = this.obterNsfwAtivo();
    const perfilCorporal = resolverPerfilDescricaoCorporal(
      this.obterPerfilCorporal(),
      nsfwAtivo
    );
    const prompt = montarPromptInterpretacao(contexto, contextoDeclarado, perfilCorporal);
    const modelo = this.obterModelo();
    const inicio = this.agora();
    const resposta = await this.enviar(
      {
        imagens,
        frameIds: contexto.frames.map((frame) => frame.frameId),
        prompt,
        contexto,
        modelo: modelo ?? undefined,
        ...(contextoDeclarado ? { contextoDeclarado } : {}),
        ...(perfilCorporal === "nsfw" ? { nsfwAtivo: true } : {}),
        ...(perfilCorporal === "neutro" ? { perfilCorporal: "neutro" as const } : {}),
      },
      sinal
    );
    const duracaoMs = resposta.duracaoMs ?? Math.round(this.agora() - inicio);
    const resultado = normalizarInterpretacao(resposta.texto, resposta.modelo ?? modelo ?? undefined);
    const validado = this.validarEvidencias(contexto, resultado);
    const comEvidencia = aplicarExigenciaEvidencias(validado, contextoParaEvidencia(contexto));
    // Fase 3, item 5: o chamador registra nas metricas se/como o contexto foi
    // compactado, permitindo medir a frequencia real de truncamento.
    return {
      ...comEvidencia.resultado,
      duracaoMs,
      ...(resposta.tokens !== undefined ? { tokens: resposta.tokens } : {}),
      versaoPrompt: VERSAO_PROMPT_INTERPRETACAO,
      contextoMultimodal: diagnosticarContexto(contexto, this.limites.maxBytesContexto),
      ...(selecao ? { selecaoFrames: selecao } : {}),
    };
  }

  /**
   * Valida os IDs/timestamps citados pelo modelo contra os frames e eventos
   * reais do contexto (Fase 3, item 6). Referencias inexistentes sao removidas
   * de `evidencias`/`acoes[].evidencias`/`participantes[].evidencias` e
   * separadas em `evidenciasInvalidas`, sem nunca fabricar uma evidencia que
   * nao exista.
   */
  private validarEvidencias(
    contexto: ContextoCicloSerializavel,
    resultado: ResultadoInterpretacao
  ): ResultadoInterpretacao {
    const global = validarReferencias(contexto, resultado.evidencias);
    const acoes = resultado.acoes.map((acao) => {
      const validada = validarReferencias(contexto, acao.evidencias);
      return {
        ...acao,
        evidencias: validada.validas,
        ...(validada.invalidas.length > 0 ? { evidenciasInvalidas: validada.invalidas } : {}),
      };
    });
    const participantes = resultado.participantes?.map((participante) => {
      const validada = validarReferencias(contexto, participante.evidencias);
      return {
        ...participante,
        evidencias: validada.validas,
        ...(validada.invalidas.length > 0 ? { evidenciasInvalidas: validada.invalidas } : {}),
      };
    });
    return {
      ...resultado,
      acoes,
      ...(participantes !== undefined ? { participantes } : {}),
      evidencias: global.validas,
      ...(global.invalidas.length > 0 ? { evidenciasInvalidas: global.invalidas } : {}),
    };
  }
}

/** Projeta o contexto versionado para a regra pura de exigência de evidência. */
function contextoParaEvidencia(contexto: ContextoCicloSerializavel): ContextoParaEvidencia {
  return {
    frames: contexto.frames.map((frame) => ({
      frameId: frame.frameId,
      percepcaoValida: !Object.values(frame.subsistemas).some(
        (subsistema) => subsistema.status === "indisponivel"
      ),
    })),
    eventosTemporais: contexto.eventosTemporais,
  };
}
