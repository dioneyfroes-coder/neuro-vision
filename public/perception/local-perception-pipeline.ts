import { ehCancelamento, ErroPercepcao } from "../../src/erros";
import { estaIndisponivel, indisponivel } from "../../src/domain/perception";
import type {
  ResultadoDeteccaoLocal,
  ResultadoIndisponivel,
  ResultadoMaos,
  ResultadoNsfw,
  ResultadoOuIndisponivel,
  ResultadoPose,
} from "../../src/domain/perception";
import type { SnapshotCapturado } from "../capture/snapshot-store";
import type { ProcessamentoFrame, TelemetriaSubsistema } from "../cycle/ciclo-multiframe";
import type {
  ClassificadorNsfw,
  DetectorObjetos,
  EntradaAdaptador,
  EstimadorPose,
  EstadoSubsistema,
  MetricasAdaptador,
  ReconhecedorGestos,
} from "./contracts";

/**
 * Pipeline local do ciclo multiframe (Etapa 5 do roteiro).
 *
 * Executa os tres subsistemas — deteccao de objetos, pose e maos/gestos — sobre
 * **cada snapshot** capturado. Os subsistemas de um mesmo frame rodam em
 * **paralelo** (`Promise.all`): sao runtimes distintos (YOLO/Transformers,
 * MediaPipe) e nao competem pela mesma sessao, entao a espera deixa de somar.
 * A previsibilidade continua garantida pelo isolamento por subsistema (abaixo) e
 * pela ordem estavel das observacoes no ciclo — nao pela ordem de conclusao.
 *
 * Cada subsistema e isolado: se um modelo lanca, o pipeline registra
 * `ResultadoIndisponivel` para aquele subsistema e **preserva** o resultado dos
 * demais (principio 8). Assim uma falha de pose nao apaga a deteccao de objetos
 * ja obtida no mesmo frame.
 *
 * O pipeline nao conhece SDK algum: recebe as portas `DetectorObjetos`,
 * `EstimadorPose` e `ReconhecedorGestos`, o snapshot identificado (`frameId`,
 * `capturadoEm`) e devolve `ProcessamentoFrame`, que o `executarCicloMultiframe`
 * associa ao timestamp do snapshot.
 */

/** Subsistemas de percepcao local (disparados em paralelo por frame). */
export type SubsistemaPercepcao = "deteccao" | "pose" | "maos" | "nsfw";

export interface DependenciasPipelineLocal {
  /** Detector de objetos. Omitido: o subsistema fica indisponivel (desativado). */
  detector?: DetectorObjetos;
  /** Estimador de pose. Omitido: o subsistema fica indisponivel (desativado). */
  pose?: EstimadorPose;
  /** Reconhecedor de maos/gestos. Omitido: fica indisponivel (desativado). */
  maos?: ReconhecedorGestos;
  /**
   * Classificador **NSFW experimental**. O subsistema so roda quando o adaptador
   * esta presente **e** carregado (`modelo !== null`): sem toggle da interface
   * nenhum modelo e carregado e o campo `nsfw` simplesmente fica ausente no
   * frame — "nao rodou" permanece distinguivel de "rodou e nao marcou nada".
   */
  nsfw?: ClassificadorNsfw;
  /**
   * Habilitacao explicita por subsistema (Fase 2, item 1). Um subsistema
   * desabilitado responde `indisponivel` ("desativado") sem sequer tocar o SDK,
   * independentemente de a porta estar presente. Default: `HABILITACAO_PADRAO`.
   */
  habilitacao?: HabilitacaoSubsistemas;
  /** Limiar de deteccao lido a cada frame (reflete ajustes da interface). */
  obterThreshold?: () => number;
  /** Avisos do pipeline (ex.: subsistema que falhou). */
  aoStatus?: (mensagem: string) => void;
}

/** Assinatura do processamento de um frame, compativel com `DependenciasCicloMultiframe`. */
export type ProcessarFrameLocal = (
  snapshot: SnapshotCapturado,
  sinal?: AbortSignal
) => Promise<ProcessamentoFrame>;

interface ExecucaoSubsistema<T> {
  resultado: ResultadoOuIndisponivel<T>;
  duracaoMs: number;
}

function cancelado(): ErroPercepcao {
  return new ErroPercepcao("cancelamento", "processamento local cancelado");
}

