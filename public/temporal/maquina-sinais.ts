import type { ConfigMaquinaSinais } from "./contracts";
import { CONFIG_MAQUINA_PADRAO } from "./contracts";
import { uuid } from "../../src/domain/ids";

/**
 * Leitura de um sinal para uma entidade em um frame.
 *
 * `rotulo` e o sinal observado (ex.: nome do gesto, ou `"levantado"` para o
 * braco). `null` indica que **nao ha sinal valido** neste frame para a entidade
 * (mão oculta, gesto abaixo do limiar) — distinto de ausencia da propria
 * entidade e de **falha de inferencia** (tratada em nivel de frame, via
 * `processar(..., { indisponivel: true })`): uma inferencia que falhou nao
 * afirma que o sinal deixou de existir.
 */
export interface LeituraSinal {
  entidadeId: string;
  rotulo: string | null;
  confianca: number;
  frameId: string;
  timestamp: string;
  cycleId: string;
}

/** Por que um evento foi encerrado (preservado no diagnostico). */
export type MotivoEncerramento = "sem_sinal" | "troca_sinal" | "periodo_cego";

/**
 * Evento de sinal emitido pela maquina, com identidade estavel por todo o
 * ciclo de vida (confirmacao e encerramento compartilham o mesmo `eventoId`).
 *
 * `fimEm` e sempre o instante da **ultima evidencia positiva** — nunca o frame
 * em que a ausencia foi percebida nem o inicio do evento. Assim a duracao
 * reflete o que foi de fato observado e nunca fica negativa.
 */
export interface EventoSinal {
  eventoId: string;
  entidadeId: string;
  rotulo: string;
  estado: "confirmado" | "encerrado";
  inicioEm: string;
  fimEm?: string;
  frameIds: string[];
  confianca: number;
  cycleIdInicio: string;
  /** Frames em que o sinal foi observado (evidencia). */
  framesSinal: number;
  motivoEncerramento?: MotivoEncerramento;
  /** Duracao (ms) do periodo cego que interrompeu o evento, quando houver. */
  intervaloSemObservacaoMs?: number;
}

interface Ativo {
  eventoId: string;
  entidadeId: string;
  rotulo: string;
  inicioEm: string;
  cycleIdInicio: string;
  frameIds: string[];
  confianca: number;
  framesSinal: number;
  /** Instante ISO da ultima leitura valida que sustentou o sinal. */
  ultimoSinalEm: string;
  /** Ultimo frame com evidencia positiva do sinal. */
  ultimoFrameId: string;
}

interface EstadoEntidade {
  rotuloCandidato: string | null;
  framesCandidato: number;
  frameIdsCandidato: string[];
  inicioCandidato: string | null;
  cycleIdCandidato: string | null;
  framesSemSinal: number;
  ativo: Ativo | null;
}

/** Opcoes de `processar` para distinguir "sem sinal" de "nao foi possivel ver". */
export interface OpcoesProcessarSinais {
  /**
   * `true` quando o subsistema de origem estava **indisponivel** neste frame
   * (falha, timeout, modelo nao carregado). A maquina preserva os eventos
   * ativos, nao conta ausencia e reinicia candidatos: uma inferencia que falhou
   * nao pode encerrar gesto nem confirmar sinal.
   */
  indisponivel?: boolean;
}

/**
 * Maquina de estados de sinal com confirmacao e encerramento temporais.
 *
 * - Um sinal precisa persistir por `framesParaConfirmar` frames **validos** para
 *   ser confirmado (filtra gestos instaveis de um unico frame).
 * - Um evento confirmado so encerra apos `framesParaEncerrar` frames validos
 *   sem o sinal (filtra ocultacoes breves).
 * - `fimEm` e sempre a ultima evidencia positiva; a identidade (`eventoId`) e
 *   estavel.
 * - Uma inferencia indisponivel nao conta como ausencia: o evento ativo e
 *   preservado e o candidato reinicia.
 * - O estado e reutilizado entre ciclos; `limpar()` reseta tudo.
 */
export class MaquinaSinais {
  private readonly config: ConfigMaquinaSinais;
  private readonly estados = new Map<string, EstadoEntidade>();

  constructor(config?: Partial<ConfigMaquinaSinais>) {
    this.config = { ...CONFIG_MAQUINA_PADRAO, ...config };
  }

