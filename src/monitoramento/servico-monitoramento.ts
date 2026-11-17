import { QuadroRejeitadoError } from "../domain";
import type {
  MotivoRejeicaoQuadro,
  QuadroAtribuido,
  QuadroGravado,
  SessaoMonitoramento,
  VideoSegment,
} from "../domain";
import {
  gravarSegmentoMonitoramento,
  gravarSessaoMonitoramento,
  lerSegmentosDaSessao,
  lerSegmentosMonitoramento,
  lerSessoesMonitoramento,
} from "../persistence/repositorio-monitoramento";
import { GerenciadorGravacao } from "./gerenciador-gravacao";
import type { ConfigGerenciadorGravacao, OpcoesSessaoMonitoramento } from "./gerenciador-gravacao";

/**
 * Composição do núcleo de gravação com o índice durável (Fase 3).
 *
 * O serviço mantém **uma** sessão viva no `GerenciadorGravacao` e persiste o
 * índice a cada transição relevante: início/pausa/retomada/encerramento da
 * sessão e abertura/fechamento de segmento. Quadros individuais **não** geram
 * uma linha por frame — o contador do segmento em gravação é publicado no
 * encerramento. Isso mantém o arquivo proporcional ao número de segmentos, não
 * ao número de quadros.
 *
 * O serviço não lê o relógio: quem chama informa `agoraMs` e o instante de
 * captura de cada quadro (`capturadoEmMs`). Assim a mesma sequência produz o
 * mesmo índice, em teste e em produção.
 */

/** Teto de quadros por lote de `enviarQuadros` (2 min a 5 FPS). */
export const MAX_QUADROS_POR_LOTE = 600;

/** Limite padrão de atualizações lidas do índice por consulta. */
export const LIMITE_INDICE_MONITORAMENTO_PADRAO = 2_000;

/** Limite padrão de bytes por arquivo do índice (rotação append-only). */
export const MAX_BYTES_INDICE_MONITORAMENTO_PADRAO = 5_000_000;

export interface ArquivosMonitoramento {
  sessoesFile: string;
  segmentosFile: string;
}

export interface OpcoesServicoMonitoramento extends ArquivosMonitoramento {
  /** Tamanho máximo de cada JSONL antes da rotação. */
  maxBytes?: number;
  /** Configuração padrão repassada ao gerenciador (pode ser sobreposta por sessão). */
  config?: ConfigGerenciadorGravacao;
}

/** Quadro recusado dentro de um lote, sem interromper os demais. */
export interface QuadroRejeitadoNoLote {
  frameId: string;
  motivo: MotivoRejeicaoQuadro;
  erro: string;
}

export interface ResultadoEnvioQuadros {
  sessao: SessaoMonitoramento | null;
  atribuicoes: QuadroAtribuido[];
  rejeitados: QuadroRejeitadoNoLote[];
}

/** Conflito de estado: não é payload inválido, é uma transição impossível agora. */
export class ConflitoMonitoramentoError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ConflitoMonitoramentoError";
  }
}

/**
 * Assinatura do que já foi publicado de um segmento.
 *
 * Enquanto o segmento está `gravando`, `quadros`/`fimMs` mudam a cada frame;
 * publicar por esses campos escreveria uma linha por quadro. A assinatura
 * ignora esses campos no estado aberto e usa o desfecho quando o segmento
 * fecha (`estado|motivo|fimMs`).
 */
function assinaturaPublicada(segmento: VideoSegment): string {
  if (segmento.estado === "gravando") return "gravando";
  return `${segmento.estado}|${segmento.motivoFim ?? ""}|${segmento.fimMs}`;
}

export class ServicoMonitoramento {
  private readonly gerenciador: GerenciadorGravacao;
  private readonly maxBytes: number;
  private readonly publicados = new Map<string, string>();
  /**
   * Serializa as mutações (sessão + índice). Sem isso, dois lotes concorrentes
   * poderiam intercalar escritas e deixar no arquivo um retrato mais antigo
   * depois do desfecho do segmento — a deduplicação passaria a mostrar
   * `gravando` para um segmento já fechado.
   */
  private fila: Promise<unknown> = Promise.resolve();

  constructor(private readonly opcoes: OpcoesServicoMonitoramento) {
    this.gerenciador = new GerenciadorGravacao(opcoes.config);
    this.maxBytes = opcoes.maxBytes ?? MAX_BYTES_INDICE_MONITORAMENTO_PADRAO;
  }

