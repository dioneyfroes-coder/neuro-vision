import { ehCancelamento } from "../../../src/erros";
import { estaIndisponivel, indisponivel } from "../../../src/domain/perception";
import { planejarAmostragem, resumirAmostragem } from "../../../src/domain/cadencia";
import type {
  ErroEtapa,
  MetricasCiclo,
  PacoteCiclo,
  ResultadoCiclo,
  ResumoTemporal,
  SubsistemaMetricaCiclo,
} from "../../../src/domain/cycle";
import type { ObservacaoFrame } from "../../../src/domain/observation";
import { amostrarMemoriaBytes } from "../../perception/contracts";
import {
  CONCORRENCIA_FRAMES_PADRAO,
  mapearConcorrente,
} from "./concorrencia";
import { cancelado, persistirDiagnostico } from "./persistencia";
import type {
  DependenciasCicloMultiframe,
  ProcessamentoFrame,
} from "./tipos";

/**
 * Resultado interno do processamento concorrente de um frame: o `processamento`
 * sempre existe; `falha` so aparece quando o processador lancou (o fallback
 * marca os subsistemas como `indisponivel`). Permite preservar a ordem das
 * observacoes independentemente da ordem de conclusao.
 */
interface FrameProcessado {
  processamento: ProcessamentoFrame;
  falha?: string;
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
  const politica = deps.obterPolitica?.();
  const configuracao = deps.obterConfiguracaoCiclo?.();

  const erros: ErroEtapa[] = [];
  // Declarado fora do try para que o diagnostico de um ciclo incompleto
  // (catch) tambem possa registrar o que ja foi observado.
  const observacoes: ObservacaoFrame[] = [];
  // Copias enriquecidas com IDs de rastreamento; alimentam o pacote/contexto.
  let observacoesEnriquecidas: ObservacaoFrame[] = observacoes;
  let resumoTemporal: ResumoTemporal = {
    eventos: [],
    tracksAtivos: 0,
    pessoasAtivas: 0,
    maosAtivas: 0,
    objetosAtivos: 0,
  };
  // Contexto de custo comum a todos os desfechos do ciclo (sucesso, sem frame
  // ou falha): carga fria da sessao, intervalo desde o ciclo anterior e memoria.
  const latenciaEntreCiclosMs = deps.obterLatenciaEntreCiclosMs?.();
  const cargaModelos = deps.obterCargaModelos?.();
  let memoriaMaximaBytes = amostrarMemoriaBytes();
  const registrarMemoria = (bytes: number | undefined): void => {
    if (bytes === undefined || !Number.isFinite(bytes)) return;
    if (memoriaMaximaBytes === undefined || bytes > memoriaMaximaBytes) {
      memoriaMaximaBytes = bytes;
    }
  };
  let metricas: MetricasCiclo = {};
  if (
    latenciaEntreCiclosMs !== undefined &&
    Number.isFinite(latenciaEntreCiclosMs) &&
    latenciaEntreCiclosMs >= 0
  ) {
    metricas.latenciaEntreCiclosMs = Math.round(latenciaEntreCiclosMs);
  }
  if (cargaModelos) metricas.cargaModelos = cargaModelos;
  if (memoriaMaximaBytes !== undefined) {
    metricas.memoriaMaximaBytes = memoriaMaximaBytes;
  }

