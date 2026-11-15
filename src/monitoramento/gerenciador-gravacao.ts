import {
  DURACAO_SEGMENTO_PADRAO_MS,
  LIMIAR_LACUNA_PADRAO_MS,
  RETENCAO_PRE_EVENTO_PADRAO_MS,
  QuadroRejeitadoError,
  uuid,
  type LacunaGravacao,
  type MotivoFimSegmento,
  type QuadroAtribuido,
  type QuadroGravado,
  type SessaoMonitoramento,
  type VideoSegment,
} from "../domain";

/**
 * Gravação segmentada do modo Câmera de Segurança (Fase 3).
 *
 * O gerenciador é **puro e determinístico**: não chama `Date.now()` nem conhece
 * codecs, disco ou HTTP. Quem grava entrega o instante de captura de cada
 * quadro; o gerenciador decide a qual segmento ele pertence, fecha segmentos no
 * limite exato, registra lacunas e devolve o `offsetMs` que o gravador usa para
 * montar o vídeo.
 *
 * Regras de cobertura:
 *
 * - segmentos normais cobrem `[inicioMs, fimMs)`; na rotação por duração o
 *   próximo começa exatamente no limite, sem perder nem sobrepor frames;
 * - em pausa, encerramento ou lacuna, `fimMs` é o **último quadro realmente
 *   gravado** — o trecho sem gravação não é anunciado como coberto;
 * - um intervalo entre quadros maior que `limiarLacunaMs` fecha o segmento como
 *   `incompleto` e registra a lacuna com motivo `sem_quadros`;
 * - um salto que atravessa um segmento inteiro sem quadros também vira lacuna,
 *   mesmo que o limiar configurado seja maior que a duração do segmento.
 *
 * Falhas não apagam o histórico: segmentos já fechados continuam consultáveis e
 * a interrupção fecha apenas o segmento em curso como `incompleto`.
 */

/** Configuração padrão do gerenciador (pode ser sobreposta por sessão). */
export interface ConfigGerenciadorGravacao {
  duracaoSegmentoMs?: number;
  retencaoPreEventoMs?: number;
  limiarLacunaMs?: number;
}

/** Dados necessários para abrir uma sessão de monitoramento. */
export interface OpcoesSessaoMonitoramento {
  /** Rótulo do ambiente (ex.: "sala", "garagem"). */
  ambiente: string;
  /** Instante de início em epoch ms. */
  agoraMs: number;
  duracaoSegmentoMs?: number;
  retencaoPreEventoMs?: number;
  limiarLacunaMs?: number;
}

const LIMITE_DATA_MS = 8.64e15;

function instanteValido(ms: number): boolean {
  return Number.isFinite(ms) && Math.abs(ms) <= LIMITE_DATA_MS;
}

function paraIso(ms: number): string {
  return new Date(ms).toISOString();
}

function exigirPositivo(valor: number, nome: string): number {
  if (!Number.isFinite(valor) || valor <= 0) {
    throw new Error(`${nome} deve ser finito e maior que zero`);
  }
  return valor;
}

function copiarSegmento(segmento: VideoSegment): VideoSegment {
  return {
    ...segmento,
    lacunas: segmento.lacunas.map((lacuna) => ({ ...lacuna })),
  };
}

function copiarSessao(sessao: SessaoMonitoramento): SessaoMonitoramento {
  return { ...sessao };
}

export class GerenciadorGravacao {
  private sessao: SessaoMonitoramento | null = null;
  private segmentos: VideoSegment[] = [];
  private atual: VideoSegment | null = null;
  private ultimoFrameMs: number | null = null;

  constructor(private readonly config: ConfigGerenciadorGravacao = {}) {}

