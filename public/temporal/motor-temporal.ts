import {
  estaIndisponivel,
  type EventoTemporal,
  type MaoDetectada,
  type ObservacaoFrame,
  type OrigemSinalTemporal,
  type PessoaPose,
  type PontoCorporal,
  type ResumoTemporal,
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
} from "./contracts";
import { CONFIG_MOTOR_TEMPORAL_PADRAO } from "./contracts";
import { RastreadorEntidades } from "./rastreador-entidades";
import { MaquinaSinais, type EventoSinal } from "./maquina-sinais";
import type { Ponto2D } from "./suavizador";

/**
 * Indices dos pontos-chave na ordem COCO (17 pontos) usada pelo estimador de
 * pose padrao (YOLOv8-pose): punhos esquerdo/direito. Ver `ARTICULACOES_BRACO`
 * para a relacao articular completa (ombro/cotovelo/punho).
 */
export const INDICES_PUNHOS = [9, 10] as const;

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
  private ultimoTempoMs: number | null = null;

  constructor(config?: ConfiguracaoParcialMotorTemporal) {
    this.config = {
      ...CONFIG_MOTOR_TEMPORAL_PADRAO,
      ...config,
      rastreador: { ...CONFIG_MOTOR_TEMPORAL_PADRAO.rastreador, ...config?.rastreador },
      gestos: { ...CONFIG_MOTOR_TEMPORAL_PADRAO.gestos, ...config?.gestos },
      braco: { ...CONFIG_MOTOR_TEMPORAL_PADRAO.braco, ...config?.braco },
    };
    this.objetos = new RastreadorObjetos();
    this.cena = new DetectorMudancaDeCena();
    this.pessoas = new RastreadorEntidades(this.config.rastreador, "pes");
    this.maos = new RastreadorEntidades(this.config.rastreador, "mao");
    this.gestos = new MaquinaSinais(this.config.gestos);
    this.braco = new MaquinaSinais(this.config.braco);
  }

  /**
   * Processa a sequencia de observacoes de um ciclo e retorna o resumo
   * temporal consolidado. O estado persiste entre chamadas.
   */
  processar(observacoes: ObservacaoFrame[]): ResumoTemporal {
    if (observacoes.length === 0) {
      return { eventos: [], entidadesAtivas: 0 };
    }

    const sessionId = observacoes[0].sessionId;
    const eventos: EventoTemporal[] = [];
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
    }

    for (const obs of observacoes) {
      const tempoMs = obs.capturadoEmMs;
      const frameId = obs.frameId;

      // 1. Rastreamento de objetos (logica existente de rastreamento.ts).
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
      if (this.config.modo === "basico") continue;

      // 3. Rastreamento de pose (pessoas) em coordenadas normalizadas.
      const poseDisponivel = !estaIndisponivel(obs.pose);
      let poses: PessoaPose[] = [];
      if (!estaIndisponivel(obs.pose)) {
        poses = obs.pose.pessoas;
        this.pessoas.atualizar(
          poses
            .map((p, i) => {
              const centro = centroide(p.pontos);
              if (!centro) return null;
              return {
                x: centro.x,
                y: centro.y,
                confianca: p.confianca ?? 0.8,
                meta: { indice: i },
              };
            })
            .filter((s): s is NonNullable<typeof s> => s !== null),
          tempoMs
        );
      }

      // 4. Rastreamento de maos em coordenadas normalizadas.
      const maosDisponivel = !estaIndisponivel(obs.maos);
      let maosVistas: MaoDetectada[] = [];
      if (!estaIndisponivel(obs.maos)) {
        maosVistas = obs.maos.maos;
        this.maos.atualizar(
          maosVistas
            .map((m, i) => {
              const centro = centroide(m.landmarks as PontoCorporal[]);
              if (!centro) return null;
              return {
                x: centro.x,
                y: centro.y,
                confianca: m.gesto?.confianca ?? 0.8,
                meta: { indice: i, lateralidade: m.lateralidade },
              };
            })
            .filter((s): s is NonNullable<typeof s> => s !== null),
          tempoMs
        );
      }

      // 5. Maquina de braco levantado (a partir da pose).
      const leiturasBraco = this.montarLeiturasBraco(poses, obs.capturadoEm, frameId, obs.cycleId);
      for (const sinal of this.braco.processar(leiturasBraco, { indisponivel: !poseDisponivel })) {
        eventos.push(
          this.sinalParaEvento(sinal, "braco_levantado", "pose", sessionId, (s) =>
            s.estado === "confirmado"
              ? "Braco levantado"
              : "Braco abaixado"
          )
        );
      }

      // 6. Maquina de gestos (a partir das maos).
      const leiturasGesto = this.montarLeiturasGesto(maosVistas, obs.capturadoEm, frameId, obs.cycleId);
      for (const sinal of this.gestos.processar(leiturasGesto, { indisponivel: !maosDisponivel })) {
        eventos.push(
          this.sinalParaEvento(sinal, "gesto_detectado", "maos", sessionId, (s) =>
            s.estado === "confirmado"
              ? `Gesto "${s.rotulo}" confirmado`
              : `Gesto "${s.rotulo}" encerrado`
          )
        );
      }
    }

    this.ultimoTempoMs = observacoes[observacoes.length - 1].capturadoEmMs;

    const entidadesAtivas =
      this.pessoas.vivas.length + this.maos.vivas.length + this.objetos.rastreados.length;

    return {
      eventos,
      entidadesAtivas,
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
    return this.pessoas.vivas.map((entidade) => {
      const visto = entidade.framesAusente === 0;
      const indice = typeof entidade.meta.indice === "number" ? entidade.meta.indice : -1;
      const pose = visto ? poses[indice] : undefined;
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
      };
    });
  }

  private montarLeiturasGesto(
    maos: MaoDetectada[],
    timestamp: string,
    frameId: string,
    cycleId: string
  ) {
    return this.maos.vivas.map((entidade) => {
      const visto = entidade.framesAusente === 0;
      const indice = typeof entidade.meta.indice === "number" ? entidade.meta.indice : -1;
      const mao = visto ? maos[indice] : undefined;
      const gesto = mao?.gesto;
      return {
        entidadeId: entidade.entidadeId,
        rotulo: gesto?.nome ?? null,
        confianca: gesto?.confianca ?? 0,
        frameId,
        timestamp,
        cycleId,
      };
    });
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
      entidadeId: sinal.entidadeId,
      descricao: descricao(sinal),
      confianca: sinal.confianca,
      origens: [origem],
      frameIds: sinal.frameIds,
      estado: interrompidoPorLacuna ? "incerto" : sinal.estado,
      intervaloSemObservacaoMs: sinal.intervaloSemObservacaoMs,
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
      entidadeId: ev.objetoId,
      descricao: ev.descricao,
      confianca: ev.confianca,
      origens: [origem],
      frameIds: frameId ? [frameId] : [],
      estado: "confirmado",
    };
  }
}

const MAPEAMENTO_EVENTO_VISUAL: Partial<Record<EventoVisual["tipo"], TipoEventoTemporal>> = {
  aparicao: "aparicao",
  desaparecimento: "desaparecimento",
  movimento: "movimento_corporal",
  mudanca_de_cena: "mudanca_de_cena",
};

/** Centroide dos pontos com confianca valida (ou de todos, se nenhuma informa). */
function centroide(pontos: PontoCorporal[]): Ponto2D | null {
  if (!pontos || pontos.length === 0) return null;
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const p of pontos) {
    if (!p || typeof p.x !== "number" || typeof p.y !== "number") continue;
    if (p.confianca !== undefined && p.confianca < 0.05) continue;
    sx += p.x;
    sy += p.y;
    n += 1;
  }
  if (n === 0) return null;
  return { x: sx / n, y: sy / n };
}

/**
 * Indices COCO (17 pontos) usados na relacao articular do braco erguido.
 * Cada lado combina ombro, cotovelo e punho.
 */
export const ARTICULACOES_BRACO = [
  { ombro: 5, cotovelo: 7, punho: 9 }, // lado esquerdo
  { ombro: 6, cotovelo: 8, punho: 10 }, // lado direito
] as const;

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
