import type {
  EntradaLog,
  EventoVisual,
  MarcacaoNsfwLog,
  MotivoAnalise,
} from "../../../src/types";
import type { MotorPercepcao } from "../../../src/percepcao";
import { RastreadorObjetos } from "../../../src/rastreamento";
import { DetectorMudancaDeCena } from "../../../src/cena";
import { PoliticaAnalise } from "../../../src/politica-analise";
import { criarSessionId, uuid } from "../../../src/domain/ids";
import { normalizarMarcacoesNsfw } from "../../../src/nsfw-prompt";
import { AgendadorAnalise } from "../../scheduler";
import {
  gerarId,
  type ControladorCiclo,
  type DependenciasCiclo,
  type ItemHistorico,
} from "./tipos";

export abstract class BaseCycleController implements ControladorCiclo {
  protected readonly rastreador: RastreadorObjetos;
  protected readonly detectorCena: DetectorMudancaDeCena;
  protected readonly politica = new PoliticaAnalise();
  protected readonly agendador: AgendadorAnalise;
  protected sessaoId = criarSessionId();
  protected motorAtual: MotorPercepcao | null = null;
  protected rodando = false;
  protected abortador: AbortController | null = null;
  protected ultimaDescricao = "";
  protected ultimaDuracaoMsValor = 0;
  protected ultimaCargaMsValor = 0;
  protected ultimaPersistenciaMsValor = 0;
  protected roteiroBeats: string[] = [];
  protected roteiroPrimeiro = true;
  protected frameIdAtual: string | null = null;
  protected manualSolicitado = false;
  /** NSFW carregado com sucesso nesta sessao; falha de carga nao derruba o ciclo. */
  protected nsfwAtivo = false;

  constructor(protected readonly deps: DependenciasCiclo) {
    this.rastreador = new RastreadorObjetos({}, this.sessaoId);
    this.detectorCena = new DetectorMudancaDeCena({}, this.sessaoId);
    this.agendador = new AgendadorAnalise({
      executar: () => this.executarCiclo(),
      obterIntervaloMs: deps.obterIntervaloMs,
    });
  }

  get estaRodando(): boolean {
    return this.rodando;
  }

  get ultimaDuracaoMs(): number {
    return this.ultimaDuracaoMsValor;
  }

  get ultimaCargaMs(): number {
    return this.ultimaCargaMsValor;
  }

  get ultimaPersistenciaMs(): number {
    return this.ultimaPersistenciaMsValor;
  }

  get agendamentoAtivo(): boolean {
    return this.agendador.estaRodando;
  }

  /** Estado da sessao para exibicao/limpeza (a interface reinicia ao limpar o historico). */
  reiniciarSessao(opcoes: { manterContexto?: boolean } = {}): void {
    this.sessaoId = criarSessionId();
    this.rastreador.reiniciar();
    this.rastreador.definirSessao(this.sessaoId);
    this.detectorCena.reiniciar();
    this.detectorCena.definirSessao(this.sessaoId);
    this.politica.reiniciar();
    this.frameIdAtual = gerarId();
    this.manualSolicitado = false;
    if (!opcoes.manterContexto) {
      this.ultimaDescricao = "";
      this.roteiroBeats = [];
      this.roteiroPrimeiro = true;
    } else {
      this.roteiroPrimeiro = this.roteiroBeats.length === 0;
    }
  }

  /** Troca de modo zera o contexto de descricao/roteiro (o seletor exige isso). */
  aoTrocarModo(): void {
    this.ultimaDescricao = "";
    this.roteiroBeats = [];
    this.roteiroPrimeiro = true;
    this.frameIdAtual = gerarId();
    this.manualSolicitado = false;
  }

  /** Reidrata roteiro/ultima descricao a partir da memoria persistida. */
  reidratarContexto(roteiro: string[], ultimaDescricao: string): void {
    this.roteiroBeats = roteiro.slice(-64);
    this.ultimaDescricao = ultimaDescricao;
  }

  /** "Analisar agora": marca pedido manual e dispara um ciclo imediato. */
  solicitarManual(): void {
    this.manualSolicitado = true;
    this.agendador.disparar();
  }

  reajustarAgendamento(): void {
    this.agendador.reajustar();
  }

  pararAgendamento(): void {
    this.agendador.parar();
  }

  get agendamentoExecutando(): boolean {
    return this.agendador.estaExecutando;
  }

