import type {
  Caixa,
  EntradaLog,
  EventoVisual,
  MarcacaoNsfwLog,
} from "../../../src/types";
import type { MotorPercepcao } from "../../../src/percepcao";
import { uuid } from "../../../src/domain/ids";
import type { FilaPersistencia } from "../../persistencia";
import type { DefinicaoModo } from "../../modos";
import type { OpcoesMotorVisao } from "../../motores";
import type { ClassificadorNsfw } from "../../perception/contracts";

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
  | {
      tipo: "desenhar_caixas";
      objetos: ReadonlyArray<{ nome: string; score: number; caixa: Caixa }>;
      /** Marcacoes NSFW com caixas normalizadas (desenhadas em cor distinta). */
      nsfw?: ReadonlyArray<MarcacaoNsfwLog>;
    }
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
    larguraThumb?: number,
    qualidade?: number
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
  /**
   * Classificador NSFW experimental injetado pelo app (worker-first). Quando
   * ausente, o modo de frame unico roda sem o subsistema.
   */
  classificadorNsfw?: ClassificadorNsfw;
  /** Modelo NSFW a carregar; `undefined` desliga o subsistema nesta sessao. */
  obterModeloNsfw?: () => string | undefined;
  /**
   * Contexto/metadado declarado (anotacao do usuario). Vai ao prompt como
   * declaracao, nunca como observacao visual. Ausente = nenhum contexto.
   */
  obterContexto?: () => string | undefined;
}

export function gerarId(): string {
  return uuid().replace(/-/g, "").slice(0, 12);
}

/**
 * Dimensoes da imagem apos `Camera.capturarFrame(maxWidth)`: mesma regra de
 * escala usada pela captura, para normalizar caixas NSFW sem depender do
 * tamanho original do video.
 */
export function dimensoesReduzidas(
  largura: number,
  altura: number,
  maxWidth: number
): { largura: number; altura: number } {
  const escala = maxWidth > 0 && largura > maxWidth ? maxWidth / largura : 1;
  return {
    largura: Math.round(largura * escala),
    altura: Math.round(altura * escala),
  };
}

/**
 * Superficie comum dos controladores de ciclo (frame unico e multiframe).
 *
 * A interface (`public/app.ts`) escolhe o controlador pelo modo ativo e usa
 * apenas estes metodos, sem conhecer qual implementacao esta por tras.
 */
export interface ControladorCiclo {
  readonly estaRodando: boolean;
  readonly ultimaDuracaoMs: number;
  readonly ultimaCargaMs: number;
  readonly ultimaPersistenciaMs: number;
  readonly agendamentoExecutando: boolean;
  iniciar(): Promise<void>;
  parar(): void;
  aoTrocarModo(): void;
  reiniciarSessao(opcoes?: { manterContexto?: boolean }): void;
  reidratarContexto(roteiro: string[], ultimaDescricao: string): void;
  solicitarManual(): void;
  reajustarAgendamento(): void;
  pararAgendamento(): void;
  aguardarExecucao(): Promise<void>;
  retomarAgendamento(): Promise<void>;
}
