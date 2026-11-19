import type { CargaModelosCiclo, ResultadoCiclo } from "../../../src/domain/cycle";
import {
  estadoInicialFrequenciaAdaptativa,
  type EstadoFrequenciaAdaptativa,
} from "../../../src/domain/frequencia-adaptativa";
import { criarSessionId } from "../../../src/domain/ids";
import { ehCancelamento } from "../../../src/erros";
import { AgendadorAnalise } from "../../scheduler";
import { SnapshotStore } from "../../capture/snapshot-store";
import {
  CONFIG_CAPTURA_PADRAO,
  WebcamCapture,
  type ConfigCaptura,
} from "../../capture/webcam-capture";
import {
  executarCicloMultiframe,
  type DependenciasCicloMultiframe,
} from "../ciclo-multiframe";
import type { ControladorCiclo } from "../cycle-controller";
import { criarProcessadorInativo } from "../../perception/local-perception-pipeline";
import type { ProcessarFrameLocal } from "../../perception/local-perception-pipeline";
import { obterVariante, type VariantePercepcao } from "../../perception/variantes";
import type { MotorTemporal } from "../../temporal/contracts";
import type { InterpretadorMultimodal } from "../../interpretation/contracts";
import {
  POLITICA_CICLO_BENCHMARK_ALVO,
  type PoliticaCiclo,
} from "../politica-ciclo";
import type {
  DependenciasCicloPercepcao,
  PercepcaoMultiframe,
} from "./tipos";

export abstract class BaseCicloPercepcaoController implements ControladorCiclo {
  protected readonly agendador: AgendadorAnalise;
  protected readonly captura: WebcamCapture;
  protected readonly configuracaoCaptura: ConfigCaptura;
  protected readonly store: SnapshotStore;
  protected readonly percepcao: PercepcaoMultiframe;
  protected readonly processarInativo: ProcessarFrameLocal = criarProcessadorInativo();
  protected motorTemporal: MotorTemporal | null;
  protected interpretadorAtual: InterpretadorMultimodal | null = null;
  protected sessaoId = criarSessionId();
  protected cicloSeq = 0;
  /** Eventos temporais ja gravados nesta sessao (identidade unica por evento). */
  protected readonly eventosPersistidos = new Set<string>();
  /**
   * Atualizacoes de gesto/postura ja gravadas nesta sessao, por
   * `eventoId:estado` (um evento pode passar por `confirmado` e `encerrado`;
   * `incerto` tambem e memoria, mas `candidato` nunca e).
   */
  protected readonly memoriaTemporalPersistida = new Set<string>();
  protected rodando = false;
  protected abortador: AbortController | null = null;
  protected ultimaDuracaoMsValor = 0;
  protected ultimaCargaMsValor = 0;
  protected ultimaPersistenciaMsValor = 0;
  /** Ciclos com interpretacao multimodal efetiva (base da taxa de truncamento). */
  protected ciclosInterpretados = 0;
  /** Ciclos em que o contexto multimodal precisou ser compactado (Fase 3). */
  protected ciclosComTruncamento = 0;
  /** Carga fria dos modelos da sessao (P3.1); ausente na variante sem percepcao. */
  protected cargaModelosAtual: CargaModelosCiclo | undefined;
  /** Fim monotonico do ultimo ciclo; base da latencia entre ciclos. */
  protected ultimoFimCicloMs: number | null = null;
  /** Politica do ciclo (Fase 4): pausa pos-ciclo e frequencia da interpretacao. */
  protected readonly politicaCiclo: PoliticaCiclo;
  /**
   * Marca que o proximo ciclo foi pedido pela interface (`solicitarManual`).
   * Consumido uma vez por ciclo; alimenta a decisao `sob_demanda`.
   */
  protected disparoManualPendente = false;
  /**
   * Estado da frequencia adaptativa (Fase 4). Atualizado depois de cada ciclo
   * com o resumo temporal e os timestamps ja medidos; nunca com relogio de
   * parede. Zerado junto com a sessao logica.
   */
  protected estadoFrequencia: EstadoFrequenciaAdaptativa =
    estadoInicialFrequenciaAdaptativa();

