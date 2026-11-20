import { vi } from "vitest";

import { CicloPercepcaoController } from "../../../public/cycle/ciclo-percepcao-controller";
import type {
  DependenciasCicloPercepcao,
  FilaGravacao,
  RepositorioPercepcao,
} from "../../../public/cycle/ciclo-percepcao-controller";
import type { EventoUi, ItemHistorico } from "../../../public/cycle/cycle-controller";
import type { MotorTemporal } from "../../../public/temporal/contracts";
import type { ConfiguracaoParcial, ModelosPercepcao } from "../../../public/perception/local-perception-pipeline";
import type { DefinicaoModo } from "../../../public/modos";
import type { ConfigCaptura } from "../../../public/capture/webcam-capture";
import type { TarefaPersistencia } from "../../../public/persistencia";
import type { RegistroCiclo } from "../../../src/domain/cycle";
import type { ResultadoInterpretacao } from "../../../src/domain/interpretation";
import type { EntradaLog, EventoTemporalEnvio, EventoVisual } from "../../../src/types";
import type { EventoTemporal } from "../../../src/domain/temporal-event";
import type { ResumoTemporal } from "../../../src/domain";
import type { PoliticaCiclo } from "../../../public/cycle/politica-ciclo";
import { CONFIG_CAPTURA, DEPS_CAPTURA, MODO } from "./constantes";
import { cameraFalsa, percepcaoFalsa } from "./fabricas";

interface Contexto {
  controle: CicloPercepcaoController;
  eventos: EventoUi[];
  ciclos: RegistroCiclo[];
  entradas: EntradaLog[];
  eventosVisuais: EventoVisual[];
  eventosTemporaisMemoria: EventoTemporalEnvio[];
  operacionais: Array<{ nivel?: string; origem?: string; mensagem: string }>;
  tarefas: TarefaPersistencia[];
  motorTemporal: MotorTemporal;
  resetes: ReturnType<typeof vi.fn>;
  cameraEstado: { iniciadas: number; encerradas: number };
  modelosVistos: ModelosPercepcao[];
  encerramentosPercepcao: ReturnType<typeof vi.fn>;
  naoGravados: number;
  modosTemporais: string[];
  /** Quantas vezes a interpretacao multimodal foi efetivamente chamada. */
  interpretacoes: () => number;
}

