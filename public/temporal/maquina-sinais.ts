import type { ConfigMaquinaSinais } from "./contracts";
import { CONFIG_MAQUINA_PADRAO } from "./contracts";
import { uuid } from "../../src/domain/ids";
import type { MotivoEncerramentoEvento } from "../../src/domain";

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
  /**
   * `false` quando a entidade ainda esta no rastreador (janela de tolerancia),
   * mas **nao foi vista** neste frame. A leitura continua contando ausencia de
   * sinal, porem nao avanca `ultimaObservacaoEm`: observar que o sinal sumiu e
   * diferente de observar a entidade.
   *
   * Omitido equivale a `true` (leitura de entidade efetivamente observada).
   */
  observada?: boolean;
  /**
   * `false` quando o intervalo desde a leitura anterior nao e confiavel
   * (intervalo invalido ou longo demais). O sinal pode continuar, mas o evento
   * resultante nao afirma continuidade temporal.
   */
  continuidadeValida?: boolean;
  /** Evidencias textuais que sustentam o sinal (ex.: `geometria:todos`). */
  evidencias?: string[];
}

/**
 * Por que um evento foi encerrado (preservado no diagnostico).
 *
 * `oclusao` e distinto de `sem_sinal`: a entidade deixou de ser vista, em vez
 * de ter sido observada sem o sinal. `periodo_cego` indica uma lacuna entre
 * ciclos, nao uma ausencia observada.
 */
export type MotivoEncerramento = Extract<
  MotivoEncerramentoEvento,
  "sem_sinal" | "troca_sinal" | "periodo_cego" | "oclusao"
>;

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
  /** Instante ISO da ultima evidencia positiva do sinal. */
  ultimaEvidenciaEm: string;
  /** Instante ISO da ultima observacao valida da entidade (com ou sem sinal). */
  ultimaObservacaoEm: string;
  frameIds: string[];
  confianca: number;
  cycleIdInicio: string;
  /** Frames em que o sinal foi observado (evidencia). */
  framesSinal: number;
  motivoEncerramento?: MotivoEncerramento;
  /** Duracao (ms) do periodo cego que interrompeu o evento, quando houver. */
  intervaloSemObservacaoMs?: number;
  /** `false` se algum intervalo da evidencia nao pode ser validado. */
  continuidadeValida: boolean;
  /** Evidencias textuais acumuladas (modelo, geometria, velocidade). */
  evidencias: string[];
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
  /** Instante ISO da ultima observacao valida da entidade (com ou sem sinal). */
  ultimaObservacaoEm: string;
  /** Ultimo frame com evidencia positiva do sinal. */
  ultimoFrameId: string;
  continuidadeValida: boolean;
  evidencias: string[];
}

interface EstadoEntidade {
  entidadeId: string;
  rotuloCandidato: string | null;
  framesCandidato: number;
  frameIdsCandidato: string[];
  inicioCandidato: string | null;
  cycleIdCandidato: string | null;
  confiancaCandidato: number;
  evidenciasCandidato: string[];
  framesSemSinal: number;
  motivoUltimaAusencia: MotivoEncerramento;
  ativo: Ativo | null;
}

/** Fotografia do estado corrente de um sinal, para diagnostico. */
export interface DiagnosticoMaquinaSinal {
  entidadeId: string;
  ativo: boolean;
  rotuloAtivo?: string;
  rotuloCandidato?: string;
  framesCandidato: number;
  /** Frames de evidencia positiva (ativo) ou do candidato corrente. */
  framesEvidencia: number;
  framesSemSinal: number;
  motivoUltimaAusencia: MotivoEncerramento;
  confianca: number;
  continuidadeValida: boolean;
  evidencias: string[];
  ultimaEvidenciaEm?: string;
  ultimaObservacaoEm?: string;
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
  /**
   * Encerramentos do processamento corrente. Permite que o diagnostico do ciclo
   * distinga um evento que acabou de encerrar de um candidato/ativo, sem
   * transformar o encerramento em estado permanente.
   */
  private encerradosNesteProcessamento: DiagnosticoMaquinaSinal[] = [];

  constructor(config?: Partial<ConfigMaquinaSinais>) {
    this.config = { ...CONFIG_MAQUINA_PADRAO, ...config };
  }

  /**
   * Processa as leituras de um frame e retorna os eventos emitidos neste
   * passo (confirmacoes e encerramentos).
   */
  processar(leituras: LeituraSinal[], opcoes: OpcoesProcessarSinais = {}): EventoSinal[] {
    const emitidos: EventoSinal[] = [];
    this.encerradosNesteProcessamento = [];

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
        estado = this.novoEstado(leitura.entidadeId);
        this.estados.set(leitura.entidadeId, estado);
      }

