import type { Caixa, EntradaLog, EventoVisual, MotivoAnalise } from "../../src/types";
import { colapsarRepeticoes } from "../../src/texto";
import { entradaDeResultado } from "../../src/percepcao";
import type { MotorPercepcao, ResultadoPercepcao } from "../../src/percepcao";
import { RastreadorObjetos } from "../../src/rastreamento";
import { DetectorMudancaDeCena } from "../../src/cena";
import { ehCancelamento } from "../../src/erros";
import { PoliticaAnalise, comMotivo, rotuloMotivo } from "../../src/politica-analise";
import { criarSessionId, uuid } from "../../src/domain/ids";
import { AgendadorAnalise } from "../scheduler";
import type { FilaPersistencia } from "../persistencia";
import type { DefinicaoModo } from "../modos";
import type { OpcoesMotorVisao } from "../motores";

/**
 * Controlador do ciclo (Etapa 2 do roteiro de modularizacao).
 *
 * Concentra a logica de negocio do ciclo de frame unico — captura, inferencia,
 * atualizacao temporal, persistencia e progresso — a partir de dependencias
 * **injetadas** (camera, motores, rastreador, politica, fila de persistencia).
 * A interface (`public/app.ts`) fica com a ligacao de botoes/seletores e a
 * renderizacao do progresso, recebendo `EventoUi` de volta.
 */

/** Item do historico exibido; o controlador so pede para marca-lo como nao gravado. */
export interface ItemHistorico {
  marcarNaoGravado(): void;
}

/**
 * Eventos de progresso emitidos pelo controlador para a interface.
 * Nenhum deles acessa o DOM diretamente: quem renderiza e o `app.ts`.
 */
export type EventoUi =
  | { tipo: "status"; texto: string }
  | { tipo: "spinner"; ativo: boolean }
  | { tipo: "exibir_entrada"; entrada: EntradaLog }
  | { tipo: "desenhar_caixas"; objetos: ReadonlyArray<{ nome: string; score: number; caixa: Caixa }> }
  | { tipo: "preparar_canvas"; largura: number; altura: number }
  | { tipo: "limpar_canvas" }
  | { tipo: "iniciando" }
  | { tipo: "camera_iniciada" }
  | { tipo: "pronto"; definicao: DefinicaoModo }
  | { tipo: "falha_inicializacao"; mensagem: string }
  | { tipo: "parado" };

/** Repositorio de persistencia injetado (implementado pelo cliente HTTP). */
export interface RepositorioCliente {
  gravarEntrada(entrada: EntradaLog): Promise<void>;
  gravarEvento(evento: EventoVisual): Promise<void>;
  gravarOperacional(registro: {
    nivel?: "info" | "aviso" | "erro";
    origem?: string;
    mensagem: string;
    detalhe?: string;
  }): Promise<void>;
}

/** Camera injetada: superficie minima usada pelo controlador. */
export interface CameraCaptura {
  readonly ativa: boolean;
  readonly largura: number;
  readonly altura: number;
  iniciar(): Promise<void>;
  encerrar(): void;
  capturarFrame(maxWidth?: number): string | null;
  capturarQuadro(
    maxWidth?: number,
    larguraThumb?: number
  ): { imagem: string; thumb: string } | null;
  assinaturaDeCena(grade?: number): number[] | null;
}

export interface DependenciasCiclo {
  camera: CameraCaptura;
  /** Renderizacao do progresso; `exibir_entrada` devolve o item para rastrear falhas de gravacao. */
  aoUi: (evento: EventoUi) => ItemHistorico | void;
  repositorio: RepositorioCliente;
  fila: FilaPersistencia;
  /** Definicao do modo ativo (valor do seletor de motor). */
  obterModo: () => DefinicaoModo;
  /** Fabrica do motor de percepcao do modo ativo (dependencias ficam no app). */
  criarMotor: () => MotorPercepcao;
  /** Fabrica do motor de visao (descricao/roteiro), com o estado do contexto. */
  criarMotorVisao: (opcoes: OpcoesMotorVisao) => MotorPercepcao;
  /** Modelo de visao escolhido na interface. */
  obterModeloVisao: () => string | undefined;
  /** Intervalo entre ciclos lido da interface. */
  obterIntervaloMs: () => number;
}

