import { calcularGeometriaMao, classificarGestoGeometrico, combinarGesto, estabilizarDedos, estadosDosDedos, type EstadoDedos, type MaoDetectada, type PessoaPose } from "../../../src/domain";
import type { AvaliadorPoseSexual } from "../regras-pose";
import type { Entidade } from "../rastreador-entidades";
import type { ConfigMotorTemporal } from "../contracts";
import { continuidadeDaEntidade } from "../motor-temporal-regras";

/**
 * Le as regras geometricas de pose compativel por pessoa rastreada.
 *
 * O avaliador mantem apenas o historico de ritmo do punho; as demais regras
 * sao avaliadas no frame. Sem pose da entidade, a leitura preserva a ausencia
 * de sinal (a maquina decide se e oclusao ou apenas tolerancia do rastreador).
 */
export function montarLeiturasPoseSexual(
  pessoasVivas: readonly Entidade[],
  avaliadorPose: AvaliadorPoseSexual,
  poses: PessoaPose[],
  maos: MaoDetectada[],
  tempoMs: number,
  timestamp: string,
  frameId: string,
  cycleId: string,
  poseDisponivel: boolean
) {
  const porEntidade = new Map<string, PessoaPose>();
  for (const pose of poses) {
    if (pose.entidadeId) porEntidade.set(pose.entidadeId, pose);
  }
  return pessoasVivas.map((entidade) => {
    const pose = porEntidade.get(entidade.entidadeId);
    const resultado =
      pose && poseDisponivel
        ? avaliadorPose.avaliar(pose, maos, tempoMs)
        : null;
    return {
      entidadeId: entidade.entidadeId,
      rotulo: resultado?.compativel ? "pose_compativel" : null,
      confianca: resultado?.confianca ?? 0,
      frameId,
      timestamp,
      cycleId,
      observada: pose !== undefined,
      continuidadeValida: pose !== undefined ? continuidadeDaEntidade(entidade) : true,
      evidencias: resultado?.evidencias ?? (pose ? ["pose:sem_regra"] : []),
    };
  });
}

export function montarLeiturasGesto(
  maosVivas: readonly Entidade[],
  dedosPorEntidade: Map<string, EstadoDedos>,
  config: ConfigMotorTemporal,
  maos: MaoDetectada[],
  timestamp: string,
  frameId: string,
  cycleId: string,
  dimensoesFrame?: { largura: number; altura: number }
) {
  const porEntidade = new Map<string, MaoDetectada>();
  for (const mao of maos) {
    if (mao.entidadeId) porEntidade.set(mao.entidadeId, mao);
  }
  return maosVivas.map((entidade) => {
    const mao = porEntidade.get(entidade.entidadeId);
    if (!mao) {
      return {
        entidadeId: entidade.entidadeId,
        rotulo: null,
        confianca: 0,
        frameId,
        timestamp,
        cycleId,
        // Mao ainda na janela de tolerancia do rastreador nao e observacao.
        // A ausencia e registrada por `observada: false`; nao invalida a
        // continuidade das evidencias anteriores (o fim e `oclusao`).
        observada: false,
        continuidadeValida: true,
        evidencias: ["mao:nao_observada"],
      };
    }

    const geometria =
      mao.landmarks.length > 0
        ? calcularGeometriaMao(mao.landmarks, { dimensoes: dimensoesFrame })
        : null;
    const estabilizada = geometria
      ? estabilizarDedos(
          geometria,
          dedosPorEntidade.get(entidade.entidadeId),
          config.histereseAnguloDedoGraus
        )
      : null;
    if (estabilizada) {
      dedosPorEntidade.set(entidade.entidadeId, estadosDosDedos(estabilizada));
    }
    const geometrico = classificarGestoGeometrico(estabilizada, mao.landmarks);
    const combinado = combinarGesto(
      mao.gesto?.nome,
      mao.gesto?.confianca ?? 0,
      geometrico
    );

    return {
      entidadeId: entidade.entidadeId,
      rotulo: combinado.rotulo,
      confianca: combinado.confianca,
      frameId,
      timestamp,
      cycleId,
      observada: true,
      continuidadeValida: continuidadeDaEntidade(entidade),
      evidencias: combinado.evidencias,
    };
  });
}
