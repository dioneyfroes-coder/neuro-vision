import { describe, expect, it, vi } from "vitest";
import { CicloPercepcaoController } from "../public/cycle/ciclo-percepcao-controller";
import type {
  DependenciasCicloPercepcao,
  FilaGravacao,
  PercepcaoMultiframe,
  RepositorioPercepcao,
} from "../public/cycle/ciclo-percepcao-controller";
import type { CameraCaptura, EventoUi, ItemHistorico } from "../public/cycle/cycle-controller";
import type { ProcessamentoFrame } from "../public/cycle/ciclo-multiframe";
import type { MotorTemporal } from "../public/temporal/contracts";
import type { ConfiguracaoParcial, ModelosPercepcao } from "../public/perception/local-perception-pipeline";
import type { DefinicaoModo } from "../public/modos";
import { VARIANTES_PERCEPCAO } from "../public/perception/variantes";
import { CONFIG_CAPTURA_PADRAO } from "../public/capture/webcam-capture";
import type { TarefaPersistencia } from "../public/persistencia";
import type { RegistroCiclo } from "../src/domain/cycle";
import type { ResultadoInterpretacao } from "../src/domain/interpretation";
import type { EntradaLog, EventoVisual } from "../src/types";
import type { EventoTemporal } from "../src/domain/temporal-event";
import type { PoliticaCiclo } from "../public/cycle/politica-ciclo";
import {
  POLITICA_CICLO_BENCHMARK_ALVO,
  POLITICA_CICLO_OPERACIONAL,
} from "../public/cycle/politica-ciclo";

const MODO: DefinicaoModo = {
  id: "percepcao",
  usaDeteccao: true,
  usaVisao: true,
  permiteAnaliseManual: false,
  falhaPrefixo: "Falha ao carregar o pipeline de percepcao",
  origemFalha: "detector",
  multiframe: true,
};

const MODO_B: DefinicaoModo = {
  id: "percepcao-sequencia",
  usaDeteccao: false,
  usaVisao: true,
  permiteAnaliseManual: false,
  falhaPrefixo: "Falha ao capturar a sequencia de frames",
  origemFalha: "visao",
  multiframe: true,
  variante: VARIANTES_PERCEPCAO.sequencia,
};

const MODO_C: DefinicaoModo = {
  id: "percepcao-fundida",
  usaDeteccao: true,
  usaVisao: true,
  permiteAnaliseManual: false,
  falhaPrefixo: "Falha ao carregar o pipeline de percepcao",
  origemFalha: "detector",
  multiframe: true,
  variante: VARIANTES_PERCEPCAO.fundida,
};

const CONFIG_CAPTURA = { ...CONFIG_CAPTURA_PADRAO, quadros: 2, intervaloMs: 0 };
const DEPS_CAPTURA = {
  agora: () => 0,
  esperar: async () => undefined,
  agoraIso: () => "2026-10-17T12:00:00.000Z",
};

function processamento(): ProcessamentoFrame {
  return {
    deteccoes: {
      deteccoes: [
        { nome: "pessoa", rotulo: "person", score: 0.9, caixa: { xmin: 1, ymin: 2, xmax: 30, ymax: 40 } },
      ],
      dimensoes: { largura: 640, altura: 480 },
    },
    pose: { pessoas: [] },
    maos: { maos: [] },
    metricas: {},
  };
}

function cameraFalsa(opcoes: { falhaAoIniciar?: Error; semFrame?: boolean } = {}): {
  camera: CameraCaptura;
  estado: { iniciadas: number; encerradas: number };
} {
  const estado = { iniciadas: 0, encerradas: 0 };
  const camera: CameraCaptura = {
    ativa: true,
    largura: 640,
    altura: 480,
    iniciar: async () => {
      estado.iniciadas += 1;
      if (opcoes.falhaAoIniciar) throw opcoes.falhaAoIniciar;
    },
    encerrar: () => {
      estado.encerradas += 1;
    },
    capturarFrame: () => "data:image/jpeg;base64,AAAA",
    capturarQuadro: () =>
      opcoes.semFrame
        ? null
        : {
            imagem: "data:image/jpeg;base64,AAAA",
            thumb: "data:image/jpeg;base64,thumb",
          },
    assinaturaDeCena: () => [0, 0],
  };
  return { camera, estado };
}

