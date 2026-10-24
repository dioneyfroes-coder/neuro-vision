import { afterEach, describe, expect, it, vi } from "vitest";
import { atenderWorker, type MotorAtendido } from "../public/perception/workers/atender";

/**
 * Dispatcher RPC dos workers de percepcao.
 *
 * O invariante central e a serializacao: duas inferencias no mesmo worker nao
 * podem se sobrepor (uma sessao ONNX/MediaPipe nao ganha com reentrada). O
 * paralelismo real vem de workers distintos, nao de chamadas concorrentes aqui.
 */

interface RespostaTeste {
  id?: number;
  ok?: boolean;
  valor?: unknown;
  erro?: string;
  tipo?: string;
  mensagem?: string;
  motor?: string;
}

function montarEscopo(): {
  enviadas: RespostaTeste[];
  enviar: (data: unknown) => void;
} {
  const enviadas: RespostaTeste[] = [];
  const escopo = {
    postMessage: (mensagem: RespostaTeste) => enviadas.push(mensagem),
    onmessage: null as ((evento: { data: unknown }) => void) | null,
  };
  vi.stubGlobal("self", escopo);
  return {
    enviadas,
    enviar: (data) => {
      if (!escopo.onmessage) throw new Error("atenderWorker nao instalou onmessage");
      escopo.onmessage({ data });
    },
  };
}

async function esperar(condicao: () => boolean, timeoutMs = 2000): Promise<void> {
  const inicio = Date.now();
  while (!condicao()) {
    if (Date.now() - inicio > timeoutMs) throw new Error("timeout esperando condicao");
    await new Promise((resolver) => setTimeout(resolver, 5));
  }
}

function motorBase(sobrescrever: Partial<MotorAtendido> = {}): MotorAtendido {
  return {
    modelo: "modelo-teste",
    dispositivo: "wasm",
    versao: "1.0",
    tempoCargaMs: 12,
    async carregar(_modelo, aoStatus) {
      aoStatus?.("carregando");
    },
    async executar(imagem) {
      return { imagem };
    },
    ...sobrescrever,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("atenderWorker", () => {
  it("serializa inferencias do mesmo worker", async () => {
    const { enviadas, enviar } = montarEscopo();
    let emExecucao = 0;
    let maximoSimultaneo = 0;
    const ordem: string[] = [];
    atenderWorker({
      deteccao: motorBase({
        async executar(imagem) {
          emExecucao += 1;
          maximoSimultaneo = Math.max(maximoSimultaneo, emExecucao);
          ordem.push(`inicio:${imagem}`);
          await new Promise((resolver) => setTimeout(resolver, 15));
          ordem.push(`fim:${imagem}`);
          emExecucao -= 1;
          return { imagem };
        },
      }),
    });

    enviar({ id: 1, tipo: "executar", motor: "deteccao", imagem: "a" });
    enviar({ id: 2, tipo: "executar", motor: "deteccao", imagem: "b" });
    await esperar(() => enviadas.length >= 2);

    expect(maximoSimultaneo).toBe(1);
    expect(ordem).toEqual(["inicio:a", "fim:a", "inicio:b", "fim:b"]);
    expect(enviadas).toEqual([
      { id: 1, ok: true, valor: { imagem: "a" } },
      { id: 2, ok: true, valor: { imagem: "b" } },
    ]);
  });

  it("devolve a telemetria de carga e repassa avisos de status", async () => {
    const { enviadas, enviar } = montarEscopo();
    const carregados: string[] = [];
    atenderWorker({
      deteccao: motorBase({
        async carregar(modelo, aoStatus) {
          carregados.push(modelo);
          aoStatus?.("carregando modelo");
        },
      }),
    });

    enviar({ id: 7, tipo: "carregar", motor: "deteccao", modelo: "yolov10n" });
    await esperar(() => enviadas.some((m) => m.id === 7));

    expect(carregados).toEqual(["yolov10n"]);
    expect(enviadas).toContainEqual({
      tipo: "status",
      motor: "deteccao",
      mensagem: "carregando modelo",
    });
    expect(enviadas.find((m) => m.id === 7)).toEqual({
      id: 7,
      ok: true,
      valor: {
        modelo: "modelo-teste",
        dispositivo: "wasm",
        versao: "1.0",
        tempoCargaMs: 12,
      },
    });
  });

  it("transforma erro de inferencia em resposta ok:false", async () => {
    const { enviadas, enviar } = montarEscopo();
    atenderWorker({
      deteccao: motorBase({
        async executar() {
          throw new Error("falha de inferencia");
        },
      }),
    });

    enviar({ id: 3, tipo: "executar", motor: "deteccao", imagem: "a" });
    await esperar(() => enviadas.length >= 1);

    expect(enviadas).toEqual([{ id: 3, ok: false, erro: "falha de inferencia" }]);
  });

  it("rejeita motor desconhecido no worker", async () => {
    const { enviadas, enviar } = montarEscopo();
    atenderWorker({ deteccao: motorBase() });

    enviar({ id: 4, tipo: "executar", motor: "pose", imagem: "a" });
    await esperar(() => enviadas.length >= 1);

    expect(enviadas[0]).toMatchObject({
      id: 4,
      ok: false,
      erro: "motor pose desconhecido neste worker",
    });
  });

  it("encerra o motor quando recebe tipo encerrar", async () => {
    const { enviadas, enviar } = montarEscopo();
    let encerrado = 0;
    atenderWorker({
      deteccao: motorBase({
        encerrar() {
          encerrado += 1;
        },
      }),
    });

    enviar({ id: 5, tipo: "encerrar", motor: "deteccao" });
    await esperar(() => enviadas.length >= 1);

    expect(encerrado).toBe(1);
    expect(enviadas[0]).toEqual({ id: 5, ok: true, valor: undefined });
  });
});