function mensagemDe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Roda os subsistemas sobre cada snapshot, isolando falhas. Os subsistemas de um
 * mesmo frame sao disparados em paralelo por `processarFrame`; a injecao das
 * portas ja carregadas acontece antes, no ponto de composicao, nao no ciclo.
 */
export class PipelineLocal {
  constructor(private readonly deps: DependenciasPipelineLocal) {}

  async processarFrame(
    snapshot: SnapshotCapturado,
    sinal?: AbortSignal
  ): Promise<ProcessamentoFrame> {
    const entrada: EntradaAdaptador = {
      imagem: snapshot.imagem,
      dimensoes: snapshot.dimensoes,
    };
    const threshold = this.deps.obterThreshold?.() ?? 0.5;
    const habilitacao: Required<HabilitacaoSubsistemas> = {
      ...HABILITACAO_PADRAO,
      ...this.deps.habilitacao,
    };

    // Os subsistemas rodam **em paralelo** no mesmo frame (otimizacao de
    // desempenho): YOLO (objetos/pose), MediaPipe (maos) e NSFW compartilham a
    // inferencia concorrente sem competir pela mesma sessao (runtimes distintos).
    // Cada um continua isolado: uma falha vira `indisponivel` sem apagar os
    // demais (item 8), e o cancelamento propaga (nunca mascarado).
    const nsfwHabilitado = habilitacao.nsfw && Boolean(this.deps.nsfw?.modelo);
    const [deteccao, pose, maos, nsfwExecucao] = await Promise.all([
      this.executar("deteccao", sinal, () =>
        habilitacao.deteccao && this.deps.detector
          ? this.deps.detector.detectar(entrada, { threshold, percentage: false })
          : Promise.resolve(indisponivel("deteccao", "detector de objetos desativado"))
      ),
      this.executar("pose", sinal, () =>
        habilitacao.pose && this.deps.pose
          ? this.deps.pose.estimar(entrada)
          : Promise.resolve(indisponivel("pose", "estimador de pose desativado"))
      ),
      this.executar("maos", sinal, () =>
        habilitacao.maos && this.deps.maos
          ? this.deps.maos.reconhecer(entrada)
          : Promise.resolve(indisponivel("maos", "reconhecedor de maos desativado"))
      ),
      // NSFW experimental: roda somente quando habilitado (toggle da interface)
      // **e** carregado. Nesses casos, falha vira `indisponivel` como nos demais;
      // caso contrario o campo `nsfw` fica ausente no frame.
      nsfwHabilitado
        ? this.executar("nsfw", sinal, () =>
            this.deps.nsfw!.avaliar(entrada, { threshold, percentage: false })
          )
        : Promise.resolve(null),
    ]);

    const nsfw = nsfwExecucao
      ? (nsfwExecucao.resultado as ResultadoOuIndisponivel<ResultadoNsfw>)
      : undefined;
    const duracaoNsfwMs = nsfwExecucao?.duracaoMs;

    return {
      deteccoes: deteccao.resultado as ResultadoOuIndisponivel<ResultadoDeteccaoLocal>,
      pose: pose.resultado as ResultadoOuIndisponivel<ResultadoPose>,
      maos: maos.resultado as ResultadoOuIndisponivel<ResultadoMaos>,
      nsfw,
      metricas: {
        duracaoDeteccaoMs: deteccao.duracaoMs,
        duracaoPoseMs: pose.duracaoMs,
        duracaoMaosMs: maos.duracaoMs,
        duracaoNsfwMs,
        subsistemas: {
          deteccao: this.telemetria(this.deps.detector, deteccao.resultado),
          pose: this.telemetria(this.deps.pose, pose.resultado),
          maos: this.telemetria(this.deps.maos, maos.resultado),
          ...(nsfw || this.deps.nsfw?.modelo
            ? { nsfw: this.telemetria(this.deps.nsfw, nsfw) }
            : {}),
        },
      },
    };
  }

