import { describe, expect, it } from "vitest";
import { validarCronologiaResposta } from "../src/domain/validacao-cronologia";
import { validarRespostaMultimodal } from "../src/domain/schema-resposta-multimodal";

const contexto = {
  iniciadoEm: "2026-11-22T12:00:00.000Z",
  janelaMs: 4000,
  frames: [
    { frameId: "f-1", capturadoEm: "2026-11-22T12:00:00.000Z" },
    { frameId: "f-2", capturadoEm: "2026-11-22T12:00:02.000Z" },
  ],
};

describe("validação de cronologia (Fase 4)", () => {
  it("devolve sem_dados em vez de aprovar resposta vazia", () => {
    const vazio = validarCronologiaResposta({ resumo: "x" }, contexto);
    expect(vazio.status).toBe("sem_dados");
    expect(vazio.avisos[0]).toContain("nenhuma acao");
  });

  it("rejeita ordem invertida, fora da janela e evidência inexistente", () => {
    const diagnostico = validarCronologiaResposta(
      {
        resumo: "x",
        acoes: [
          {
            descricao: "invertida",
            inicioEm: "2026-11-22T12:00:03.000Z",
            fimEm: "2026-11-22T12:00:01.000Z",
            evidencias: ["f-9"],
          },
          {
            descricao: "fora da janela",
            inicioEm: "2026-11-22T11:59:59.000Z",
            fimEm: "2026-11-22T12:00:05.000Z",
            evidencias: ["f-1"],
          },
        ],
      },
      contexto
    );

    expect(diagnostico.status).toBe("inconsistente");
    expect(diagnostico.erros.join(" ")).toContain("inicioEm posterior a fimEm");
    expect(diagnostico.erros.join(" ")).toContain("anterior ao inicio da janela");
    expect(diagnostico.erros.join(" ")).toContain("posterior ao fim da janela");
    expect(diagnostico.erros.join(" ")).toContain("evidencia f-9 nao existe");
    expect(diagnostico.acoes).toHaveLength(2);
  });

  it("aceita intervalo coerente e registra incerteza quando evidência escapa dele", () => {
    const diagnostico = validarCronologiaResposta(
      {
        acoes: [
          {
            descricao: "acao",
            inicioEm: "2026-11-22T12:00:00.500Z",
            fimEm: "2026-11-22T12:00:03.000Z",
            evidencias: ["f-2", "f-1"],
          },
        ],
      },
      contexto
    );

    expect(diagnostico.status).toBe("valido");
    expect(diagnostico.erros).toEqual([]);
    expect(diagnostico.avisos.join(" ")).toContain("evidencia f-1 fora do intervalo");
    expect(diagnostico.incertezas.join(" ")).toContain("f-1 pode nao sustentar");
  });

  it("o schema opcionalmente acrescenta cronologia sem mudar o padrão", () => {
    const resposta = {
      resumo: "x",
      acoes: [
        {
          descricao: "x",
          inicioEm: "2026-11-22T12:00:03.000Z",
          fimEm: "2026-11-22T12:00:01.000Z",
        },
      ],
    };
    expect(validarRespostaMultimodal(resposta).erros).toEqual([]);
    const comContexto = validarRespostaMultimodal(resposta, contexto);
    expect(comContexto.valido).toBe(false);
    expect(comContexto.erros.join(" ")).toContain("inicioEm posterior a fimEm");
    expect(comContexto.avisos.join(" ")).toContain("acao sem frame de evidencia");
  });
});
