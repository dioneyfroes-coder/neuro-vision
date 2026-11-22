import { ehCancelamento } from "../../../../src/erros";
import { medirCustoMultimodal } from "../../../../src/domain/custo-multimodal";
import type {
  ErroEtapa,
  MetricasCiclo,
  PacoteCiclo,
  ResultadoCiclo,
  ResumoTemporal,
} from "../../../../src/domain/cycle";
import type { ObservacaoFrame } from "../../../../src/domain/observation";
import { amostrarMemoriaBytes } from "../../../perception/contracts";
import { cancelado, persistirDiagnostico } from "../persistencia";
import type { DependenciasCicloMultiframe } from "../tipos";
import { processarQuadros } from "./processar-quadros";

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
    // juntos sem estourar a memoria/CPU. A ordem das observacoes e preservada.
    const resultadoPercepcao = await processarQuadros({
      deps,
      sinal,
      cycleId,
      politica,
      agora,
      agoraIso,
      erros,
      registrarMemoria,
    });
    observacoes.push(...resultadoPercepcao.observacoes);
    observacoesEnriquecidas = observacoes;
    registrarMemoria(amostrarMemoriaBytes());

    metricas.percepcaoTotalMs = resultadoPercepcao.percepcaoTotalMs;
    metricas.resultadosPercepcao = resultadoPercepcao.resultadosPercepcao;
    metricas.amostragem = resultadoPercepcao.amostragem;
    if (Object.keys(resultadoPercepcao.inferenciaPorSnapshotMs).length > 0) {
      metricas.inferenciaPorSnapshotMs = resultadoPercepcao.inferenciaPorSnapshotMs;
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
        percepcaoConcluidaEm: resultadoPercepcao.percepcaoConcluidaEm,
        deteccaoMs: resultadoPercepcao.deteccaoMs,
        poseMs: resultadoPercepcao.poseMs,
        maosMs: resultadoPercepcao.maosMs,
        ...(resultadoPercepcao.nsfwMs > 0 ? { nsfwMs: resultadoPercepcao.nsfwMs } : {}),
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
    // (item 5) pode suprimir a chamada; a supressao nao e falha - o motivo fica
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
      const latenciaAteRespostaMs = Math.round(agora() - inicioMs);
      pacote.metricas.latenciaAteRespostaMultimodalMs = latenciaAteRespostaMs;
      if (resultado.tokens !== undefined) {
        pacote.metricas.tokensMultimodal = resultado.tokens;
      }
      const modeloEfetivo = resultado.modelo ?? deps.interpretador.modelo ?? undefined;
      pacote.metricas.custoMultimodal = medirCustoMultimodal({
        cycleId,
        eventoIds: decisao?.eventosRelevantes ?? [],
        modelo: modeloEfetivo,
        duracaoMs: resultado.duracaoMs,
        latenciaAteRespostaMs,
        tokens: resultado.tokens,
        versaoPrompt: resultado.versaoPrompt,
        precos: deps.obterPrecosMultimodal?.(),
        registradoEm: agoraIso(),
      });
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
