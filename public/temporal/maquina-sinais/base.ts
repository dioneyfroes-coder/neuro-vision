import type { ConfigMaquinaSinais } from "../contracts";
import { CONFIG_MAQUINA_PADRAO } from "../contracts";
import { uuid } from "../../../src/domain/ids";
import type {
  Ativo,
  DiagnosticoMaquinaSinal,
  EstadoEntidade,
  EventoSinal,
  LeituraSinal,
  MotivoEncerramento,
} from "./tipos";

export abstract class BaseMaquinaSinais {
  protected readonly config: ConfigMaquinaSinais;
  protected readonly estados = new Map<string, EstadoEntidade>();
  /**
   * Encerramentos do processamento corrente. Permite que o diagnostico do ciclo
   * distinga um evento que acabou de encerrar de um candidato/ativo, sem
   * transformar o encerramento em estado permanente.
   */
  protected encerradosNesteProcessamento: DiagnosticoMaquinaSinal[] = [];

  constructor(config?: Partial<ConfigMaquinaSinais>) {
    this.config = { ...CONFIG_MAQUINA_PADRAO, ...config };
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

  protected novoEstado(entidadeId: string): EstadoEntidade {
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

  protected resetarCandidato(estado: EstadoEntidade): void {
    estado.rotuloCandidato = null;
    estado.framesCandidato = 0;
    estado.frameIdsCandidato = [];
    estado.inicioCandidato = null;
    estado.cycleIdCandidato = null;
    estado.confiancaCandidato = 0;
    estado.evidenciasCandidato = [];
  }

  protected iniciar(leitura: LeituraSinal, estado: EstadoEntidade): Ativo {
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

  protected estender(ativo: Ativo, leitura: LeituraSinal): void {
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
  protected encerrar(estado: EstadoEntidade, motivo: MotivoEncerramento): EventoSinal {
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

  protected adicionarFrame(frameIds: string[], frameId: string): void {
    if (frameIds[frameIds.length - 1] !== frameId) frameIds.push(frameId);
  }

  /** Mantem evidencias unicas e limita o acumulado para nao crescer sem fim. */
  protected acumularEvidencias(destino: string[], novas?: readonly string[]): void {
    if (!novas) return;
    for (const evidencia of novas) {
      if (!evidencia || destino.includes(evidencia)) continue;
      if (destino.length >= 12) break;
      destino.push(evidencia);
    }
  }

  protected eventoDe(
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

  protected garantirFimNaoAnterior(ativo: Ativo, fimEm?: string): string {
    const fim = fimEm ?? ativo.ultimoSinalEm;
    return Date.parse(fim) < Date.parse(ativo.inicioEm) ? ativo.inicioEm : fim;
  }

  /**
   * Referencia de tempo/frame para encerrar um sinal: a **ultima evidencia
   * positiva** (`ultimoSinalEm`/`ultimoFrameId`), nunca o inicio do evento.
   */
  protected ultimaReferenciaDeTempo(ativo: Ativo): { timestamp: string; frameId: string } {
    return { timestamp: ativo.ultimoSinalEm, frameId: ativo.ultimoFrameId };
  }
}