function gerarId(): string {
  return uuid().replace(/-/g, "").slice(0, 12);
}

export class CycleController {
  private readonly rastreador: RastreadorObjetos;
  private readonly detectorCena: DetectorMudancaDeCena;
  private readonly politica = new PoliticaAnalise();
  private readonly agendador: AgendadorAnalise;
  private sessaoId = criarSessionId();
  private motorAtual: MotorPercepcao | null = null;
  private rodando = false;
  private abortador: AbortController | null = null;
  private ultimaDescricao = "";
  private ultimaDuracaoMsValor = 0;
  private ultimaCargaMsValor = 0;
  private ultimaPersistenciaMsValor = 0;
  private roteiroBeats: string[] = [];
  private roteiroPrimeiro = true;
  private frameIdAtual: string | null = null;
  private manualSolicitado = false;

  constructor(private readonly deps: DependenciasCiclo) {
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

  private status(texto: string): void {
    this.deps.aoUi({ tipo: "status", texto });
  }

  private async inicializarMotor(motor: MotorPercepcao): Promise<void> {
    this.deps.aoUi({ tipo: "spinner", ativo: true });
    try {
      await motor.inicializar((mensagem) => this.status(mensagem));
    } finally {
      this.deps.aoUi({ tipo: "spinner", ativo: false });
    }
  }

  private encerrar(): void {
    this.rodando = false;
    this.agendador.parar();
    if (this.abortador) {
      this.abortador.abort();
      this.abortador = null;
    }
    this.motorAtual?.encerrar();
    this.motorAtual = null;
    this.deps.camera.encerrar();
  }

  private falharInicializacao(mensagem: string): void {
    this.encerrar();
    this.deps.aoUi({ tipo: "falha_inicializacao", mensagem });
  }

  private registrarOperacional(
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
  private persistirEntrada(entry: EntradaLog, item: ItemHistorico | void): void {
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
  private persistirEvento(evt: EventoVisual): void {
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

  private async analisarComVisao(
    signal: AbortSignal,
    ehRoteiro: boolean,
    motivo?: MotivoAnalise | null,
    capturaVisao?: { imagem: string; thumb: string; capturadoEm: string }
  ): Promise<void> {
    const camera = this.deps.camera;
    const capturadoEm = capturaVisao?.capturadoEm ?? new Date().toISOString();
    const dataUrl = capturaVisao?.imagem ?? camera.capturarFrame(512);
    if (dataUrl === null) return;
    const width = camera.largura;
    const height = camera.altura;
    this.deps.aoUi({ tipo: "preparar_canvas", largura: width, altura: height });
    this.deps.aoUi({ tipo: "limpar_canvas" });

    const base64 = dataUrl.split(",")[1] ?? "";
    this.status(`LM Studio analisando frame... (pode demorar)`);

    const motor = this.deps.criarMotorVisao({
      modo: ehRoteiro ? "roteiro" : "descricao",
      modelo: this.deps.obterModeloVisao(),
      roteiro: ehRoteiro ? this.roteiroBeats.slice(-8).join(" ").slice(0, 1200) : undefined,
      base: ehRoteiro ? this.roteiroPrimeiro : undefined,
      anterior: ehRoteiro ? undefined : this.ultimaDescricao,
      motivo: motivo ?? undefined,
    });

    let resultado: ResultadoPercepcao | null;
    try {
      resultado = await motor.analisar(
        { imagem: base64, snapshot: dataUrl, capturadoEm },
        signal,
        (parcial) => this.status(`LM Studio: ${colapsarRepeticoes(parcial)}`)
      );
    } catch (err) {
      if (ehCancelamento(err) || signal.aborted) return;
      this.registrarOperacional("erro", "visao", (err as Error).message);
      this.status((err as Error).message);
      return;
    }
    if (signal.aborted || !resultado) return;
    this.ultimaDuracaoMsValor = resultado.duracaoMs;

    if (ehRoteiro && resultado.confianca?.semMudanca) {
      this.status(`Sem mudancas neste intervalo (${resultado.duracaoMs} ms).`);
      return;
    }

    if (ehRoteiro) {
      if (this.roteiroPrimeiro) this.roteiroPrimeiro = false;
      this.roteiroBeats.push(colapsarRepeticoes(resultado.descricao ?? ""));
      if (this.roteiroBeats.length > 64) this.roteiroBeats.splice(0, this.roteiroBeats.length - 64);
    }

    const entry = comMotivo(
      {
        ...entradaDeResultado(resultado, ehRoteiro ? "roteiro" : "descricao"),
        frameId: this.frameIdAtual ?? undefined,
      },
      motivo
    );
    this.ultimaDescricao = resultado.descricao ?? "";
    this.deps.aoUi({ tipo: "exibir_entrada", entrada: entry });

    const tokens = resultado.confianca?.tokens;
    if (tokens) {
      const tokS = resultado.duracaoMs > 0 ? Math.round(tokens / (resultado.duracaoMs / 1000)) : 0;
      this.status(
        `LM Studio viu: ${resultado.descricao} (${resultado.duracaoMs} ms · ${tokens} toks · ${tokS} tok/s)`
      );
    } else {
      this.status(`LM Studio viu: ${resultado.descricao} (${resultado.duracaoMs} ms)`);
    }
  }

  private async analisarDeteccao(signal: AbortSignal): Promise<void> {
    const camera = this.deps.camera;
    const width = camera.largura;
    const height = camera.altura;
    if (!width || !height) return;
    this.deps.aoUi({ tipo: "preparar_canvas", largura: width, altura: height });

    // Captura o frame UMA unica vez: o mesmo instante alimenta a analise, o
    // snapshot do historico e a assinatura de cena.
    const capturadoMs = performance.now();
    const capturadoEm = new Date().toISOString();
    const captura = camera.capturarQuadro(0, 240);
    if (captura === null) return;
    const assinatura = camera.assinaturaDeCena();

    this.status("Analisando frame...");
    let resultado: ResultadoPercepcao | null;
    try {
      if (!this.motorAtual) return;
      resultado = await this.motorAtual.analisar(
        { imagem: captura.imagem, snapshot: captura.thumb, capturadoEm },
        signal
      );
    } catch (err) {
      if (ehCancelamento(err) || signal.aborted) return;
      this.registrarOperacional("erro", "detector", (err as Error).message);
      this.status(`Erro na inferencia: ${(err as Error).message}`);
      return;
    }
    if (signal.aborted || !resultado) return;
    this.ultimaDuracaoMsValor = resultado.duracaoMs;

    const agora = capturadoMs;
    const timestamp = capturadoEm;
    const quadro = this.rastreador.processar(resultado.objetos, agora, {
      timestamp,
      snapshot: resultado.snapshot,
      modelo: resultado.modelo,
      sessaoId: this.sessaoId,
    });
    const sinalCena = this.detectorCena.avaliar(assinatura, agora, {
      timestamp,
      snapshot: resultado.snapshot,
      modelo: resultado.modelo,
      sessaoId: this.sessaoId,
    });
    const eventos = sinalCena ? [...quadro.eventos, sinalCena] : quadro.eventos;
    this.deps.aoUi({ tipo: "desenhar_caixas", objetos: quadro.objetos });

    const entry = {
      ...entradaDeResultado(resultado, "deteccao"),
      frameId: this.frameIdAtual ?? undefined,
    };
    const item = this.deps.aoUi({ tipo: "exibir_entrada", entrada: entry });
    const resumoEventos = eventos.map((e) => e.descricao).join(", ");
    this.status(
      `Viu: ${entry.resumo}  (${resultado.duracaoMs} ms)${resumoEventos ? ` · ${resumoEventos}` : ""}`
    );

    for (const evt of eventos) this.persistirEvento(evt);

    this.persistirEntrada(entry, item);
  }

  /**
   * Fluxo orientado a eventos: a percepcao leve roda a cada tick; o modelo de
   * visao so e chamado quando a politica decide que ha motivo. Falha da
   * percepcao leve = estado desconhecido, nunca "sem mudanca".
   */
  private async analisarEventos(signal: AbortSignal): Promise<void> {
    const camera = this.deps.camera;
    const width = camera.largura;
    const height = camera.altura;
    if (!width || !height) return;
    this.deps.aoUi({ tipo: "preparar_canvas", largura: width, altura: height });

    const capturadoMs = performance.now();
    const capturadoEm = new Date().toISOString();
    const captura = camera.capturarQuadro(0, 240);
    if (captura === null) return;
    const assinatura = camera.assinaturaDeCena();

    const agora = capturadoMs;
    let resultado: ResultadoPercepcao | null;
    try {
      if (!this.motorAtual) return;
      resultado = await this.motorAtual.analisar(
        { imagem: captura.imagem, snapshot: captura.thumb, capturadoEm },
        signal
      );
    } catch (err) {
      if (ehCancelamento(err) || signal.aborted) return;
      this.registrarOperacional("erro", "detector", (err as Error).message);
      const decisao = this.politica.avaliar({
        agora,
        eventos: [],
        melhorConfianca: null,
        percepcaoValida: false,
        manual: this.manualSolicitado,
      });
      this.frameIdAtual = gerarId();
      this.manualSolicitado = false;
      if (decisao.acionar) {
        this.politica.registrarChamada(agora);
        const motivo: MotivoAnalise | undefined =
          decisao.motivo === "sem_acao" ? undefined : decisao.motivo;
        this.status(
          `Percepcao leve falhou; acionando o modelo de visao por ${rotuloMotivo(motivo ?? "falha_percepcao")}...`
        );
        await this.analisarComVisao(signal, false, motivo, {
          imagem: captura.imagem,
          thumb: captura.thumb,
          capturadoEm,
        });
      } else {
        this.status(`Percepcao leve falhou: ${(err as Error).message}`);
      }
      return;
    }
    if (signal.aborted || !resultado) return;
    this.ultimaDuracaoMsValor = resultado.duracaoMs;

    const timestamp = capturadoEm;
    const quadro = this.rastreador.processar(resultado.objetos, agora, {
      timestamp,
      snapshot: resultado.snapshot,
      modelo: resultado.modelo,
      sessaoId: this.sessaoId,
    });
    const sinalCena = this.detectorCena.avaliar(assinatura, agora, {
      timestamp,
      snapshot: resultado.snapshot,
      modelo: resultado.modelo,
      sessaoId: this.sessaoId,
    });
    const eventos = sinalCena ? [...quadro.eventos, sinalCena] : quadro.eventos;

    for (const evt of eventos) this.persistirEvento(evt);

    const menorScore =
      resultado.objetos.length > 0
        ? Math.min(...resultado.objetos.map((o) => o.score))
        : null;
    const decisao = this.politica.avaliar({
      agora,
      eventos,
      melhorConfianca: menorScore,
      percepcaoValida: true,
      manual: this.manualSolicitado,
    });
    this.frameIdAtual = gerarId();
    this.manualSolicitado = false;

    if (decisao.acionar) {
      this.politica.registrarChamada(agora);
      const motivo: MotivoAnalise | undefined =
        decisao.motivo === "sem_acao" ? undefined : decisao.motivo;
      this.status(`Modelo de visao acionado: ${rotuloMotivo(motivo ?? "manual")}...`);
      await this.analisarComVisao(signal, false, motivo, {
        imagem: captura.imagem,
        thumb: captura.thumb,
        capturadoEm,
      });
      if (signal.aborted) return;
      // O modelo de visao limpa o canvas; desenha as caixas de novo por cima.
      this.deps.aoUi({ tipo: "desenhar_caixas", objetos: quadro.objetos });
      return;
    }

    this.deps.aoUi({ tipo: "desenhar_caixas", objetos: quadro.objetos });
    const entry = {
      ...entradaDeResultado(resultado, "deteccao"),
      frameId: this.frameIdAtual ?? undefined,
    };
    const item = this.deps.aoUi({ tipo: "exibir_entrada", entrada: entry });
    this.status(`Viu: ${entry.resumo} (${resultado.duracaoMs} ms) · sem mudanca relevante`);
    this.persistirEntrada(entry, item);
  }
}
