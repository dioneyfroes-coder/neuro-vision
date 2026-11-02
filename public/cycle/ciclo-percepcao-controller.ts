import type { Caixa, EntradaLog, EventoTemporalEnvio, EventoVisual } from "../../src/types";
import type {
  CargaModelosCiclo,
  ConfiguracaoCiclo,
  PacoteCiclo,
  RegistroCiclo,
  ResultadoCiclo,
} from "../../src/domain/cycle";
import type { ObservacaoFrame } from "../../src/domain/observation";
import { criarCycleId, criarSessionId, uuid } from "../../src/domain/ids";
import { estaIndisponivel } from "../../src/domain/perception";
import { ehCancelamento } from "../../src/erros";
import { AgendadorAnalise } from "../scheduler";
import { SnapshotStore } from "../capture/snapshot-store";
import {
  CONFIG_CAPTURA_PADRAO,
  WebcamCapture,
  type ConfigCaptura,
  type DepsCaptura,
} from "../capture/webcam-capture";
import { executarCicloMultiframe } from "./ciclo-multiframe";
import type { DependenciasCicloMultiframe } from "./ciclo-multiframe";
import type {
  CameraCaptura,
  ControladorCiclo,
  EventoUi,
  ItemHistorico,
} from "./cycle-controller";
import type { DefinicaoModo } from "../modos";
import type { TarefaPersistencia } from "../persistencia";
import { criarProcessadorInativo } from "../perception/local-perception-pipeline";
import type {
  ConfiguracaoParcial,
  ModelosPercepcao,
  ProcessarFrameLocal,
} from "../perception/local-perception-pipeline";
import { obterVariante } from "../perception/variantes";
import type { VariantePercepcao } from "../perception/variantes";
import type { ModoMotorTemporal, MotorTemporal } from "../temporal/contracts";
import type { InterpretadorMultimodal } from "../interpretation/contracts";
import type { PoliticaCiclo } from "./politica-ciclo";
import { aplicarPolitica, decidirInterpretacao, POLITICA_CICLO_BENCHMARK_ALVO } from "./politica-ciclo";

/**
 * Controlador do ciclo multiframe (Etapa 5 + 6 + 8 ligadas a interface).
 *
 * Executa o pipeline completo — captura identificada, percepcao local (detector +
 * pose + maos), leitura temporal e interpretacao multimodal — e traduz o
 * `ResultadoCiclo` em `EventoUi`, do mesmo jeito que o `CycleController` de frame
 * unico. Toda a composicao concreta (detector, pose, maos, motor temporal,
 * interpretador) entra por injecao, para que a interface apenas escolha o modo.
 *
 * A variante do modo (`variantes.ts`, Etapa 9) decide o que roda: sem percepcao
 * local (B) o ciclo usa um processador inativo e nao carrega modelos; sem leitura
 * temporal (`ausente`) o `motorTemporal` e omitido do ciclo.
 *
 * Regras preservadas:
 * - a falha de um subsistema nao derruba o ciclo (o pipeline devolve
 *   `indisponivel`); a falha de carga so impede a sessao quando **nenhum**
 *   subsistema carrega;
 * - o diagnostico do ciclo e persistido em best-effort (Etapa 8);
 * - a interpretacao nunca recaptura a camera: usa os snapshots ja guardados.
 */

/** Repositorio de persistencia do ciclo multiframe (implementado pelo cliente HTTP). */
export interface RepositorioPercepcao {
  gravarCiclo(registro: RegistroCiclo): Promise<void>;
  gravarEntrada(entrada: EntradaLog): Promise<void>;
  /** Evento estruturado confirmado pelo motor temporal (mesmo arquivo dos demais modos). */
  gravarEvento(evento: EventoVisual): Promise<void>;
  /**
   * Atualizacao de gesto/postura/movimento corporal no stream temporal
   * (P2.6), separado de `eventos.jsonl`.
   */
  gravarEventoTemporal(evento: EventoTemporalEnvio): Promise<void>;
  gravarOperacional(registro: {
    nivel?: "info" | "aviso" | "erro";
    origem?: string;
    mensagem: string;
    detalhe?: string;
  }): Promise<void>;
}