  try {
    if (sinal?.aborted) throw cancelado();

    // 1) Captura identificada (sem inferencia).
    const capturados = await deps.captura.capturar(cycleId, sinal);
    deps.store.limpar();
    for (const snapshot of capturados) deps.store.adicionar(snapshot);
    const capturaMs = Math.round(agora() - inicioMs);
    const capturaConcluidaEm = agoraIso();

    if (capturados.length === 0) {
      // Camera ainda sem frame: nao ha evidencia a interpretar. Nao e falha,
      // apenas um instante sem imagem (mesma semantica do ciclo de frame unico).
      const concluidoEm = agoraIso();
      return {
        pacote: {
          sessionId: deps.sessaoId,
          cycleId,
          iniciadoEm,
          concluidoEm,
          observacoes: [],
          eventosTemporais: [],
          resumoTemporal: {
            eventos: [],
            tracksAtivos: 0,
            pessoasAtivas: 0,
            maosAtivas: 0,
            objetosAtivos: 0,
          },
          politica,
          configuracao,
          metricas: {
            ...metricas,
            capturaMs,
            capturaConcluidaEm,
            concluidoEm,
            totalMs: Math.round(agora() - inicioMs),
          },
        },
        erros,
        cancelado: false,
      };
    }

    // 2) Processamento local do conjunto, depois da captura. Os frames sao
    // processados com **concorrencia limitada** (nao em serie): cada frame ja
    // tem seus subsistemas em paralelo (pipeline), e varios frames avancam
    // juntos sem estourar a memoria/CPU. A ordem das observacoes e preservada
    // (a associacao resultado<->snapshot e indexada), entao a semantica do ciclo
    // nao depende da ordem de conclusao.
    const quadros = deps.store.quadros;
    // Cadencia independente por subsistema (Fase 1.3): o plano e derivado dos
    // timestamps, antes do processamento, para nao depender da ordem de
    // conclusao dos frames. Sem `politica.cadencia`, todos rodam em todos.
    const timestampsCaptura = quadros.map((quadro) => quadro.capturadoEmMs);
    const planoAmostragem = planejarAmostragem(timestampsCaptura, politica?.cadencia);
    const concorrencia = Math.max(1, deps.concorrenciaFrames ?? CONCORRENCIA_FRAMES_PADRAO);
    let deteccaoMs = 0;
    let poseMs = 0;
    let maosMs = 0;
    let nsfwMs = 0;
    // Custo aquecido por snapshot, separado por subsistema. So entra a
    // inferencia que de fato rodou e entregou resultado (o pipeline ja zera o
    // tempo quando o subsistema falhou/esta desativado).
    const inferenciaSoma: Record<SubsistemaMetricaCiclo, number> = {
      deteccao: 0,
      pose: 0,
      maos: 0,
      nsfw: 0,
    };
    const inferenciaContagem: Record<SubsistemaMetricaCiclo, number> = {
      deteccao: 0,
      pose: 0,
      maos: 0,
      nsfw: 0,
    };
    const resultadosPercepcao = {
      deteccao: { quadrosValidos: 0, deteccoes: 0 },
      pose: { quadrosValidos: 0, pessoas: 0, keypoints: 0, pessoasCom17Keypoints: 0 },
      maos: { quadrosValidos: 0, maos: 0, landmarks: 0, maosCom21Landmarks: 0 },
    };
    const inicioPercepcao = agora();

    const processados = await mapearConcorrente(
      quadros,
      concorrencia,
      async (snapshot, indice): Promise<FrameProcessado> => {
        try {
          return {
            processamento: await deps.processarFrame(
              snapshot,
              sinal,
              planoAmostragem[indice]
            ),
          };
        } catch (err) {
          if (ehCancelamento(err) || sinal?.aborted) throw cancelado();
          const mensagem = (err as Error).message;
          return {
            falha: mensagem,
            processamento: {
              deteccoes: indisponivel("deteccao", mensagem),
              pose: indisponivel("pose", mensagem),
              maos: indisponivel("maos", mensagem),
              // NSFW omitido no fallback: sem processamento nao ha como saber se o
              // subsistema rodaria (toggle) — "indeterminado" != "indisponivel".
              metricas: {},
            },
          };
        }
      }
    );

    for (const [i, item] of processados.entries()) {
      const snapshot = quadros[i];
      if (item.falha !== undefined) erros.push({ etapa: "deteccao", mensagem: item.falha });
      const processamento = item.processamento;
      deteccaoMs += processamento.metricas.duracaoDeteccaoMs ?? 0;
      poseMs += processamento.metricas.duracaoPoseMs ?? 0;
      maosMs += processamento.metricas.duracaoMaosMs ?? 0;
      nsfwMs += processamento.metricas.duracaoNsfwMs ?? 0;

      if (!estaIndisponivel(processamento.deteccoes)) {
        resultadosPercepcao.deteccao.quadrosValidos += 1;
        resultadosPercepcao.deteccao.deteccoes += processamento.deteccoes.deteccoes.length;
      }
      if (!estaIndisponivel(processamento.pose)) {
        resultadosPercepcao.pose.quadrosValidos += 1;
        resultadosPercepcao.pose.pessoas += processamento.pose.pessoas.length;
        for (const pessoa of processamento.pose.pessoas) {
          resultadosPercepcao.pose.keypoints += pessoa.pontos.length;
          if (pessoa.pontos.length === 17) {
            resultadosPercepcao.pose.pessoasCom17Keypoints += 1;
          }
        }
      }
      if (!estaIndisponivel(processamento.maos)) {
        resultadosPercepcao.maos.quadrosValidos += 1;
        resultadosPercepcao.maos.maos += processamento.maos.maos.length;
        for (const mao of processamento.maos.maos) {
          resultadosPercepcao.maos.landmarks += mao.landmarks.length;
          if (mao.landmarks.length === 21) {
            resultadosPercepcao.maos.maosCom21Landmarks += 1;
          }
        }
      }

      // Telemetria por subsistema: acumula inferencia aquecida e memoria. O
      // `tempoInferenciaMs` so existe quando a inferencia devolveu resultado
      // valido; ausente nao vira zero na media.
      const subsistemas = processamento.metricas.subsistemas;
      if (subsistemas) {
        for (const subsistema of ["deteccao", "pose", "maos", "nsfw"] as const) {
          const telemetria = subsistemas[subsistema];
          if (!telemetria) continue;
          const inferencia = telemetria.tempoInferenciaMs;
          if (inferencia !== undefined && Number.isFinite(inferencia) && inferencia >= 0) {
            inferenciaSoma[subsistema] += inferencia;
            inferenciaContagem[subsistema] += 1;
          }
          registrarMemoria(telemetria.memoriaBytes);
        }
      }

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
    const percepcaoTotalMs = Math.round(agora() - inicioPercepcao);
    const percepcaoConcluidaEm = agoraIso();
    registrarMemoria(amostrarMemoriaBytes());

    const inferenciaPorSnapshotMs: Partial<Record<SubsistemaMetricaCiclo, number>> = {};
    for (const subsistema of ["deteccao", "pose", "maos", "nsfw"] as const) {
      if (inferenciaContagem[subsistema] > 0) {
        inferenciaPorSnapshotMs[subsistema] = Math.round(
          inferenciaSoma[subsistema] / inferenciaContagem[subsistema]
        );
      }
    }
    metricas.percepcaoTotalMs = percepcaoTotalMs;
    metricas.resultadosPercepcao = resultadosPercepcao;
    metricas.amostragem = resumirAmostragem(
      timestampsCaptura,
      planoAmostragem,
      politica?.cadencia
    );
    if (Object.keys(inferenciaPorSnapshotMs).length > 0) {
      metricas.inferenciaPorSnapshotMs = inferenciaPorSnapshotMs;
    }
    if (memoriaMaximaBytes !== undefined) {
      metricas.memoriaMaximaBytes = memoriaMaximaBytes;
    }

    // 2.5) Leitura temporal consolidada (motor com estado entre ciclos). Uma
    // falha do motor e isolada como etapa `temporal`: o ciclo segue com o
    // resumo vazio em vez de derrubar a interpretacao.
    let temporalMs = 0;
    let temporalConcluidoEm: string | undefined;
    if (deps.motorTemporal && observacoes.length > 0) {
      const inicioTemporal = agora();
      try {
        const resultado = deps.motorTemporal.processar(observacoes);
        const { observacoes: enriquecidas, ...resumo } = resultado;
        resumoTemporal = resumo;
        // Um motor que nao devolve copias enriquecidas nao pode zerar as
        // observacoes do ciclo: preserva as originais como fallback.
        observacoesEnriquecidas = enriquecidas ?? observacoes;
      } catch (err) {
        erros.push({ etapa: "temporal", mensagem: (err as Error).message });
      }
      temporalMs = Math.round(agora() - inicioTemporal);
      temporalConcluidoEm = agoraIso();
    }

    // 3) Pacote do ciclo: fronteira entre analise local e interpretacao.
    // `concluidoEm` so entra no passo 5, imediatamente antes da persistencia:
    // aqui a interpretacao e a gravacao ainda vao rodar.
    const pacote: PacoteCiclo = {
      sessionId: deps.sessaoId,
      cycleId,
      iniciadoEm,
      observacoes: observacoesEnriquecidas,
      eventosTemporais: resumoTemporal.eventos,
      resumoTemporal,
      politica,
      configuracao,
      metricas: {
        ...metricas,
        capturaMs,
        capturaConcluidaEm,
        percepcaoConcluidaEm,
        deteccaoMs,
        poseMs,
        maosMs,
        ...(nsfwMs > 0 ? { nsfwMs } : {}),
        temporalMs,
        ...(temporalConcluidoEm ? { temporalConcluidoEm } : {}),
        totalMs: Math.round(agora() - inicioMs),
      },
    };
    const timestamps = observacoesEnriquecidas
      .map((o) => o.capturadoEmMs)
      .filter((v) => Number.isFinite(v));
    if (timestamps.length >= 2) {
      pacote.metricas.janelaCapturaMs = Math.round(
        Math.max(...timestamps) - Math.min(...timestamps)
      );
    } else if (timestamps.length === 1) {
      pacote.metricas.janelaCapturaMs = 0;
    }
    metricas = pacote.metricas;

    // 4) Interpretacao multimodal sobre o pacote (sem nova captura). A politica
    // (item 5) pode suprimir a chamada; a supressao nao e falha — o motivo fica
    // registrado e o ciclo continua valido.
    let interpretacao: string | undefined;
    const decisao = deps.decidirInterpretacao?.(resumoTemporal);
    if (decisao && !decisao.interpretar) {
      if (decisao.motivo) pacote.metricas.interpretacaoSuprimida = decisao.motivo;
    } else {
      const resultado = await deps.interpretador.interpretar(pacote, sinal);
      pacote.metricas.multimodalMs = resultado.duracaoMs;
      if (resultado.contextoMultimodal) {
        pacote.metricas.contextoMultimodal = resultado.contextoMultimodal;
      }
      pacote.metricas.interpretacaoConcluidaEm = agoraIso();
      if (configuracao) {
        configuracao.modeloMultimodalEfetivo =
          resultado.modelo ?? deps.interpretador.modelo ?? undefined;
      }
      // Latencia real ate a resposta multimodal: inclui captura, percepcao e a
      // propria chamada remota. So existe quando houve resposta (nao suprimida
      // pela politica e sem erro).
      pacote.metricas.latenciaAteRespostaMultimodalMs = Math.round(agora() - inicioMs);
      interpretacao = resultado.resumo;
    }
    registrarMemoria(amostrarMemoriaBytes());
    if (memoriaMaximaBytes !== undefined) {
      pacote.metricas.memoriaMaximaBytes = memoriaMaximaBytes;
    }
    pacote.metricas.totalMs = Math.round(agora() - inicioMs);

    // 5) Diagnostico persistido (Etapa 8). A falha de gravacao nao derruba o
    // ciclo: entra em `erros` como `persistencia`.
    const saida: ResultadoCiclo = {
      pacote,
      interpretacao,
      erros,
      cancelado: false,
    };
    // O registro persistido precisa carregar o instante de conclusao. Usamos o
    // instante imediatamente anterior a gravacao (a diferenca sera o custo da
    // propria persistencia) e, no fim, atualizamos o pacote com o instante
    // efetivo - assim o JSONL nao fica sem `concluidoEm`.
    const antesDaPersistencia = agoraIso();
    pacote.concluidoEm = antesDaPersistencia;
    pacote.metricas.concluidoEm = antesDaPersistencia;
    pacote.metricas.persistenciaMs = await persistirDiagnostico(deps, saida, erros);
    pacote.metricas.persistenciaConcluidaEm = agoraIso();
    // Conclusao efetiva: depois da interpretacao e da persistencia.
    const concluidoEm = agoraIso();
    pacote.concluidoEm = concluidoEm;
    pacote.metricas.concluidoEm = concluidoEm;
    pacote.metricas.totalMs = Math.round(agora() - inicioMs);

    return saida;
  } catch (err) {
    // 6) Falha/cancelamento: nao reter imagens em memoria, mas registrar o
    // diagnostico do ciclo incompleto para que a falha nao se perca.
    deps.store.limpar();
    const concluidoEm = agoraIso();
    registrarMemoria(amostrarMemoriaBytes());
    const metricasFinais: MetricasCiclo = { ...metricas, concluidoEm };
    if (memoriaMaximaBytes !== undefined) {
      metricasFinais.memoriaMaximaBytes = memoriaMaximaBytes;
    }
    await persistirDiagnostico(
      deps,
      {
        pacote: {
          sessionId: deps.sessaoId,
          cycleId,
          iniciadoEm,
          concluidoEm,
          observacoes: observacoesEnriquecidas,
          eventosTemporais: resumoTemporal.eventos,
          resumoTemporal,
          politica,
          configuracao,
          metricas: metricasFinais,
        },
        erros,
        cancelado: ehCancelamento(err) || sinal?.aborted === true,
      },
      erros
    );
    throw err;
  } finally {
    // Base da latencia entre ciclos. Roda tambem nos caminhos de "sem frame" e
    // de falha/cancelamento, para que o proximo ciclo nao herde uma referencia
    // antiga indefinidamente.
    deps.registrarFimCiclo?.(agora());
  }
}