  /**
   * Telemetria de um subsistema no frame (Fase 2, item 5): combina o estado da
   * porta (`metricas`) com o resultado efetivo do frame. Quando a porta nao
   * expoe `metricas` (motores falsos em teste), deriva o status do resultado.
   */
  private telemetria<T>(
    porta: { metricas?: MetricasAdaptador } | undefined,
    resultado: ResultadoOuIndisponivel<T> | undefined
  ): TelemetriaSubsistema {
    const metricas = porta?.metricas as MetricasAdaptador | undefined;
    const indisponivel = resultado && estaIndisponivel(resultado);
    const status: EstadoSubsistema = resultado
      ? indisponivel
        ? "indisponivel"
        : "ok"
      : (metricas?.status ?? "nao_carregado");
    return {
      status,
      modelo: metricas?.modelo,
      dispositivo: metricas?.dispositivo,
      versao: metricas?.versao,
      motivoFalha: indisponivel
        ? (resultado as ResultadoIndisponivel).motivo
        : metricas?.motivoFalha,
    };
  }

  /** Encerra os subsistemas (liberacao de recursos do adaptador). */
  encerrar(): void {
    this.deps.detector?.encerrar();
    this.deps.pose?.encerrar();
    this.deps.maos?.encerrar();
    this.deps.nsfw?.encerrar();
  }

  /**
   * Executa um subsistema isolado: mede a latencia e converte falha em
   * `ResultadoIndisponivel`. Cancelamento nunca e mascarado.
   */
  private async executar<T>(
    subsistema: SubsistemaPercepcao,
    sinal: AbortSignal | undefined,
    tarefa: () => Promise<ResultadoOuIndisponivel<T>>
  ): Promise<ExecucaoSubsistema<T>> {
    if (sinal?.aborted) throw cancelado();
    const inicio = performance.now();
    try {
      const resultado = await tarefa();
      return { resultado, duracaoMs: Math.round(performance.now() - inicio) };
    } catch (err) {
      if (ehCancelamento(err) || sinal?.aborted) throw cancelado();
      const mensagem = mensagemDe(err);
      this.deps.aoStatus?.(`${subsistema} indisponivel neste frame: ${mensagem}`);
      return {
        resultado: indisponivel(subsistema, mensagem),
        duracaoMs: Math.round(performance.now() - inicio),
      };
    }
  }
}

/** Cria o processador de frame a partir do pipeline, pronto para o ciclo. */
export function criarProcessadorFrameLocal(deps: DependenciasPipelineLocal): ProcessarFrameLocal {
  const pipeline = new PipelineLocal(deps);
  return (snapshot, sinal) => pipeline.processarFrame(snapshot, sinal);
}

/**
 * Processador inativo das variantes sem percepcao local (B · Sequência): todo
 * subsistema responde `indisponivel`, sem carregar modelo algum. O ciclo segue
 * valido — apenas nao ha evidencia local para o contexto multimodal nem para o
 * motor temporal, preservando a comparacao "apenas imagens".
 */
export function criarProcessadorInativo(): ProcessarFrameLocal {
  return () =>
    Promise.resolve({
      deteccoes: indisponivel("deteccao", "percepcao local desativada na variante"),
      pose: indisponivel("pose", "percepcao local desativada na variante"),
      maos: indisponivel("maos", "percepcao local desativada na variante"),
      metricas: {
        subsistemas: {
          deteccao: { status: "indisponivel", motivoFalha: "percepcao local desativada na variante" },
          pose: { status: "indisponivel", motivoFalha: "percepcao local desativada na variante" },
          maos: { status: "indisponivel", motivoFalha: "percepcao local desativada na variante" },
        },
      },
    });
}

/** Ids de modelo por subsistema (todos opcionais; `nsfw` so carrega com toggle). */
export interface ModelosPercepcao {
  objetos?: string;
  pose?: string;
  maos?: string;
  nsfw?: string;
}

/**
 * Habilitacao **explicita** de cada subsistema (Fase 2, item 1).
 *
 * Antes a ativacao era implicita: bastava haver um id de modelo para o
 * subsistema ser carregado, o que tornava impossivel distinguir "desligado de
 * proposito" de "esquecido". Aqui cada subsistema tem um booleano proprio; o
 * default vive em `HABILITACAO_PADRAO` e a interface pode sobrescrever por
 * sessao. Um subsistema desabilitado nunca chama `carregar` e responde
 * `indisponivel` (motivo "desativado") em cada frame — nunca lista vazia.
 */
