import { describe, expect, it } from "vitest";

import {
  avaliarDescricoesHumanasNsfw,
  prepararAmostrasCegasNsfw,
} from "../src/domain/avaliacao-descricoes-humanas";
import {
  normalizarPesoDeclaradoNsfw,
  validarProvenienciaPesos,
} from "../src/domain/proveniencia-pesos";
import {
  auditarArquivosVersionados,
  classificarArquivoNsfw,
} from "../src/domain/auditoria-privacidade";

/** Textos e revisões fictícios: exercitam o protocolo, não qualidade de modelo. */
const pares = [
  { id: "amostra-1", sfw: "pessoa sem camisa", especializada: "torso exposto" },
  { id: "amostra-2", sfw: "duas pessoas", especializada: "duas pessoas, maos visiveis" },
];

describe("Fase 6 — revisão cega, proveniência e privacidade", () => {
  it("gera ordem A/B estável sem revelar a origem", () => {
    const primeiro = prepararAmostrasCegasNsfw(pares);
    const segundo = prepararAmostrasCegasNsfw(pares);
    expect(segundo).toEqual(primeiro);
    for (const amostra of primeiro.amostras) {
      const mapa = primeiro.mapa[amostra.id];
      expect(new Set([mapa.A, mapa.B])).toEqual(new Set(["sfw", "especializada"]));
      expect([amostra.textoA, amostra.textoB]).toEqual(
        mapa.A === "sfw"
          ? [pares.find((par) => par.id === amostra.id)?.sfw, pares.find((par) => par.id === amostra.id)?.especializada]
          : [pares.find((par) => par.id === amostra.id)?.especializada, pares.find((par) => par.id === amostra.id)?.sfw]
      );
    }
  });

  it("não publica consenso sem revisores suficientes", () => {
    const { amostras, mapa } = prepararAmostrasCegasNsfw(pares);
    expect(avaliarDescricoesHumanasNsfw(amostras, mapa, []).status).toBe("sem_dados");
    const isolado = avaliarDescricoesHumanasNsfw(amostras, mapa, [
      { amostraId: "amostra-1", revisorId: "r1", preferencia: "A" },
    ]);
    expect(isolado.status).toBe("sem_dados");
    expect(isolado.concordanciaMedia).toBeNull();
  });

  it("registra preferência por origem sem inventar taxa de acerto", () => {
    const { amostras, mapa } = prepararAmostrasCegasNsfw(pares);
    const relatorio = avaliarDescricoesHumanasNsfw(amostras, mapa, [
      { amostraId: "amostra-1", revisorId: "r1", preferencia: "A" },
      { amostraId: "amostra-1", revisorId: "r2", preferencia: "A" },
    ]);
    expect(relatorio.status).toBe("observado");
    expect(relatorio.amostrasComConsenso).toBe(1);
    expect(relatorio.concordanciaMedia).toBe(1);
    const origem = mapa["amostra-1"].A;
    expect(relatorio.preferenciasPorOrigem[origem]).toBe(1);
    expect(relatorio).not.toHaveProperty("precisao");
  });

  it("recusa manifesto de pesos sem licença, hash ou revisão fixada", () => {
    const manifesto = { versaoEsquema: 1 };
    expect(validarProvenienciaPesos(undefined).status).toBe("sem_dados");
    const incompleto = validarProvenienciaPesos(manifesto, [{ nome: "a.onnx", funcao: "detector" }]);
    expect(incompleto.status).toBe("invalido");
    expect(incompleto.erros.join(" ")).toMatch(/licenca|SHA-256|revisao/);

    const sha = "f".repeat(64);
    const revisao = "1".repeat(40);
    const valido = validarProvenienciaPesos(manifesto, [
      {
        nome: "a.onnx",
        funcao: "detector",
        fonte: "https://exemplo.local/modelos/resolver/abc",
        licenca: "Apache-2.0",
        sha256: sha,
        revisao,
        tamanhoBytes: 1024,
      },
    ]);
    expect(valido.status).toBe("valido");
    expect(valido.prontosParaBenchmark).toBe(true);
    expect(valido.fontesMoveis).toBe(0);
  });

  it("sinaliza fonte móvel e peso incorporado", () => {
    const sha = "f".repeat(64);
    const revisao = "1".repeat(40);
    const oRelatorio = validarProvenienciaPesos({ versaoEsquema: 1 }, [
      {
        nome: "a.onnx",
        funcao: "detector",
        fonte: "https://huggingface.co/x/resolve/main/a.onnx",
        licenca: "MIT",
        sha256: sha,
        revisao,
      },
    ]);
    expect(oRelatorio.fontesMoveis).toBe(1);
    expect(oRelatorio.status).toBe("invalido");
    expect(normalizarPesoDeclaradoNsfw({ nome: "a.onnx", funcao: "detector", base64: "..." }).erro)
      .toMatch(/midia\/peso incorporado/);
  });

  it("classifica apenas caminhos e nunca afirma ausência de segredos no conteúdo", () => {
    expect(classificarArquivoNsfw("C:\\temp\\a.png")).toBe("midia");
    expect(classificarArquivoNsfw("modelos/yolonsfw/a.onnx")).toBe("peso");
    expect(classificarArquivoNsfw("logs/ciclos.jsonl")).toBe("log");
    expect(classificarArquivoNsfw(".env.local")).toBe("segredo");
    expect(classificarArquivoNsfw(".env.example")).toBe("texto");
    expect(classificarArquivoNsfw("src/domain/index.ts")).toBe("texto");

    const limpo = auditarArquivosVersionados(["src/a.ts", "docs/README.md"]);
    expect(limpo.status).toBe("limpo");
    expect(limpo.revisaoHumanaNecessaria).toBe(false);
    const atencao = auditarArquivosVersionados(["src/a.ts", "bench/videos/cena.mp4"]);
    expect(atencao.status).toBe("atencao");
    expect(atencao.caminhosSensiveis).toEqual(["bench/videos/cena.mp4"]);
    expect(atencao.revisaoHumanaNecessaria).toBe(true);
    expect(auditarArquivosVersionados([]).status).toBe("sem_dados");
  });
});
