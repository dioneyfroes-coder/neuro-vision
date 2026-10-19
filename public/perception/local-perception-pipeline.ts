import { ehCancelamento, ErroPercepcao } from "../../src/erros";
import { indisponivel } from "../../src/domain/perception";
import type {
  ResultadoDeteccaoLocal,
  ResultadoMaos,
  ResultadoOuIndisponivel,
  ResultadoPose,
} from "../../src/domain/perception";
import type { SnapshotCapturado } from "../capture/snapshot-store";
import type { ProcessamentoFrame } from "../cycle/ciclo-multiframe";
import type {
  DetectorObjetos,
  EntradaAdaptador,
  EstimadorPose,
  ReconhecedorGestos,
} from "./contracts";

/**
 * Pipeline local do ciclo multiframe (Etapa 5 do roteiro).
 *
 * Executa os tres subsistemas — deteccao de objetos, pose e maos/gestos — sobre
 * **cada snapshot** capturado, em sequencia e de forma previsivel (item 4:
 * "a primeira configuracao de referencia deve ser simples e previsivel"; so
 * experimentar paralelismo depois do primeiro benchmark sequencial).
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

/** Subsistemas de percepcao local, na ordem sequencial do pipeline. */
export type SubsistemaPercepcao = "deteccao" | "pose" | "maos";

export interface DependenciasPipelineLocal {
  /** Detector de objetos. Omitido: o subsistema fica indisponivel (desativado). */
  detector?: DetectorObjetos;
  /** Estimador de pose. Omitido: o subsistema fica indisponivel (desativado). */
  pose?: EstimadorPose;
  /** Reconhecedor de maos/gestos. Omitido: fica indisponivel (desativado). */
  maos?: ReconhecedorGestos;
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
 * Roda os tres subsistemas em sequencia sobre cada snapshot, isolando falhas.
 * Reusa as portas ja carregadas; o carregamento dos modelos acontece antes, no
 * ponto de composicao, nao dentro do ciclo.
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

    const deteccao = await this.executar("deteccao", sinal, () =>
      this.deps.detector
        ? this.deps.detector.detectar(entrada, { threshold, percentage: false })
        : Promise.resolve(indisponivel("deteccao", "detector de objetos desativado"))
    );
    const pose = await this.executar("pose", sinal, () =>
      this.deps.pose
        ? this.deps.pose.estimar(entrada)
        : Promise.resolve(indisponivel("pose", "estimador de pose desativado"))
    );
    const maos = await this.executar("maos", sinal, () =>
      this.deps.maos
        ? this.deps.maos.reconhecer(entrada)
        : Promise.resolve(indisponivel("maos", "reconhecedor de maos desativado"))
    );

    return {
      deteccoes: deteccao.resultado as ResultadoOuIndisponivel<ResultadoDeteccaoLocal>,
      pose: pose.resultado as ResultadoOuIndisponivel<ResultadoPose>,
      maos: maos.resultado as ResultadoOuIndisponivel<ResultadoMaos>,
      metricas: {
        duracaoDeteccaoMs: deteccao.duracaoMs,
        duracaoPoseMs: pose.duracaoMs,
        duracaoMaosMs: maos.duracaoMs,
      },
    };
  }

  /** Encerra os subsistemas (liberacao de recursos do adaptador). */
  encerrar(): void {
    this.deps.detector?.encerrar();
    this.deps.pose?.encerrar();
    this.deps.maos?.encerrar();
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
      metricas: {},
    });
}

/** Ids de modelo por subsistema (todos opcionais). */
export interface ModelosPercepcao {
  objetos?: string;
  pose?: string;
  maos?: string;
}

/** Resultado da configuracao dos subsistemas: quem carregou e quem falhou. */
export interface ConfiguracaoParcial {
  carregados: SubsistemaPercepcao[];
  falhas: { subsistema: SubsistemaPercepcao; motivo: string }[];
}

/**
 * Carrega os modelos de cada subsistema de forma **isolada** (itens 4 e 5):
 * um modelo que falha entra em `falhas` sem impedir o carregamento dos demais.
 * O pipeline segue rodando: o subsistema quebrado responde `indisponivel` em
 * cada frame, os outros continuam entregando evidencia.
 */
export async function configurarSubsistemas(
  deps: DependenciasPipelineLocal,
  modelos: ModelosPercepcao,
  aoStatus?: (mensagem: string) => void
): Promise<ConfiguracaoParcial> {
  const alvos: {
    subsistema: SubsistemaPercepcao;
    porta?: { carregar(modelo: string, aoStatus?: (mensagem: string) => void): Promise<void> };
    modelo?: string;
  }[] = [
    { subsistema: "deteccao", porta: deps.detector, modelo: modelos.objetos },
    { subsistema: "pose", porta: deps.pose, modelo: modelos.pose },
    { subsistema: "maos", porta: deps.maos, modelo: modelos.maos },
  ];

  const carregados: SubsistemaPercepcao[] = [];
  const falhas: ConfiguracaoParcial["falhas"] = [];

  for (const alvo of alvos) {
    if (!alvo.porta || !alvo.modelo) continue;
    try {
      await alvo.porta.carregar(alvo.modelo, aoStatus);
      carregados.push(alvo.subsistema);
    } catch (err) {
      falhas.push({ subsistema: alvo.subsistema, motivo: mensagemDe(err) });
      aoStatus?.(`${alvo.subsistema} indisponivel: ${mensagemDe(err)}`);
    }
  }

  return { carregados, falhas };
}

