import { describe, expect, it } from "vitest";
import {
  analisarRespostaMultimodal,
  validarRespostaMultimodal,
} from "../../src/domain/schema-resposta-multimodal";
import {
  aplicarExigenciaEvidencias,
  statusEvidenciaLocal,
} from "../../src/domain/evidencia-interpretacao";
import type { ResultadoInterpretacao } from "../../src/domain/interpretation";
import type { ContextoParaEvidencia } from "../../src/domain/evidencia-interpretacao";

describe("schema canônico da resposta multimodal (Fase 6, itens 4 e 5)", () => {
  it("aceita a forma já usada por ResultadoInterpretacao", () => {
    const analise = analisarRespostaMultimodal(
      '```json\n{"resumo":"pessoa entra","acoes":[{"descricao":"entrar","natureza":"observada","evidencias":["f1"]}],"evidencias":["f1"],"incertezas":[]}\n```'
    );
    expect(analise.schema.valido).toBe(true);
    expect(analise.json?.resumo).toBe("pessoa entra");
  });

  it("rejeita natureza desconhecida e resumo vazio sem descartar o objeto", () => {
    const schema = validarRespostaMultimodal({
      resumo: "",
      acoes: [{ descricao: "ação", natureza: "certa", evidencias: ["f1"] }],
    });
    expect(schema.valido).toBe(false);
    expect(schema.erros).toContain("resumo ausente ou vazio");
    expect(schema.erros).toContain("natureza de ação desconhecida");
  });

  it("reporta JSON inválido como erro explícito", () => {
    const analise = analisarRespostaMultimodal("texto solto");
    expect(analise.json).toBeNull();
    expect(analise.schema.erros).toEqual(["resposta não é JSON válido"]);
  });
});

describe("exigência de evidência e separação observação/inferência (itens 5 e 6)", () => {
  const contexto: ContextoParaEvidencia = {
    frames: [{ frameId: "f1" }, { frameId: "f2", percepcaoValida: false }],
    eventosTemporais: [
      {
        eventoId: "ev1",
        tipo: "desaparecimento",
        status: "encerrado",
        evidencias: ["f1"],
        motivoEncerramento: "periodo_cego",
      },
    ],
  };

  const resultado: ResultadoInterpretacao = {
    resumo: "algo aconteceu",
    acoes: [
      { descricao: "ação sustentada", evidencias: ["f1"], natureza: "inferida" },
      { descricao: "ação sem base", evidencias: [] },
    ],
    participantes: [{ descricao: "pessoa sem base", evidencias: [] }],
    evidencias: ["f1"],
    incertezas: ["talvez"],
    contradicoes: [],
  };

  it("remove afirmações sem referência e preserva o texto separadamente", () => {
    const { resultado: filtrado, afirmacoesSemEvidencia, distincao } = aplicarExigenciaEvidencias(
      resultado,
      contexto
    );
    expect(filtrado.acoes.map((a) => a.descricao)).toEqual(["ação sustentada"]);
    expect(filtrado.participantes).toEqual([]);
    expect(afirmacoesSemEvidencia.map((a) => a.texto)).toEqual([
      "ação sem base",
      "pessoa sem base",
    ]);
    expect(distincao.inferenciasModelo).toEqual([
      { descricao: "ação sustentada", natureza: "inferida" },
    ]);
    expect(distincao.naoVerificado).toContain("talvez");
  });

  it("deriva status local sem transformar lacuna/falha em ausência observada", () => {
    const { distincao } = aplicarExigenciaEvidencias(resultado, contexto);
    expect(statusEvidenciaLocal(contexto)).toBe("falha_percepcao");
    expect(distincao.observacoesLocais).toContainEqual({
      id: "f2",
      statusEvidencia: "falha_percepcao",
    });
    expect(distincao.observacoesLocais).toContainEqual({
      id: "ev1",
      statusEvidencia: "desconhecido",
    });
    expect(distincao.statusEvidenciaLocal).not.toBe("observado");
  });

  it("não deixa resumo sem evidência como narrativa verificada", () => {
    const semEvidencia: ResultadoInterpretacao = {
      resumo: "narrativa sem base",
      acoes: [],
      evidencias: [],
      incertezas: [],
      contradicoes: [],
    };
    const { resultado: filtrado, afirmacoesSemEvidencia, distincao } =
      aplicarExigenciaEvidencias(semEvidencia, contexto);
    expect(filtrado.resumo).toBe("");
    expect(afirmacoesSemEvidencia).toContainEqual({
      tipo: "resumo",
      texto: "narrativa sem base",
    });
    expect(distincao.resumoSemEvidencia).toBe(true);
    expect(distincao.naoVerificado).toContain("narrativa sem base");
    expect(semEvidencia.resumo).toBe("narrativa sem base");
  });
});
