import { describe, expect, it, vi } from "vitest";
import { CycleController } from "../public/cycle/cycle-controller";
import type { DependenciasCiclo, EventoUi, ItemHistorico } from "../public/cycle/cycle-controller";
import type { FilaPersistencia } from "../public/persistencia";
import type { DefinicaoModo } from "../public/modos";
import type { MotorPercepcao, ResultadoPercepcao } from "../src/percepcao";
import type { ClassificadorNsfw } from "../public/perception/contracts";
import type { OpcoesMotorVisao } from "../public/motores";

/** Camera falsa: um frame fixo, sem DOM. */
function cameraFalsa(opcoes: { ativa?: boolean; quadro?: { imagem: string; thumb: string } | null } = {}) {
  return {
    ativa: opcoes.ativa ?? true,
    largura: 640,
    altura: 480,
    iniciar: vi.fn(async () => undefined),
    encerrar: vi.fn(() => undefined),
    capturarFrame: () => "data:image/jpeg;base64,QUJD",
    capturarQuadro: () => (opcoes.quadro === undefined ? { imagem: "data:image/jpeg;base64,QUJD", thumb: "data:image/jpeg;base64,QUJD" } : opcoes.quadro),
    assinaturaDeCena: () => [1, 2, 3],
  };
}

function filaFalsa() {
  return {
    agendar: vi.fn(),
    pausar: vi.fn(async () => undefined),
    retomar: vi.fn(),
    limpar: vi.fn(),
    estado: { enviados: 0, falhas: 0, pendentes: 0 },
    naoEnviados: [],
  } as unknown as FilaPersistencia;
}

function repositorioFalso() {
  return {
    gravarEntrada: vi.fn(async () => undefined),
    gravarEvento: vi.fn(async () => undefined),
    gravarOperacional: vi.fn(async () => undefined),
  };
}

function modoDeteccao(): DefinicaoModo {
  return {
    id: "deteccao",
    usaDeteccao: true,
    usaVisao: false,
    permiteAnaliseManual: false,
    falhaPrefixo: "Falha ao carregar modelo",
    origemFalha: "detector",
    criarMotor: () => ({}) as MotorPercepcao,
  };
}

function montar(opcoes: {
  motor?: MotorPercepcao;
  camera?: ReturnType<typeof cameraFalsa>;
  modo?: DefinicaoModo;
  classificadorNsfw?: ClassificadorNsfw;
  obterModeloNsfw?: () => string | undefined;
  criarMotorVisao?: (opcoes: OpcoesMotorVisao) => MotorPercepcao;
} = {}) {
  const eventos: EventoUi[] = [];
  const motor: MotorPercepcao =
    opcoes.motor ??
    ({
      id: "deteccao",
      inicializar: vi.fn(async () => undefined),
      analisar: vi.fn(async (): Promise<ResultadoPercepcao> => ({
        modelo: "falso-modelo",
        duracaoMs: 5,
        objetos: [
          { nome: "pessoa", rotulo: "person", score: 0.9, caixa: { xmin: 0, ymin: 0, xmax: 10, ymax: 10 } },
        ],
        descricao: "pessoa em pe",
        snapshot: "data:image/jpeg;base64,QUJD",
        capturadoEm: new Date().toISOString(),
      })),
      encerrar: vi.fn(),
    }) as MotorPercepcao;

  const camera = opcoes.camera ?? cameraFalsa();
  const repositorio = repositorioFalso();
  const fila = filaFalsa();
  const modo = opcoes.modo ?? modoDeteccao();

  const deps: DependenciasCiclo = {
    camera,
    aoUi: (evento) => {
      eventos.push(evento);
      if (evento.tipo === "exibir_entrada") return { marcarNaoGravado: vi.fn() } satisfies ItemHistorico;
      return;
    },
    repositorio,
    fila,
    obterModo: () => modo,
    criarMotor: () => motor,
    criarMotorVisao: opcoes.criarMotorVisao ?? (() => motor),
    obterModeloVisao: () => undefined,
    obterIntervaloMs: () => 60_000,
    classificadorNsfw: opcoes.classificadorNsfw,
    obterModeloNsfw: opcoes.obterModeloNsfw,
  };

  return { controlador: new CycleController(deps), eventos, camera, repositorio, fila, motor };
}

function statusFinal(eventos: EventoUi[]): string {
  const ultimos = eventos.filter((e) => e.tipo === "status");
  const ultimo = ultimos[ultimos.length - 1];
  return ultimo && ultimo.tipo === "status" ? ultimo.texto : "";
}

