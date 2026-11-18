import type { EventoTemporal, MotivoEncerramentoEvento } from "../../src/domain";
import { uuid } from "../../src/domain/ids";

/**
 * Detector de entrada/saida de pessoas (Fase 4, item 1) — regra pura.
 *
 * Consome uma amostra por track de pose por frame. A identidade vem do
 * `RastreadorEntidades` (`pes-1`, `pes-2`, ...): o detector nao reidentifica
 * pessoas, apenas traduz a presenca observada do track em eventos
 * `aparicao`/`desaparecimento` com histerese curta.
 *
 * Regras centrais:
 *
 * - **entrada** so e emitida apos `framesParaEntrada` observacoes positivas;
 * - **saida** so e emitida apos `framesParaSaida` frames sem observacao —
 *   oclusao curta nao vira saida;
 * - `inicioEm`/`frameIds` apontam para o frame em que a transicao foi
 *   **confirmada**, enquanto `ultimaEvidenciaEm` preserva o ultimo frame em que
 *   a pessoa foi realmente vista;
 * - inferencia falha nao conta como ausencia (`indisponivel: true` congela);
 * - periodo cego encerra presencas em curso como `incerto`, sem afirmar saida.
 *
 * Nenhuma funcao le relogio, DOM ou API de navegador: o tempo vem da observacao.
 */

/** Grau de presenca de um track (observabilidade/testes). */
export type EstadoPresenca = "observando" | "presente" | "ausente";

export interface ConfigPresencaPessoas {
  /** Frames positivos consecutivos antes de emitir `aparicao`. */
  framesParaEntrada: number;
  /** Frames sem observacao antes de emitir `desaparecimento`. */
  framesParaSaida: number;
}

export const CONFIG_PRESENCA_PESSOAS_PADRAO: ConfigPresencaPessoas = {
  framesParaEntrada: 2,
  framesParaSaida: 3,
};

/** Uma amostra por track de pose em um frame. */
export interface AmostraPresenca {
  sessionId: string;
  entidadeId: string;
  frameId: string;
  timestamp: string;
  tempoMs: number;
  cycleId: string;
  /** `false` quando o track existe, mas a pessoa nao foi vista neste frame. */
  observado: boolean;
  /** `false` quando a associacao/intervalo nao pode ser validado. */
  continuidadeValida: boolean;
  confianca: number;
  /** Origem do ponto de referencia usado pelo rastreador (`torso`, etc.). */
  fonteReferencia?: string;
}

/** Frame usado como referencia para tracks que desapareceram das amostras. */
export interface ReferenciaFramePresenca {
  sessionId: string;
  frameId: string;
  timestamp: string;
  tempoMs: number;
  cycleId: string;
}

export interface OpcoesProcessarPresenca {
  /** `true` quando a inferencia de pose falhou: congela o estado. */
  indisponivel?: boolean;
}

interface Presenca {
  entidadeId: string;
  sessionId: string;
  cycleIdInicio: string;
  primeiraEvidenciaEm: string;
  ultimaEvidenciaEm: string;
  ultimoFrameEvidencia: string;
  framesObservado: number;
  framesSemSinal: number;
  confianca: number;
  fonteReferencia?: string;
  estado: EstadoPresenca;
  entrou: boolean;
  continuidadeValida: boolean;
}

export class DetectorPresencaPessoas {
  private readonly config: ConfigPresencaPessoas;
  private readonly tracks = new Map<string, Presenca>();

  constructor(config?: Partial<ConfigPresencaPessoas>) {
    this.config = { ...CONFIG_PRESENCA_PESSOAS_PADRAO, ...config };
  }

  processar(
    amostras: AmostraPresenca[],
    referencia: ReferenciaFramePresenca,
    opcoes: OpcoesProcessarPresenca = {}
  ): EventoTemporal[] {
    if (opcoes.indisponivel) return [];
    const emitidos: EventoTemporal[] = [];
    const vistos = new Set<string>();

    for (const amostra of amostras) {
      vistos.add(amostra.entidadeId);
      let presenca = this.tracks.get(amostra.entidadeId);
      if (!presenca) {
        presenca = this.nova(amostra);
        this.tracks.set(amostra.entidadeId, presenca);
      }

      if (amostra.observado) {
        presenca.framesObservado += 1;
        presenca.framesSemSinal = 0;
        presenca.ultimaEvidenciaEm = amostra.timestamp;
        presenca.ultimoFrameEvidencia = amostra.frameId;
        presenca.confianca = Math.max(presenca.confianca, amostra.confianca);
        presenca.fonteReferencia = amostra.fonteReferencia ?? presenca.fonteReferencia;
        if (amostra.continuidadeValida === false) presenca.continuidadeValida = false;

        if (!presenca.entrou && presenca.framesObservado >= this.config.framesParaEntrada) {
          presenca.entrou = true;
          presenca.estado = "presente";
          emitidos.push(this.eventoDe(presenca, "aparicao", amostra));
        }
        continue;
      }

      const evento = this.registrarAusencia(
        amostra.entidadeId,
        presenca,
        { frameId: amostra.frameId, timestamp: amostra.timestamp },
        amostra.continuidadeValida
      );
      if (evento) emitidos.push(evento);
    }

    // Tracks que nao apareceram em nenhuma amostra tambem estao ausentes. Isso
    // cobre a entidade que expirou do RastreadorEntidades e sumiu das listas.
    for (const [id, presenca] of [...this.tracks]) {
      if (vistos.has(id)) continue;
      const evento = this.registrarAusencia(
        id,
        presenca,
        { frameId: referencia.frameId, timestamp: referencia.timestamp },
        referencia.cycleId === presenca.cycleIdInicio
      );
      if (evento) emitidos.push(evento);
    }

    return emitidos;
  }