  constructor(protected readonly deps: DependenciasCicloPercepcao) {
    const config = deps.configuracaoCaptura ?? CONFIG_CAPTURA_PADRAO;
    this.configuracaoCaptura = { ...config };
    this.politicaCiclo = deps.politicaCiclo ?? POLITICA_CICLO_BENCHMARK_ALVO;
    this.percepcao = deps.criarPercepcao();
    this.motorTemporal = this.criarMotorTemporal();
    this.store = new SnapshotStore({ maxQuadros: config.quadros });
    this.captura = new WebcamCapture(deps.camera, this.configuracaoCaptura, deps.dependenciasCaptura);
    this.agendador = new AgendadorAnalise({
      executar: () => this.executarCiclo(),
      obterIntervaloMs: deps.obterIntervaloMs,
      obterPausaAposCicloMs: () => this.politicaCiclo.pausaAposCicloMs,
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

  /**
   * Fracao de ciclos interpretados cujo contexto precisou de compactacao
   * (Fase 3, item 5). `undefined` enquanto nao houve interpretacao. O mesmo
   * diagnostico fica em `metricas.contextoMultimodal` de cada `RegistroCiclo`.
   */
  get taxaTruncamentoContexto(): number | undefined {
    return this.ciclosInterpretados === 0
      ? undefined
      : this.ciclosComTruncamento / this.ciclosInterpretados;
  }

  /** Contagem absoluta de ciclos interpretados e de ciclos com truncamento. */
  get contagemTruncamentoContexto(): { interpretados: number; truncados: number } {
    return { interpretados: this.ciclosInterpretados, truncados: this.ciclosComTruncamento };
  }

  get agendamentoExecutando(): boolean {
    return this.agendador.estaExecutando;
  }

  /** Variante do modo ativo (B/C/D); sem declaracao explicita assume a alvo (D). */
  protected variante(): VariantePercepcao {
    return obterVariante(this.deps.obterModo().variante);
  }

  /** Cria o motor temporal do nivel da variante; `null` quando nao ha leitura. */
  protected criarMotorTemporal(): MotorTemporal | null {
    const nivel = this.variante().temporal;
    return nivel === "ausente" ? null : this.deps.criarMotorTemporal(nivel);
  }

  reiniciarSessao(_opcoes: { manterContexto?: boolean } = {}): void {
    this.sessaoId = criarSessionId();
    this.cicloSeq = 0;
    this.eventosPersistidos.clear();
    this.memoriaTemporalPersistida.clear();
    this.ultimoFimCicloMs = null;
    this.ciclosInterpretados = 0;
    this.ciclosComTruncamento = 0;
    this.estadoFrequencia = estadoInicialFrequenciaAdaptativa();
    this.motorTemporal?.resetar();
    this.store.limpar();
  }

  /** Troca de modo zera o estado temporal e os ids (nova sessao logica). */
  aoTrocarModo(): void {
    this.reiniciarSessao();
    // A variante pode mudar (basico/ampliado/ausente): recria o motor.
    this.motorTemporal = this.criarMotorTemporal();
  }

  reidratarContexto(_roteiro: string[], _ultimaDescricao: string): void {
    // O ciclo multiframe nao tem contexto de roteiro/descricao a reidratar: a
    // continuidade vem do motor temporal, reiniciado a cada sessao.
  }

  solicitarManual(): void {
    this.disparoManualPendente = true;
    this.agendador.disparar();
  }

  reajustarAgendamento(): void {
    this.agendador.reajustar();
  }

  pararAgendamento(): void {
    this.agendador.parar();
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
    this.ultimaDuracaoMsValor = 0;
    this.ultimaCargaMsValor = 0;
    this.ultimaPersistenciaMsValor = 0;
    this.cargaModelosAtual = undefined;
    this.ultimoFimCicloMs = null;
    this.sessaoId = criarSessionId();
    this.cicloSeq = 0;
    this.eventosPersistidos.clear();
    this.memoriaTemporalPersistida.clear();
    this.ciclosInterpretados = 0;
    this.ciclosComTruncamento = 0;
    this.estadoFrequencia = estadoInicialFrequenciaAdaptativa();
    this.motorTemporal?.resetar();
    this.store.limpar();

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

    const definicao = this.deps.obterModo();
    const variante = obterVariante(definicao.variante);
    try {
      // A variante B (sequencia) nao roda percepcao local: nada de modelos para
      // carregar e a sessao segue apenas com as imagens capturadas.
      if (variante.percepcaoLocal) {
        const inicioCarga = performance.now();
        const configuracao = await this.percepcao.configurar(
          (mensagem) => this.status(mensagem),
          this.deps.obterModelosPercepcao()
        );
        this.ultimaCargaMsValor = Math.round(performance.now() - inicioCarga);
        // Carga fria por modelo (P3.1): fica separada do custo aquecido de
        // inferencia e e replicada em cada ciclo da sessao.
        if (configuracao.carregamento) {
          this.cargaModelosAtual = {
            totalMs: this.ultimaCargaMsValor,
            subsistemas: configuracao.carregamento,
          };
        }

        // Sem nenhum subsistema carregado nao ha evidencia possivel: falha.
        if (configuracao.carregados.length === 0) {
          const motivo =
            configuracao.falhas.map((f) => `${f.subsistema}: ${f.motivo}`).join("; ") ||
            "nenhum subsistema disponivel";
          this.registrarOperacional("erro", definicao.origemFalha, motivo);
          this.falharInicializacao(`${definicao.falhaPrefixo}: ${motivo}`);
          return;
        }
      }
      if (!this.deps.camera.ativa) {
        this.falharInicializacao("A camera foi encerrada durante a inicializacao.");
        return;
      }

      this.motorTemporal = this.criarMotorTemporal();
      this.interpretadorAtual = this.deps.criarInterpretador();
      this.rodando = true;
      this.deps.aoUi({ tipo: "pronto", definicao });
      await this.agendador.iniciar();
    } catch (err) {
      this.registrarOperacional("erro", definicao.origemFalha, (err as Error).message);
      this.falharInicializacao(`${definicao.falhaPrefixo}: ${(err as Error).message}`);
    }
  }

  parar(): void {
    this.deps.aoUi({ tipo: "limpar_canvas" });
    this.encerrar();
    this.deps.aoUi({ tipo: "parado" });
  }

  /** Executa um ciclo completo. Publico para a interface e para os testes. */
  async executarCiclo(): Promise<void> {
    if (!this.rodando) return;
    const ctrl = new AbortController();
    this.abortador = ctrl;
    const { signal } = ctrl;
    this.deps.aoUi({ tipo: "spinner", ativo: true });
    try {
      const resultado = await executarCicloMultiframe(this.dependenciasCiclo(), signal);
      this.apresentarResultado(resultado);
    } catch (err) {
      if (ehCancelamento(err) || signal.aborted) {
        // Cancelamento e um desfecho legitimo: registra o motivo explicito para
        // que nenhum ciclo incompleto fique sem explicacao (criterio da Fase 4).
        this.registrarOperacional("info", "ciclo", "ciclo cancelado (sinal de aborto)");
        return;
      }
      this.registrarOperacional("erro", "percepcao", (err as Error).message);
      this.status(`Erro no ciclo de percepcao: ${(err as Error).message}`);
    } finally {
      // O flag de disparo manual vale para um unico ciclo.
      this.disparoManualPendente = false;
      if (this.abortador === ctrl) {
        this.abortador = null;
        this.deps.aoUi({ tipo: "spinner", ativo: false });
      }
    }
  }
  protected encerrar(): void {
    this.rodando = false;
    this.agendador.parar();
    if (this.abortador) {
      this.abortador.abort();
      this.abortador = null;
    }
    this.store.limpar();
    this.deps.camera.encerrar();
    void this.aguardarExecucao().then(async () => {
      try {
        await this.percepcao.encerrar?.();
      } catch (err) {
        this.status(`Falha ao liberar os modelos locais: ${(err as Error).message}`);
      }
    });
  }

  protected falharInicializacao(mensagem: string): void {
    this.encerrar();
    this.deps.aoUi({ tipo: "falha_inicializacao", mensagem });
  }

  protected status(texto: string): void {
    this.deps.aoUi({ tipo: "status", texto });
  }

  protected registrarOperacional(
    nivel: "info" | "aviso" | "erro",
    origem: string,
    mensagem: string
  ): void {
    void this.deps.repositorio.gravarOperacional({ nivel, origem, mensagem });
  }

  protected abstract dependenciasCiclo(): DependenciasCicloMultiframe;

  protected abstract apresentarResultado(resultado: ResultadoCiclo): void;
}