  /**
   * Abre uma nova sessão. Uma sessão ativa ou pausada precisa ser encerrada ou
   * interrompida antes — abrir outra em silêncio descartaria histórico.
   */
  iniciar(opcoes: OpcoesSessaoMonitoramento): SessaoMonitoramento {
    if (this.sessao && (this.sessao.estado === "ativa" || this.sessao.estado === "pausada")) {
      throw new Error("Ja existe uma sessao de monitoramento em andamento");
    }
    if (!instanteValido(opcoes.agoraMs)) {
      throw new Error("agoraMs deve ser um instante finito em epoch ms");
    }
    const ambiente = opcoes.ambiente.trim();
    if (!ambiente) throw new Error("ambiente obrigatorio");

    const duracaoSegmentoMs = exigirPositivo(
      opcoes.duracaoSegmentoMs ?? this.config.duracaoSegmentoMs ?? DURACAO_SEGMENTO_PADRAO_MS,
      "duracaoSegmentoMs"
    );
    const retencaoPreEventoMs = exigirPositivo(
      opcoes.retencaoPreEventoMs ??
        this.config.retencaoPreEventoMs ??
        RETENCAO_PRE_EVENTO_PADRAO_MS,
      "retencaoPreEventoMs"
    );
    const limiarLacunaMs = exigirPositivo(
      opcoes.limiarLacunaMs ?? this.config.limiarLacunaMs ?? LIMIAR_LACUNA_PADRAO_MS,
      "limiarLacunaMs"
    );

    this.segmentos = [];
    this.atual = null;
    this.ultimoFrameMs = null;
    this.sessao = {
      sessaoId: uuid(),
      ambiente,
      iniciadaEm: paraIso(opcoes.agoraMs),
      iniciadaEmMs: opcoes.agoraMs,
      estado: "ativa",
      duracaoSegmentoMs,
      retencaoPreEventoMs,
      limiarLacunaMs,
    };
    return copiarSessao(this.sessao);
  }

  /**
   * Atribui um quadro ao segmento correspondente e devolve o offset dentro dele.
   *
   * Rejeita com `QuadroRejeitadoError` quando o quadro não pode ser atribuído
   * sem inventar cobertura (sem sessão, sessão pausada/encerrada, timestamp
   * inválido ou fora de ordem).
   */
  quadro(quadro: QuadroGravado): QuadroAtribuido {
    const sessao = this.sessao;
    if (!sessao) {
      throw new QuadroRejeitadoError(
        "sem_sessao",
        "Nenhuma sessao de monitoramento iniciada para receber o quadro"
      );
    }

    const capturadoEmMs = quadro.capturadoEmMs;
    if (!instanteValido(capturadoEmMs) || capturadoEmMs < sessao.iniciadaEmMs) {
      throw new QuadroRejeitadoError(
        "tempo_invalido",
        `Quadro ${quadro.frameId} tem instante invalido ou anterior ao inicio da sessao`
      );
    }

    if (sessao.estado === "pausada") {
      throw new QuadroRejeitadoError(
        "sessao_pausada",
        `Quadro ${quadro.frameId} chegou com a sessao pausada`
      );
    }
    if (sessao.estado !== "ativa") {
      throw new QuadroRejeitadoError(
        "sessao_encerrada",
        `Quadro ${quadro.frameId} chegou com a sessao ${sessao.estado}`
      );
    }

    if (this.ultimoFrameMs !== null) {
      const intervalo = capturadoEmMs - this.ultimoFrameMs;
      if (intervalo < 0) {
        throw new QuadroRejeitadoError(
          "fora_de_ordem",
          `Quadro ${quadro.frameId} chegou fora de ordem (${capturadoEmMs} < ${this.ultimoFrameMs})`
        );
      }
      if (intervalo > sessao.limiarLacunaMs) {
        this.registrarLacuna(capturadoEmMs);
      } else if (this.atual) {
        this.avancarSegmentoSeNecessario(capturadoEmMs);
      }
    }

    if (!this.atual) this.iniciarSegmento(capturadoEmMs);
    const segmento = this.atual;
    if (!segmento) {
      // Defensivo: o quadro sempre abre um segmento quando não há um em curso.
      throw new Error("Segmento de gravacao indisponivel apos a atribuicao");
    }

    segmento.quadros += 1;
    segmento.fimMs = capturadoEmMs;
    segmento.fimEm = paraIso(capturadoEmMs);
    segmento.duracaoMs = segmento.fimMs - segmento.inicioMs;
    this.ultimoFrameMs = capturadoEmMs;

    return {
      frameId: quadro.frameId,
      segmentoId: segmento.segmentoId,
      sequenciaSegmento: segmento.sequencia,
      offsetMs: capturadoEmMs - segmento.inicioMs,
    };
  }