function percepcaoFalsa(configuracao?: ConfiguracaoParcial): {
  percepcao: PercepcaoMultiframe;
  modelosVistos: ModelosPercepcao[];
} {
  const modelosVistos: ModelosPercepcao[] = [];
  const percepcao: PercepcaoMultiframe = {
    processarFrame: async () => processamento(),
    configurar: async (_aoStatus, modelos) => {
      modelosVistos.push(modelos ?? {});
      return configuracao ?? { carregados: ["deteccao", "pose", "maos"], falhas: [] };
    },
  };
  return { percepcao, modelosVistos };
}

interface Contexto {
  controle: CicloPercepcaoController;
  eventos: EventoUi[];
  ciclos: RegistroCiclo[];
  entradas: EntradaLog[];
  eventosVisuais: EventoVisual[];
  operacionais: Array<{ nivel?: string; origem?: string; mensagem: string }>;
  tarefas: TarefaPersistencia[];
  motorTemporal: MotorTemporal;
  resetes: ReturnType<typeof vi.fn>;
  cameraEstado: { iniciadas: number; encerradas: number };
  modelosVistos: ModelosPercepcao[];
  naoGravados: number;
  modosTemporais: string[];
  /** Quantas vezes a interpretacao multimodal foi efetivamente chamada. */
  interpretacoes: () => number;
}

function montar(
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
  } = {}
): Contexto {
  const eventos: EventoUi[] = [];
  const ciclos: RegistroCiclo[] = [];
  const entradas: EntradaLog[] = [];
  const eventosVisuais: EventoVisual[] = [];
  const operacionais: Array<{ nivel?: string; origem?: string; mensagem: string }> = [];
  const tarefas: TarefaPersistencia[] = [];
  let naoGravados = 0;

  const { camera, estado } = cameraFalsa({
    falhaAoIniciar: opcoes.falhaAoIniciar,
    semFrame: opcoes.semFrame,
  });
  const { percepcao, modelosVistos } = percepcaoFalsa(opcoes.configuracao);

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
  const motorTemporal: MotorTemporal = {
    processar: () => ({
      eventos: (opcoes.eventosTemporais ?? []).map((e) => ({ ...e })),
      entidadesAtivas: 0,
    }),
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
      interpretar: async (): Promise<ResultadoInterpretacao> => {
        interpretacoes += 1;
        return {
          resumo: "pessoa gesticulando entre dois frames",
          acoes: [],
          evidencias: [],
          incertezas: [],
          contradicoes: [],
          duracaoMs: 10,
        };
      },
    }),
    obterIntervaloMs: () => 4000,
    politicaCiclo: opcoes.politica,
    configuracaoCaptura: CONFIG_CAPTURA,
    dependenciasCaptura: DEPS_CAPTURA,
  };

  return {
    controle: new CicloPercepcaoController(deps),
    eventos,
    ciclos,
    entradas,
    eventosVisuais,
    operacionais,
    tarefas,
    motorTemporal,
    resetes,
    cameraEstado: estado,
    modelosVistos,
    modosTemporais,
    get naoGravados() {
      return naoGravados;
    },
    interpretacoes: () => interpretacoes,
  } as Contexto;
}

function primeiro<T extends EventoUi["tipo"]>(eventos: EventoUi[], tipo: T): Extract<EventoUi, { tipo: T }> | undefined {
  return eventos.find((e) => e.tipo === tipo) as Extract<EventoUi, { tipo: T }> | undefined;
}