  async aguardarExecucao(): Promise<void> {
    while (this.agendador.estaExecutando) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  async retomarAgendamento(): Promise<void> {
    if (!this.agendador.estaRodando) {
      await this.agendador.iniciar().catch(() => undefined);
    }
  }

  async iniciar(): Promise<void> {
    if (this.rodando) return;
    this.deps.aoUi({ tipo: "iniciando" });
    // `roteiroBeats`/`ultimaDescricao` vem do contexto reidratado: se ja existe
    // roteiro persistido, o proximo beat e um delta, nao a base.
    this.ultimaDuracaoMsValor = 0;
    this.roteiroPrimeiro = this.roteiroBeats.length === 0;
    this.sessaoId = criarSessionId();
    this.frameIdAtual = null;
    this.rastreador.reiniciar();
    this.rastreador.definirSessao(this.sessaoId);
    this.detectorCena.reiniciar();
    this.detectorCena.definirSessao(this.sessaoId);

    try {
      await this.deps.camera.iniciar();
    } catch (err) {
      this.registrarOperacional("erro", "camera", (err as Error).message);
      const fase = (err as { fase?: string }).fase;
      this.falharInicializacao(
        fase === "video"
          ? `Falha ao iniciar o video: ${(err as Error).message}`
          : `Nao foi possivel acessar a webcam: ${(err as Error).message}`
      );
      return;
    }
    this.deps.aoUi({ tipo: "camera_iniciada" });

    // A partir daqui a webcam esta ligada: qualquer falha inesperada precisa
    // liberar as faixas de video via `falharInicializacao` -> `encerrar`.
    try {
      const definicao = this.deps.obterModo();
      const motor = this.deps.criarMotor();
      this.motorAtual = motor;
      const inicioCarga = performance.now();
      try {
        await this.inicializarMotor(motor);
        this.ultimaCargaMsValor = Math.round(performance.now() - inicioCarga);
      } catch (err) {
        this.registrarOperacional("erro", definicao.origemFalha, (err as Error).message);
        this.falharInicializacao(`${definicao.falhaPrefixo}: ${(err as Error).message}`);
        return;
      }
      if (!this.deps.camera.ativa) {
        this.falharInicializacao("A camera foi encerrada durante a inicializacao.");
        return;
      }
      await this.carregarNsfw();
      if (!this.deps.camera.ativa) {
        this.falharInicializacao("A camera foi encerrada durante a inicializacao.");
        return;
      }
      this.rodando = true;
      this.politica.reiniciar();
      this.deps.aoUi({ tipo: "pronto", definicao });
      await this.agendador.iniciar();
    } catch (err) {
      this.registrarOperacional("erro", "inicializacao", (err as Error).message);
      this.falharInicializacao(`Falha ao iniciar: ${(err as Error).message}`);
    }
  }

  parar(): void {
    this.encerrar();
    this.deps.aoUi({ tipo: "parado" });
  }

  /** Ciclo unico: captura, inferencia, rastreamento, persistencia e progresso. */
  async executarCiclo(): Promise<void> {
    if (!this.rodando) return;
    const ctrl = new AbortController();
    this.abortador = ctrl;
    const { signal } = ctrl;
    this.deps.aoUi({ tipo: "spinner", ativo: true });
    try {
      const modo = this.deps.obterModo();
      if (modo.id === "visao" || modo.id === "roteiro") {
        await this.analisarComVisao(signal, modo.id === "roteiro");
        return;
      }
      if (modo.id === "eventos") {
        await this.analisarEventos(signal);
        return;
      }
      await this.analisarDeteccao(signal);
    } finally {
      if (this.abortador === ctrl) {
        this.abortador = null;
        this.deps.aoUi({ tipo: "spinner", ativo: false });
      }
    }
  }

  protected status(texto: string): void {
    this.deps.aoUi({ tipo: "status", texto });
  }

  protected async inicializarMotor(motor: MotorPercepcao): Promise<void> {
    this.deps.aoUi({ tipo: "spinner", ativo: true });
    try {
      await motor.inicializar((mensagem) => this.status(mensagem));
    } finally {
      this.deps.aoUi({ tipo: "spinner", ativo: false });
    }
  }

  /**
   * Carrega o classificador NSFW quando o toggle esta ligado.
   *
   * Falha de carga **nao** aborta a sessao: o restante do modo continua e a
   * analise segue sem o bloco NSFW (registrado como aviso operacional).
   */
  protected async carregarNsfw(): Promise<void> {
    const modelo = this.deps.obterModeloNsfw?.();
    const classificador = this.deps.classificadorNsfw;
    if (!modelo || !classificador) {
      this.nsfwAtivo = false;
      return;
    }
    this.deps.aoUi({ tipo: "spinner", ativo: true });
    try {
      await classificador.carregar(modelo, (mensagem) => this.status(mensagem));
      this.nsfwAtivo = true;
      // Carga parcial resolve sem lancar: cada modelo indisponivel precisa
      // aparecer por nome/motivo no aviso operacional e no status da interface.
      const parcial = classificador.metricas.motivoFalha;
      if (parcial) {
        this.registrarOperacional("aviso", "nsfw", `carga parcial: ${parcial}`);
        this.status(`NSFW parcialmente disponivel: ${parcial}`);
      }
    } catch (err) {
      this.nsfwAtivo = false;
      this.registrarOperacional("aviso", "nsfw", (err as Error).message);
      this.status(`NSFW indisponivel; seguindo sem o bloco NSFW: ${(err as Error).message}`);
    } finally {
      this.deps.aoUi({ tipo: "spinner", ativo: false });
    }
  }

  /**
   * Roda o classificador NSFW no frame e devolve as marcacoes normalizadas.
   *
   * `undefined` = subsistema desligado ou falhou nesta analise; lista vazia =
   * rodou e nao encontrou nada. Falha e nao fatal e fica registrada.
   */
  protected async avaliarNsfw(
    imagem: string,
    dimensoes: { largura: number; altura: number }
  ): Promise<MarcacaoNsfwLog[] | undefined> {
    const classificador = this.deps.classificadorNsfw;
    if (!this.nsfwAtivo || !classificador) return undefined;
    try {
      const resultado = await classificador.avaliar({ imagem, dimensoes });
      return normalizarMarcacoesNsfw(resultado.marcacoes, dimensoes);
    } catch (err) {
      this.registrarOperacional("aviso", "nsfw", (err as Error).message);
      this.status(`NSFW indisponivel neste frame: ${(err as Error).message}`);
      return undefined;
    }
  }

  protected encerrar(): void {
    this.rodando = false;
    this.agendador.parar();
    if (this.abortador) {
      this.abortador.abort();
      this.abortador = null;
    }
    this.motorAtual?.encerrar();
    this.motorAtual = null;
    this.deps.classificadorNsfw?.encerrar();
    this.nsfwAtivo = false;
    this.deps.camera.encerrar();
  }

  protected falharInicializacao(mensagem: string): void {
    this.encerrar();
    this.deps.aoUi({ tipo: "falha_inicializacao", mensagem });
  }

  protected registrarOperacional(
    nivel: "info" | "aviso" | "erro",
    origem: string,
    mensagem: string
  ): void {
    void this.deps.repositorio.gravarOperacional({ nivel, origem, mensagem });
  }

  /**
   * Enfileira a gravacao de uma entrada. A fila mede o tempo de gravacao,
   * mantem a ordem e retenta falhas transitorias. Em falha definitiva, marca o
   * item do registro como nao gravado.
   */
  protected persistirEntrada(entry: EntradaLog, item: ItemHistorico | void): void {
    this.deps.fila.agendar({
      descricao: `entrada:${entry.tipo}`,
      payload: entry,
      executar: async () => {
        const inicio = performance.now();
        await this.deps.repositorio.gravarEntrada(entry);
        this.ultimaPersistenciaMsValor = Math.round(performance.now() - inicio);
      },
      aoFalhar: () => {
        if (!item) return;
        item.marcarNaoGravado();
      },
    });
  }

  /**
   * Enfileira a gravacao de um evento estruturado. O `idempotencyKey` e
   * estavel durante as tentativas. Movimento e o evento mais frequente: grava
   * sem snapshot para poupar disco.
   */
  protected persistirEvento(evt: EventoVisual): void {
    const payload: EventoVisual = {
      ...evt,
      snapshot: evt.tipo === "movimento" ? undefined : evt.snapshot,
      frameId: this.frameIdAtual ?? undefined,
      sessaoId: this.sessaoId,
      idempotencyKey: uuid(),
    };
    this.deps.fila.agendar({
      descricao: `evento:${evt.tipo}`,
      payload,
      executar: () => this.deps.repositorio.gravarEvento(payload),
    });
  }

  protected abstract analisarComVisao(
    signal: AbortSignal,
    ehRoteiro: boolean,
    motivo?: MotivoAnalise | null,
    capturaVisao?: {
      imagem: string;
      thumb: string;
      capturadoEm: string;
      /** NSFW ja avaliado no mesmo frame (fluxo de eventos); evita repetir. */
      nsfw?: MarcacaoNsfwLog[];
      nsfwAvaliado?: boolean;
    }
  ): Promise<void>;

  protected abstract analisarEventos(signal: AbortSignal): Promise<void>;

  protected abstract analisarDeteccao(signal: AbortSignal): Promise<void>;
}