/** Fila de gravacao usada para a entrada do historico (serializa/retenta). */
export interface FilaGravacao {
  agendar(tarefa: TarefaPersistencia): void;
}

/** Pipeline local de percepcao consumido pelo controlador (testavel com fake). */
export interface PercepcaoMultiframe {
  processarFrame: ProcessarFrameLocal;
  configurar(
    aoStatus?: (mensagem: string) => void,
    modelos?: ModelosPercepcao
  ): Promise<ConfiguracaoParcial>;
  encerrar?(): void | Promise<void>;
}

export interface DependenciasCicloPercepcao {
  camera: CameraCaptura;
  /** Renderizacao do progresso; `exibir_entrada` devolve o item para rastrear falhas. */
  aoUi: (evento: EventoUi) => ItemHistorico | void;
  repositorio: RepositorioPercepcao;
  fila: FilaGravacao;
  /** Definicao do modo multiframe (diagnostico e mensagens de falha). */
  obterModo: () => DefinicaoModo;
  /** Pipeline local de percepcao (detector + pose + maos) ja composto. */
  criarPercepcao: () => PercepcaoMultiframe;
  /** Modelos a carregar no inicio da sessao (respeita o seletor da interface). */
  obterModelosPercepcao: () => ModelosPercepcao;
  /**
   * Cria o motor temporal do nivel pedido (`basico`/`ampliado`), recriado por
   * sessao. A variante sem leitura temporal (`ausente`, B) nao chama a fabrica.
   */
  criarMotorTemporal: (modo: ModoMotorTemporal) => MotorTemporal;
  /** Interpretador multimodal (sem acesso a camera). */
  criarInterpretador: () => InterpretadorMultimodal;
  /** Intervalo entre ciclos lido da interface. */
  obterIntervaloMs: () => number;
  /**
   * Politica do ciclo (Fase 4): espacamento/quantidade de snapshots, pausa
   * pos-ciclo e frequencia da interpretacao. Padrao: `POLITICA_CICLO_BENCHMARK_ALVO`.
   * A `configuracaoCaptura` continua sendo a fonte dos parametros de captura; a
   * politica fornece a pausa pos-ciclo e a decisao de interpretar.
   */
  politicaCiclo?: PoliticaCiclo;
  /** Captura: configuracao e relogios injetaveis (testes deterministicos). */
  configuracaoCaptura?: ConfigCaptura;
  dependenciasCaptura?: DepsCaptura;
}

function caixasDe(
  observacao: ObservacaoFrame | undefined
): Array<{ nome: string; score: number; caixa: Caixa }> {
  if (!observacao || estaIndisponivel(observacao.deteccoes)) return [];
  return observacao.deteccoes.deteccoes.map((deteccao) => ({
    nome: deteccao.nome,
    score: deteccao.score,
    caixa: deteccao.caixa,
  }));
}

export class CicloPercepcaoController implements ControladorCiclo {
  private readonly agendador: AgendadorAnalise;
  private readonly captura: WebcamCapture;
  private readonly configuracaoCaptura: ConfigCaptura;
  private readonly store: SnapshotStore;
  private readonly percepcao: PercepcaoMultiframe;
  private readonly processarInativo: ProcessarFrameLocal = criarProcessadorInativo();
  private motorTemporal: MotorTemporal | null;
  private interpretadorAtual: InterpretadorMultimodal | null = null;
  private sessaoId = criarSessionId();
  private cicloSeq = 0;
  /** Eventos temporais ja gravados nesta sessao (identidade unica por evento). */
  private readonly eventosPersistidos = new Set<string>();
  /**
   * Atualizacoes de gesto/postura ja gravadas nesta sessao, por
   * `eventoId:estado` (um evento pode passar por `confirmado` e `encerrado`;
   * `incerto` tambem e memoria, mas `candidato` nunca e).
   */
  private readonly memoriaTemporalPersistida = new Set<string>();
  private rodando = false;
  private abortador: AbortController | null = null;
  private ultimaDuracaoMsValor = 0;
  private ultimaCargaMsValor = 0;
  private ultimaPersistenciaMsValor = 0;
  /** Carga fria dos modelos da sessao (P3.1); ausente na variante sem percepcao. */
  private cargaModelosAtual: CargaModelosCiclo | undefined;
  /** Fim monotonico do ultimo ciclo; base da latencia entre ciclos. */
  private ultimoFimCicloMs: number | null = null;
  /** Politica do ciclo (Fase 4): pausa pos-ciclo e frequencia da interpretacao. */
  private readonly politicaCiclo: PoliticaCiclo;
  /**
   * Marca que o proximo ciclo foi pedido pela interface (`solicitarManual`).
   * Consumido uma vez por ciclo; alimenta a decisao `sob_demanda`.
   */
  private disparoManualPendente = false;

