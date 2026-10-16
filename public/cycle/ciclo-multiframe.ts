import { ehCancelamento, ErroPercepcao } from "../../src/erros";
import { indisponivel } from "../../src/domain/perception";
import type {
  ResultadoDeteccaoLocal,
  ResultadoMaos,
  ResultadoOuIndisponivel,
  ResultadoPose,
} from "../../src/domain/perception";
import type { ObservacaoFrame } from "../../src/domain/observation";
import type { ErroEtapa, PacoteCiclo, ResultadoCiclo } from "../../src/domain/cycle";
import type { WebcamCapture } from "../capture/webcam-capture";
import type { SnapshotCapturado, SnapshotStore } from "../capture/snapshot-store";
import type { InterpretadorMultimodal } from "../interpretation/contracts";

/**
 * `CicloMultiframe` (Etapa 4 do roteiro).
 *
 * Ordem do ciclo: **capturar** os snapshots identificados (sem inferencia),
 * guarda-los no buffer, **depois** processa-los localmente em sequencia e, por
 * fim, enviar `PacoteCiclo` a interpretacao multimodal. As imagens que chegam ao
 * interpretador sao exatamente as guardadas na captura — o pacote carrega os
 * mesmos `imagem`, `frameId` e `capturadoEm`, e a interface do interpretador
 * nao expoe nenhuma camera.
 */

/** Resultado do processamento local de um snapshot (um frame). */
export interface ProcessamentoFrame {
  deteccoes: ResultadoOuIndisponivel<ResultadoDeteccaoLocal>;
  pose: ResultadoOuIndisponivel<ResultadoPose>;
  maos: ResultadoOuIndisponivel<ResultadoMaos>;
  metricas: {
    duracaoDeteccaoMs?: number;
    duracaoPoseMs?: number;
    duracaoMaosMs?: number;
  };
}

export interface DependenciasCicloMultiframe {
  /** Captura identificada, sem inferencia. */
  captura: WebcamCapture;
  /** Buffer de snapshots (retencao limitada, limpeza ao falhar/parar). */
  store: SnapshotStore;
  /**
   * Processa um snapshot localmente. Deve representar falha de um subsistema
   * como `indisponivel`, e nao lancando — assim um modelo que falha nao apaga
   * o resultado dos demais.
   */
  processarFrame: (
    snapshot: SnapshotCapturado,
    sinal?: AbortSignal
  ) => Promise<ProcessamentoFrame>;
  /** Interpretador multimodal; recebe o pacote, nunca a camera. */
  interpretador: InterpretadorMultimodal;
  /** Sessao atual (ids de ciclo derivam dela). */
  sessaoId: string;
  /** Sequencia do proximo ciclo na sessao (1, 2, 3, ...). */
  proximoCycleId: () => string;
  /** Relogio monotonico (ms). Padrao: `performance.now`. */
  agora?: () => number;
  /** Relogio de parede ISO. Padrao: `new Date().toISOString`. */
  agoraIso?: () => string;
}

function cancelado(): ErroPercepcao {
  return new ErroPercepcao("cancelamento", "ciclo cancelado");
}

/**
 * Executa um ciclo multiframe completo. Limpa o buffer e propaga o erro quando
 * a captura/processamento e cancelado ou falha de forma inesperada.
 */
export async function executarCicloMultiframe(
  deps: DependenciasCicloMultiframe,
  sinal?: AbortSignal
): Promise<ResultadoCiclo> {
  const agora = deps.agora ?? (() => performance.now());
  const agoraIso = deps.agoraIso ?? (() => new Date().toISOString());
  const cycleId = deps.proximoCycleId();
  const iniciadoEm = agoraIso();
  const inicioMs = agora();

  const erros: ErroEtapa[] = [];

  try {
    if (sinal?.aborted) throw cancelado();

    // 1) Captura identificada (sem inferencia).
    const capturados = await deps.captura.capturar(cycleId, sinal);
    deps.store.limpar();
    for (const snapshot of capturados) deps.store.adicionar(snapshot);
    const capturaMs = Math.round(agora() - inicioMs);

    // 2) Processamento local do conjunto, depois da captura, em sequencia.
    const quadros = deps.store.quadros;
    const observacoes: ObservacaoFrame[] = [];
    let deteccaoMs = 0;
    let poseMs = 0;
    let maosMs = 0;

    for (const snapshot of quadros) {
      if (sinal?.aborted) throw cancelado();
      let processamento: ProcessamentoFrame;
      try {
        processamento = await deps.processarFrame(snapshot, sinal);
      } catch (err) {
        if (ehCancelamento(err) || sinal?.aborted) throw cancelado();
        const mensagem = (err as Error).message;
        erros.push({ etapa: "deteccao", mensagem });
        processamento = {
          deteccoes: indisponivel("deteccao", mensagem),
          pose: indisponivel("pose", mensagem),
          maos: indisponivel("maos", mensagem),
          metricas: {},
        };
      }
      deteccaoMs += processamento.metricas.duracaoDeteccaoMs ?? 0;
      poseMs += processamento.metricas.duracaoPoseMs ?? 0;
      maosMs += processamento.metricas.duracaoMaosMs ?? 0;

      observacoes.push(
        Object.freeze({
          sessionId: deps.sessaoId,
          cycleId,
          frameId: snapshot.frameId,
          capturadoEm: snapshot.capturadoEm,
          capturadoEmMs: snapshot.capturadoEmMs,
          imagem: snapshot.imagem,
          thumb: snapshot.thumb,
          assinaturaCena: snapshot.assinaturaCena,
          deteccoes: processamento.deteccoes,
          pose: processamento.pose,
          maos: processamento.maos,
          inferidoEm: agoraIso(),
          metricas: processamento.metricas,
        })
      );
    }

    // 3) Pacote do ciclo: fronteira entre analise local e interpretacao.
    const pacote: PacoteCiclo = {
      sessionId: deps.sessaoId,
      cycleId,
      iniciadoEm,
      concluidoEm: agoraIso(),
      observacoes,
      eventosTemporais: [],
      resumoTemporal: { eventos: [], entidadesAtivas: 0 },
      metricas: {
        capturaMs,
        deteccaoMs,
        poseMs,
        maosMs,
        totalMs: Math.round(agora() - inicioMs),
      },
    };

    // 4) Interpretacao multimodal sobre o pacote (sem nova captura).
    const resultado = await deps.interpretador.interpretar(pacote, sinal);
    pacote.metricas.multimodalMs = resultado.duracaoMs;
    pacote.metricas.totalMs = Math.round(agora() - inicioMs);

    return { pacote, interpretacao: resultado.resumo, erros, cancelado: false };
  } catch (err) {
    // 5) Falha/cancelamento: nao reter imagens em memoria.
    deps.store.limpar();
    throw err;
  }
}