  /** Abre uma sessão nova, persiste o índice e devolve a sessão. */
  iniciar(opcoes: OpcoesSessaoMonitoramento): Promise<SessaoMonitoramento> {
    return this.enfileirar(async () => {
      const atual = this.gerenciador.obterSessao();
      if (atual && (atual.estado === "ativa" || atual.estado === "pausada")) {
        throw new ConflitoMonitoramentoError("Ja existe uma sessao de monitoramento em andamento");
      }
      const sessao = this.gerenciador.iniciar(opcoes);
      this.publicados.clear();
      await this.publicarSessao(sessao);
      return sessao;
    });
  }

  /**
   * Atribui um lote de quadros em ordem de chegada.
   *
   * Um quadro inválido é devolvido em `rejeitados` com o motivo explícito; os
   * demais seguem sendo processados. Nenhuma cobertura é inventada para o
   * trecho de um quadro recusado.
   */
  enviarQuadros(quadros: QuadroGravado[]): Promise<ResultadoEnvioQuadros> {
    return this.enfileirar(async () => {
      if (!this.gerenciador.obterSessao()) {
        throw new ConflitoMonitoramentoError("Nenhuma sessao de monitoramento iniciada");
      }
      const atribuicoes: QuadroAtribuido[] = [];
      const rejeitados: QuadroRejeitadoNoLote[] = [];

      for (const quadro of quadros) {
        try {
          atribuicoes.push(this.gerenciador.quadro(quadro));
        } catch (erro) {
          if (erro instanceof QuadroRejeitadoError) {
            rejeitados.push({
              frameId: quadro.frameId,
              motivo: erro.motivo,
              erro: erro.message,
            });
            continue;
          }
          throw erro;
        }
      }

      await this.publicarSegmentos();
      return { sessao: this.gerenciador.obterSessao(), atribuicoes, rejeitados };
    });
  }

  /** Pausa a sessão em andamento. */
  pausar(sessaoId: string): Promise<SessaoMonitoramento> {
    return this.enfileirar(async () => {
      const sessao = this.transicao(sessaoId, () => this.gerenciador.pausar());
      await this.publicarSessao(sessao);
      await this.publicarSegmentos();
      return sessao;
    });
  }

  /** Retoma a sessão pausada. */
  retomar(sessaoId: string): Promise<SessaoMonitoramento> {
    return this.enfileirar(async () => {
      const sessao = this.transicao(sessaoId, () => this.gerenciador.retomar());
      await this.publicarSessao(sessao);
      return sessao;
    });
  }

  /** Encerra a sessão; o intervalo sem quadros não é coberto. */
  encerrar(sessaoId: string, agoraMs: number): Promise<SessaoMonitoramento> {
    return this.enfileirar(async () => {
      const sessao = this.transicao(sessaoId, () => this.gerenciador.encerrar(agoraMs));
      await this.publicarSessao(sessao);
      await this.publicarSegmentos();
      return sessao;
    });
  }

  /** Interrompe a sessão por falha de gravação, preservando o histórico. */
  interromper(
    sessaoId: string,
    agoraMs: number,
    motivo: "falha" | "sem_quadros" = "falha"
  ): Promise<SessaoMonitoramento> {
    return this.enfileirar(async () => {
      const sessao = this.transicao(sessaoId, () =>
        this.gerenciador.interromper(agoraMs, motivo)
      );
      await this.publicarSessao(sessao);
      await this.publicarSegmentos();
      return sessao;
    });
  }

  /** Sessão viva (cópia defensiva) ou `null` depois de reiniciar o processo. */
  sessaoAtual(): SessaoMonitoramento | null {
    return this.gerenciador.obterSessao();
  }

  /**
   * Segmento pelo id, consultando primeiro a sessão viva e depois o índice
   * durável. Usado pelo upload de bytes para validar que o arquivo corresponde a
   * um segmento conhecido (e que já foi fechado).
   */
  async segmentoPorId(
    segmentoId: string,
    limit = LIMITE_INDICE_MONITORAMENTO_PADRAO
  ): Promise<VideoSegment | null> {
    const vivo = this.gerenciador
      .listarSegmentos()
      .find((segmento) => segmento.segmentoId === segmentoId);
    if (vivo) return vivo;
    const duraveis = await lerSegmentosMonitoramento(this.opcoes.segmentosFile, limit);
    return duraveis.find((segmento) => segmento.segmentoId === segmentoId) ?? null;
  }

