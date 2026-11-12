import {
  calcularGeometriaMao,
  classificarGestoGeometrico,
  combinarGesto,
  estabilizarDedos,
  estadosDosDedos,
  estaIndisponivel,
  type DiagnosticoSinalTemporal,
  type EstadoDedos,
  type EventoTemporal,
  type MaoDetectada,
  type ObservacaoFrame,
  type OrigemSinalTemporal,
  type PessoaPose,
  type PontoCorporal,
  type SinalTemporalDiagnosticado,
  type TipoEventoTemporal,
} from "../../src/domain";
import { uuid } from "../../src/domain/ids";
import { RastreadorObjetos } from "../../src/rastreamento";
import { DetectorMudancaDeCena } from "../../src/cena";
import type { EventoVisual, ObjetoVisto } from "../../src/types";
import type {
  ConfigMotorTemporal,
  ConfiguracaoParcialMotorTemporal,
  MotorTemporal,
  ResultadoTemporal,
} from "./contracts";
import { CONFIG_MOTOR_TEMPORAL_PADRAO } from "./contracts";
import { RastreadorEntidades, type Entidade, type Sonda } from "./rastreador-entidades";
import { MaquinaSinais, type EventoSinal } from "./maquina-sinais";
import { centroidePontos, pontoReferenciaPose } from "./referencia-pose";
import { AvaliadorPoseSexual } from "./regras-pose";

/**
 * Motor temporal (Etapa 6 do roteiro de modularizacao).
 *
 * Encapsula a logica atual de `rastreamento.ts` (rastreamento de objetos) e
 * `cena.ts` (mudanca de cena) **sem reescrever os algoritmos**, e adiciona:
 *
 * - rastreadores de pose (pessoas) e maos com IDs estaveis na sessao;
 * - suavizacao e metricas de movimento em coordenadas normalizadas;
 * - maquina de estados de gestos e de braco levantado com confirmacao e
 *   encerramento temporais;
 * - emissao de `EventoTemporal` com duracao, confianca, timestamps e IDs de
 *   frames de evidencia;
 * - tratamento de frames ausentes, inferencias falhas, mudancas de resolucao e
 *   periodos cegos entre ciclos.
 *
 * O estado e reutilizado entre ciclos; `resetar()` zera tudo (sessao explicita).
 */
export class MotorTemporalImpl implements MotorTemporal {
  private readonly config: ConfigMotorTemporal;
  private readonly objetos: RastreadorObjetos;
  private readonly cena: DetectorMudancaDeCena;
  private readonly pessoas: RastreadorEntidades;
  private readonly maos: RastreadorEntidades;
  private readonly gestos: MaquinaSinais;
  private readonly braco: MaquinaSinais;
  private readonly transicao: MaquinaSinais;
  private readonly movimento: MaquinaSinais;
  private readonly poseSexual: MaquinaSinais;
  /** Regras geometricas de pose compativel (Fase 7.2). */
  private readonly avaliadorPose: AvaliadorPoseSexual;
  /** Histerese dos cinco dedos por track de mao. */
  private readonly dedosPorEntidade = new Map<string, EstadoDedos>();
  /** Ultima amostra vertical de cada punho por pessoa/lado, para transicao. */
  private readonly punhos = new Map<string, { y: number; tempoMs: number }>();
  /** Diagnostico mais recente por sinal+entidade (estado corrente do ciclo). */
  private readonly diagnosticos = new Map<string, DiagnosticoSinalTemporal>();
  private ultimoTempoMs: number | null = null;

