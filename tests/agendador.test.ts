import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgendadorAnalise, calcularEspera, MARGEM_RESERVA_MS } from "../public/scheduler";

afterEach(() => {
  vi.useRealTimers();
});

describe("calcularEspera", () => {
  it("usa o intervalo configurado quando a analise e rapida", () => {
    expect(calcularEspera(4000, 300)).toBe(Math.max(MARGEM_RESERVA_MS, 4000 - 300));
    expect(calcularEspera(1000, 0)).toBe(Math.max(MARGEM_RESERVA_MS, 1000 - 0));
  });

  it("espera a inferencia terminar antes do proximo ciclo", () => {
    expect(calcularEspera(1000, 2500)).toBe(Math.max(MARGEM_RESERVA_MS, 1000 - 2500));
    expect(calcularEspera(1000, 1200)).toBe(Math.max(MARGEM_RESERVA_MS, 1000 - 1200));
  });

  it("respeita uma margem customizada", () => {
    expect(calcularEspera(1000, 2000, 100)).toBe(Math.max(100, 1000 - 2000));
  });

  it("aplica a pausa pos-ciclo como piso, contada do fim do ciclo", () => {
    // Pausa maior que o intervalo entre inicios: o proximo ciclo so comeca
    // depois de a pausa transcorrer apos a conclusao efetiva.
    expect(calcularEspera(1000, 300, MARGEM_RESERVA_MS, 6000)).toBe(6000);
    // Pausa menor que o intervalo: prevalece o intervalo entre inicios.
    expect(calcularEspera(10_000, 300, MARGEM_RESERVA_MS, 6000)).toBe(9700);
    // Sem pausa (padrao) o comportamento anterior e preservado.
    expect(calcularEspera(4000, 300)).toBe(Math.max(MARGEM_RESERVA_MS, 3700));
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
    expect(inicios.length).toBeGreaterThanOrEqual(3);
    expect(inicios[0]).toBe(Date.parse("2026-01-01T00:00:00.000Z"));
    // Gap entre inicios = duracao da inferencia (2500) + espera (2500 + margem).
    const gapEsperado = 2500 + Math.max(MARGEM_RESERVA_MS, 1000 - 2500);
    expect(inicios[1] - inicios[0]).toBe(gapEsperado);
    expect(inicios[2] - inicios[1]).toBe(gapEsperado);
  });

  it("aplica a mudanca de intervalo no proximo agendamento", async () => {
    let execs = 0;
    let intervalo = 1000;
    const agendador = new AgendadorAnalise({
      obterIntervaloMs: () => intervalo,
      executar: async () => {
        execs += 1;
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

  it("reiniciar apos parar durante a execucao roda a analise imediata sem sobrepor", async () => {    let chamadas = 0;
    let ativas = 0;
    let sobreposicoes = 0;
    const inicios: number[] = [];
    let liberar: () => void = () => {};
    const agendador = new AgendadorAnalise({
      obterIntervaloMs: () => 1000,
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

  it("garante a pausa pos-ciclo contada do fim do ciclo anterior", async () => {
    // Ciclo curto (300ms) com intervalo curto, mas pausa pos-ciclo de 6000ms:
    // o proximo inicio deve ocorrer 6000ms apos o **fim** do ciclo anterior.
    const inicios: number[] = [];
    const agendador = new AgendadorAnalise({
      obterIntervaloMs: () => 1000,
      obterPausaAposCicloMs: () => 6000,
      executar: async () => {
        inicios.push(Date.now());
        await new Promise((resolve) => setTimeout(resolve, 300));
      },
    });

    const iniciar = agendador.iniciar();
    await vi.advanceTimersByTimeAsync(300); // 1o ciclo termina em t=300
    await iniciar;
    expect(inicios).toHaveLength(1);

    // Entre 300 e 6300 nada deve começar (a pausa é contada do fim).
    await vi.advanceTimersByTimeAsync(5900); // t=6200
    expect(inicios).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(200); // t=6400 > 300 + 6000
    expect(inicios).toHaveLength(2);
    expect(inicios[1] - inicios[0]).toBe(300 + 6000);
  });
});