  constructor(private readonly deps: DependenciasCicloPercepcao) {
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

  get agendamentoExecutando(): boolean {
    return this.agendador.estaExecutando;
  }

  /** Variante do modo ativo (B/C/D); sem declaracao explicita assume a alvo (D). */
  private variante(): VariantePercepcao {
    return obterVariante(this.deps.obterModo().variante);
  }

  /** Cria o motor temporal do nivel da variante; `null` quando nao ha leitura. */
  private criarMotorTemporal(): MotorTemporal | null {
    const nivel = this.variante().temporal;
    return nivel === "ausente" ? null : this.deps.criarMotorTemporal(nivel);
  }

  reiniciarSessao(_opcoes: { manterContexto?: boolean } = {}): void {
    this.sessaoId = criarSessionId();
    this.cicloSeq = 0;
    this.eventosPersistidos.clear();
    this.memoriaTemporalPersistida.clear();
    this.ultimoFimCicloMs = null;
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

  private dependenciasCiclo(): DependenciasCicloMultiframe {
    return {
      captura: this.captura,
      store: this.store,
      processarFrame: this.variante().percepcaoLocal
        ? this.percepcao.processarFrame
        : this.processarInativo,
      interpretador: this.interpretadorAtual ?? this.deps.criarInterpretador(),
      motorTemporal: this.motorTemporal ?? undefined,
      sessaoId: this.sessaoId,
      proximoCycleId: () => criarCycleId(this.sessaoId, (this.cicloSeq += 1)),
      decidirInterpretacao: (resumoTemporal) => {
        const decisao = decidirInterpretacao(this.politicaCiclo, resumoTemporal, {
          disparoManual: this.disparoManualPendente,
        });
        return { interpretar: decisao.interpretar, motivo: decisao.motivo };
      },
      obterPolitica: () => aplicarPolitica(this.politicaCiclo),
      obterConfiguracaoCiclo: (): ConfiguracaoCiclo => ({
        varianteId: this.variante().id,
        quantidadeSnapshotsConfigurada: this.configuracaoCaptura.quadros,
        intervaloEntreSnapshotsMs: this.configuracaoCaptura.intervaloMs,
        intervaloAgendamentoMs: this.deps.obterIntervaloMs(),
        ...(this.interpretadorAtual?.diagnostico
          ? { interpretador: this.interpretadorAtual.diagnostico }
          : {}),
      }),
      persistirCiclo: (registro) => this.deps.repositorio.gravarCiclo(registro),
      obterCargaModelos: () => this.cargaModelosAtual,
      obterLatenciaEntreCiclosMs: () =>
        this.ultimoFimCicloMs === null
          ? undefined
          : Math.round(performance.now() - this.ultimoFimCicloMs),
      registrarFimCiclo: (fimMs) => {
        this.ultimoFimCicloMs = fimMs;
      },
    };
  }

  /**
   * Traduz o resultado do ciclo em `EventoUi`: caixas do ultimo frame, entrada
   * com a interpretacao e status. Um ciclo sem frames nao gera entrada (nao ha
   * evidencia), apenas sinaliza que a camera ainda nao entregou imagem.
   */
  private apresentarResultado(resultado: ResultadoCiclo): void {
    const { pacote } = resultado;
    this.ultimaDuracaoMsValor = pacote.metricas.totalMs ?? 0;
    this.ultimaPersistenciaMsValor = pacote.metricas.persistenciaMs ?? 0;

    const ultima = pacote.observacoes[pacote.observacoes.length - 1];
    if (!ultima) {
      this.status("Sem frame da camera ainda; aguardando imagem para analisar.");
      return;
    }

    if (this.deps.camera.largura > 0 && this.deps.camera.altura > 0) {
      this.deps.aoUi({
        tipo: "preparar_canvas",
        largura: this.deps.camera.largura,
        altura: this.deps.camera.altura,
      });
    }
    this.deps.aoUi({ tipo: "desenhar_caixas", objetos: caixasDe(ultima) });

    // Interpretacao suprimida pela politica (Fase 4): o frame foi observado, mas
    // nao houve nova interpretacao — sem entrada no historico. Os eventos
    // temporais e o diagnostico continuam sendo persistidos.
    if (pacote.metricas.interpretacaoSuprimida) {
      this.persistirEventosTemporais(pacote);
      this.persistirMemoriaTemporal(pacote);
      this.status(
        this.resumoStatus(pacote.cycleId, undefined, pacote.metricas.totalMs) +
          ` (interpretacao suprimida: ${pacote.metricas.interpretacaoSuprimida})`
      );
      return;
    }

    const resumo = resultado.interpretacao?.trim();
    const entrada: EntradaLog = {
      timestamp: new Date().toISOString(),
      modelo: this.interpretadorAtual?.modelo ?? "multiframe",
      objetos: [],
      resumo: resumo && resumo.length > 0 ? resumo : "sem interpretacao",
      tipo: "descricao",
      snapshot: ultima.thumb,
      capturadoEm: ultima.capturadoEm,
      frameId: ultima.frameId,
      sessaoId: pacote.sessionId,
      ms: pacote.metricas.multimodalMs,
    };
    const item = this.deps.aoUi({ tipo: "exibir_entrada", entrada });
    this.persistirEntrada(entrada, item);
    this.persistirEventosTemporais(pacote);
    this.persistirMemoriaTemporal(pacote);
    this.status(this.resumoStatus(pacote.cycleId, resumo, pacote.metricas.totalMs));
  }

  private resumoStatus(cycleId: string, resumo: string | undefined, totalMs?: number): string {
    const texto = resumo && resumo.length > 0 ? resumo : "sem interpretacao";
    const duracao = totalMs === undefined ? "" : ` (${totalMs} ms)`;
    return `Ciclo ${cycleId}: ${texto}${duracao}`;
  }

  private persistirEntrada(entrada: EntradaLog, item: ItemHistorico | void): void {
    this.deps.fila.agendar({
      descricao: "entrada:multiframe",
      payload: entrada,
      executar: () => this.deps.repositorio.gravarEntrada(entrada),
      aoFalhar: () => item?.marcarNaoGravado(),
    });
  }

  /**
   * Persiste os eventos temporais do ciclo como `EventoVisual` — mesmo
   * arquivo (`eventos.jsonl`) e API dos demais modos, para que
   * `npm run qualidade` meça cada variante (Etapa 9) sobre os mesmos eventos.
   *
   * Um `EventoTemporal` tem identidade unica e e atualizado entre ciclos, entao:
   * - **uma gravacao por `eventoId`** (o Set `eventosPersistidos` evita duplicar
   *   a mesma identidade a cada ciclo em que ela aparece);
   * - **so `confirmado`/`encerrado`**: candidato/incerto nunca vira fato;
   * - `timestamp` = `inicioEm` (o instante real do acontecimento, nao o fim da
   *   confirmacao) — e o que o casamento da avaliacao usa.
   *
   * Tipos sem equivalente em `EventoVisual` (`gesto_detectado`,
   * `braco_levantado`, `movimento_corporal`) nao entram neste stream: vao para
   * a memoria temporal propria em `persistirMemoriaTemporal`. `movimento_objeto`
   * e adaptado ao rótulo visual legado `movimento` com origem semantica explícita.
   */
  private persistirEventosTemporais(pacote: PacoteCiclo): void {
    for (const evt of pacote.eventosTemporais) {
      if (this.eventosPersistidos.has(evt.eventoId)) continue;
      if (evt.estado !== "confirmado" && evt.estado !== "encerrado") continue;
      if (
        evt.tipo !== "aparicao" &&
        evt.tipo !== "desaparecimento" &&
        evt.tipo !== "mudanca_de_cena" &&
        evt.tipo !== "movimento_objeto"
      ) {
        continue;
      }
      this.eventosPersistidos.add(evt.eventoId);

      // Evidencia: o ultimo frame do evento; sem ele, o ultimo frame do ciclo.
      const ultimoFrameId = evt.frameIds[evt.frameIds.length - 1];
      const obs =
        pacote.observacoes.find((o) => o.frameId === ultimoFrameId) ??
        pacote.observacoes[pacote.observacoes.length - 1];
      const modeloDeteccao =
        obs && !estaIndisponivel(obs.deteccoes) ? obs.deteccoes.modelo : undefined;
      const evento: EventoVisual = {
        id: evt.eventoId,
        timestamp: evt.inicioEm,
        tipo: evt.tipo === "movimento_objeto" ? "movimento" : evt.tipo,
        objetoId: evt.entidadeId,
        rotuloObjeto: evt.rotuloObjeto,
        descricao: evt.descricao,
        confianca: evt.confianca,
        origem: "rastreador",
        origensSinal: evt.origens,
        snapshot: obs?.thumb,
        modelo: modeloDeteccao,
        sessaoId: pacote.sessionId,
        idempotencyKey: uuid(),
        frameId: obs?.frameId,
      };
      this.deps.fila.agendar({
        descricao: `evento:multiframe:${evt.tipo}`,
        payload: evento,
        executar: () => this.deps.repositorio.gravarEvento(evento),
      });
    }
  }

  /**
   * Persiste a memoria pesquisavel de gestos/posturas/movimento corporal no
   * stream temporal (`eventos-temporais.jsonl`), separado dos fatos visuais.
   *
   * - so `gesto_detectado`, `braco_levantado` e `movimento_corporal` entram;
   * - `candidato` nunca vira memoria; `confirmado`, `encerrado` e `incerto`
   *   entram, cada um uma unica vez por `eventoId:estado`;
   * - `incerto` preserva `intervaloSemObservacaoMs`, para distinguir "o sinal
   *   parou" de "a observacao parou";
   * - a chave de idempotencia e estavel (`eventoId:estado`), entao uma
   *   retentativa da fila nao duplica a atualizacao no servidor.
   */
  private persistirMemoriaTemporal(pacote: PacoteCiclo): void {
    for (const evt of pacote.eventosTemporais) {
      if (
        evt.tipo !== "gesto_detectado" &&
        evt.tipo !== "braco_levantado" &&
        evt.tipo !== "movimento_corporal"
      ) {
        continue;
      }
      if (evt.estado !== "confirmado" && evt.estado !== "encerrado" && evt.estado !== "incerto") {
        continue;
      }
      const chave = `${evt.eventoId}:${evt.estado}`;
      if (this.memoriaTemporalPersistida.has(chave)) continue;
      this.memoriaTemporalPersistida.add(chave);

      const evento: EventoTemporalEnvio = {
        eventoId: evt.eventoId,
        sessionId: evt.sessionId,
        cycleId: evt.cycleId,
        tipo: evt.tipo,
        inicioEm: evt.inicioEm,
        fimEm: evt.fimEm,
        ultimaEvidenciaEm: evt.ultimaEvidenciaEm,
        ultimaObservacaoEm: evt.ultimaObservacaoEm,
        entidadeId: evt.entidadeId,
        descricao: evt.descricao,
        confianca: evt.confianca,
        origens: evt.origens,
        frameIds: evt.frameIds,
        estado: evt.estado,
        intervaloSemObservacaoMs: evt.intervaloSemObservacaoMs,
        idempotencyKey: chave,
      };
      this.deps.fila.agendar({
        descricao: `memoria:${evt.tipo}:${evt.estado}`,
        payload: evento,
        executar: () => this.deps.repositorio.gravarEventoTemporal(evento),
      });
    }
  }

  private encerrar(): void {
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

  private falharInicializacao(mensagem: string): void {
    this.encerrar();
    this.deps.aoUi({ tipo: "falha_inicializacao", mensagem });
  }

  private status(texto: string): void {
    this.deps.aoUi({ tipo: "status", texto });
  }

  private registrarOperacional(
    nivel: "info" | "aviso" | "erro",
    origem: string,
    mensagem: string
  ): void {
    void this.deps.repositorio.gravarOperacional({ nivel, origem, mensagem });
  }
}