  /**
   * Processa as leituras de um frame e retorna os eventos emitidos neste
   * passo (confirmacoes e encerramentos).
   */
  processar(leituras: LeituraSinal[], opcoes: OpcoesProcessarSinais = {}): EventoSinal[] {
    const emitidos: EventoSinal[] = [];

    // Inferencia indisponivel: nao observamos nada. Preserva ativos (nao
    // afirma encerramento), reinicia candidatos (confirmacao exige frames
    // validos contiguos) e nao incrementa `framesSemSinal`.
    if (opcoes.indisponivel) {
      for (const estado of this.estados.values()) this.resetarCandidato(estado);
      return emitidos;
    }

    const vistas = new Set<string>();

    for (const leitura of leituras) {
      vistas.add(leitura.entidadeId);
      const valida =
        leitura.rotulo !== null && leitura.confianca >= this.config.confiancaMinima;

      let estado = this.estados.get(leitura.entidadeId);
      if (!estado) {
        estado = this.novoEstado();
        this.estados.set(leitura.entidadeId, estado);
      }

      if (valida && leitura.rotulo !== null) {
        estado.framesSemSinal = 0;

        // O sinal ativo continua: apenas estende a evidencia.
        if (estado.ativo && estado.ativo.rotulo === leitura.rotulo) {
          this.estender(estado.ativo, leitura);
          continue;
        }

        // Troca de sinal encerra o ativo anterior antes de avaliar o novo.
        if (estado.ativo) {
          emitidos.push(this.encerrar(estado, "troca_sinal"));
        }

        if (estado.rotuloCandidato === leitura.rotulo) {
          estado.framesCandidato += 1;
          this.adicionarFrame(estado.frameIdsCandidato, leitura.frameId);
        } else {
          estado.rotuloCandidato = leitura.rotulo;
          estado.framesCandidato = 1;
          estado.frameIdsCandidato = [leitura.frameId];
          estado.inicioCandidato = leitura.timestamp;
          estado.cycleIdCandidato = leitura.cycleId;
        }

        if (!estado.ativo && estado.framesCandidato >= this.config.framesParaConfirmar) {
          estado.ativo = this.iniciar(leitura, estado);
          emitidos.push(this.eventoDe(estado.ativo, "confirmado"));
        }
      } else {
        // Sem sinal valido neste frame (observacao valida, sem resultado).
        estado.framesSemSinal += 1;
        this.resetarCandidato(estado);
        if (estado.ativo && estado.framesSemSinal >= this.config.framesParaEncerrar) {
          emitidos.push(this.encerrar(estado, "sem_sinal"));
        }
      }
    }

    // Entidades que sumiram completamente do frame tambem contam como "sem sinal".
    for (const [entidadeId, estado] of this.estados) {
      if (vistas.has(entidadeId)) continue;
      estado.framesSemSinal += 1;
      if (estado.ativo && estado.framesSemSinal >= this.config.framesParaEncerrar) {
        emitidos.push(this.encerrar(estado, "sem_sinal"));
      }
      // Retencao: sem evento ativo e sem sinal ha tempo, descarta o estado.
      if (!estado.ativo && estado.framesSemSinal > this.config.framesParaEncerrar) {
        this.estados.delete(entidadeId);
      }
    }

    return emitidos;
  }

  /**
   * Interrompe os eventos ativos por um periodo cego (lacuna entre ciclos) sem
   * presumir continuidade. Cada evento ativo e encerrado na **ultima evidencia
   * positiva**, com `motivoEncerramento: "periodo_cego"` e a duracao da lacuna.
   * Candidatos sao descartados: a confirmacao recomeca apos o intervalo.
   */
  interromperPorPeriodoCego(gapMs?: number): EventoSinal[] {
    const emitidos: EventoSinal[] = [];
    for (const estado of this.estados.values()) {
      if (estado.ativo) {
        const referencia = this.ultimaReferenciaDeTempo(estado.ativo);
        emitidos.push(
          this.eventoDe(estado.ativo, "encerrado", referencia.timestamp, {
            motivoEncerramento: "periodo_cego",
            intervaloSemObservacaoMs: gapMs,
          })
        );
        estado.ativo = null;
      }
      this.resetarCandidato(estado);
      estado.framesSemSinal = 0;
    }
    return emitidos;
  }

