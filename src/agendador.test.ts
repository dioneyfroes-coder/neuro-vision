import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgendadorAnalise, calcularEspera, MARGEM_RESERVA_MS } from "../public/scheduler";

afterEach(() => {
  vi.useRealTimers();
});

describe("calcularEspera", () => {
  it("usa o intervalo configurado quando a analise e rapida", () => {
    expect(calcularEspera(4000, 300)).toBe(4000);
    expect(calcularEspera(1000, 0)).toBe(1000);
  });

  it("espera a inferencia terminar antes do proximo ciclo", () => {
    expect(calcularEspera(1000, 2500)).toBe(2500 + MARGEM_RESERVA_MS);
    expect(calcularEspera(1000, 1200)).toBe(1200 + MARGEM_RESERVA_MS);
  });

  it("respeita uma margem customizada", () => {
    expect(calcularEspera(1000, 2000, 100)).toBe(2100);
  });
});

describe("AgendadorAnalise", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  it("nao sobrepoe analises e agenda o proximo ciclo apos a conclusao", async () => {
    let ativas = 0;
    let sobreposicoes = 0;
    const inicios: number[] = [];
    const agendador = new AgendadorAnalise({
      obterIntervaloMs: () => 1000,
      obterUltimaDuracaoMs: () => 2500,
      executar: async () => {
        inicios.push(Date.now());
        if (ativas > 0) sobreposicoes += 1;
        ativas += 1;
        await new Promise((resolve) => setTimeout(resolve, 2500));
        ativas -= 1;
      },
    });

    const iniciar = agendador.iniciar();
    await vi.advanceTimersByTimeAsync(2500); // 1a analise termina
    await iniciar;
    await vi.advanceTimersByTimeAsync(3000); // proximo ciclo (2500 + margem)
    await vi.advanceTimersByTimeAsync(2500); // 2a analise termina
    await vi.advanceTimersByTimeAsync(3000); // 3o ciclo

    expect(sobreposicoes).toBe(0);
    expect(inicios).toHaveLength(3);
    expect(inicios[0]).toBe(Date.parse("2026-01-01T00:00:00.000Z"));
    // Gap entre inicios = duracao da inferencia (2500) + espera (2500 + margem).
    const gapEsperado = 2500 + 2500 + MARGEM_RESERVA_MS;
    expect(inicios[1] - inicios[0]).toBe(gapEsperado);
    expect(inicios[2] - inicios[1]).toBe(gapEsperado);
  });

  it("aplica a mudanca de intervalo no proximo agendamento", async () => {
    let execs = 0;
    let intervalo = 1000;
    let duracao = 0;
    const agendador = new AgendadorAnalise({
      obterIntervaloMs: () => intervalo,
      obterUltimaDuracaoMs: () => duracao,
      executar: async () => {
        execs += 1;
        duracao = 50;
      },
    });

    const iniciar = agendador.iniciar();
    await vi.advanceTimersByTimeAsync(0);
    await iniciar;
    expect(execs).toBe(1);

    // Antes do tick de 1000ms, o usuario aumenta o intervalo.
    intervalo = 5000;
    agendador.reajustar();
    await vi.advanceTimersByTimeAsync(1000);
    expect(execs).toBe(1); // o tick antigo foi cancelado

    await vi.advanceTimersByTimeAsync(4000);
    expect(execs).toBe(2); // disparou apenas com o novo intervalo
  });

  it("parar durante a inferencia impede novas analises", async () => {
    let execs = 0;
    let liberar: () => void = () => {};
    const agendador = new AgendadorAnalise({
      obterIntervaloMs: () => 1000,
      obterUltimaDuracaoMs: () => 0,
      executar: async () => {
        execs += 1;
        await new Promise<void>((resolve) => {
          liberar = resolve;
        });
      },
    });

    const iniciar = agendador.iniciar();
    await vi.advanceTimersByTimeAsync(0);
    expect(execs).toBe(1);
    expect(agendador.estaExecutando).toBe(true);

    agendador.parar();
    liberar();
    await iniciar;
    expect(agendador.estaRodando).toBe(false);
    expect(agendador.estaExecutando).toBe(false);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(execs).toBe(1);
  });

  it("iniciar duas vezes nao duplica a analise imediata", async () => {
    let execs = 0;
    let liberar: () => void = () => {};
    const agendador = new AgendadorAnalise({
      obterIntervaloMs: () => 1000,
      obterUltimaDuracaoMs: () => 0,
      executar: async () => {
        execs += 1;
        await new Promise<void>((resolve) => {
          liberar = resolve;
        });
      },
    });

    const primeira = agendador.iniciar();
    const segunda = agendador.iniciar();
    await vi.advanceTimersByTimeAsync(0);
    expect(execs).toBe(1);

    liberar();
    await primeira;
    await segunda;
    expect(execs).toBe(1);
  });

  it("reiniciar apos parar durante a execucao roda a analise imediata sem sobrepor", async () => {
    let chamadas = 0;
    let ativas = 0;
    let sobreposicoes = 0;
    const inicios: number[] = [];
    let liberar: () => void = () => {};
    const agendador = new AgendadorAnalise({
      obterIntervaloMs: () => 1000,
      obterUltimaDuracaoMs: () => 0,
      executar: async () => {
        inicios.push(Date.now());
        if (ativas > 0) sobreposicoes += 1;
        ativas += 1;
        chamadas += 1;
        if (chamadas === 1) {
          // Simula uma inferencia nao cancelavel ainda em andamento.
          await new Promise<void>((resolve) => {
            liberar = resolve;
          });
        }
        ativas -= 1;
      },
    });

    const primeira = agendador.iniciar();
    await vi.advanceTimersByTimeAsync(0);
    expect(inicios).toHaveLength(1);

    agendador.parar();
    const segunda = agendador.iniciar();
    await vi.advanceTimersByTimeAsync(5000);
    expect(inicios).toHaveLength(1); // espera a execucao anterior terminar

    liberar();
    await primeira;
    await segunda;
    expect(inicios).toHaveLength(2); // a analise imediata do reinicio rodou
    expect(sobreposicoes).toBe(0);
  });
});