      if (valida && leitura.rotulo !== null) {
        estado.framesSemSinal = 0;

        // O sinal ativo continua: apenas estende a evidencia.
        if (estado.ativo && estado.ativo.rotulo === leitura.rotulo) {
          this.estender(estado.ativo, leitura);
          continue;
        }

        // Troca de sinal encerra o ativo anterior antes de avaliar o novo. A
        // entidade foi observada neste frame (ainda que com outro sinal), entao
        // `ultimaObservacaoEm` avanca sem alterar a ultima evidencia positiva.
        if (estado.ativo) {
          estado.ativo.ultimaObservacaoEm = leitura.timestamp;
          emitidos.push(this.encerrar(estado, "troca_sinal"));
        }

        if (estado.rotuloCandidato === leitura.rotulo) {
          estado.framesCandidato += 1;
          estado.confiancaCandidato = Math.max(
            estado.confiancaCandidato,
            leitura.confianca
          );
          this.acumularEvidencias(estado.evidenciasCandidato, leitura.evidencias);
          this.adicionarFrame(estado.frameIdsCandidato, leitura.frameId);
        } else {
          estado.rotuloCandidato = leitura.rotulo;
          estado.framesCandidato = 1;
          estado.frameIdsCandidato = [leitura.frameId];
          estado.inicioCandidato = leitura.timestamp;
          estado.cycleIdCandidato = leitura.cycleId;
          estado.confiancaCandidato = leitura.confianca;
          estado.evidenciasCandidato = [...(leitura.evidencias ?? [])];
        }

        if (!estado.ativo && estado.framesCandidato >= this.config.framesParaConfirmar) {
          estado.ativo = this.iniciar(leitura, estado);
          emitidos.push(this.eventoDe(estado.ativo, "confirmado"));
        }
      } else {
        // Sem sinal valido neste frame. Se a entidade foi de fato observada
        // (mesmo sem sinal), a ultima observacao avanca; se ela apenas segue na
        // janela de tolerancia do rastreador, a observacao NAO avanca.
        const motivo: MotivoEncerramento =
          leitura.observada === false ? "oclusao" : "sem_sinal";
        estado.motivoUltimaAusencia = motivo;
        if (estado.ativo) {
          if (leitura.observada !== false) {
            estado.ativo.ultimaObservacaoEm = leitura.timestamp;
          }
          if (leitura.continuidadeValida === false) {
            estado.ativo.continuidadeValida = false;
          }
        }
        estado.framesSemSinal += 1;
        this.resetarCandidato(estado);
        if (estado.ativo && estado.framesSemSinal >= this.config.framesParaEncerrar) {
          emitidos.push(this.encerrar(estado, motivo));
        }
      }
    }

    // Entidades que sumiram completamente do frame deixaram de ser vistas: o
    // encerramento e por oclusao, nao por "sinal ausente observado".
    for (const [entidadeId, estado] of this.estados) {
      if (vistas.has(entidadeId)) continue;
      estado.motivoUltimaAusencia = "oclusao";
      estado.framesSemSinal += 1;
      if (estado.ativo && estado.framesSemSinal >= this.config.framesParaEncerrar) {
        emitidos.push(this.encerrar(estado, "oclusao"));
      }
      // Retencao: sem evento ativo e sem sinal ha tempo, descarta o estado.
      if (!estado.ativo && estado.framesSemSinal > this.config.framesParaEncerrar) {
        this.estados.delete(entidadeId);
      }
    }

    return emitidos;
  }

  /**
   * Estados correntes para diagnostico, sem criar evento.
   *
   * Permite distinguir "observacao insuficiente" (candidato abaixo do limiar)
   * de "confirmado" e "ocluido" mesmo quando nada foi emitido neste passo.
   */
  diagnosticos(): DiagnosticoMaquinaSinal[] {
    const lista: DiagnosticoMaquinaSinal[] = [];
    // Encerramentos primeiro: se a mesma entidade ja tem um novo ativo/candidato
    // no ciclo, o estado corrente prevalece (o consumidor mantem um por sinal).
    lista.push(
      ...this.encerradosNesteProcessamento.map((diag) => ({
        ...diag,
        evidencias: [...diag.evidencias],
      }))
    );
    for (const estado of this.estados.values()) {
      const ativo = estado.ativo;
      if (!ativo && estado.framesCandidato === 0) continue;
      lista.push({
        entidadeId: ativo?.entidadeId ?? estado.entidadeId,
        ativo: ativo !== null,
        rotuloAtivo: ativo?.rotulo,
        rotuloCandidato: estado.rotuloCandidato ?? undefined,
        framesCandidato: estado.framesCandidato,
        framesEvidencia: ativo?.framesSinal ?? estado.framesCandidato,
        framesSemSinal: estado.framesSemSinal,
        motivoUltimaAusencia: estado.motivoUltimaAusencia,
        confianca: ativo?.confianca ?? estado.confiancaCandidato,
        continuidadeValida: ativo?.continuidadeValida ?? true,
        evidencias: [...(ativo?.evidencias ?? estado.evidenciasCandidato)],
        ultimaEvidenciaEm: ativo?.ultimoSinalEm,
        ultimaObservacaoEm: ativo?.ultimaObservacaoEm,
      });
    }
    return lista;
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
            continuidadeValida: false,
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
    this.encerradosNesteProcessamento = [];
  }

  private novoEstado(entidadeId: string): EstadoEntidade {
    return {
      entidadeId,
      rotuloCandidato: null,
      framesCandidato: 0,
      frameIdsCandidato: [],
      inicioCandidato: null,
      cycleIdCandidato: null,
      confiancaCandidato: 0,
      evidenciasCandidato: [],
      framesSemSinal: 0,
      motivoUltimaAusencia: "sem_sinal",
      ativo: null,
    };
  }

  private resetarCandidato(estado: EstadoEntidade): void {
    estado.rotuloCandidato = null;
    estado.framesCandidato = 0;
    estado.frameIdsCandidato = [];
    estado.inicioCandidato = null;
    estado.cycleIdCandidato = null;
    estado.confiancaCandidato = 0;
    estado.evidenciasCandidato = [];
  }

  private iniciar(leitura: LeituraSinal, estado: EstadoEntidade): Ativo {
    const evidencias = [...estado.evidenciasCandidato];
    this.acumularEvidencias(evidencias, leitura.evidencias);
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
      ultimaObservacaoEm: leitura.timestamp,
      ultimoFrameId: leitura.frameId,
      continuidadeValida: leitura.continuidadeValida !== false,
      evidencias,
    };
  }

  private estender(ativo: Ativo, leitura: LeituraSinal): void {
    this.adicionarFrame(ativo.frameIds, leitura.frameId);
    ativo.confianca = Math.max(ativo.confianca, leitura.confianca);
    ativo.framesSinal += 1;
    ativo.ultimoSinalEm = leitura.timestamp;
    ativo.ultimaObservacaoEm = leitura.timestamp;
    ativo.ultimoFrameId = leitura.frameId;
    if (leitura.continuidadeValida === false) ativo.continuidadeValida = false;
    this.acumularEvidencias(ativo.evidencias, leitura.evidencias);
  }

  /** Encerra o ativo do estado na ultima evidencia positiva. */
  private encerrar(estado: EstadoEntidade, motivo: MotivoEncerramento): EventoSinal {
    const ativo = estado.ativo as Ativo;
    const referencia = this.ultimaReferenciaDeTempo(ativo);
    estado.ativo = null;
    this.encerradosNesteProcessamento.push({
      entidadeId: ativo.entidadeId,
      ativo: false,
      rotuloAtivo: ativo.rotulo,
      framesCandidato: 0,
      framesEvidencia: ativo.framesSinal,
      framesSemSinal: estado.framesSemSinal,
      motivoUltimaAusencia: motivo,
      confianca: ativo.confianca,
      continuidadeValida: ativo.continuidadeValida,
      evidencias: [...ativo.evidencias],
      ultimaEvidenciaEm: ativo.ultimoSinalEm,
      ultimaObservacaoEm: ativo.ultimaObservacaoEm,
    });
    return this.eventoDe(ativo, "encerrado", referencia.timestamp, {
      motivoEncerramento: motivo,
    });
  }

  private adicionarFrame(frameIds: string[], frameId: string): void {
    if (frameIds[frameIds.length - 1] !== frameId) frameIds.push(frameId);
  }

  /** Mantem evidencias unicas e limita o acumulado para nao crescer sem fim. */
  private acumularEvidencias(destino: string[], novas?: readonly string[]): void {
    if (!novas) return;
    for (const evidencia of novas) {
      if (!evidencia || destino.includes(evidencia)) continue;
      if (destino.length >= 12) break;
      destino.push(evidencia);
    }
  }

  private eventoDe(
    ativo: Ativo,
    estado: "confirmado" | "encerrado",
    fimEm?: string,
    extras: Partial<
      Pick<
        EventoSinal,
        "motivoEncerramento" | "intervaloSemObservacaoMs" | "continuidadeValida"
      >
    > = {}
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
      ultimaEvidenciaEm: ativo.ultimoSinalEm,
      ultimaObservacaoEm: ativo.ultimaObservacaoEm,
      frameIds: [...ativo.frameIds],
      confianca: ativo.confianca,
      cycleIdInicio: ativo.cycleIdInicio,
      framesSinal: ativo.framesSinal,
      evidencias: [...ativo.evidencias],
      ...extras,
      continuidadeValida: extras.continuidadeValida ?? ativo.continuidadeValida,
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