  /** Sessões do índice durável, da mais recente para a mais antiga. */
  async listarSessoes(limit = LIMITE_INDICE_MONITORAMENTO_PADRAO): Promise<SessaoMonitoramento[]> {
    return lerSessoesMonitoramento(this.opcoes.sessoesFile, limit);
  }

  /**
   * Segmentos de uma sessão: o índice durável sobreposto pelos segmentos
   * vivos, para que o segmento em gravação apareça com os contadores atuais
   * mesmo antes do fechamento ser persistido.
   */
  async segmentosDaSessao(
    sessaoId: string,
    limit = LIMITE_INDICE_MONITORAMENTO_PADRAO
  ): Promise<VideoSegment[]> {
    const porId = new Map<string, VideoSegment>();
    for (const segmento of await lerSegmentosDaSessao(
      this.opcoes.segmentosFile,
      sessaoId,
      limit
    )) {
      porId.set(segmento.segmentoId, segmento);
    }
    const atual = this.gerenciador.obterSessao();
    if (atual?.sessaoId === sessaoId) {
      for (const segmento of this.gerenciador.listarSegmentos()) {
        porId.set(segmento.segmentoId, segmento);
      }
    }
    return [...porId.values()].sort(
      (a, b) => a.inicioMs - b.inicioMs || a.sequencia - b.sequencia
    );
  }

  /**
   * Segmentos que tocam o intervalo, com extremos **inclusivos** (um evento no
   * limite referencia os dois segmentos). O índice durável é sobreposto pelos
   * segmentos vivos da sessão atual.
   */
  async segmentosParaIntervalo(
    inicioMs: number,
    fimMs: number,
    limit = LIMITE_INDICE_MONITORAMENTO_PADRAO
  ): Promise<VideoSegment[]> {
    if (!Number.isFinite(inicioMs) || !Number.isFinite(fimMs)) {
      throw new Error("Intervalo deve usar instantes finitos em epoch ms");
    }
    if (inicioMs > fimMs) throw new Error("Intervalo invertido");

    const porId = new Map<string, VideoSegment>();
    for (const segmento of await lerSegmentosMonitoramento(this.opcoes.segmentosFile, limit)) {
      porId.set(segmento.segmentoId, segmento);
    }
    for (const segmento of this.gerenciador.listarSegmentos()) {
      porId.set(segmento.segmentoId, segmento);
    }
    return [...porId.values()]
      .filter((segmento) => segmento.inicioMs <= fimMs && segmento.fimMs >= inicioMs)
      .sort((a, b) => a.inicioMs - b.inicioMs || a.sequencia - b.sequencia);
  }

  private exigirSessaoAtual(sessaoId: string): SessaoMonitoramento {
    const sessao = this.gerenciador.obterSessao();
    if (!sessao) {
      throw new ConflitoMonitoramentoError("Nenhuma sessao de monitoramento em andamento");
    }
    if (sessao.sessaoId !== sessaoId) {
      throw new ConflitoMonitoramentoError(
        "A sessao informada nao e a sessao de monitoramento em andamento"
      );
    }
    return sessao;
  }

  /** Enfileira uma mutação, preservando a ordem e liberando a fila em falha. */
  private enfileirar<T>(acao: () => Promise<T>): Promise<T> {
    const execucao = this.fila.then(acao, acao);
    this.fila = execucao.then(
      () => undefined,
      () => undefined
    );
    return execucao;
  }

  /** Executa uma transição só na sessão informada, traduzindo conflitos de estado. */
  private transicao<T>(sessaoId: string, acao: () => T): T {
    this.exigirSessaoAtual(sessaoId);
    try {
      return acao();
    } catch (erro) {
      if (erro instanceof ConflitoMonitoramentoError) throw erro;
      throw new ConflitoMonitoramentoError((erro as Error).message);
    }
  }

  private async publicarSessao(sessao: SessaoMonitoramento): Promise<void> {
    await gravarSessaoMonitoramento(sessao, this.opcoes.sessoesFile, this.maxBytes);
  }

  /** Publica apenas segmentos novos ou que mudaram de estado desde a última escrita. */
  private async publicarSegmentos(): Promise<void> {
    for (const segmento of this.gerenciador.listarSegmentos()) {
      const assinatura = assinaturaPublicada(segmento);
      if (this.publicados.get(segmento.segmentoId) === assinatura) continue;
      await gravarSegmentoMonitoramento(segmento, this.opcoes.segmentosFile, this.maxBytes);
      this.publicados.set(segmento.segmentoId, assinatura);
    }
  }
}
