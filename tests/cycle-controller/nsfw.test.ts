import { describe, expect, it, vi } from "vitest";
import type { MotorPercepcao, ResultadoPercepcao } from "../../src/percepcao";
import type { ClassificadorNsfw } from "../../public/perception/contracts";
import type { OpcoesMotorVisao } from "../../public/motores";
import type { DefinicaoModo } from "../../public/modos";
import { montar } from "../helpers/cycle-controller";

describe("CycleController", () => {
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