describe("CicloPercepcaoController", () => {
  it("inicia, roda um ciclo multiframe e persiste diagnostico e entrada", async () => {
    const ctx = montar();
    await ctx.controle.iniciar();

    expect(ctx.cameraEstado.iniciadas).toBe(1);
    expect(ctx.controle.estaRodando).toBe(true);
    expect(primeiro(ctx.eventos, "pronto")).toMatchObject({ definicao: MODO });

    // O diagnostico do ciclo guarda as relacoes sessao/ciclo/frames (2 quadros).
    expect(ctx.ciclos).toHaveLength(1);
    expect(ctx.ciclos[0].observacoes).toBe(2);
    expect(ctx.ciclos[0].frameIds).toHaveLength(2);

    // As caixas do ultimo frame foram desenhadas.
    const caixas = primeiro(ctx.eventos, "desenhar_caixas");
    expect(caixas?.objetos).toHaveLength(1);
    expect(caixas?.objetos[0].nome).toBe("pessoa");

    // A interpretacao virou uma entrada do historico.
    const entrada = primeiro(ctx.eventos, "exibir_entrada");
    expect(entrada?.entrada).toMatchObject({
      tipo: "descricao",
      modelo: "modelo-teste",
      resumo: "pessoa gesticulando entre dois frames",
      snapshot: "data:image/jpeg;base64,thumb",
    });
    expect(entrada?.entrada.frameId).toBe(ctx.ciclos[0].frameIds[1]);

    // A entrada foi enfileirada para gravacao (retentativa/ordem).
    expect(ctx.tarefas.map((t) => t.descricao)).toContain("entrada:multiframe");
    await Promise.all(ctx.tarefas.map((t) => t.executar()));
    expect(ctx.entradas).toHaveLength(1);

    ctx.controle.parar();
    expect(primeiro(ctx.eventos, "parado")).toBeTruthy();
    expect(ctx.cameraEstado.encerradas).toBe(1);
  });

  it("falha ao acessar a camera impede a sessao sem rodar ciclos", async () => {
    const ctx = montar({ falhaAoIniciar: new Error("permissao negada") });
    await ctx.controle.iniciar();

    expect(ctx.controle.estaRodando).toBe(false);
    expect(primeiro(ctx.eventos, "falha_inicializacao")?.mensagem).toContain("permissao negada");
    expect(ctx.ciclos).toHaveLength(0);
    expect(ctx.cameraEstado.encerradas).toBe(1);
  });

  it("sem nenhum subsistema carregado, falha antes de rodar", async () => {
    const ctx = montar({
      configuracao: { carregados: [], falhas: [{ subsistema: "pose", motivo: "modelo offline" }] },
    });
    await ctx.controle.iniciar();

    expect(ctx.controle.estaRodando).toBe(false);
    const falha = primeiro(ctx.eventos, "falha_inicializacao");
    expect(falha?.mensagem).toContain("Falha ao carregar o pipeline de percepcao");
    expect(falha?.mensagem).toContain("pose: modelo offline");
    expect(ctx.ciclos).toHaveLength(0);
  });

  it("um subsistema carregado ja permite rodar (falha parcial nao bloqueia)", async () => {
    const ctx = montar({
      configuracao: { carregados: ["deteccao"], falhas: [{ subsistema: "pose", motivo: "sem modelo" }] },
    });
    await ctx.controle.iniciar();

    expect(ctx.controle.estaRodando).toBe(true);
    expect(ctx.ciclos).toHaveLength(1);
    ctx.controle.parar();
  });

  it("reiniciar a sessao zera o estado temporal e libera o buffer", () => {
    const ctx = montar();
    ctx.controle.reiniciarSessao();
    expect(ctx.resetes).toHaveBeenCalledTimes(1);
    expect(ctx.controle.estaRodando).toBe(false);
  });

  it("variante B (sequencia) nao carrega modelos, nao pede temporal e roda sem caixas", async () => {
    const ctx = montar({ modo: MODO_B });
    await ctx.controle.iniciar();

    expect(ctx.controle.estaRodando).toBe(true);
    // Sem percepcao local: nada de modelos e a fabrica de temporal nunca e usada.
    expect(ctx.modelosVistos).toHaveLength(0);
    expect(ctx.modosTemporais).toHaveLength(0);
    // O ciclo roda normalmente e o processador inativo nao desenha caixas.
    expect(ctx.ciclos).toHaveLength(1);
    expect(ctx.ciclos[0].observacoes).toBe(2);
    expect(ctx.ciclos[0].eventosTemporais).toBe(0);
    expect(ctx.ciclos[0].subsistemasIndisponiveis).toEqual(
      expect.arrayContaining(["deteccao", "pose", "maos"])
    );
    expect(primeiro(ctx.eventos, "desenhar_caixas")?.objetos).toHaveLength(0);
    // A interpretacao (multimodal) continua acontecendo com as imagens.
    expect(primeiro(ctx.eventos, "exibir_entrada")).toBeTruthy();

    ctx.controle.parar();
  });

  it("variante C (fundida) carrega modelos e pede motor temporal basico", async () => {
    const ctx = montar({ modo: MODO_C });
    await ctx.controle.iniciar();

    expect(ctx.controle.estaRodando).toBe(true);
    expect(ctx.modelosVistos).toHaveLength(1);
    expect(ctx.modosTemporais).toContain("basico");
    expect(ctx.modosTemporais).not.toContain("ampliado");
    // Percepcao local ativa: as caixas voltam a ser desenhadas.
    expect(primeiro(ctx.eventos, "desenhar_caixas")?.objetos).toHaveLength(1);
    ctx.controle.parar();
  });

  it("variante padrao (D) pede motor temporal ampliado", async () => {
    const ctx = montar();
    await ctx.controle.iniciar();
    expect(ctx.modosTemporais).toContain("ampliado");
    ctx.controle.parar();
  });

  it("carrega os modelos escolhidos na interface ao iniciar a sessao", async () => {
    const ctx = montar({ modelos: { objetos: "onnx-community/yolov10s" } });
    await ctx.controle.iniciar();

    expect(ctx.modelosVistos).toEqual([{ objetos: "onnx-community/yolov10s" }]);
    ctx.controle.parar();
  });

  it("trocar de modo reinicia a sessao (novo contexto temporal)", () => {
    const ctx = montar();
    ctx.controle.aoTrocarModo();
    expect(ctx.resetes).toHaveBeenCalledTimes(1);
  });

  it("camera ainda sem frame nao gera entrada nem diagnostico", async () => {
    const ctx = montar({ semFrame: true });
    await ctx.controle.iniciar();

    expect(ctx.controle.estaRodando).toBe(true);
    expect(primeiro(ctx.eventos, "exibir_entrada")).toBeUndefined();
    expect(ctx.ciclos).toHaveLength(0);
    expect(ctx.entradas).toHaveLength(0);
    ctx.controle.parar();
  });

  it("persiste eventos temporais confirmados uma unica vez como EventoVisual", async () => {
    const confirmado: EventoTemporal = {
      eventoId: "evt-1",
      sessionId: "s",
      tipo: "desaparecimento",
      inicioEm: "2026-10-19T02:00:19.500Z",
      descricao: "pessoa sai do quadro",
      confianca: 0.8,
      origens: ["objetos"],
      frameIds: [],
      estado: "confirmado",
    };
    const candidato: EventoTemporal = {
      ...confirmado,
      eventoId: "evt-2",
      tipo: "gesto_detectado",
      estado: "candidato",
    };
    const gestoConfirmado: EventoTemporal = {
      ...confirmado,
      eventoId: "evt-3",
      tipo: "gesto_detectado",
      estado: "confirmado",
    };
    const ctx = montar({ eventosTemporais: [confirmado, candidato, gestoConfirmado] });
    await ctx.controle.iniciar();

    // So o evento de tipo mapeavel e confirmado vai para a fila (1 por ciclo).
    const agendados = ctx.tarefas.filter((t) => t.descricao.startsWith("evento:multiframe:"));
    expect(agendados).toHaveLength(1);
    await Promise.all(ctx.tarefas.map((t) => t.executar()));
    expect(ctx.eventosVisuais).toHaveLength(1);
    // timestamp = inicioEm (instante real), frameId = evidencia do ciclo,
    // id = identidade temporal (rastreavel de volta ao RegistroCiclo).
    expect(ctx.eventosVisuais[0]).toMatchObject({
      id: "evt-1",
      timestamp: "2026-10-19T02:00:19.500Z",
      tipo: "desaparecimento",
      origem: "rastreador",
      sessaoId: ctx.ciclos[0].sessionId,
      frameId: ctx.ciclos[0].frameIds[1],
    });
    expect(ctx.eventosVisuais[0].idempotencyKey).toBeTruthy();

    // A identidade que reaparece no proximo ciclo nao duplica no arquivo.
    await ctx.controle.executarCiclo();
    expect(ctx.tarefas.filter((t) => t.descricao.startsWith("evento:multiframe:"))).toHaveLength(1);
    ctx.controle.parar();
  });

  it("a_cada_ciclo interpreta sempre", async () => {
    const ctx = montar({ politica: POLITICA_CICLO_BENCHMARK_ALVO });
    await ctx.controle.iniciar();
    expect(ctx.interpretacoes()).toBe(1);
    ctx.controle.parar();
  });

  it("quando_evento_relevante suprime a interpretacao sem evento e registra o motivo", async () => {
    const ctx = montar({
      politica: { ...POLITICA_CICLO_OPERACIONAL, interpretacao: "quando_evento_relevante" },
    });
    await ctx.controle.iniciar();

    expect(ctx.interpretacoes()).toBe(0);
    expect(ctx.ciclos).toHaveLength(1);
    expect(ctx.ciclos[0].metricas.interpretacaoSuprimida).toBe("sem_evento_relevante");
    // Sem interpretacao, nao ha entrada no historico; o ciclo segue diagnostico.
    expect(primeiro(ctx.eventos, "exibir_entrada")).toBeUndefined();
    expect(ctx.ciclos[0].cancelado).toBe(false);
    ctx.controle.parar();
  });

  it("quando_evento_relevante interpreta quando o motor temporal confirma evento", async () => {
    const confirmado: EventoTemporal = {
      eventoId: "evt-1",
      sessionId: "s",
      tipo: "aparicao",
      inicioEm: "2026-10-19T02:00:19.500Z",
      descricao: "pessoa entra no quadro",
      confianca: 0.8,
      origens: ["objetos"],
      frameIds: [],
      estado: "confirmado",
    };
    const ctx = montar({
      politica: { ...POLITICA_CICLO_OPERACIONAL, interpretacao: "quando_evento_relevante" },
      eventosTemporais: [confirmado],
    });
    await ctx.controle.iniciar();

    expect(ctx.interpretacoes()).toBe(1);
    expect(ctx.ciclos[0].metricas.interpretacaoSuprimida).toBeUndefined();
    ctx.controle.parar();
  });

  it("sob_demanda so interpreta em ciclo pedido manualmente", async () => {
    const ctx = montar({
      politica: { ...POLITICA_CICLO_OPERACIONAL, interpretacao: "sob_demanda" },
    });
    await ctx.controle.iniciar();

    // Ciclo automatico: suprimido.
    expect(ctx.interpretacoes()).toBe(0);
    expect(ctx.ciclos[0].metricas.interpretacaoSuprimida).toBe("politica_sob_demanda");

    // Ciclo pedido pela interface: interpreta.
    ctx.controle.solicitarManual();
    await ctx.controle.aguardarExecucao();
    expect(ctx.interpretacoes()).toBe(1);
    ctx.controle.parar();
  });
});
