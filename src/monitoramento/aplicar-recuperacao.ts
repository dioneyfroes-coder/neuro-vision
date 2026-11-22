/**
 * Aplicação da recuperação de monitoramento na subida do processo (Fase 7).
 *
 * O planejamento é puro (`recuperacao-monitoramento.ts`); aqui ele é executado
 * contra o índice append-only: sessões abandonadas viram `interrompida`,
 * segmentos abertos viram `incompleto` com lacuna explícita, e a ausência de
 * arquivo de vídeo é **sinalizada**, nunca tratada como gravação perdida ou
 * concluída. Nada é apagado; o histórico segue auditável.
 */
import type { RegistradorAuditoria } from "../domain/auditoria";
import {
  gravarSegmentoMonitoramento,
  gravarSessaoMonitoramento,
  lerSegmentosMonitoramento,
  lerSessoesMonitoramento,
} from "../persistence/repositorio-monitoramento";
import {
  planejarRecuperacaoMonitoramento,
  type PlanoRecuperacaoMonitoramento,
} from "./recuperacao-monitoramento";
import {
  LIMITE_INDICE_MONITORAMENTO_PADRAO,
  MAX_BYTES_INDICE_MONITORAMENTO_PADRAO,
} from "./servico-monitoramento/tipos";

/** Metadado mínimo dos arquivos já presentes no armazenador de vídeos. */
export interface ArquivoVideoParaRecuperacao {
  segmentoId: string;
}

export interface OpcoesAplicacaoRecuperacao {
  sessoesFile: string;
  segmentosFile: string;
  arquivosVideo: readonly ArquivoVideoParaRecuperacao[];
  agoraMs?: number;
  maxBytes?: number;
  limiteIndice?: number;
  auditar?: RegistradorAuditoria;
}

export interface ResultadoAplicacaoRecuperacao {
  plano: PlanoRecuperacaoMonitoramento;
  sessoesAtualizadas: number;
  segmentosAtualizados: number;
}

/**
 * Reconcilia o índice durável com o estado real na subida. Idempotente: uma
 * segunda chamada não encontra sessões ativas nem segmentos `gravando`, então
 * não acrescenta registros nem lacunas duplicadas.
 */
export async function aplicarRecuperacaoMonitoramento(
  opcoes: OpcoesAplicacaoRecuperacao
): Promise<ResultadoAplicacaoRecuperacao> {
  const agoraMs = opcoes.agoraMs ?? Date.now();
  const maxBytes = opcoes.maxBytes ?? MAX_BYTES_INDICE_MONITORAMENTO_PADRAO;
  const limite = opcoes.limiteIndice ?? LIMITE_INDICE_MONITORAMENTO_PADRAO;

  const [sessoes, segmentos] = await Promise.all([
    lerSessoesMonitoramento(opcoes.sessoesFile, limite),
    lerSegmentosMonitoramento(opcoes.segmentosFile, limite),
  ]);
  const plano = planejarRecuperacaoMonitoramento({
    sessoes,
    segmentos,
    arquivosVideo: opcoes.arquivosVideo,
    agoraMs,
  });

  let sessoesAtualizadas = 0;
  let segmentosAtualizados = 0;
  for (const recuperacao of plano.recuperacoes) {
    await gravarSessaoMonitoramento(recuperacao.recuperada, opcoes.sessoesFile, maxBytes);
    sessoesAtualizadas += 1;
    for (const item of recuperacao.segmentos) {
      await gravarSegmentoMonitoramento(item.recuperado, opcoes.segmentosFile, maxBytes);
      segmentosAtualizados += 1;
    }
  }
  for (const item of plano.segmentosOrfaos) {
    await gravarSegmentoMonitoramento(item.recuperado, opcoes.segmentosFile, maxBytes);
    segmentosAtualizados += 1;
  }

  opcoes.auditar?.({
    acao: "recuperacao_monitoramento",
    resultado: "sucesso",
    alvo: "indice-monitoramento",
    detalhe: {
      sessoesAtualizadas,
      segmentosIncompletos: plano.segmentosIncompletos.length,
      uploadsPendentes: plano.uploadsPendentes.length,
      observacoes: plano.observacoes.join(";"),
    },
  });

  return { plano, sessoesAtualizadas, segmentosAtualizados };
}