describe("CycleController", () => {
  it("executa o ciclo de frame unico e exibe a entrada capturada", async () => {
    const { controlador, eventos, motor } = montar();
    await controlador.iniciar();
    expect(controlador.estaRodando).toBe(true);
    // `iniciar` dispara o primeiro ciclo pelo agendador; parte do zero daqui.
    eventos.length = 0;
    (motor.analisar as unknown as { mockClear: () => void }).mockClear();

    await controlador.executarCiclo();

    expect(motor.analisar).toHaveBeenCalledTimes(1);
    const exibidas = eventos.filter((e) => e.tipo === "exibir_entrada");
    expect(exibidas).toHaveLength(1);
    expect(statusFinal(eventos)).toContain("Viu:");
    const entrada = exibidas[0];
    expect(entrada.tipo === "exibir_entrada" && entrada.entrada.tipo).toBe("deteccao");
  });

  it("falha na inferencia vira status de erro, nao em entradas", async () => {
    const motor: MotorPercepcao = {
      id: "deteccao",
      inicializar: vi.fn(async () => undefined),
      analisar: vi.fn(async () => {
        throw new Error("gpu explodiu");
      }),
      encerrar: vi.fn(),
    };
    const { controlador, eventos, repositorio } = montar({ motor });
    await controlador.iniciar();
    await controlador.executarCiclo();

    expect(eventos.some((e) => e.tipo === "exibir_entrada")).toBe(false);
    expect(statusFinal(eventos)).toContain("gpu explodiu");
    expect(repositorio.gravarOperacional).toHaveBeenCalledWith(
      expect.objectContaining({ nivel: "erro", origem: "detector" })
    );
  });

  it("cancelar durante a inferencia nao emite entradas nem derruba o fluxo", async () => {
    let liberar: (v: ResultadoPercepcao) => void = () => {};
    const pendente = new Promise<ResultadoPercepcao>((resolve) => (liberar = resolve));
    const motor: MotorPercepcao = {
      id: "deteccao",
      inicializar: vi.fn(async () => undefined),
      analisar: vi.fn(async (): Promise<ResultadoPercepcao> => ({
        modelo: "falso-modelo",
        duracaoMs: 1,
        objetos: [],
        descricao: "primeiro ciclo",
      })),
      encerrar: vi.fn(),
    };
    const { controlador, eventos, camera } = montar({ motor });
    await controlador.iniciar();
    eventos.length = 0;
    // A proxima inferencia fica pendente ate o cancelamento.
    (motor.analisar as unknown as { mockImplementation: (f: () => Promise<ResultadoPercepcao>) => void }).mockImplementation(
      () => pendente
    );

    const ciclo = controlador.executarCiclo();
    controlador.parar();
    liberar({
      modelo: "falso-modelo",
      duracaoMs: 1,
      objetos: [],
      descricao: "tarde demais",
    });
    await ciclo;

    expect(eventos.some((e) => e.tipo === "exibir_entrada")).toBe(false);
    expect(camera.encerrar).toHaveBeenCalled();
    expect(controlador.estaRodando).toBe(false);
  });

  it("sem frame disponivel o ciclo termina sem erro e sem entradas", async () => {
    const camera = cameraFalsa({ quadro: null });
    camera.capturarFrame = () => null;
    const { controlador, eventos } = montar({ camera });
    await controlador.iniciar();
    await controlador.executarCiclo();
    expect(eventos.some((e) => e.tipo === "exibir_entrada")).toBe(false);
    // Nao e falha: apenas nao ha evidencia neste instante.
    expect(
      eventos.filter((e) => e.tipo === "status" && e.texto.startsWith("Erro"))
    ).toHaveLength(0);
  });

  it("falha ao carregar o motor libera a camera e sinaliza falha de inicializacao", async () => {
    const motor: MotorPercepcao = {
      id: "deteccao",
      inicializar: vi.fn(async () => {
        throw new Error("sem memoria");
      }),
      analisar: vi.fn(),
      encerrar: vi.fn(),
    };
    const { controlador, eventos, camera } = montar({ motor });
    await controlador.iniciar();

    expect(controlador.estaRodando).toBe(false);
    expect(camera.encerrar).toHaveBeenCalled();
    const falha = eventos.find((e) => e.tipo === "falha_inicializacao");
    expect(falha && falha.tipo === "falha_inicializacao" && falha.mensagem).toContain(
      "Falha ao carregar modelo"
    );
  });

  it("limpar a sessao zera a politica sem depender do interpretador", async () => {
    const { controlador } = montar();
    await controlador.iniciar();
    controlador.reiniciarSessao();
    // Nova sessao pronta para o proximo ciclo; nada aqui invoca visao/Ollama.
    expect(controlador.estaRodando).toBe(true);
    await controlador.executarCiclo();
  });

  it("com NSFW ligado, anexa marcacoes normalizadas a entrada, ao log e ao canvas", async () => {
    const classificador = {
      id: "nsfw",
      modelo: "erax_nsfw_yolo11n",
      metricas: {},
      carregar: vi.fn(async () => undefined),
      avaliar: vi.fn(async () => ({
        marcacoes: [
          {
            rotulo: "porn",
            score: 0.8765,
            caixa: { xmin: 64, ymin: 48, xmax: 320, ymax: 240 },
          },
        ],
        modelo: "erax_nsfw_yolo11n",
      })),
      encerrar: vi.fn(),
    } as unknown as ClassificadorNsfw;

    const { controlador, eventos, fila } = montar({
      classificadorNsfw: classificador,
      obterModeloNsfw: () => "erax_nsfw_yolo11n",
    });
    await controlador.iniciar();
    expect(classificador.carregar).toHaveBeenCalledWith(
      "erax_nsfw_yolo11n",
      expect.any(Function)
    );
    eventos.length = 0;

    await controlador.executarCiclo();

    const entrada = eventos.find((e) => e.tipo === "exibir_entrada");
    expect(entrada?.tipo === "exibir_entrada" && entrada.entrada.nsfw).toEqual([
      {
        rotulo: "porn",
        score: 0.877,
        caixa: { xmin: 0.1, ymin: 0.1, xmax: 0.5, ymax: 0.5 },
      },
    ]);
    const desenho = eventos.find((e) => e.tipo === "desenhar_caixas");
    expect(desenho?.tipo === "desenhar_caixas" && desenho.nsfw).toEqual(
      entrada?.tipo === "exibir_entrada" ? entrada.entrada.nsfw : undefined
    );
    // A fila falsa nao executa `executar`; o payload agendado carrega o NSFW.
    const agendado = (fila.agendar as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .map(([item]) => item as { payload?: { tipo?: string; nsfw?: unknown } })
      .find((item) => item.payload?.tipo === "deteccao");
    expect(agendado?.payload?.nsfw).toEqual([
      {
        rotulo: "porn",
        score: 0.877,
        caixa: { xmin: 0.1, ymin: 0.1, xmax: 0.5, ymax: 0.5 },
      },
    ]);
  });

  it("falha ao carregar o NSFW nao impede a sessao e registra aviso", async () => {
    const classificador = {
      id: "nsfw",
      modelo: null,
      metricas: {},
      carregar: vi.fn(async () => {
        throw new Error("pesos NSFW ausentes");
      }),
      avaliar: vi.fn(),
      encerrar: vi.fn(),
    } as unknown as ClassificadorNsfw;

    const { controlador, eventos, repositorio } = montar({
      classificadorNsfw: classificador,
      obterModeloNsfw: () => "erax_nsfw_yolo11n",
    });
    await controlador.iniciar();

    expect(controlador.estaRodando).toBe(true);
    expect(repositorio.gravarOperacional).toHaveBeenCalledWith(
      expect.objectContaining({ nivel: "aviso", origem: "nsfw" })
    );
    eventos.length = 0;
    await controlador.executarCiclo();
    const entrada = eventos.find((e) => e.tipo === "exibir_entrada");
    expect(entrada?.tipo === "exibir_entrada" && entrada.entrada.nsfw).toBeUndefined();
    expect(classificador.avaliar).not.toHaveBeenCalled();
  });

  it("no modo visao, envia as marcacoes NSFW ao motor e exibe a resposta explicita", async () => {
    const classificador = {
      id: "nsfw",
      modelo: "erax_nsfw_yolo11n",
      metricas: {},
      carregar: vi.fn(async () => undefined),
      avaliar: vi.fn(async () => ({
        marcacoes: [
          {
            rotulo: "sexy",
            score: 0.6,
            caixa: { xmin: 64, ymin: 48, xmax: 320, ymax: 240 },
          },
        ],
      })),
      encerrar: vi.fn(),
    } as unknown as ClassificadorNsfw;

    const motorVisao: MotorPercepcao = {
      id: "visao",
      inicializar: vi.fn(async () => undefined),
      analisar: vi.fn(async (): Promise<ResultadoPercepcao> => ({
        modelo: "m",
        duracaoMs: 5,
        objetos: [],
        descricao: "Pessoa nua em close, seios e genitais visiveis.",
      })),
      encerrar: vi.fn(),
    };
    const opcoesVisao: OpcoesMotorVisao[] = [];
    const modoVisao: DefinicaoModo = {
      id: "visao",
      usaDeteccao: false,
      usaVisao: true,
      permiteAnaliseManual: false,
      falhaPrefixo: "Falha ao preparar o modelo de visao",
      origemFalha: "visao",
      criarMotor: () => motorVisao,
    };

    const { controlador, eventos } = montar({
      modo: modoVisao,
      classificadorNsfw: classificador,
      obterModeloNsfw: () => "erax_nsfw_yolo11n",
      criarMotorVisao: (opcoes) => {
        opcoesVisao.push(opcoes);
        return motorVisao;
      },
    });
    await controlador.iniciar();
    eventos.length = 0;

    await controlador.executarCiclo();

    const ultima = opcoesVisao[opcoesVisao.length - 1];
    expect(ultima?.nsfw).toEqual([
      {
        rotulo: "sexy",
        score: 0.6,
        caixa: { xmin: 0.125, ymin: 0.125, xmax: 0.625, ymax: 0.625 },
      },
    ]);
    const entrada = eventos.find((e) => e.tipo === "exibir_entrada");
    expect(entrada?.tipo === "exibir_entrada" && entrada.entrada.resumo).toContain(
      "genitais visiveis"
    );
    expect(entrada?.tipo === "exibir_entrada" && entrada.entrada.nsfw).toEqual(
      ultima?.nsfw
    );
  });
});