  constructor(config?: ConfiguracaoParcialMotorTemporal) {
    this.config = {
      ...CONFIG_MOTOR_TEMPORAL_PADRAO,
      ...config,
      rastreador: { ...CONFIG_MOTOR_TEMPORAL_PADRAO.rastreador, ...config?.rastreador },
      gestos: { ...CONFIG_MOTOR_TEMPORAL_PADRAO.gestos, ...config?.gestos },
      braco: { ...CONFIG_MOTOR_TEMPORAL_PADRAO.braco, ...config?.braco },
      transicao: { ...CONFIG_MOTOR_TEMPORAL_PADRAO.transicao, ...config?.transicao },
      movimento: { ...CONFIG_MOTOR_TEMPORAL_PADRAO.movimento, ...config?.movimento },
      poseSexual: { ...CONFIG_MOTOR_TEMPORAL_PADRAO.poseSexual, ...config?.poseSexual },
      regrasPoseSexual: {
        ...CONFIG_MOTOR_TEMPORAL_PADRAO.regrasPoseSexual,
        ...config?.regrasPoseSexual,
      },
    };
    this.objetos = new RastreadorObjetos();
    this.cena = new DetectorMudancaDeCena();
    this.pessoas = new RastreadorEntidades(this.config.rastreador, "pes");
    this.maos = new RastreadorEntidades(this.config.rastreador, "mao");
    this.gestos = new MaquinaSinais(this.config.gestos);
    this.braco = new MaquinaSinais(this.config.braco);
    this.transicao = new MaquinaSinais(this.config.transicao);
    this.movimento = new MaquinaSinais(this.config.movimento);
    this.poseSexual = new MaquinaSinais(this.config.poseSexual);
    this.avaliadorPose = new AvaliadorPoseSexual(this.config.regrasPoseSexual);
  }