export interface HabilitacaoSubsistemas {
  /** Deteccao de objetos (YOLO). */
  deteccao?: boolean;
  /** Estimativa de pose (YOLO Pose). */
  pose?: boolean;
  /** Maos/gestos (MediaPipe). */
  maos?: boolean;
  /** Classificador NSFW experimental (opt-in, desligado por padrao). */
  nsfw?: boolean;
}

/** Habilitacao de referencia: objetos/pose/maos ligados; NSFW opt-in. */
export const HABILITACAO_PADRAO: Required<HabilitacaoSubsistemas> = {
  deteccao: true,
  pose: true,
  maos: true,
  nsfw: false,
};

/** Resultado da configuracao dos subsistemas: quem carregou, quem falhou e quem esta desativado. */
export interface ConfiguracaoParcial {
  carregados: SubsistemaPercepcao[];
  falhas: { subsistema: SubsistemaPercepcao; motivo: string }[];
  /** Subsistemas desativados explicitamente (nunca tentaram carregar). */
  desativados: SubsistemaPercepcao[];
  /** Status final por subsistema, para telemetria/diagnostico. */
  status: Record<SubsistemaPercepcao, "carregado" | "desativado" | "falhou">;
}

function habilitado(
  subsistema: SubsistemaPercepcao,
  habilitacao: Required<HabilitacaoSubsistemas>
): boolean {
  return habilitacao[subsistema];
}

/**
 * Carrega os modelos de cada subsistema de forma **isolada** (itens 4 e 5):
 * um modelo que falha entra em `falhas` sem impedir o carregamento dos demais.
 * O pipeline segue rodando: o subsistema quebrado responde `indisponivel` em
 * cada frame, os outros continuam entregando evidencia.
 *
 * A ativacao e **explicita** (item 1): um subsistema so tenta carregar quando
 * esta habilitado **e** tem modelo. Desabilitado entra em `desativados` e nunca
 * toca o SDK.
 */
export async function configurarSubsistemas(
  deps: DependenciasPipelineLocal,
  modelos: ModelosPercepcao,
  aoStatus?: (mensagem: string) => void,
  habilitacao: HabilitacaoSubsistemas = HABILITACAO_PADRAO
): Promise<ConfiguracaoParcial> {
  const efetiva: Required<HabilitacaoSubsistemas> = { ...HABILITACAO_PADRAO, ...habilitacao };
  const alvos: {
    subsistema: SubsistemaPercepcao;
    porta?: { carregar(modelo: string, aoStatus?: (mensagem: string) => void): Promise<void> };
    modelo?: string;
  }[] = [
    { subsistema: "deteccao", porta: deps.detector, modelo: modelos.objetos },
    { subsistema: "pose", porta: deps.pose, modelo: modelos.pose },
    { subsistema: "maos", porta: deps.maos, modelo: modelos.maos },
    // NSFW experimental: toggle desligado (`habilitacao.nsfw`) ou sem modelo =
    // nada e carregado (e o pipeline omite o subsistema dos frames).
    { subsistema: "nsfw", porta: deps.nsfw, modelo: modelos.nsfw },
  ];

  const carregados: SubsistemaPercepcao[] = [];
  const desativados: SubsistemaPercepcao[] = [];
  const falhas: ConfiguracaoParcial["falhas"] = [];
  const status: ConfiguracaoParcial["status"] = {
    deteccao: "desativado",
    pose: "desativado",
    maos: "desativado",
    nsfw: "desativado",
  };

  for (const alvo of alvos) {
    if (!habilitado(alvo.subsistema, efetiva)) {
      desativados.push(alvo.subsistema);
      continue;
    }
    if (!alvo.porta || !alvo.modelo) {
      // Habilitado, mas sem porta ou sem id de modelo: nada a carregar.
      desativados.push(alvo.subsistema);
      continue;
    }
    try {
      await alvo.porta.carregar(alvo.modelo, aoStatus);
      carregados.push(alvo.subsistema);
      status[alvo.subsistema] = "carregado";
    } catch (err) {
      falhas.push({ subsistema: alvo.subsistema, motivo: mensagemDe(err) });
      status[alvo.subsistema] = "falhou";
      aoStatus?.(`${alvo.subsistema} indisponivel: ${mensagemDe(err)}`);
    }
  }

  return { carregados, falhas, desativados, status };
}

