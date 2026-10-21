import { ehCancelamento, ErroPercepcao } from "../../src/erros";
import { indisponivel } from "../../src/domain/perception";
import type {
  ResultadoDeteccaoLocal,
  ResultadoMaos,
  ResultadoNsfw,
  ResultadoOuIndisponivel,
  ResultadoPose,
} from "../../src/domain/perception";
import type { ObservacaoFrame } from "../../src/domain/observation";
import { criarRegistroCiclo } from "../../src/domain/cycle";
import type {
  ErroEtapa,
  MetricasCiclo,
  PacoteCiclo,
  RegistroCiclo,
  ResultadoCiclo,
  ResumoTemporal,
} from "../../src/domain/cycle";
import type { WebcamCapture } from "../capture/webcam-capture";
import type { SnapshotCapturado, SnapshotStore } from "../capture/snapshot-store";
import type { TelemetriaSubsistema } from "../../src/domain";
import type { SubsistemaPercepcao } from "../perception/local-perception-pipeline";
import type { InterpretadorMultimodal } from "../interpretation/contracts";
import type { MotorTemporal } from "../temporal/contracts";

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
  /**
   * Marcacoes NSFW (experimental). Ausente quando o subsistema nao roda
   * (toggle desligado) — distinto de `indisponivel` (tentou e falhou).
   */
  nsfw?: ResultadoOuIndisponivel<ResultadoNsfw>;
  metricas: {
    duracaoDeteccaoMs?: number;
    duracaoPoseMs?: number;
    duracaoMaosMs?: number;
    duracaoNsfwMs?: number;
    /**
     * Telemetria por subsistema no frame (Fase 2, item 5): estado, modelo,
     * dispositivo e versao efetivamente usados. Ausente quando o processador nao
     * a fornece (ex.: variante sem percepcao local).
     */
    subsistemas?: Partial<Record<SubsistemaPercepcao, TelemetriaSubsistema>>;
  };
}

/** Telemetria de um subsistema num frame (Fase 2, item 5; tipo do dominio). */
export type { TelemetriaSubsistema };

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
  /**
   * Motor temporal opcional (Etapa 6): consome as observacoes do ciclo e devolve
   * o `ResumoTemporal` que alimenta o pacote e a interpretacao. Mantem estado
   * entre ciclos; ausente, o resumo temporal fica vazio (compatibilidade).
   */
  motorTemporal?: MotorTemporal;
  /** Sessao atual (ids de ciclo derivam dela). */
  sessaoId: string;
  /** Sequencia do proximo ciclo na sessao (1, 2, 3, ...). */
  proximoCycleId: () => string;
  /** Relogio monotonico (ms). Padrao: `performance.now`. */
  agora?: () => number;
  /** Relogio de parede ISO. Padrao: `new Date().toISOString`. */
  agoraIso?: () => string;
  /**
   * Persiste o diagnostico do ciclo (Etapa 8), opcional. A falha de gravacao
   * **nao** derruba o ciclo nem se confunde com falha de inferencia: entra em
   * `erros` como etapa `persistencia` e o resultado segue valido.
   */
  persistirCiclo?: (registro: RegistroCiclo) => Promise<void> | void;
}

function cancelado(): ErroPercepcao {
  return new ErroPercepcao("cancelamento", "ciclo cancelado");
}

/**
 * Persiste o diagnostico do ciclo em modo best-effort. Devolve o tempo gasto
 * (ms) para alimentar `metricas.persistenciaMs`.
 */