  /** Eventos ativos (confirmados e ainda em curso). */
  ativos(): Ativo[] {
    const lista: Ativo[] = [];
    for (const estado of this.estados.values()) {
      if (estado.ativo) lista.push(estado.ativo);
    }
    return lista;
  }

  /** Indica se a entidade tem um sinal confirmado em curso. */
  estaAtivo(entidadeId: string): boolean {
    return this.estados.get(entidadeId)?.ativo != null;
  }

  limpar(): void {
    this.estados.clear();
  }

  private novoEstado(): EstadoEntidade {
    return {
      rotuloCandidato: null,
      framesCandidato: 0,
      frameIdsCandidato: [],
      inicioCandidato: null,
      cycleIdCandidato: null,
      framesSemSinal: 0,
      ativo: null,
    };
  }

  private resetarCandidato(estado: EstadoEntidade): void {
    estado.rotuloCandidato = null;
    estado.framesCandidato = 0;
    estado.frameIdsCandidato = [];
    estado.inicioCandidato = null;
    estado.cycleIdCandidato = null;
  }

  private iniciar(leitura: LeituraSinal, estado: EstadoEntidade): Ativo {
    return {
      eventoId: uuid(),
      entidadeId: leitura.entidadeId,
      rotulo: leitura.rotulo as string,
      inicioEm: estado.inicioCandidato ?? leitura.timestamp,
      cycleIdInicio: estado.cycleIdCandidato ?? leitura.cycleId,
      frameIds: [...estado.frameIdsCandidato],
      confianca: leitura.confianca,
      framesSinal: estado.frameIdsCandidato.length,
      ultimoSinalEm: leitura.timestamp,
      ultimoFrameId: leitura.frameId,
    };
  }

  private estender(ativo: Ativo, leitura: LeituraSinal): void {
    this.adicionarFrame(ativo.frameIds, leitura.frameId);
    ativo.confianca = Math.max(ativo.confianca, leitura.confianca);
    ativo.framesSinal += 1;
    ativo.ultimoSinalEm = leitura.timestamp;
    ativo.ultimoFrameId = leitura.frameId;
  }

  /** Encerra o ativo do estado na ultima evidencia positiva. */
  private encerrar(estado: EstadoEntidade, motivo: MotivoEncerramento): EventoSinal {
    const ativo = estado.ativo as Ativo;
    const referencia = this.ultimaReferenciaDeTempo(ativo);
    estado.ativo = null;
    return this.eventoDe(ativo, "encerrado", referencia.timestamp, {
      motivoEncerramento: motivo,
    });
  }

  private adicionarFrame(frameIds: string[], frameId: string): void {
    if (frameIds[frameIds.length - 1] !== frameId) frameIds.push(frameId);
  }

  private eventoDe(
    ativo: Ativo,
    estado: "confirmado" | "encerrado",
    fimEm?: string,
    extras: Pick<EventoSinal, "motivoEncerramento" | "intervaloSemObservacaoMs"> = {}
  ): EventoSinal {
    return {
      eventoId: ativo.eventoId,
      entidadeId: ativo.entidadeId,
      rotulo: ativo.rotulo,
      estado,
      inicioEm: ativo.inicioEm,
      // Um evento nunca termina antes de comecar: se nao houver evidencia
      // posterior, o fim coincide com o inicio.
      fimEm: estado === "encerrado" ? this.garantirFimNaoAnterior(ativo, fimEm) : undefined,
      frameIds: [...ativo.frameIds],
      confianca: ativo.confianca,
      cycleIdInicio: ativo.cycleIdInicio,
      framesSinal: ativo.framesSinal,
      ...extras,
    };
  }

  private garantirFimNaoAnterior(ativo: Ativo, fimEm?: string): string {
    const fim = fimEm ?? ativo.ultimoSinalEm;
    return Date.parse(fim) < Date.parse(ativo.inicioEm) ? ativo.inicioEm : fim;
  }

  /**
   * Referencia de tempo/frame para encerrar um sinal: a **ultima evidencia
   * positiva** (`ultimoSinalEm`/`ultimoFrameId`), nunca o inicio do evento.
   */
  private ultimaReferenciaDeTempo(ativo: Ativo): { timestamp: string; frameId: string } {
    return { timestamp: ativo.ultimoSinalEm, frameId: ativo.ultimoFrameId };
  }
}