  /**
   * Processa a sequencia de observacoes de um ciclo e retorna o resumo
   * temporal consolidado. O estado persiste entre chamadas.
   */
  processar(observacoes: ObservacaoFrame[]): ResultadoTemporal {
    if (observacoes.length === 0) {
      return {
        eventos: [],
        tracksAtivos: 0,
        pessoasAtivas: 0,
        maosAtivas: 0,
        objetosAtivos: 0,
        observacoes: [],
      };
    }

    const sessionId = observacoes[0].sessionId;
    const eventos: EventoTemporal[] = [];
    this.diagnosticos.clear();
    // Copias com `entidadeId` preenchido. Sao elas que alimentam os sinais e o
    // contexto serializado; as observacoes originais sao congeladas e nao mudam.
    const observacoesEnriquecidas: ObservacaoFrame[] = [];
    let houvePeriodoCego = false;
    let gapMs: number | undefined;

    const primeiroMs = observacoes[0].capturadoEmMs;
    if (
      this.ultimoTempoMs !== null &&
      primeiroMs - this.ultimoTempoMs > this.config.limiarPeriodoCegoMs
    ) {
      houvePeriodoCego = true;
      gapMs = primeiroMs - this.ultimoTempoMs;
    }

    // Periodo cego entre ciclos: nao presuma continuidade. Interrompe os sinais
    // ativos na ultima evidencia positiva e descarta candidatos, antes de
    // processar os novos frames. O fim observado e explicito (`incerto`).
    if (houvePeriodoCego) {
      for (const sinal of this.gestos.interromperPorPeriodoCego(gapMs)) {
        eventos.push(
          this.sinalParaEvento(sinal, "gesto_detectado", "maos", sessionId, (s) =>
            `Gesto "${s.rotulo}" interrompido por periodo cego`
          )
        );
      }
      for (const sinal of this.braco.interromperPorPeriodoCego(gapMs)) {
        eventos.push(
          this.sinalParaEvento(sinal, "braco_levantado", "pose", sessionId, () =>
            "Braco levantado interrompido por periodo cego"
          )
        );
      }
      for (const sinal of this.transicao.interromperPorPeriodoCego(gapMs)) {
        eventos.push(
          this.sinalParaEvento(sinal, "transicao_acao", "pose", sessionId, () =>
            "Transicao de acao interrompida por periodo cego"
          )
        );
      }
      for (const sinal of this.movimento.interromperPorPeriodoCego(gapMs)) {
        eventos.push(
          this.sinalParaEvento(sinal, "movimento_corporal", "pose", sessionId, () =>
            "Movimento corporal interrompido por periodo cego"
          )
        );
      }
      if (this.config.avaliarPoseSexual) {
        for (const sinal of this.poseSexual.interromperPorPeriodoCego(gapMs)) {
          eventos.push(
            this.sinalParaEvento(sinal, "pose_compativel_sexual", "pose", sessionId, () =>
              "Pose compativel interrompida por periodo cego"
            )
          );
        }
      }
      // Uma lacuna invalida a continuidade de todos os punhos conhecidos.
      this.punhos.clear();
      this.avaliadorPose.limpar();
    }

    for (const obs of observacoes) {
      const tempoMs = obs.capturadoEmMs;
      const frameId = obs.frameId;

      // 1. Rastreamento de objetos (logica existente de rastreamento.ts).
      let deteccoesObservadas = obs.deteccoes;
      if (!estaIndisponivel(obs.deteccoes)) {
        const objetosVistos: ObjetoVisto[] = obs.deteccoes.deteccoes.map((d) => ({
          nome: d.nome,
          rotulo: d.rotulo,
          score: d.score,
          caixa: d.caixa,
        }));
        const resultado = this.objetos.processar(objetosVistos, tempoMs, {
          timestamp: obs.capturadoEm,
          sessaoId: sessionId,
        });
        const deteccoes = obs.deteccoes.deteccoes.map((deteccao) => ({ ...deteccao }));
        for (const { indice, objetoId } of resultado.associacoes) {
          const deteccao = deteccoes[indice];
          if (deteccao) deteccao.entidadeId = objetoId;
        }
        deteccoesObservadas = { ...obs.deteccoes, deteccoes };
        for (const ev of resultado.eventos) {
          const convertido = this.converterEventoVisual(ev, sessionId, frameId, obs.cycleId);
          if (convertido) eventos.push(convertido);
        }
      }

      // 2. Mudanca de cena (logica existente de cena.ts).
      if (obs.assinaturaCena) {
        const evCena = this.cena.avaliar(obs.assinaturaCena, tempoMs, {
          timestamp: obs.capturadoEm,
          sessaoId: sessionId,
        });
        if (evCena) {
          const convertido = this.converterEventoVisual(evCena, sessionId, frameId, obs.cycleId);
          if (convertido) eventos.push(convertido);
        }
      }

      // 3–6. Leitura temporal ampliada (pose/maos + maquinas de estado). No
      // modo `basico` apenas objetos e cena (acima) sao considerados: a variante
      // C do benchmark nao deve ganhar interpretacao temporal explicita.
      if (this.config.modo === "basico") {
        observacoesEnriquecidas.push({ ...obs, deteccoes: deteccoesObservadas });
        continue;
      }

      // 3. Rastreamento de pose (pessoas) em coordenadas normalizadas. As
      // associacoes explicitas (indice da sonda -> entidadeId) permitem copiar a
      // observacao com identidade estavel sem tocar no objeto compartilhado.
      let poseObservada = obs.pose;
      let posesComTrackId: PessoaPose[] = [];
      if (!estaIndisponivel(obs.pose)) {
        const poses = obs.pose.pessoas;
        const rastreamento = this.pessoas.atualizarComAssociacoes(
          poses
            .map((p, i) => {
              // Torso/ombros/quadris: referencia estavel mesmo com mudanca de
              // postura (bracos/cabeca). O centroide de todos os keypoints fica
              // apenas como ultimo recurso dentro de `pontoReferenciaPose`.
              const referencia = pontoReferenciaPose(p.pontos);
              if (!referencia) return null;
              return {
                x: referencia.x,
                y: referencia.y,
                confianca: p.confianca ?? 0.8,
                meta: { indice: i, referenciaPose: referencia.fonte },
              };
            })
            .filter((s): s is NonNullable<typeof s> => s !== null),
          tempoMs
        );
        posesComTrackId = poses.map((p) => ({ ...p }));
        for (const { indice, entidadeId } of rastreamento.associacoes) {
          const pessoa = posesComTrackId[indice];
          if (pessoa) pessoa.entidadeId = entidadeId;
        }
        poseObservada = { ...obs.pose, pessoas: posesComTrackId };
      }
      const poseDisponivel = !estaIndisponivel(obs.pose);

      // 4. Rastreamento de maos em coordenadas normalizadas.
      let maosObservadas = obs.maos;
      let maosComTrackId: MaoDetectada[] = [];
      if (!estaIndisponivel(obs.maos)) {
        const maosVistas = obs.maos.maos;
        const rastreamento = this.maos.atualizarComAssociacoes(
          maosVistas
            .map((m, i) => {
              const centro = centroidePontos(m.landmarks as PontoCorporal[]);
              if (!centro) return null;
              return {
                x: centro.x,
                y: centro.y,
                confianca: m.gesto?.confianca ?? 0.8,
                meta: { indice: i, lateralidade: m.lateralidade },
              };
            })
            .filter((s): s is NonNullable<typeof s> => s !== null),
          tempoMs,
          // Lateralidade e restricao de associacao: uma mao esquerda nao deve
          // herdar o ID de uma mao direita durante cruzamentos/oclusoes.
          podeAssociarMao
        );
        maosComTrackId = maosVistas.map((m) => ({ ...m }));
        for (const { indice, entidadeId } of rastreamento.associacoes) {
          const mao = maosComTrackId[indice];
          if (mao) mao.entidadeId = entidadeId;
        }
        maosObservadas = { ...obs.maos, maos: maosComTrackId };
      }
      const maosDisponivel = !estaIndisponivel(obs.maos);

      // 5. Maquina de braco levantado (a partir da pose enriquecida).
      const leiturasBraco = this.montarLeiturasBraco(
        posesComTrackId,
        obs.capturadoEm,
        frameId,
        obs.cycleId
      );
      for (const sinal of this.braco.processar(leiturasBraco, { indisponivel: !poseDisponivel })) {
        eventos.push(
          this.sinalParaEvento(sinal, "braco_levantado", "pose", sessionId, (s) =>
            s.estado === "confirmado"
              ? "Braco levantado"
              : "Braco abaixado"
          )
        );
      }

      // 5a. Transicao de acao: velocidade vertical do punho. Distingue
      // "levantou o braco" (movimento) de "braco erguido" (postura mantida).
      const leiturasTransicao = this.montarLeiturasTransicao(
        posesComTrackId,
        tempoMs,
        obs.capturadoEm,
        frameId,
        obs.cycleId,
        poseDisponivel
      );
      for (const sinal of this.transicao.processar(leiturasTransicao, {
        indisponivel: !poseDisponivel,
      })) {
        eventos.push(
          this.sinalParaEvento(sinal, "transicao_acao", "pose", sessionId, (s) =>
            s.rotulo === "braco_subindo"
              ? "Braco subindo (transicao)"
              : "Braco descendo (transicao)"
          )
        );
      }

      // 5b. Movimento corporal: deslocamento de pessoas rastreadas. Nao confundir
      // com `movimento_objeto` (deslocamento de objetos do detector COCO).
      const leiturasMovimento = this.montarLeiturasMovimento(
        obs.capturadoEm,
        frameId,
        obs.cycleId
      );
      for (const sinal of this.movimento.processar(leiturasMovimento, {
        indisponivel: !poseDisponivel,
      })) {
        eventos.push(
          this.sinalParaEvento(sinal, "movimento_corporal", "pose", sessionId, (s) =>
            s.estado === "confirmado"
              ? "Movimento corporal"
              : "Movimento corporal encerrado"
          )
        );
      }

      // 6. Maquina de gestos (a partir das maos enriquecidas).
      const leiturasGesto = this.montarLeiturasGesto(
        maosComTrackId,
        obs.capturadoEm,
        frameId,
        obs.cycleId
      );
      for (const sinal of this.gestos.processar(leiturasGesto, { indisponivel: !maosDisponivel })) {
        eventos.push(
          this.sinalParaEvento(sinal, "gesto_detectado", "maos", sessionId, (s) =>
            s.estado === "confirmado"
              ? `Gesto "${s.rotulo}" confirmado`
              : `Gesto "${s.rotulo}" encerrado`
          )
        );
      }

      // 7. Pose compativel com ato sexual (Fase 7.2). So roda quando o NSFW
      // esta ativo; o evento e indicio geometrico, nunca prova do ato.
      if (this.config.avaliarPoseSexual) {
        const leiturasPose = this.montarLeiturasPoseSexual(
          posesComTrackId,
          maosComTrackId,
          tempoMs,
          obs.capturadoEm,
          frameId,
          obs.cycleId,
          poseDisponivel
        );
        for (const sinal of this.poseSexual.processar(leiturasPose, {
          indisponivel: !poseDisponivel,
        })) {
          eventos.push(
            this.sinalParaEvento(sinal, "pose_compativel_sexual", "pose", sessionId, (s) =>
              s.estado === "confirmado"
                ? "Pose compativel com ato sexual (indicio geometrico, nao prova)"
                : "Pose compativel encerrada"
            )
          );
        }
      }

      // Diagnostico corrente: diferencia confirmado, ocluido, inferencia
      // indisponivel e observacao insuficiente mesmo sem evento emitido.
      this.registrarDiagnosticos("gesto", this.gestos, !maosDisponivel);
      this.registrarDiagnosticos("braco", this.braco, !poseDisponivel);
      this.registrarDiagnosticos("transicao", this.transicao, !poseDisponivel);
      this.registrarDiagnosticos("movimento", this.movimento, !poseDisponivel);
      if (this.config.avaliarPoseSexual) {
        this.registrarDiagnosticos("pose_sexual", this.poseSexual, !poseDisponivel);
      }

      observacoesEnriquecidas.push({
        ...obs,
        deteccoes: deteccoesObservadas,
        pose: poseObservada,
        maos: maosObservadas,
      });
    }

    this.ultimoTempoMs = observacoes[observacoes.length - 1].capturadoEmMs;

    const pessoasAtivas = this.pessoas.vivas.length;
    const maosAtivas = this.maos.vivas.length;
    const objetosAtivos = this.objetos.rastreados.length;
    // Soma de tracks, nao de entidades fisicas: pose e maos de uma mesma pessoa
    // contam separadamente (ver `ResumoTemporal`).
    const tracksAtivos = pessoasAtivas + maosAtivas + objetosAtivos;

    return {
      eventos,
      tracksAtivos,
      pessoasAtivas,
      maosAtivas,
      objetosAtivos,
      observacoes: observacoesEnriquecidas,
      diagnosticos: [...this.diagnosticos.values()],
      houveIntervaloSemObservacao: houvePeriodoCego || undefined,
      intervaloSemObservacaoMs: gapMs,
    };
  }

