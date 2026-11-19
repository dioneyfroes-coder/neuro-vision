import {
  calcularGeometriaMao,
  classificarGestoGeometrico,
  combinarGesto,
  estabilizarDedos,
  estadosDosDedos,
  estaIndisponivel,
  type EstadoDedos,
  type MaoDetectada,
  type ObservacaoFrame,
  type PessoaPose,
} from "../../src/domain";
import type { AmostraInteracao } from "./interacao";
import type { AmostraPresenca } from "./presenca-pessoas";
import type { MaquinaSinais } from "./maquina-sinais";
import type { AvaliadorPoseSexual } from "./regras-pose";
import type { Entidade } from "./rastreador-entidades";
import type { ConfigMotorTemporal } from "./contracts";
import {
  ARTICULACOES_BRACO,
  arredondar,
  continuidadeDaEntidade,
  pontoConfiavel,
  punhoErguido,
} from "./motor-temporal-regras";

/**
 * Monta uma amostra por track de pose no frame. Tracks que continuam vivos
 * mas nao foram associados a nenhuma sonda entram como `observado: false`:
 * e essa distincao que permite histerese sem confundir oclusao com falha.
 */
export function montarAmostrasPresenca(
  pessoasVivas: readonly Entidade[],
  pessoas: PessoaPose[],
  sessionId: string,
  tempoMs: number,
  timestamp: string,
  frameId: string,
  cycleId: string
): AmostraPresenca[] {
  const porId = new Map<string, Entidade>();
  for (const entidade of pessoasVivas) {
    porId.set(entidade.entidadeId, entidade);
  }

  const amostras: AmostraPresenca[] = [];
  const vistos = new Set<string>();
  for (const pessoa of pessoas) {
    if (!pessoa.entidadeId) continue;
    const entidade = porId.get(pessoa.entidadeId);
    if (!entidade) continue;
    vistos.add(pessoa.entidadeId);
    const referencia = entidade.meta.referenciaPose;
    amostras.push({
      sessionId,
      entidadeId: pessoa.entidadeId,
      frameId,
      timestamp,
      tempoMs,
      cycleId,
      observado: entidade.estado === "ativa",
      continuidadeValida: continuidadeDaEntidade(entidade),
      confianca: pessoa.confianca ?? entidade.confianca,
      fonteReferencia: typeof referencia === "string" ? referencia : undefined,
    });
  }

  for (const entidade of pessoasVivas) {
    if (vistos.has(entidade.entidadeId)) continue;
    const referencia = entidade.meta.referenciaPose;
    amostras.push({
      sessionId,
      entidadeId: entidade.entidadeId,
      frameId,
      timestamp,
      tempoMs,
      cycleId,
      observado: false,
      continuidadeValida: continuidadeDaEntidade(entidade),
      confianca: entidade.confianca,
      fonteReferencia: typeof referencia === "string" ? referencia : undefined,
    });
  }

  return amostras;
}

/**
 * Monta uma amostra por par (mao, objeto) no frame. As caixas vem em pixels
 * e sao normalizadas pelas dimensoes da deteccao para compartilhar o espaco
 * dos landmarks da mao. Sem dimensoes, a comparacao nao e confiavel e o par
 * e descartado (melhor abster que afirmar proximidade em escalas distintas).
 */
export function montarAmostrasInteracao(
  maosVivas: readonly Entidade[],
  maos: MaoDetectada[],
  deteccoes: ObservacaoFrame["deteccoes"],
  dimensoes: { largura: number; altura: number } | undefined,
  sessionId: string,
  tempoMs: number,
  timestamp: string,
  frameId: string,
  cycleId: string
): AmostraInteracao[] {
  if (!dimensoes || estaIndisponivel(deteccoes)) return [];
  const { largura, altura } = dimensoes;
  if (!(largura > 0) || !(altura > 0)) return [];
  const continuidadePorMao = new Map<string, boolean>();
  for (const entidade of maosVivas) {
    continuidadePorMao.set(entidade.entidadeId, continuidadeDaEntidade(entidade));
  }
  const amostras: AmostraInteracao[] = [];
  for (const mao of maos) {
    if (!mao.entidadeId) continue;
    const punho = mao.landmarks[0];
    if (!punho || typeof punho.x !== "number" || typeof punho.y !== "number") continue;
    const confiancaMao = mao.gesto?.confianca ?? 0.8;
    for (const deteccao of deteccoes.deteccoes) {
      if (!deteccao.entidadeId) continue;
      amostras.push({
        sessionId,
        maoEntidadeId: mao.entidadeId,
        objetoEntidadeId: deteccao.entidadeId,
        rotuloObjeto: deteccao.nome || deteccao.rotulo || undefined,
        punhoMao: { x: punho.x, y: punho.y },
        caixaObjeto: {
          xmin: deteccao.caixa.xmin / largura,
          ymin: deteccao.caixa.ymin / altura,
          xmax: deteccao.caixa.xmax / largura,
          ymax: deteccao.caixa.ymax / altura,
        },
        confianca: Math.min(confiancaMao, deteccao.score),
        frameId,
        timestamp,
        tempoMs,
        cycleId,
        observado: true,
        continuidadeValida: continuidadePorMao.get(mao.entidadeId) ?? true,
      });
    }
  }
  return amostras;
}

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