export function montar(
  opcoes: {
    configuracao?: ConfiguracaoParcial;
    falhaAoIniciar?: Error;
    modelos?: ModelosPercepcao;
    semFrame?: boolean;
    modo?: DefinicaoModo;
    /** Eventos que o motor temporal falso devolve a cada ciclo. */
    eventosTemporais?: EventoTemporal[];
    /** Politica do ciclo (Fase 4); padrao do controlador: `POLITICA_CICLO_BENCHMARK_ALVO`. */
    politica?: PoliticaCiclo;
    /** Diagnostico de compactacao devolvido pelo interpretador falso. */
    contextoMultimodal?: ResultadoInterpretacao["contextoMultimodal"];
    /** Resumo temporal por ciclo, para simular entrada/saida de pessoas. */
    resumoPorCiclo?: (indice: number) => ResumoTemporal;
    /** Relogio monotonico injetado na captura (testes de cadencia). */
    capturaAgora?: () => number;
    /** Configuracao de captura (quantidade/intervalo de snapshots). */
    configCaptura?: Partial<ConfigCaptura>;
  } = {}
): Contexto {
  const eventos: EventoUi[] = [];
  const ciclos: RegistroCiclo[] = [];
  const entradas: EntradaLog[] = [];
  const eventosVisuais: EventoVisual[] = [];
  const eventosTemporaisMemoria: EventoTemporalEnvio[] = [];
  const operacionais: Array<{ nivel?: string; origem?: string; mensagem: string }> = [];
  const tarefas: TarefaPersistencia[] = [];
  let naoGravados = 0;

  const { camera, estado } = cameraFalsa({
    falhaAoIniciar: opcoes.falhaAoIniciar,
    semFrame: opcoes.semFrame,
  });
  const { percepcao, modelosVistos, encerramentos } = percepcaoFalsa(opcoes.configuracao);

  const repositorio: RepositorioPercepcao = {
    gravarCiclo: async (registro) => {
      ciclos.push(registro);
    },
    gravarEntrada: async (entrada) => {
      entradas.push(entrada);
    },
    gravarEvento: async (evento) => {
      eventosVisuais.push(evento);
    },
    gravarEventoTemporal: async (evento) => {
      eventosTemporaisMemoria.push(evento);
    },
    gravarOperacional: async (registro) => {
      operacionais.push(registro);
    },
  };

  const fila: FilaGravacao = {
    agendar: (tarefa) => {
      tarefas.push(tarefa);
    },
  };

  const resetes = vi.fn();
  let indiceResumo = 0;
  const motorTemporal: MotorTemporal = {
    processar: () => {
      const resumo = opcoes.resumoPorCiclo?.(indiceResumo++) ?? {
        eventos: (opcoes.eventosTemporais ?? []).map((e) => ({ ...e })),
        tracksAtivos: 0,
        pessoasAtivas: 0,
        maosAtivas: 0,
        objetosAtivos: 0,
      };
      // O motor falso nao enriquece observacoes: omitir o campo preserva o
      // fallback do ciclo (usar as observacoes originais).
      return resumo as ReturnType<MotorTemporal["processar"]>;
    },
    resetar: resetes,
  };
  const modosTemporais: string[] = [];
  let interpretacoes = 0;

  const aoUi = (evento: EventoUi): ItemHistorico | void => {
    eventos.push(evento);
    if (evento.tipo === "exibir_entrada") {
      return {
        marcarNaoGravado: () => {
          naoGravados += 1;
        },
      };
    }
  };

  const deps: DependenciasCicloPercepcao = {
    camera,
    aoUi,
    repositorio,
    fila,
    obterModo: () => opcoes.modo ?? MODO,
    criarPercepcao: () => percepcao,
    obterModelosPercepcao: () => opcoes.modelos ?? { objetos: "onnx-community/yolov10n" },
    criarMotorTemporal: (modo) => {
      modosTemporais.push(modo);
      return motorTemporal;
    },
    criarInterpretador: () => ({
      modelo: "modelo-teste",
      diagnostico: {
        modeloSolicitado: "modelo-teste",
        incluirDadosLocais: true,
        limites: {
          maxImagens: 4,
          maxEventos: 20,
          maxPontosPorFrame: 6,
          decimais: 2,
          maxBytesContexto: 16_000,
        },
        serializacao: {
          decimais: 2,
          landmarksCompletos: false,
          geometriaMao: true,
          confiancaMinimaKeypoint: 0.3,
          maxKeypointsPorPessoa: 17,
          confiancaMinimaDeteccao: 0,
          maxDeteccoesPorFrame: 20,
          maxPessoasPorFrame: 8,
          maxMaosPorFrame: 8,
        },
      },
      interpretar: async (): Promise<ResultadoInterpretacao> => {
        interpretacoes += 1;
        return {
          resumo: "pessoa gesticulando entre dois frames",
          acoes: [],
          evidencias: [],
          incertezas: [],
          contradicoes: [],
          duracaoMs: 10,
          ...(opcoes.contextoMultimodal
            ? { contextoMultimodal: opcoes.contextoMultimodal }
            : {}),
        };
      },
    }),
    obterIntervaloMs: () => 4000,
    politicaCiclo: opcoes.politica,
    configuracaoCaptura: { ...CONFIG_CAPTURA, ...opcoes.configCaptura },
    dependenciasCaptura: {
      ...DEPS_CAPTURA,
      ...(opcoes.capturaAgora ? { agora: opcoes.capturaAgora } : {}),
    },
  };

  return {
    controle: new CicloPercepcaoController(deps),
    eventos,
    ciclos,
    entradas,
    eventosVisuais,
    eventosTemporaisMemoria,
    operacionais,
    tarefas,
    motorTemporal,
    resetes,
    cameraEstado: estado,
    modelosVistos,
    encerramentosPercepcao: encerramentos,
    modosTemporais,
    get naoGravados() {
      return naoGravados;
    },
    interpretacoes: () => interpretacoes,
  } as Contexto;
}

export function primeiro<T extends EventoUi["tipo"]>(eventos: EventoUi[], tipo: T): Extract<EventoUi, { tipo: T }> | undefined {
  return eventos.find((e) => e.tipo === tipo) as Extract<EventoUi, { tipo: T }> | undefined;
}
