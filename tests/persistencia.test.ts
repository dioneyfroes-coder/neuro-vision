import { describe, expect, it } from "vitest";
import { FilaPersistencia } from "../public/persistencia";

describe("FilaPersistencia", () => {
  it("preserva a ordem e limita a concorrencia a uma gravacao", async () => {
    const ordem: string[] = [];
    let simultaneas = 0;
    let maximo = 0;
    const fila = new FilaPersistencia();

    for (const n of [1, 2, 3]) {
      fila.agendar({
        descricao: `e${n}`,
        payload: n,
        executar: async () => {
          simultaneas += 1;
          maximo = Math.max(maximo, simultaneas);
          ordem.push(`inicio${n}`);
          await new Promise((resolve) => setTimeout(resolve, 5));
          ordem.push(`fim${n}`);
          simultaneas -= 1;
        },
      });
    }

    await fila.aguardar();

    expect(ordem).toEqual(["inicio1", "fim1", "inicio2", "fim2", "inicio3", "fim3"]);
    expect(maximo).toBe(1);
    expect(fila.estado).toMatchObject({ enviados: 3, falhas: 0, pendentes: 0 });
    expect(fila.naoEnviados).toEqual([]);
  });

  it("retenta falhas transitorias com atraso progressivo e conta o sucesso", async () => {
    let tentativas = 0;
    const fila = new FilaPersistencia({ atrasoBaseMs: 0, maxTentativas: 3 });

    fila.agendar({
      descricao: "e1",
      payload: 1,
      executar: async () => {
        tentativas += 1;
        if (tentativas < 3) throw new Error("temporario");
      },
    });

    await fila.aguardar();

    expect(tentativas).toBe(3);
    expect(fila.estado).toMatchObject({ enviados: 1, falhas: 0 });
    expect(fila.naoEnviados).toEqual([]);
  });

  it("expoe falhas persistentes e chama aoFalhar uma unica vez", async () => {
    let marcado = 0;
    const fila = new FilaPersistencia({ atrasoBaseMs: 0, maxTentativas: 2 });

    fila.agendar({
      descricao: "e1",
      payload: { id: 1 },
      executar: async () => {
        throw new Error("sem servidor");
      },
      aoFalhar: () => {
        marcado += 1;
      },
    });

    await fila.aguardar();

    expect(fila.estado.falhas).toBe(1);
    expect(fila.estado.ultimoErro).toBe("sem servidor");
    expect(marcado).toBe(1);
    expect(fila.naoEnviados).toEqual([{ id: 1 }]);
  });

  it("pausar aguarda a gravacao em andamento e ignora novas entradas", async () => {
    const realizadas: string[] = [];
    let liberar!: () => void;
    const bloqueio = new Promise<void>((resolve) => {
      liberar = resolve;
    });
    const fila = new FilaPersistencia({ maxTentativas: 1 });

    fila.agendar({
      descricao: "em-andamento",
      payload: "a",
      executar: async () => {
        await bloqueio;
        realizadas.push("a");
      },
    });
    fila.agendar({ descricao: "na-fila", payload: "b", executar: async () => void realizadas.push("b") });

    const pausa = fila.pausar(5000);
    // Durante a pausa, novas gravacoes sao descartadas.
    fila.agendar({ descricao: "tardia", payload: "c", executar: async () => void realizadas.push("c") });
    liberar();
    await pausa;

    expect(realizadas).toEqual(["a"]);
    // `limpar` descarta o que ficou na fila; `retomar` volta a aceitar.
    fila.limpar();
    fila.retomar();
    fila.agendar({ descricao: "depois", payload: "d", executar: async () => void realizadas.push("d") });
    await fila.aguardar();

    expect(realizadas).toEqual(["a", "d"]);
    expect(fila.estado).toMatchObject({ enviados: 1, falhas: 0, pendentes: 0 });
  });

  it("descarta a gravacao mais antiga quando a fila passa do limite", async () => {
    let liberar!: () => void;
    const bloqueio = new Promise<void>((resolve) => {
      liberar = resolve;
    });
    const fila = new FilaPersistencia({ maxTentativas: 1, maxPendentes: 2 });

    fila.agendar({ descricao: "trabalhando", payload: "w", executar: () => bloqueio });
    fila.agendar({ descricao: "f1", payload: "1", executar: async () => {} });
    fila.agendar({ descricao: "f2", payload: "2", executar: async () => {} });
    fila.agendar({ descricao: "f3", payload: "3", executar: async () => {} });

    expect(fila.naoEnviados).toEqual(["1"]);

    liberar();
    await fila.aguardar();

    expect(fila.estado.enviados).toBe(3);
    expect(fila.estado.falhas).toBe(1);
  });

  it("notifica o estado a cada mudanca", async () => {
    const enviados: number[] = [];
    const fila = new FilaPersistencia({
      atrasoBaseMs: 0,
      maxTentativas: 1,
      aoMudar: (estado) => enviados.push(estado.enviados),
    });

    fila.agendar({ descricao: "e", payload: 1, executar: async () => {} });
    await fila.aguardar();

    expect(enviados.at(-1)).toBe(1);
  });
});
