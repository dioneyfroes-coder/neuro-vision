import { ehCancelamento } from "../../../../src/erros";
import { estaIndisponivel, indisponivel } from "../../../../src/domain/perception";
import { planejarAmostragem, resumirAmostragem } from "../../../../src/domain/cadencia";
import type {
  ErroEtapa,
  MetricasCiclo,
  PoliticaCicloAplicada,
  SubsistemaMetricaCiclo,
} from "../../../../src/domain/cycle";
import type { ObservacaoFrame } from "../../../../src/domain/observation";
import {
  CONCORRENCIA_FRAMES_PADRAO,
  mapearConcorrente,
} from "../concorrencia";
import { cancelado } from "../persistencia";
import type { DependenciasCicloMultiframe } from "../tipos";
import type { FrameProcessado } from "./tipos-internos";

export interface ResultadoProcessamentoQuadros {
  observacoes: ObservacaoFrame[];
  percepcaoTotalMs: number;
  percepcaoConcluidaEm: string;
  deteccaoMs: number;
  poseMs: number;
  maosMs: number;
  nsfwMs: number;
  inferenciaPorSnapshotMs: Partial<Record<SubsistemaMetricaCiclo, number>>;
  resultadosPercepcao: NonNullable<MetricasCiclo["resultadosPercepcao"]>;
  amostragem: MetricasCiclo["amostragem"];
}

export async function processarQuadros(args: {
  deps: DependenciasCicloMultiframe;
  sinal: AbortSignal | undefined;
  cycleId: string;
  politica: PoliticaCicloAplicada | undefined;
  agora: () => number;
  agoraIso: () => string;
  erros: ErroEtapa[];
  registrarMemoria: (bytes: number | undefined) => void;
}): Promise<ResultadoProcessamentoQuadros> {
  const { deps, sinal, cycleId, politica, agora, agoraIso, erros, registrarMemoria } = args;
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
            // subsistema rodaria (toggle) - "indeterminado" != "indisponivel".
            metricas: {},
          },
        };
      }
    }
  );

  const observacoes: ObservacaoFrame[] = [];
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

  const inferenciaPorSnapshotMs: Partial<Record<SubsistemaMetricaCiclo, number>> = {};
  for (const subsistema of ["deteccao", "pose", "maos", "nsfw"] as const) {
    if (inferenciaContagem[subsistema] > 0) {
      inferenciaPorSnapshotMs[subsistema] = Math.round(
        inferenciaSoma[subsistema] / inferenciaContagem[subsistema]
      );
    }
  }

  return {
    observacoes,
    percepcaoTotalMs,
    percepcaoConcluidaEm,
    deteccaoMs,
    poseMs,
    maosMs,
    nsfwMs,
    inferenciaPorSnapshotMs,
    resultadosPercepcao,
    amostragem: resumirAmostragem(timestampsCaptura, planoAmostragem, politica?.cadencia),
  };
}