  /** Pausa intencional: fecha o segmento no último quadro gravado. */
  pausar(): SessaoMonitoramento {
    const sessao = this.exigirSessao();
    if (sessao.estado === "pausada") return copiarSessao(sessao);
    if (sessao.estado !== "ativa") {
      throw new Error(`Nao e possivel pausar uma sessao ${sessao.estado}`);
    }
    if (this.atual && this.ultimoFrameMs !== null) {
      this.fecharSegmento("pausa", this.ultimoFrameMs);
    }
    sessao.estado = "pausada";
    return copiarSessao(sessao);
  }

  /** Retoma uma sessão pausada; o próximo quadro abre um novo segmento. */
  retomar(): SessaoMonitoramento {
    const sessao = this.exigirSessao();
    if (sessao.estado === "ativa") return copiarSessao(sessao);
    if (sessao.estado !== "pausada") {
      throw new Error(`Nao e possivel retomar uma sessao ${sessao.estado}`);
    }
    sessao.estado = "ativa";
    return copiarSessao(sessao);
  }

  /** Encerra a sessão; o intervalo sem quadros não é atribuído a nenhum segmento. */
  encerrar(agoraMs: number): SessaoMonitoramento {
    const sessao = this.exigirSessao();
    if (sessao.estado === "encerrada") return copiarSessao(sessao);
    if (sessao.estado === "interrompida") {
      throw new Error("Sessao ja foi interrompida");
    }
    this.validarFim(agoraMs, sessao);
    if (this.atual && this.ultimoFrameMs !== null) {
      this.fecharSegmento("sessao_encerrada", this.ultimoFrameMs);
    }
    sessao.estado = "encerrada";
    sessao.encerradaEm = paraIso(agoraMs);
    sessao.encerradaEmMs = agoraMs;
    return copiarSessao(sessao);
  }

  /**
   * Interrupção anormal (falha de gravação): fecha o segmento em curso como
   * incompleto e registra a falha, mantendo todos os segmentos já fechados.
   */
  interromper(agoraMs: number, motivo: LacunaGravacao["motivo"] = "falha"): SessaoMonitoramento {
    const sessao = this.exigirSessao();
    if (sessao.estado === "interrompida") return copiarSessao(sessao);
    if (sessao.estado === "encerrada") {
      throw new Error("Sessao ja encerrada; nao ha segmento em curso para interromper");
    }
    this.validarFim(agoraMs, sessao);
    if (this.atual && this.ultimoFrameMs !== null) {
      const ultimo = this.ultimoFrameMs;
      if (agoraMs > ultimo) {
        this.atual.lacunas.push(this.criarLacuna(ultimo, agoraMs, motivo));
      }
      this.fecharSegmento("lacuna", ultimo);
    }
    sessao.estado = "interrompida";
    sessao.encerradaEm = paraIso(agoraMs);
    sessao.encerradaEmMs = agoraMs;
    return copiarSessao(sessao);
  }

  /** Sessão corrente (cópia defensiva) ou `null`. */
  obterSessao(): SessaoMonitoramento | null {
    return this.sessao ? copiarSessao(this.sessao) : null;
  }

  /** Todos os segmentos, inclusive o que está em gravação (cópias defensivas). */
  listarSegmentos(): VideoSegment[] {
    return this.segmentos.map(copiarSegmento);
  }

  /** Segmento em gravação (cópia defensiva) ou `null`. */
  segmentoEmGravacao(): VideoSegment | null {
    return this.atual ? copiarSegmento(this.atual) : null;
  }

  /**
   * Segmentos que tocam o intervalo, com extremos **inclusivos**: um evento
   * exatamente no limite entre dois segmentos referencia os dois.
   */
  segmentosParaIntervalo(inicioMs: number, fimMs: number): VideoSegment[] {
    if (!instanteValido(inicioMs) || !instanteValido(fimMs)) {
      throw new Error("Intervalo deve usar instantes finitos em epoch ms");
    }
    if (inicioMs > fimMs) throw new Error("Intervalo invertido");
    return this.segmentos
      .filter((segmento) => segmento.inicioMs <= fimMs && segmento.fimMs >= inicioMs)
      .map(copiarSegmento);
  }

