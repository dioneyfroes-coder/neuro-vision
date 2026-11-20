import type { SessaoMonitoramento } from "../../../../src/domain";
import type { SegmentoFechado } from "../../gravador-segmentos";
import type { GravadorSegmentos } from "../../gravador-segmentos";
import type {
  DependenciasMonitoramento,
  EstadoMonitoramento,
  UploadPendente,
} from "../tipos";

export class ControladorMonitoramentoBase {
  protected estado: EstadoMonitoramento = "parada";
  protected sessao: SessaoMonitoramento | null = null;
  protected segmentoAtualId: string | null = null;
  protected gravador: GravadorSegmentos | null = null;
  protected sequenciaFrame = 0;
  protected cancelarTick: (() => void) | null = null;
  protected pendentes: UploadPendente[] = [];
  protected fila: Promise<unknown> = Promise.resolve();
  protected capturaSuspensa = false;
  protected motivoSuspensao: string | undefined;

  constructor(protected readonly deps: DependenciasMonitoramento) {}

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

  /** `true` enquanto a camera esta sem sinal: nenhum quadro e reportado. */
  get semSinal(): boolean {
    return this.capturaSuspensa;
  }

  protected iniciarGravador(): void {
    const gravador = this.deps.criarGravador();
    this.gravador = gravador;
    gravador.iniciar();
  }

  /** Fecha o gravador atual (sem reiniciar); usado por pausa/encerramento. */
  protected async fecharGravadorAtual(segmentoId: string | null): Promise<void> {
    const gravador = this.gravador;
    this.gravador = null;
    await this.fecharGravador(segmentoId, gravador);
  }

  /** Fecha o gravador informado e envia o blob; nao altera `this.gravador`. */
  protected async fecharGravador(
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

  protected async enviar(pendente: UploadPendente): Promise<void> {
    await this.deps.api.enviarVideo(pendente);
  }

  protected pararTick(): void {
    this.cancelarTick?.();
    this.cancelarTick = null;
  }

  protected limparSinal(): void {
    this.capturaSuspensa = false;
    this.motivoSuspensao = undefined;
  }

  protected definirEstado(estado: EstadoMonitoramento): void {
    this.estado = estado;
    this.deps.aoEstado?.(estado);
  }

  protected definirSegmento(segmentoId: string | null): void {
    if (this.segmentoAtualId === segmentoId) return;
    this.segmentoAtualId = segmentoId;
    this.deps.aoSegmento?.(segmentoId);
  }

  protected avisarErro(erro: unknown): void {
    this.deps.aoErro?.(erro instanceof Error ? erro : new Error(String(erro)));
  }

  /** Serializa tick, comandos e reenvio para evitar corrida na troca de gravador. */
  protected enfileirar<T>(acao: () => Promise<T>): Promise<T> {
    const execucao = this.fila.then(acao, acao);
    this.fila = execucao.then(
      () => undefined,
      () => undefined
    );
    return execucao;
  }
}
