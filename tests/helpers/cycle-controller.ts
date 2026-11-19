import { vi } from "vitest";
import { CycleController } from "../../public/cycle/cycle-controller";
import type { DependenciasCiclo, EventoUi, ItemHistorico } from "../../public/cycle/cycle-controller";
import type { FilaPersistencia } from "../../public/persistencia";
import type { DefinicaoModo } from "../../public/modos";
import type { MotorPercepcao, ResultadoPercepcao } from "../../src/percepcao";
import type { ClassificadorNsfw } from "../../public/perception/contracts";
import type { OpcoesMotorVisao } from "../../public/motores";

/** Camera falsa: um frame fixo, sem DOM. */
export function cameraFalsa(opcoes: { ativa?: boolean; quadro?: { imagem: string; thumb: string } | null } = {}) {
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

export function filaFalsa() {
  return {
    agendar: vi.fn(),
    pausar: vi.fn(async () => undefined),
    retomar: vi.fn(),
    limpar: vi.fn(),
    estado: { enviados: 0, falhas: 0, pendentes: 0 },
    naoEnviados: [],
  } as unknown as FilaPersistencia;
}

export function repositorioFalso() {
  return {
    gravarEntrada: vi.fn(async () => undefined),
    gravarEvento: vi.fn(async () => undefined),
    gravarOperacional: vi.fn(async () => undefined),
  };
}

export function modoDeteccao(): DefinicaoModo {
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

export function montar(opcoes: {
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

export function statusFinal(eventos: EventoUi[]): string {
  const ultimos = eventos.filter((e) => e.tipo === "status");
  const ultimo = ultimos[ultimos.length - 1];
  return ultimo && ultimo.tipo === "status" ? ultimo.texto : "";
}