  /**
   * Segmento que contém o instante. Em um limite de rotação devolve o segmento
   * posterior (a cobertura normal é `[inicio, fim)`); em pausa/lacuna, um
   * instante sem gravação não pertence a segmento nenhum.
   */
  segmentoParaTimestamp(instanteMs: number): VideoSegment | undefined {
    if (!instanteValido(instanteMs)) {
      throw new Error("instanteMs deve ser um instante finito em epoch ms");
    }
    let encontrado: VideoSegment | undefined;
    for (const segmento of this.segmentos) {
      if (instanteMs < segmento.inicioMs || instanteMs > segmento.fimMs) continue;
      if (
        !encontrado ||
        segmento.inicioMs > encontrado.inicioMs ||
        (segmento.inicioMs === encontrado.inicioMs && segmento.sequencia > encontrado.sequencia)
      ) {
        encontrado = segmento;
      }
    }
    return encontrado ? copiarSegmento(encontrado) : undefined;
  }

  private exigirSessao(): SessaoMonitoramento {
    if (!this.sessao) throw new Error("Nenhuma sessao de monitoramento iniciada");
    return this.sessao;
  }

  private validarFim(agoraMs: number, sessao: SessaoMonitoramento): void {
    if (!instanteValido(agoraMs) || agoraMs < sessao.iniciadaEmMs) {
      throw new Error("Instante de encerramento invalido ou anterior ao inicio");
    }
    if (this.ultimoFrameMs !== null && agoraMs < this.ultimoFrameMs) {
      throw new Error("Instante de encerramento anterior ao ultimo quadro gravado");
    }
  }

  private avancarSegmentoSeNecessario(capturadoEmMs: number): void {
    const sessao = this.sessao;
    const atual = this.atual;
    if (!sessao || !atual) return;

    const limite = atual.inicioMs + sessao.duracaoSegmentoMs;
    if (capturadoEmMs < limite) return;

    // Um salto que atravessa um segmento inteiro sem quadros não pode ser
    // coberto por rotação normal: é lacuna, com fim no último quadro real.
    if (capturadoEmMs >= limite + sessao.duracaoSegmentoMs) {
      this.registrarLacuna(capturadoEmMs);
      return;
    }

    this.fecharSegmento("duracao", limite);
    this.iniciarSegmento(limite);
  }

  private registrarLacuna(capturadoEmMs: number): void {
    if (!this.atual || this.ultimoFrameMs === null) return;
    const ultimo = this.ultimoFrameMs;
    if (capturadoEmMs <= ultimo) return;
    this.atual.lacunas.push(this.criarLacuna(ultimo, capturadoEmMs, "sem_quadros"));
    this.fecharSegmento("lacuna", ultimo);
  }

  private criarLacuna(
    inicioMs: number,
    fimMs: number,
    motivo: LacunaGravacao["motivo"]
  ): LacunaGravacao {
    return {
      inicioEm: paraIso(inicioMs),
      inicioMs,
      fimEm: paraIso(fimMs),
      fimMs,
      duracaoMs: fimMs - inicioMs,
      motivo,
    };
  }

  private iniciarSegmento(inicioMs: number): void {
    const sessao = this.sessao;
    if (!sessao) throw new Error("Nenhuma sessao de monitoramento iniciada");
    const segmento: VideoSegment = {
      segmentoId: uuid(),
      sessaoId: sessao.sessaoId,
      sequencia: this.segmentos.length + 1,
      inicioEm: paraIso(inicioMs),
      inicioMs,
      fimEm: paraIso(inicioMs),
      fimMs: inicioMs,
      duracaoMs: 0,
      quadros: 0,
      estado: "gravando",
      lacunas: [],
    };
    this.segmentos.push(segmento);
    this.atual = segmento;
  }

  private fecharSegmento(motivo: MotivoFimSegmento, fimMs: number): void {
    const segmento = this.atual;
    if (!segmento) return;
    const fim = Math.max(fimMs, segmento.inicioMs);
    segmento.fimMs = fim;
    segmento.fimEm = paraIso(fim);
    segmento.duracaoMs = fim - segmento.inicioMs;
    segmento.motivoFim = motivo;
    segmento.estado = motivo === "lacuna" ? "incompleto" : "fechado";
    this.atual = null;
  }
}