async function persistirDiagnostico(
  deps: DependenciasCicloMultiframe,
  resultado: ResultadoCiclo,
  erros: ErroEtapa[]
): Promise<number> {
  if (!deps.persistirCiclo) return 0;
  const agora = deps.agora ?? (() => performance.now());
  const inicio = agora();
  try {
    await deps.persistirCiclo(criarRegistroCiclo(resultado));
  } catch (err) {
    erros.push({ etapa: "persistencia", mensagem: (err as Error).message });
  }
  return Math.round(agora() - inicio);
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
  // Declarado fora do try para que o diagnostico de um ciclo incompleto
  // (catch) tambem possa registrar o que ja foi observado.
  const observacoes: ObservacaoFrame[] = [];
  let resumoTemporal: ResumoTemporal = { eventos: [], entidadesAtivas: 0 };
  let metricas: MetricasCiclo = {};

  try {
    if (sinal?.aborted) throw cancelado();

    // 1) Captura identificada (sem inferencia).
    const capturados = await deps.captura.capturar(cycleId, sinal);
    deps.store.limpar();
    for (const snapshot of capturados) deps.store.adicionar(snapshot);
    const capturaMs = Math.round(agora() - inicioMs);

    if (capturados.length === 0) {
      // Camera ainda sem frame: nao ha evidencia a interpretar. Nao e falha,
      // apenas um instante sem imagem (mesma semantica do ciclo de frame unico).
      return {
        pacote: {
          sessionId: deps.sessaoId,
          cycleId,
          iniciadoEm,
          concluidoEm: agoraIso(),
          observacoes: [],
          eventosTemporais: [],
          resumoTemporal: { eventos: [], entidadesAtivas: 0 },
          metricas: { capturaMs, totalMs: Math.round(agora() - inicioMs) },
        },
        erros,
        cancelado: false,
      };
    }

    // 2) Processamento local do conjunto, depois da captura, em sequencia.
    const quadros = deps.store.quadros;
    let deteccaoMs = 0;
    let poseMs = 0;
    let maosMs = 0;
    let nsfwMs = 0;

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
          // NSFW omitido no fallback: sem processamento nao ha como saber se o
          // subsistema rodaria (toggle) — "indeterminado" != "indisponivel".
          metricas: {},
        };
      }
      deteccaoMs += processamento.metricas.duracaoDeteccaoMs ?? 0;
      poseMs += processamento.metricas.duracaoPoseMs ?? 0;
      maosMs += processamento.metricas.duracaoMaosMs ?? 0;
      nsfwMs += processamento.metricas.duracaoNsfwMs ?? 0;

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
          nsfw: processamento.nsfw,
          inferidoEm: agoraIso(),
          metricas: processamento.metricas,
        })
      );
    }

    // 2.5) Leitura temporal consolidada (motor com estado entre ciclos). Uma
    // falha do motor e isolada como etapa `temporal`: o ciclo segue com o
    // resumo vazio em vez de derrubar a interpretacao.
    let temporalMs = 0;
    if (deps.motorTemporal && observacoes.length > 0) {
      const inicioTemporal = agora();
      try {
        resumoTemporal = deps.motorTemporal.processar(observacoes);
      } catch (err) {
        erros.push({ etapa: "temporal", mensagem: (err as Error).message });
      }
      temporalMs = Math.round(agora() - inicioTemporal);
    }

    // 3) Pacote do ciclo: fronteira entre analise local e interpretacao.
    const pacote: PacoteCiclo = {
      sessionId: deps.sessaoId,
      cycleId,
      iniciadoEm,
      concluidoEm: agoraIso(),
      observacoes,
      eventosTemporais: resumoTemporal.eventos,
      resumoTemporal,
      metricas: {
        capturaMs,
        deteccaoMs,
        poseMs,
        maosMs,
        ...(nsfwMs > 0 ? { nsfwMs } : {}),
        temporalMs,
        totalMs: Math.round(agora() - inicioMs),
      },
    };
    metricas = pacote.metricas;

    // 4) Interpretacao multimodal sobre o pacote (sem nova captura).
    const resultado = await deps.interpretador.interpretar(pacote, sinal);
    pacote.metricas.multimodalMs = resultado.duracaoMs;
    pacote.metricas.totalMs = Math.round(agora() - inicioMs);

    // 5) Diagnostico persistido (Etapa 8). A falha de gravacao nao derruba o
    // ciclo: entra em `erros` como `persistencia`.
    const saida: ResultadoCiclo = {
      pacote,
      interpretacao: resultado.resumo,
      erros,
      cancelado: false,
    };
    pacote.metricas.persistenciaMs = await persistirDiagnostico(deps, saida, erros);
    pacote.metricas.totalMs = Math.round(agora() - inicioMs);

    return saida;
  } catch (err) {
    // 6) Falha/cancelamento: nao reter imagens em memoria, mas registrar o
    // diagnostico do ciclo incompleto para que a falha nao se perca.
    deps.store.limpar();
    await persistirDiagnostico(
      deps,
      {
        pacote: {
          sessionId: deps.sessaoId,
          cycleId,
          iniciadoEm,
          concluidoEm: agoraIso(),
          observacoes,
          eventosTemporais: resumoTemporal.eventos,
          resumoTemporal,
          metricas,
        },
        erros,
        cancelado: ehCancelamento(err) || sinal?.aborted === true,
      },
      erros
    );
    throw err;
  }
}