  /** Reseta todo o estado (evento explicito de sessao). */
  resetar(): void {
    this.objetos.reiniciar();
    this.cena.reiniciar();
    this.pessoas.limpar();
    this.maos.limpar();
    this.gestos.limpar();
    this.braco.limpar();
    this.transicao.limpar();
    this.movimento.limpar();
    this.poseSexual.limpar();
    this.avaliadorPose.limpar();
    this.dedosPorEntidade.clear();
    this.punhos.clear();
    this.diagnosticos.clear();
    this.ultimoTempoMs = null;
  }

  /** Entidades vivas de pose (exposto para observabilidade/testes). */
  get pessoasVivas() {
    return this.pessoas.vivas;
  }

  /** Entidades vivas de maos (exposto para observabilidade/testes). */
  get maosVivas() {
    return this.maos.vivas;
  }

  private montarLeiturasBraco(
    poses: PessoaPose[],
    timestamp: string,
    frameId: string,
    cycleId: string
  ) {
    const porEntidade = new Map<string, PessoaPose>();
    for (const pose of poses) {
      if (pose.entidadeId) porEntidade.set(pose.entidadeId, pose);
    }
    return this.pessoas.vivas.map((entidade) => {
      const pose = porEntidade.get(entidade.entidadeId);
      // Histerese: se o sinal ja esta ativo para a entidade, o punho continua
      // contando como erguido com um limiar mais folgado (`limiar + histerese`).
      const jaAtivo = this.braco.estaAtivo(entidade.entidadeId);
      const limiar =
        this.config.limiarAlturaBraco + (jaAtivo ? this.config.histereseBraco : 0);
      const confianca = pose
        ? punhoErguido(pose, limiar, this.config.confiancaMinimaPontoBraco)
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

  private montarLeiturasMovimento(timestamp: string, frameId: string, cycleId: string) {
    const limiar = this.config.limiarVelocidadeCorporal;
    return this.pessoas.vivas.map((entidade) => {
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
  private montarLeiturasTransicao(
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
    return this.pessoas.vivas.map((entidade) => {
      const pose = porEntidade.get(entidade.entidadeId);
      let melhor: { rotulo: string; confianca: number; velocidadeY: number } | null = null;
      let continuidadeValida = continuidadeDaEntidade(entidade);

      if (pose && poseDisponivel) {
        for (const { punho } of ARTICULACOES_BRACO) {
          const ponto = pontoConfiavel(
            pose.pontos[punho],
            this.config.confiancaMinimaPontoBraco
          );
          if (!ponto) continue;
          const chave = `${entidade.entidadeId}:${punho}`;
          const anterior = this.punhos.get(chave);
          this.punhos.set(chave, { y: ponto.y, tempoMs });
          if (!anterior) continue;

          const intervaloMs = tempoMs - anterior.tempoMs;
          const intervaloValido =
            Number.isFinite(intervaloMs) &&
            intervaloMs > 0 &&
            intervaloMs <= this.config.rastreador.maxTempoAusenteMs;
          if (!intervaloValido) {
            continuidadeValida = false;
            continue;
          }

          const velocidadeY = ((ponto.y - anterior.y) * 1000) / intervaloMs;
          const rotulo =
            velocidadeY <= -this.config.limiarVelocidadeTransicaoBraco
              ? "braco_subindo"
              : velocidadeY >= this.config.limiarVelocidadeTransicaoBraco
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
  private montarLeiturasPoseSexual(
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
    return this.pessoas.vivas.map((entidade) => {
      const pose = porEntidade.get(entidade.entidadeId);
      const resultado =
        pose && poseDisponivel
          ? this.avaliadorPose.avaliar(pose, maos, tempoMs)
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

  private montarLeiturasGesto(
    maos: MaoDetectada[],
    timestamp: string,
    frameId: string,
    cycleId: string
  ) {
    const porEntidade = new Map<string, MaoDetectada>();
    for (const mao of maos) {
      if (mao.entidadeId) porEntidade.set(mao.entidadeId, mao);
    }
    return this.maos.vivas.map((entidade) => {
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

      const geometria = mao.landmarks.length > 0 ? calcularGeometriaMao(mao.landmarks) : null;
      const estabilizada = geometria
        ? estabilizarDedos(
            geometria,
            this.dedosPorEntidade.get(entidade.entidadeId),
            this.config.histereseAnguloDedoGraus
          )
        : null;
      if (estabilizada) {
        this.dedosPorEntidade.set(entidade.entidadeId, estadosDosDedos(estabilizada));
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

  /**
   * Converte o estado corrente das maquinas em diagnostico, sem emitir evento.
   * `indisponivel` vence os demais estados: falha de inferencia nao e oclusao.
   */
  private registrarDiagnosticos(
    sinal: SinalTemporalDiagnosticado,
    maquina: MaquinaSinais,
    indisponivel: boolean
  ): void {
    for (const diag of maquina.diagnosticos()) {
      let estado: DiagnosticoSinalTemporal["estado"];
      if (indisponivel && (diag.ativo || diag.framesCandidato > 0)) {
        estado = "inferencia_indisponivel";
      } else if (diag.ativo && diag.framesSemSinal > 0 && diag.motivoUltimaAusencia === "oclusao") {
        estado = "ocluido";
      } else if (diag.ativo) {
        estado = "confirmado";
      } else if (diag.framesCandidato > 0) {
        estado = "observacao_insuficiente";
      } else if (diag.framesEvidencia > 0) {
        // Encerramento do processamento corrente: o evento existiu, mas nao ha
        // mais ativo/candidato. Nao e o mesmo que "nunca observado".
        estado = "encerrado";
      } else {
        continue;
      }
      this.diagnosticos.set(`${sinal}:${diag.entidadeId}`, {
        sinal,
        entidadeId: diag.entidadeId,
        estado,
        rotulo: diag.rotuloAtivo ?? diag.rotuloCandidato,
        confianca: diag.confianca,
        framesEvidencia: diag.framesEvidencia,
        framesSemSinal: diag.framesSemSinal,
        evidencias: diag.evidencias,
        continuidadeValida: diag.continuidadeValida,
        motivoEncerramento:
          estado === "ocluido" || estado === "encerrado"
            ? diag.motivoUltimaAusencia
            : undefined,
        ultimaEvidenciaEm: diag.ultimaEvidenciaEm,
        ultimaObservacaoEm: diag.ultimaObservacaoEm,
      });
    }
  }

  private sinalParaEvento(
    sinal: EventoSinal,
    tipo: TipoEventoTemporal,
    origem: OrigemSinalTemporal,
    sessionId: string,
    descricao: (s: EventoSinal) => string
  ): EventoTemporal {
    // Um encerramento por periodo cego nao afirma que o sinal terminou: o fim e
    // apenas a ultima evidencia positiva e o estado fica `incerto` (nao vira
    // fato persistido). A duracao da lacuna vai no proprio evento.
    const interrompidoPorLacuna = sinal.motivoEncerramento === "periodo_cego";
    return {
      eventoId: sinal.eventoId,
      sessionId,
      cycleId: sinal.cycleIdInicio,
      tipo,
      inicioEm: sinal.inicioEm,
      fimEm: sinal.fimEm,
      ultimaEvidenciaEm: sinal.ultimaEvidenciaEm,
      ultimaObservacaoEm: sinal.ultimaObservacaoEm,
      entidadeId: sinal.entidadeId,
      descricao: descricao(sinal),
      confianca: sinal.confianca,
      origens: [origem],
      frameIds: sinal.frameIds,
      estado: interrompidoPorLacuna ? "incerto" : sinal.estado,
      intervaloSemObservacaoMs: sinal.intervaloSemObservacaoMs,
      motivoEncerramento: sinal.motivoEncerramento,
      continuidadeValida: sinal.continuidadeValida,
      evidencias: sinal.evidencias,
    };
  }

  private converterEventoVisual(
    ev: EventoVisual,
    sessionId: string,
    frameId: string,
    cycleId: string
  ): EventoTemporal | null {
    const tipo = MAPEAMENTO_EVENTO_VISUAL[ev.tipo];
    if (!tipo) return null;
    const origem: OrigemSinalTemporal = ev.tipo === "mudanca_de_cena" ? "cena" : "objetos";
    return {
      eventoId: uuid(),
      sessionId,
      cycleId,
      tipo,
      inicioEm: ev.timestamp,
      // Eventos visuais nascem de uma observacao pontual: evidencia e
      // observacao coincidem no mesmo instante.
      ultimaEvidenciaEm: ev.timestamp,
      ultimaObservacaoEm: ev.timestamp,
      entidadeId: ev.objetoId,
      rotuloObjeto: ev.rotuloObjeto,
      descricao: ev.descricao,
      confianca: ev.confianca,
      origens: [origem],
      frameIds: frameId ? [frameId] : [],
      estado: "confirmado",
      // Evento visual e pontual: nao ha duracao sustentada para encerrar.
      motivoEncerramento: "ponto",
      continuidadeValida: true,
    };
  }
}

const MAPEAMENTO_EVENTO_VISUAL: Partial<Record<EventoVisual["tipo"], TipoEventoTemporal>> = {
  aparicao: "aparicao",
  desaparecimento: "desaparecimento",
  movimento: "movimento_objeto",
  mudanca_de_cena: "mudanca_de_cena",
};

/**
 * Indices COCO (17 pontos) usados na relacao articular do braco erguido.
 * Cada lado combina ombro, cotovelo e punho.
 */
export const ARTICULACOES_BRACO = [
  { ombro: 5, cotovelo: 7, punho: 9 }, // lado esquerdo
  { ombro: 6, cotovelo: 8, punho: 10 }, // lado direito
] as const;

/**
 * Restricao de lateralidade na associacao de maos.
 *
 * Lateralidade desconhecida nao bloqueia (nao ha evidencia para restringir);
 * esquerda e direita nunca se associam entre si.
 */
function podeAssociarMao(entidade: Entidade, sonda: Sonda): boolean {
  const atual = entidade.meta.lateralidade;
  const nova = sonda.meta?.lateralidade;
  if (atual === undefined || nova === undefined) return true;
  if (atual === "desconhecida" || nova === "desconhecida") return true;
  return atual === nova;
}

/**
 * Continuidade temporal da entidade: valida quando o ultimo intervalo usado
 * para velocidade foi positivo e curto o bastante. A primeira observacao nao
 * invalida a continuidade (ainda nao ha intervalo).
 *
 * Ausencia de observacao (`framesAusente > 0`) **nao** invalida a continuidade:
 * ela e representada por `observada: false` e explicada pelo motivo de
 * encerramento (`oclusao`). Apenas intervalos invalidos/longos a invalidam.
 */
function continuidadeDaEntidade(entidade: Entidade): boolean {
  if (entidade.framesVisto <= 1) return true;
  return entidade.velocidadeValida;
}

function arredondar(valor: number, decimais = 3): number {
  const fator = 10 ** decimais;
  return Math.round(valor * fator) / fator;
}

/**
 * Detecta se ha um **braco erguido** usando a relacao articular: o punho precisa
 * estar acima do limiar, acima do ombro do mesmo lado e acima do cotovelo do
 * mesmo lado, com os tres pontos confiaveis.
 *
 * A relacao evita falsos positivos de um punho alto por ruido (sem ombro/
 * cotovelo coerentes) e mantem o teste deterministico. Retorna a confianca do
 * punho mais alto, ou `null` se nenhum lado satisfaz a relacao.
 */
function punhoErguido(
  pose: PessoaPose,
  limiar: number,
  confiancaMinima: number
): { confianca: number } | null {
  let melhorY: number | null = null;
  let confianca = 0;
  for (const { ombro, cotovelo, punho } of ARTICULACOES_BRACO) {
    const pOmbro = pontoConfiavel(pose.pontos[ombro], confiancaMinima);
    const pCotovelo = pontoConfiavel(pose.pontos[cotovelo], confiancaMinima);
    const pPunho = pontoConfiavel(pose.pontos[punho], confiancaMinima);
    if (!pOmbro || !pCotovelo || !pPunho) continue;
    // Punho acima do limiar (topo = 0), acima do ombro e acima do cotovelo.
    if (pPunho.y > limiar) continue;
    if (pPunho.y >= pOmbro.y) continue;
    if (pPunho.y >= pCotovelo.y) continue;
    if (melhorY === null || pPunho.y < melhorY) {
      melhorY = pPunho.y;
      confianca = pPunho.confianca ?? 1;
    }
  }
  return melhorY === null ? null : { confianca };
}

/** Ponto com confianca suficiente (ou sem confianca declarada, tratado como valido). */
function pontoConfiavel(
  ponto: PontoCorporal | undefined,
  confiancaMinima: number
): PontoCorporal | null {
  if (!ponto || typeof ponto.x !== "number" || typeof ponto.y !== "number") return null;
  if (ponto.confianca !== undefined && ponto.confianca < confiancaMinima) return null;
  return ponto;
}
