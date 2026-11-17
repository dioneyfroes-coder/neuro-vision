/**
 * Controlador da sessão de monitoramento no cliente (Fase 3).
 *
 * Mantém a gravação de bytes independente do ciclo de análise: um tick leve
 * reporta instantes de captura ao índice do servidor e, quando o servidor
 * informa um `segmentoId` novo, o gravador é rotacionado — o blob do segmento
 * que termina é enviado com o **id antigo** e um gravador novo começa. Nenhuma
 * função lê o relógio diretamente: relógio, fábrica do gravador, API e
 * agendador são injetados, para testes determinísticos.
 */
import type { QuadroGravado, SessaoMonitoramento } from "../../src/domain";
import type { ResultadoQuadrosMonitoramento } from "../api";
import type { SegmentoFechado } from "./gravador-segmentos";
import type { GravadorSegmentos } from "./gravador-segmentos";

/** Superfície HTTP usada pelo controlador (implementada pelo adaptador de `api.ts`). */
export interface ApiMonitoramentoCliente {
  iniciar(opcoes: {
    ambiente: string;
    agoraMs: number;
    duracaoSegmentoMs?: number;
  }): Promise<SessaoMonitoramento>;
  enviarQuadros(quadros: QuadroGravado[]): Promise<ResultadoQuadrosMonitoramento>;
  pausar(sessaoId: string): Promise<SessaoMonitoramento>;
  retomar(sessaoId: string): Promise<SessaoMonitoramento>;
  encerrar(sessaoId: string, agoraMs: number): Promise<SessaoMonitoramento>;
  interromper(
    sessaoId: string,
    agoraMs: number,
    motivo: "falha" | "sem_quadros"
  ): Promise<SessaoMonitoramento>;
  enviarVideo(opcoes: {
    segmentoId: string;
    bytes: Blob;
    contentType: string;
    criadoEmMs: number;
  }): Promise<unknown>;
}

export interface UploadPendente extends SegmentoFechado {
  segmentoId: string;
}

export type EstadoMonitoramento =
  | "parada"
  | "iniciando"
  | "gravando"
  | "pausada"
  | "encerrada"
  | "erro";

export interface DependenciasMonitoramento {
  api: ApiMonitoramentoCliente;
  /** Relógio injetado; em produção, `() => Date.now()`. */
  agoraMs: () => number;
  /** Fábrica de um gravador já configurado com o stream da câmera. */
  criarGravador: () => GravadorSegmentos;
  /**
   * Agendador injetado: devolve uma função que cancela o tick. Em produção usa
   * `setInterval` (ignorando a promessa); nos testes o tick é disparado e
   * aguardado manualmente.
   */
  agendarTick: (tick: () => Promise<void>, periodoMs: number) => () => void;
  /** Intervalo entre relatórios de captura ao índice (padrão: 1000 ms). */
  periodoMs?: number;
  aoEstado?: (estado: EstadoMonitoramento) => void;
  /** Avisa quando o segmento corrente muda (rotação, pausa, encerramento). */
  aoSegmento?: (segmentoId: string | null) => void;
  aoErro?: (erro: Error) => void;
}

