import { describe, expect, it, vi } from "vitest";
import { CycleController } from "../public/cycle/cycle-controller";
import type { DependenciasCiclo, EventoUi, ItemHistorico } from "../public/cycle/cycle-controller";
import type { FilaPersistencia } from "../public/persistencia";
import type { DefinicaoModo } from "../public/modos";
import type { MotorPercepcao, ResultadoPercepcao } from "../src/percepcao";

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
    criarMotorVisao: () => motor,
    obterModeloVisao: () => undefined,
    obterIntervaloMs: () => 60_000,
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
});
