import { describe, expect, it, vi } from "vitest";
import { montar, primeiro } from "../helpers/ciclo-percepcao-controller";
import {
  POLITICA_CICLO_BENCHMARK_ADAPTATIVA,
  POLITICA_CICLO_BENCHMARK_ALVO,
  POLITICA_CICLO_OPERACIONAL,
} from "../../public/cycle/politica-ciclo";

describe("CicloPercepcaoController — politica de interpretacao e cadencia", () => {
  it("a_cada_ciclo interpreta sempre", async () => {
    const ctx = montar({ politica: POLITICA_CICLO_BENCHMARK_ALVO });
    await ctx.controle.iniciar();
    expect(ctx.interpretacoes()).toBe(1);
  });

  it("libera os modelos depois que o ciclo em andamento termina", async () => {
    const ctx = montar();
    await ctx.controle.iniciar();

    ctx.controle.parar();
    await vi.waitFor(() => {
      expect(ctx.encerramentosPercepcao).toHaveBeenCalledTimes(1);
    });

    expect(ctx.cameraEstado.encerradas).toBe(1);
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

  it("eleva o fpsEfetivo apos a entrada e volta a base com histerese (Fase 4)", async () => {
    const base = { maosMs: 400, poseMs: 1000, deteccaoMs: 1000 };
    const entrada: EventoTemporal = {
      eventoId: "pres-entrada",
      sessionId: "s",
      tipo: "aparicao",
      inicioEm: "2026-11-18T12:00:00.000Z",
      descricao: "pessoa entra no quadro",
      origens: ["pose"],
      frameIds: ["f1"],
      estado: "confirmado",
    };
    const saida: EventoTemporal = {
      ...entrada,
      eventoId: "pres-saida",
      tipo: "desaparecimento",
      descricao: "pessoa sai do quadro",
      estado: "confirmado",
    };
    const resumoVazio: ResumoTemporal = {
      eventos: [],
      tracksAtivos: 0,
      pessoasAtivas: 0,
      maosAtivas: 0,
      objetosAtivos: 0,
    };
    let relogio = 0;
    const ctx = montar({
      politica: POLITICA_CICLO_BENCHMARK_ADAPTATIVA,
      configCaptura: { quadros: 5, intervaloMs: 200 },
      capturaAgora: () => {
        const valor = relogio;
        relogio += 100;
        return valor;
      },
      resumoPorCiclo: (indice) => {
        if (indice === 0) return { ...resumoVazio, eventos: [entrada], pessoasAtivas: 1 };
        if (indice === 1) return { ...resumoVazio, pessoasAtivas: 1 };
        if (indice === 2) return { ...resumoVazio, eventos: [saida] };
        return resumoVazio;
      },
    });

    await ctx.controle.iniciar();
    ctx.controle.pararAgendamento();
    for (let i = 0; i < 5; i += 1) await ctx.controle.executarCiclo();

    const fps = (indice: number) =>
      ctx.ciclos[indice].metricas.amostragem?.porSubsistema.maos?.fpsEfetivo;
    expect(ctx.ciclos[0].politica?.cadencia).toEqual(base);
    expect(fps(0)).toBe(2.5);

    // A entrada confirmada no primeiro ciclo afeta o plano do proximo.
    expect(ctx.ciclos[1].politica?.cadencia).toMatchObject({ maosMs: 200, poseMs: 500 });
    expect(fps(1)).toBe(5);
    expect(fps(2)).toBe(5);

    // A saida so volta ao ritmo base depois dos 3 ciclos de histerese.
    expect(ctx.ciclos[3].politica?.cadencia).toMatchObject({ maosMs: 200 });
    expect(ctx.ciclos[4].politica?.cadencia).toMatchObject({ maosMs: 200 });
    expect(ctx.ciclos[5].politica?.cadencia).toEqual(base);
    expect(fps(5)).toBe(2.5);
    ctx.controle.parar();
  });
});