import { describe, expect, it } from "vitest";
import type { PacoteCiclo, ObservacaoFrame } from "../../src/domain";
import { InterpretadorCiclo } from "../../public/interpretation/interpretador-ciclo";
import { VERSAO_PROMPT_INTERPRETACAO } from "../../public/interpretation/prompt";
import { executarCicloMultiframe } from "../../public/cycle/ciclo-multiframe";
import { OBS_BASE, PACOTE } from "../helpers/interpretacao-payload";
import { montar } from "../helpers/ciclo-multiframe";

describe("integração da Fase 6 no interpretador e no ciclo", () => {
  it("valida schema, exigência de evidência, tokens e seleção no resultado", async () => {
    const observacoes: ObservacaoFrame[] = [
      OBS_BASE,
      { ...OBS_BASE, frameId: "f2", capturadoEmMs: 500, imagem: "img2" },
    ];
    const pacote: PacoteCiclo = { ...PACOTE, observacoes };
    const interpretador = new InterpretadorCiclo({
      modelo: "modelo-teste",
      enviar: async () => ({
        texto: JSON.stringify({
          resumo: "pessoaobservada",
          acoes: [
            { descricao: "ação sem base", evidencias: [] },
            { descricao: "ação sustentada", natureza: "inferida", evidencias: ["f1"] },
          ],
          evidencias: ["f1"],
          incertezas: [],
        }),
        tokens: 17,
        duracaoMs: 25,
      }),
    });

    const resultado = await interpretador.interpretar(pacote);

    expect(resultado.schema?.valido).toBe(true);
    expect(resultado.tokens).toBe(17);
    expect(resultado.duracaoMs).toBe(25);
    expect(resultado.versaoPrompt).toBe(VERSAO_PROMPT_INTERPRETACAO);
    expect(resultado.acoes.map((a) => a.descricao)).toEqual(["ação sustentada"]);
    expect(resultado.afirmacoesSemEvidencia?.map((a) => a.texto)).toContain("ação sem base");
    expect(resultado.selecaoFrames?.totalFrames).toBe(2);
    expect(resultado.selecaoFrames?.criterio).toBe("uniforme");
    expect(resultado.distincaoEvidencia?.inferenciasModelo[0].natureza).toBe("inferida");
  });

  it("registra latência, tokens e custo por evento no pacote do ciclo", async () => {
    const { deps } = montar({
      interpretador: {
        modelo: "modelo-teste",
        interpretar: async () => ({
          resumo: "resumo",
          acoes: [],
          evidencias: [],
          incertezas: [],
          contradicoes: [],
          duracaoMs: 12,
          tokens: 34,
        }),
      },
      decidirInterpretacao: () => ({ interpretar: true, eventosRelevantes: ["ev1"] }),
      obterPrecosMultimodal: () => ({ entradaPorMilhao: 1, saidaPorMilhao: 2, moeda: "USD" }),
    });

    const resultado = await executarCicloMultiframe(deps);
    const metricas = resultado.pacote.metricas;

    expect(metricas.multimodalMs).toBe(12);
    expect(metricas.tokensMultimodal).toBe(34);
    expect(metricas.latenciaAteRespostaMultimodalMs).toBeGreaterThanOrEqual(0);
    expect(metricas.custoMultimodal).toMatchObject({
      cycleId: "sess0001-c1",
      eventoIds: ["ev1"],
      duracaoMs: 12,
      motivoCustoIndisponivel: "sem_divisao_entrada_saida",
    });
    expect(metricas.custoMultimodal?.tokensEntrada).toBeUndefined();
  });
});