export class ControladorMonitoramento {
  private estado: EstadoMonitoramento = "parada";
  private sessao: SessaoMonitoramento | null = null;
  private segmentoAtualId: string | null = null;
  private gravador: GravadorSegmentos | null = null;
  private sequenciaFrame = 0;
  private cancelarTick: (() => void) | null = null;
  private pendentes: UploadPendente[] = [];
  private fila: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: DependenciasMonitoramento) {}

  get estadoAtual(): EstadoMonitoramento {
    return this.estado;
  }

  get sessaoAtual(): SessaoMonitoramento | null {
    return this.sessao;
  }

  get segmentoAtual(): string | null {
    return this.segmentoAtualId;
  }

  get uploadsPendentes(): number {
    return this.pendentes.length;
  }

  /** Abre uma sessão, inicia o gravador e passa a reportar capturas. */
  iniciar(ambiente: string, duracaoSegmentoMs?: number): Promise<void> {
    return this.enfileirar(async () => {
      if (this.estado === "gravando" || this.estado === "iniciando") {
        throw new Error("Ja ha uma sessao de monitoramento ativa");
      }
      this.definirEstado("iniciando");
      try {
        const sessao = await this.deps.api.iniciar({
          ambiente,
          agoraMs: this.deps.agoraMs(),
          ...(duracaoSegmentoMs !== undefined ? { duracaoSegmentoMs } : {}),
        });
        this.sessao = sessao;
        this.definirSegmento(null);
        this.sequenciaFrame = 0;
        this.gravador = this.deps.criarGravador();
        this.gravador.iniciar();
        this.cancelarTick = this.deps.agendarTick(() => this.tick(), this.deps.periodoMs ?? 1000);
        this.definirEstado("gravando");
      } catch (err) {
        this.avisarErro(err);
        await this.desfazerInicio();
        this.definirEstado("erro");
        throw err;
      }
    });
  }

  /** Pausa o índice e fecha o segmento sem iniciar outro. */
  pausar(): Promise<void> {
    return this.enfileirar(async () => {
      if (this.estado !== "gravando" || !this.sessao) return;
      await this.deps.api.pausar(this.sessao.sessaoId);
      this.pararTick();
      const fechado = this.segmentoAtualId;
      this.definirSegmento(null);
      await this.fecharGravadorAtual(fechado);
      this.definirEstado("pausada");
    });
  }

  /** Retoma com um gravador novo: pausa não é lacuna, mas troca de segmento. */
  retomar(): Promise<void> {
    return this.enfileirar(async () => {
      if (this.estado !== "pausada" || !this.sessao) return;
      await this.deps.api.retomar(this.sessao.sessaoId);
      this.iniciarGravador();
      this.cancelarTick = this.deps.agendarTick(() => this.tick(), this.deps.periodoMs ?? 1000);
      this.definirEstado("gravando");
    });
  }

  /** Encerra a sessão no índice e fecha o último segmento. */
  encerrar(): Promise<void> {
    return this.enfileirar(async () => {
      if (this.estado !== "gravando" && this.estado !== "pausada") return;
      const sessao = this.sessao;
      if (!sessao) return;
      await this.deps.api.encerrar(sessao.sessaoId, this.deps.agoraMs());
      this.pararTick();
      const fechado = this.segmentoAtualId;
      this.definirSegmento(null);
      await this.fecharGravadorAtual(fechado);
      this.sessao = null;
      this.definirEstado("encerrada");
    });
  }

  /** Interrompe por falha de gravação, preservando os segmentos já enviados. */
  interromper(motivo: "falha" | "sem_quadros" = "falha"): Promise<void> {
    return this.enfileirar(async () => {
      if (this.estado !== "gravando" && this.estado !== "pausada") return;
      const sessao = this.sessao;
      if (!sessao) return;
      await this.deps.api.interromper(sessao.sessaoId, this.deps.agoraMs(), motivo);
      this.pararTick();
      const fechado = this.segmentoAtualId;
      this.definirSegmento(null);
      await this.fecharGravadorAtual(fechado);
      this.sessao = null;
      this.definirEstado("encerrada");
    });
  }

  /** Tenta reenviar os blobs cujo upload falhou; devolve quantos conseguiram. */
  reenviarPendentes(): Promise<number> {
    return this.enfileirar(async () => {
      const restantes: UploadPendente[] = [];
      let enviados = 0;
      for (const pendente of this.pendentes) {
        try {
          await this.enviar(pendente);
          enviados += 1;
        } catch (err) {
          restantes.push(pendente);
          this.avisarErro(err);
        }
      }
      this.pendentes = restantes;
      return enviados;
    });
  }

  /**
   * Um tick reporta apenas metadados de captura; os bytes vêm do
   * `MediaRecorder`, que continua gravando mesmo se a análise estiver lenta.
   */
  private tick(): Promise<void> {
    return this.enfileirar(async () => {
      if (this.estado !== "gravando" || !this.sessao) return;
      const capturadoEmMs = this.deps.agoraMs();
      const frameId = `${this.sessao.sessaoId}-f${this.sequenciaFrame++}`;
      let resultado;
      try {
        resultado = await this.deps.api.enviarQuadros([{ frameId, capturadoEmMs }]);
      } catch (err) {
        // Falha do índice não interrompe a gravação dos bytes.
        this.avisarErro(err);
        return;
      }
      for (const rejeitado of resultado.rejeitados) {
        this.avisarErro(new Error(`Quadro ${rejeitado.frameId} recusado: ${rejeitado.motivo}`));
      }
      const segmentoId = resultado.atribuicoes.at(-1)?.segmentoId;
      if (!segmentoId) return;
      if (this.segmentoAtualId === null) {
        // Primeiro quadro: o gravador aberto em `iniciar` pertence a este segmento.
        this.definirSegmento(segmentoId);
        return;
      }
      if (segmentoId !== this.segmentoAtualId) {
        const anterior = this.segmentoAtualId;
        this.definirSegmento(segmentoId);
        await this.rotacionar(anterior);
      }
    });
  }

  private iniciarGravador(): void {
    this.gravador = this.deps.criarGravador();
    this.gravador.iniciar();
  }

  /** Fecha o gravador atual (sem reiniciar); usado por pausa/encerramento. */
  private async fecharGravadorAtual(segmentoId: string | null): Promise<void> {
    const gravador = this.gravador;
    this.gravador = null;
    await this.fecharGravador(segmentoId, gravador);
  }

  /**
   * Troca de segmento: inicia o gravador novo **antes** de fechar o antigo para
   * não perder quadros no intervalo, e envia o blob com o id do segmento que
   * termina (`anterior`), nunca com o id novo.
   */
  private async rotacionar(anterior: string): Promise<void> {
    const gravadorAntigo = this.gravador;
    try {
      this.iniciarGravador();
    } catch (err) {
      // Sem gravador novo não há como seguir acumulando bytes: preserva o
      // segmento que termina e interrompe a sessão com motivo de falha.
      this.avisarErro(err);
      await this.fecharGravador(anterior, gravadorAntigo);
      void this.interromper("falha").catch((interrupcao) => this.avisarErro(interrupcao));
      return;
    }
    await this.fecharGravador(anterior, gravadorAntigo);
  }

  /** Fecha o gravador informado e envia o blob; não altera `this.gravador`. */
  private async fecharGravador(
    segmentoId: string | null,
    gravador: GravadorSegmentos | null
  ): Promise<void> {
    if (!gravador || !gravador.ativo) return;
    let fechado: SegmentoFechado | null;
    try {
      fechado = await gravador.fechar();
    } catch (err) {
      this.avisarErro(err);
      return;
    }
    if (!fechado || !segmentoId) return;
    const pendente: UploadPendente = { segmentoId, ...fechado };
    try {
      await this.enviar(pendente);
    } catch (err) {
      this.pendentes.push(pendente);
      this.avisarErro(err);
    }
  }

  private async enviar(pendente: UploadPendente): Promise<void> {
    await this.deps.api.enviarVideo(pendente);
  }

  private pararTick(): void {
    this.cancelarTick?.();
    this.cancelarTick = null;
  }

  private async desfazerInicio(): Promise<void> {
    this.pararTick();
    try {
      if (this.gravador?.ativo) await this.gravador.fechar();
    } catch (err) {
      this.avisarErro(err);
    }
    this.gravador = null;
    const sessao = this.sessao;
    this.sessao = null;
    this.definirSegmento(null);
    if (sessao) {
      try {
        await this.deps.api.interromper(sessao.sessaoId, this.deps.agoraMs(), "falha");
      } catch (err) {
        this.avisarErro(err);
      }
    }
  }

  private definirEstado(estado: EstadoMonitoramento): void {
    this.estado = estado;
    this.deps.aoEstado?.(estado);
  }

  private definirSegmento(segmentoId: string | null): void {
    if (this.segmentoAtualId === segmentoId) return;
    this.segmentoAtualId = segmentoId;
    this.deps.aoSegmento?.(segmentoId);
  }

  private avisarErro(erro: unknown): void {
    this.deps.aoErro?.(erro instanceof Error ? erro : new Error(String(erro)));
  }

  /** Serializa tick, comandos e reenvio para evitar corrida na troca de gravador. */
  private enfileirar<T>(acao: () => Promise<T>): Promise<T> {
    const execucao = this.fila.then(acao, acao);
    this.fila = execucao.then(
      () => undefined,
      () => undefined
    );
    return execucao;
  }
}