  /**
   * Encerra presencas em curso por uma lacuna entre ciclos. A saida nao e
   * afirmada: o evento fica `incerto` com continuidade invalida.
   */
  interromperPorPeriodoCego(gapMs?: number): EventoTemporal[] {
    const emitidos: EventoTemporal[] = [];
    for (const [id, presenca] of [...this.tracks]) {
      this.tracks.delete(id);
      if (!presenca.entrou) continue;
      const evento = this.eventoDe(
        presenca,
        "desaparecimento",
        { frameId: presenca.ultimoFrameEvidencia, timestamp: presenca.ultimaEvidenciaEm },
        "incerto"
      );
      evento.motivoEncerramento = "periodo_cego";
      evento.intervaloSemObservacaoMs = gapMs;
      evento.continuidadeValida = false;
      emitidos.push(evento);
    }
    return emitidos;
  }

  /** Limpa todo o estado (nova sessao/reset explicito). */
  limpar(): void {
    this.tracks.clear();
  }

  /** Tracks atualmente monitorados, para observabilidade/testes. */
  estados(): ReadonlyArray<{
    entidadeId: string;
    estado: EstadoPresenca;
    framesObservado: number;
    framesSemSinal: number;
  }> {
    return [...this.tracks.values()].map((p) => ({
      entidadeId: p.entidadeId,
      estado: p.estado,
      framesObservado: p.framesObservado,
      framesSemSinal: p.framesSemSinal,
    }));
  }

  private registrarAusencia(
    id: string,
    presenca: Presenca,
    referencia: { frameId: string; timestamp: string },
    continuidadeValida: boolean
  ): EventoTemporal | null {
    presenca.framesSemSinal += 1;
    presenca.estado = "ausente";
    if (!continuidadeValida) presenca.continuidadeValida = false;
    if (presenca.framesSemSinal < this.config.framesParaSaida) return null;

    const evento = presenca.entrou ? this.eventoDe(presenca, "desaparecimento", referencia) : null;
    this.tracks.delete(id);
    return evento;
  }

  private nova(amostra: AmostraPresenca): Presenca {
    return {
      entidadeId: amostra.entidadeId,
      sessionId: amostra.sessionId,
      cycleIdInicio: amostra.cycleId,
      primeiraEvidenciaEm: amostra.timestamp,
      ultimaEvidenciaEm: amostra.timestamp,
      ultimoFrameEvidencia: amostra.frameId,
      framesObservado: 0,
      framesSemSinal: 0,
      confianca: amostra.confianca,
      fonteReferencia: amostra.fonteReferencia,
      estado: "observando",
      entrou: false,
      continuidadeValida: amostra.continuidadeValida !== false,
    };
  }

  private eventoDe(
    presenca: Presenca,
    tipo: "aparicao" | "desaparecimento",
    referencia: { frameId: string; timestamp: string },
    estado: "confirmado" | "incerto" = "confirmado"
  ): EventoTemporal {
    const motivo: MotivoEncerramentoEvento =
      tipo === "desaparecimento" ? "oclusao" : "ponto";
    const descricao =
      estado === "incerto"
        ? "Presenca interrompida por periodo cego (saida nao confirmada)"
        : tipo === "aparicao"
          ? "Pessoa entrou na cena (track de pose)"
          : "Pessoa saiu da cena (track de pose)";
    return {
      eventoId: uuid(),
      sessionId: presenca.sessionId,
      cycleId: presenca.cycleIdInicio,
      tipo,
      inicioEm: referencia.timestamp,
      ultimaEvidenciaEm: presenca.ultimaEvidenciaEm,
      ultimaObservacaoEm: referencia.timestamp,
      entidadeId: presenca.entidadeId,
      descricao,
      confianca: presenca.confianca,
      origens: ["pose"],
      frameIds: [referencia.frameId],
      estado,
      motivoEncerramento: motivo,
      continuidadeValida: presenca.continuidadeValida,
      evidencias: [
        presenca.fonteReferencia ? `pose:${presenca.fonteReferencia}` : "pose",
        `framesObservado:${presenca.framesObservado}`,
        `framesSemSinal:${presenca.framesSemSinal}`,
        `primeiraEvidenciaEm:${presenca.primeiraEvidenciaEm}`,
      ],
    };
  }
}
