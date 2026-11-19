import type {
  Caixa,
  EntradaLog,
  EventoTemporalEnvio,
  EventoVisual,
} from "../../../src/types";
import type { RegistroCiclo } from "../../../src/domain/cycle";
import type { ObservacaoFrame } from "../../../src/domain/observation";
import { estaIndisponivel } from "../../../src/domain/perception";
import type { ConfigCaptura, DepsCaptura } from "../../capture/webcam-capture";
import type {
  CameraCaptura,
  EventoUi,
  ItemHistorico,
} from "../cycle-controller";
import type { DefinicaoModo } from "../../modos";
import type { TarefaPersistencia } from "../../persistencia";
import type {
  ConfiguracaoParcial,
  ModelosPercepcao,
  ProcessarFrameLocal,
} from "../../perception/local-perception-pipeline";
import type { ModoMotorTemporal, MotorTemporal } from "../../temporal/contracts";
import type { InterpretadorMultimodal } from "../../interpretation/contracts";
import type { PoliticaCiclo } from "../politica-ciclo";

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

export function caixasDe(
  observacao: ObservacaoFrame | undefined
): Array<{ nome: string; score: number; caixa: Caixa }> {
  if (!observacao || estaIndisponivel(observacao.deteccoes)) return [];
  return observacao.deteccoes.deteccoes.map((deteccao) => ({
    nome: deteccao.nome,
    score: deteccao.score,
    caixa: deteccao.caixa,
  }));
}
