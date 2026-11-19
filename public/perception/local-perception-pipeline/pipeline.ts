import { ehCancelamento, ErroPercepcao } from "../../../src/erros";
import type { AmostragemFrame } from "../../../src/domain/cadencia";
import { estaIndisponivel, indisponivel, naoAmostrado, naoFoiAmostrado } from "../../../src/domain/perception";
import type {
  ResultadoDeteccaoLocal,
  ResultadoIndisponivel,
  ResultadoMaos,
  ResultadoNsfw,
  ResultadoOuIndisponivel,
  ResultadoPose,
} from "../../../src/domain/perception";
import type { SnapshotCapturado } from "../../capture/snapshot-store";
import type { ProcessamentoFrame, TelemetriaSubsistema } from "../../cycle/ciclo-multiframe";
import type { EntradaAdaptador, EstadoSubsistema, MetricasAdaptador } from "../contracts";
import { HABILITACAO_PADRAO } from "./tipos";
import type { DependenciasPipelineLocal, HabilitacaoSubsistemas, SubsistemaPercepcao } from "./tipos";
import { mensagemDe } from "./util";

interface ExecucaoSubsistema<T> {
  resultado: ResultadoOuIndisponivel<T>;
  duracaoMs: number;
}

function cancelado(): ErroPercepcao {
  return new ErroPercepcao("cancelamento", "processamento local cancelado");
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
    sinal?: AbortSignal,
    amostragem?: AmostragemFrame
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
    // Ausente = sem cadencia configurada: todos os subsistemas rodam.
    const executar = (subsistema: SubsistemaPercepcao): boolean =>
      amostragem === undefined || amostragem.has(subsistema);

    // Os subsistemas rodam **em paralelo** no mesmo frame (otimizacao de
    // desempenho): YOLO (objetos/pose), MediaPipe (maos) e NSFW compartilham a
    // inferencia concorrente sem competir pela mesma sessao (runtimes distintos).
    // Cada um continua isolado: uma falha vira `indisponivel` sem apagar os
    // demais (item 8), e o cancelamento propaga (nunca mascarado). Um
    // subsistema pulado pela cadencia vira `naoAmostrado` — nem falha nem
    // ausencia.
    const nsfwHabilitado = habilitacao.nsfw && Boolean(this.deps.nsfw?.modelo);
    const [deteccao, pose, maos, nsfwExecucao] = await Promise.all([
      this.executar("deteccao", sinal, () =>
        habilitacao.deteccao && this.deps.detector
          ? this.deps.detector.detectar(entrada, { threshold, percentage: false })
          : Promise.resolve(indisponivel("deteccao", "detector de objetos desativado")),
        executar("deteccao")
      ),
      this.executar("pose", sinal, () =>
        habilitacao.pose && this.deps.pose
          ? this.deps.pose.estimar(entrada)
          : Promise.resolve(indisponivel("pose", "estimador de pose desativado")),
        executar("pose")
      ),
      this.executar("maos", sinal, () =>
        habilitacao.maos && this.deps.maos
          ? this.deps.maos.reconhecer(entrada)
          : Promise.resolve(indisponivel("maos", "reconhecedor de maos desativado")),
        executar("maos")
      ),
      // NSFW experimental: roda somente quando habilitado (toggle da interface)
      // **e** carregado. Nesses casos, falha vira `indisponivel` como nos demais;
      // caso contrario o campo `nsfw` fica ausente no frame.
      nsfwHabilitado
        ? this.executar("nsfw", sinal, () =>
            this.deps.nsfw!.avaliar(entrada, { threshold, percentage: false }),
            executar("nsfw")
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
          deteccao: this.telemetria(this.deps.detector, deteccao.resultado, deteccao.duracaoMs),
          pose: this.telemetria(this.deps.pose, pose.resultado, pose.duracaoMs),
          maos: this.telemetria(this.deps.maos, maos.resultado, maos.duracaoMs),
          ...(nsfw || this.deps.nsfw?.modelo
            ? { nsfw: this.telemetria(this.deps.nsfw, nsfw, nsfwExecucao?.duracaoMs) }
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
    resultado: ResultadoOuIndisponivel<T> | undefined,
    duracaoInferenciaMs: number | undefined
  ): TelemetriaSubsistema {
    const metricas = porta?.metricas as MetricasAdaptador | undefined;
    if (naoFoiAmostrado(resultado)) {
      // Pular pela cadencia nao e falha: preserva modelo/dispositivo e nao
      // herda tempo de inferencia de outro frame.
      return {
        status: "nao_amostrado",
        modelo: metricas?.modelo,
        dispositivo: metricas?.dispositivo,
        versao: metricas?.versao,
      };
    }
    const indisponivel = resultado && estaIndisponivel(resultado);
    const status: EstadoSubsistema = resultado
      ? indisponivel
        ? "indisponivel"
        : "ok"
      : (metricas?.status ?? "nao_carregado");
    // Inferencia so entra quando o subsistema de fato rodou e entregou resultado:
    // uma inferencia que falhou (ou um frame desativado) nao pode herdar o tempo
    // da ultima inferencia valida do adaptador.
    const inferenciaValida = resultado !== undefined && !indisponivel;
    return {
      status,
      modelo: metricas?.modelo,
      dispositivo: metricas?.dispositivo,
      versao: metricas?.versao,
      motivoFalha: indisponivel
        ? (resultado as ResultadoIndisponivel).motivo
        : metricas?.motivoFalha,
      ...(metricas?.motivoFallback ? { motivoFallback: metricas.motivoFallback } : {}),
      tempoCargaMs: metricas?.tempoCargaMs,
      tempoInferenciaMs: inferenciaValida ? duracaoInferenciaMs : undefined,
      memoriaBytes: metricas?.memoriaBytes,
      ...(metricas?.telemetriaModelos?.length
        ? { modelos: metricas.telemetriaModelos }
        : {}),
    };
  }

  /** Encerra os subsistemas (liberacao de recursos do adaptador). */
  async encerrar(): Promise<void> {
    await Promise.all([
      Promise.resolve().then(() => this.deps.detector?.encerrar()),
      Promise.resolve().then(() => this.deps.pose?.encerrar()),
      Promise.resolve().then(() => this.deps.maos?.encerrar()),
      Promise.resolve().then(() => this.deps.nsfw?.encerrar()),
    ]);
  }

  /**
   * Executa um subsistema isolado: mede a latencia e converte falha em
   * `ResultadoIndisponivel`. Cancelamento nunca e mascarado.
   */
  private async executar<T>(
    subsistema: SubsistemaPercepcao,
    sinal: AbortSignal | undefined,
    tarefa: () => Promise<ResultadoOuIndisponivel<T>>,
    amostrar = true
  ): Promise<ExecucaoSubsistema<T>> {
    if (sinal?.aborted) throw cancelado();
    // Frame pulado de proposito: nao toca o SDK e nao conta como inferencia.
    if (!amostrar) {
      return { resultado: naoAmostrado(subsistema), duracaoMs: 0 };
    }
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
