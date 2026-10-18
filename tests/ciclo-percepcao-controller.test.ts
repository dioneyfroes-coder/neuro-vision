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
import type { InterpretadorMultimodal } from "../public/interpretation/contracts";
import type { ConfiguracaoParcial, ModelosPercepcao } from "../public/perception/local-perception-pipeline";
import type { DefinicaoModo } from "../public/modos";
import { CONFIG_CAPTURA_PADRAO } from "../public/capture/webcam-capture";
import type { TarefaPersistencia } from "../public/persistencia";
import type { RegistroCiclo } from "../src/domain/cycle";
import type { ResultadoInterpretacao } from "../src/domain/interpretation";
import type { EntradaLog } from "../src/types";

const MODO: DefinicaoModo = {
  id: "percepcao",
  usaDeteccao: true,
  usaVisao: true,
  permiteAnaliseManual: false,
  falhaPrefixo: "Falha ao carregar o pipeline de percepcao",
  origemFalha: "detector",
  multiframe: true,
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

function interpretadorFalso(resumo = "pessoa gesticulando entre dois frames"): InterpretadorMultimodal {
  return {
    modelo: "modelo-teste",
    interpretar: async (): Promise<ResultadoInterpretacao> => ({
      resumo,
      acoes: [],
      evidencias: [],
      incertezas: [],
      contradicoes: [],
      duracaoMs: 10,
    }),
  };
}

interface Contexto {
  controle: CicloPercepcaoController;
  eventos: EventoUi[];
  ciclos: RegistroCiclo[];
  entradas: EntradaLog[];
  operacionais: Array<{ nivel?: string; origem?: string; mensagem: string }>;
  tarefas: TarefaPersistencia[];
  motorTemporal: MotorTemporal;
  resetes: ReturnType<typeof vi.fn>;
  cameraEstado: { iniciadas: number; encerradas: number };
  modelosVistos: ModelosPercepcao[];
  naoGravados: number;
}

function montar(
  opcoes: {
    configuracao?: ConfiguracaoParcial;
    falhaAoIniciar?: Error;
    modelos?: ModelosPercepcao;
    semFrame?: boolean;
  } = {}
): Contexto {
  const eventos: EventoUi[] = [];
  const ciclos: RegistroCiclo[] = [];
  const entradas: EntradaLog[] = [];
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
    processar: () => ({ eventos: [], entidadesAtivas: 0 }),
    resetar: resetes,
  };

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
    obterModo: () => MODO,
    criarPercepcao: () => percepcao,
    obterModelosPercepcao: () => opcoes.modelos ?? { objetos: "Xenova/yolos-tiny" },
    criarMotorTemporal: () => motorTemporal,
    criarInterpretador: () => interpretadorFalso(),
    obterIntervaloMs: () => 4000,
    configuracaoCaptura: CONFIG_CAPTURA,
    dependenciasCaptura: DEPS_CAPTURA,
  };

  return {
    controle: new CicloPercepcaoController(deps),
    eventos,
    ciclos,
    entradas,
    operacionais,
    tarefas,
    motorTemporal,
    resetes,
    cameraEstado: estado,
    modelosVistos,
    get naoGravados() {
      return naoGravados;
    },
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

  it("carrega os modelos escolhidos na interface ao iniciar a sessao", async () => {
    const ctx = montar({ modelos: { objetos: "Xenova/detr-resnet-50" } });
    await ctx.controle.iniciar();

    expect(ctx.modelosVistos).toEqual([{ objetos: "Xenova/detr-resnet-50" }]);
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
});
