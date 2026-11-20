import type { PessoaPose } from "../../../src/domain";
import type { MaquinaSinais } from "../maquina-sinais";
import type { Entidade } from "../rastreador-entidades";
import type { ConfigMotorTemporal } from "../contracts";
import { ARTICULACOES_BRACO, arredondar, continuidadeDaEntidade, pontoConfiavel, punhoErguido } from "../motor-temporal-regras";

export function montarLeiturasBraco(
  pessoasVivas: readonly Entidade[],
  maquinaBraco: MaquinaSinais,
  config: ConfigMotorTemporal,
  poses: PessoaPose[],
  timestamp: string,
  frameId: string,
  cycleId: string
) {
  const porEntidade = new Map<string, PessoaPose>();
  for (const pose of poses) {
    if (pose.entidadeId) porEntidade.set(pose.entidadeId, pose);
  }
  return pessoasVivas.map((entidade) => {
    const pose = porEntidade.get(entidade.entidadeId);
    // Histerese: se o sinal ja esta ativo para a entidade, o punho continua
    // contando como erguido com um limiar mais folgado (`limiar + histerese`).
    const jaAtivo = maquinaBraco.estaAtivo(entidade.entidadeId);
    const limiar =
      config.limiarAlturaBraco + (jaAtivo ? config.histereseBraco : 0);
    const confianca = pose
      ? punhoErguido(pose, limiar, config.confiancaMinimaPontoBraco)
      : null;
    return {
      entidadeId: entidade.entidadeId,
      rotulo: confianca ? "levantado" : null,
      confianca: confianca?.confianca ?? 0,
      frameId,
      timestamp,
      cycleId,
      // Sem pose da entidade neste frame, a leitura apenas preserva a
      // ausencia de sinal; nao conta como observacao da entidade. A ausencia
      // nao invalida a continuidade ja observada: quem explica o fim e o
      // motivo de encerramento (`oclusao`), nao um intervalo invalido.
      observada: pose !== undefined,
      continuidadeValida: pose !== undefined ? continuidadeDaEntidade(entidade) : true,
      evidencias: confianca ? ["pose:ombro+cotovelo+punho"] : [],
    };
  });
}

export function montarLeiturasMovimento(
  pessoasVivas: readonly Entidade[],
  config: ConfigMotorTemporal,
  timestamp: string,
  frameId: string,
  cycleId: string
) {
  const limiar = config.limiarVelocidadeCorporal;
  return pessoasVivas.map((entidade) => {
    // Movimento e velocidade por segundo em intervalo valido; entidade
    // ausente ou intervalo invalido nao "se moveu".
    const velocidadeValida =
      entidade.framesAusente === 0 && entidade.velocidadeValida;
    const movimento = velocidadeValida && entidade.velocidade >= limiar;
    return {
      entidadeId: entidade.entidadeId,
      rotulo: movimento ? "movimento" : null,
      confianca: movimento ? 1 : 0,
      frameId,
      timestamp,
      cycleId,
      observada: entidade.framesAusente === 0,
      continuidadeValida: continuidadeDaEntidade(entidade),
      evidencias: velocidadeValida
        ? [`velocidade:${arredondar(entidade.velocidade)}/s`]
        : ["velocidade:invalida"],
    };
  });
}

/**
 * Le transicoes de acao pelo movimento vertical do punho.
 *
 * A postura `braco_levantado` continua sendo "punho erguido mantido"; aqui o
 * evento e o **deslocamento** que leva de uma postura a outra. Cada punho tem
 * sua propria amostra anterior, e o intervalo precisa ser positivo e nao
 * excessivamente longo para a velocidade ser valida.
 */
export function montarLeiturasTransicao(
  pessoasVivas: readonly Entidade[],
  punhos: Map<string, { y: number; tempoMs: number }>,
  config: ConfigMotorTemporal,
  poses: PessoaPose[],
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
    let melhor: { rotulo: string; confianca: number; velocidadeY: number } | null = null;
    let continuidadeValida = continuidadeDaEntidade(entidade);

    if (pose && poseDisponivel) {
      for (const { punho } of ARTICULACOES_BRACO) {
        const ponto = pontoConfiavel(
          pose.pontos[punho],
          config.confiancaMinimaPontoBraco
        );
        if (!ponto) continue;
        const chave = `${entidade.entidadeId}:${punho}`;
        const anterior = punhos.get(chave);
        punhos.set(chave, { y: ponto.y, tempoMs });
        if (!anterior) continue;

        const intervaloMs = tempoMs - anterior.tempoMs;
        const intervaloValido =
          Number.isFinite(intervaloMs) &&
          intervaloMs > 0 &&
          intervaloMs <= config.rastreador.maxTempoAusenteMs;
        if (!intervaloValido) {
          continuidadeValida = false;
          continue;
        }

        const velocidadeY = ((ponto.y - anterior.y) * 1000) / intervaloMs;
        const rotulo =
          velocidadeY <= -config.limiarVelocidadeTransicaoBraco
            ? "braco_subindo"
            : velocidadeY >= config.limiarVelocidadeTransicaoBraco
              ? "braco_descendo"
              : null;
        if (!rotulo) continue;
        const confianca = ponto.confianca ?? 0.8;
        if (!melhor || Math.abs(velocidadeY) > Math.abs(melhor.velocidadeY)) {
          melhor = { rotulo, confianca, velocidadeY };
        }
      }
    }

    return {
      entidadeId: entidade.entidadeId,
      rotulo: melhor?.rotulo ?? null,
      confianca: melhor?.confianca ?? 0,
      frameId,
      timestamp,
      cycleId,
      observada: pose !== undefined,
      continuidadeValida,
      evidencias: melhor
        ? [`velocidadeY:${arredondar(melhor.velocidadeY)}/s`]
        : pose
          ? ["velocidadeY:abaixo_do_limiar"]
          : [],
    };
  });
}
