import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { validarConjuntoEval } from "../../scripts/validar-eval.mjs";

async function montarConjunto({ minimo = 1, bytesTuning = "tuning", metodo = "quadro-a-quadro" } = {}) {
  const raiz = await mkdtemp(path.join(tmpdir(), "neuro-eval-"));
  const evalDir = path.join(raiz, "bench", "clipes", "eval");
  const tuningDir = path.join(raiz, "bench", "clipes", "tuning");
  const videosDir = path.join(raiz, "bench", "videos");
  await Promise.all([mkdir(evalDir, { recursive: true }), mkdir(tuningDir, { recursive: true }), mkdir(videosDir, { recursive: true })]);
  const salvarJson = (arquivo, dados) =>
    writeFile(arquivo, `${JSON.stringify(dados, null, 2)}\n`, "utf8");
  const revisao = { status: "revisada", metodo };
  const evento = {
    tipo: "movimento",
    em: 500,
    inicioMs: 400,
    fimMs: 600,
    categoria: "gesto",
    classe: "aceno",
    visibilidade: "clara",
    parteEnvolvida: "mao_direita",
    determinavel: true,
  };
  const anotacao = (clip, eventos, extra = {}) => ({
    versaoEsquema: 2,
    clip,
    conjunto: "eval",
    duracaoMs: 1000,
    revisao,
    eventos,
    ...extra,
  });

  await salvarJson(path.join(evalDir, "manifest.json"), {
    versaoEsquema: 1,
    ocorrenciasMinimasPorClasse: minimo,
    clipesNegativosMinimos: 3,
    classes: [{ categoria: "gesto", classe: "aceno" }],
  });
  await salvarJson(path.join(evalDir, "gesture-eval.json"), anotacao("gesture-eval.webm", [evento]));
  await salvarJson(
    path.join(evalDir, "negative-one.json"),
    anotacao("negative-one.webm", [], { casoNegativo: true })
  );
  await salvarJson(
    path.join(evalDir, "negative-two.json"),
    anotacao("negative-two.webm", [], { negativos: ["gesto.aceno"] })
  );
  await salvarJson(
    path.join(evalDir, "negative-three.json"),
    anotacao("negative-three.webm", [], { negativos: ["gesto.aceno"] })
  );
  await salvarJson(path.join(tuningDir, "gesture-tuning.json"), {
    clip: "gesture-tuning.webm",
    eventos: [],
  });

  await writeFile(path.join(videosDir, "gesture-eval.webm"), "eval");
  await writeFile(path.join(videosDir, "negative-one.webm"), "negative-one");
  await writeFile(path.join(videosDir, "negative-two.webm"), "negative-two");
  await writeFile(path.join(videosDir, "negative-three.webm"), "negative-three");
  await writeFile(path.join(videosDir, "gesture-tuning.webm"), bytesTuning);

  return { raiz, tuningDir, videosDir };
}

describe("validarConjuntoEval", () => {
  it("valida cobertura minima, negativos e revisao humana", async () => {
    const conjunto = await montarConjunto();
    try {
      const resultado = await validarConjuntoEval({ raiz: conjunto.raiz });
      expect(resultado.valido).toBe(true);
      expect(resultado.cobertura).toEqual([
        { categoria: "gesto", classe: "aceno", ocorrencias: 1, negativos: 3 },
      ]);
      expect(resultado.clipesNegativos).toBe(3);
    } finally {
      await rm(conjunto.raiz, { recursive: true, force: true });
    }
  });

  it("rejeita clipe compartilhado entre tuning e eval por hash", async () => {
    const conjunto = await montarConjunto({ bytesTuning: "eval" });
    try {
      const resultado = await validarConjuntoEval({ raiz: conjunto.raiz });
      expect(resultado.valido).toBe(false);
      expect(resultado.erros.some((erro) => erro.includes("tambem pertence ao conjunto tuning"))).toBe(
        true
      );
    } finally {
      await rm(conjunto.raiz, { recursive: true, force: true });
    }
  });

  it("rejeita cobertura abaixo do minimo predefinido", async () => {
    const conjunto = await montarConjunto({ minimo: 3 });
    try {
      const resultado = await validarConjuntoEval({ raiz: conjunto.raiz });
      expect(resultado.valido).toBe(false);
      expect(resultado.erros).toContain("gesto.aceno: 1/3 ocorrencias");
    } finally {
      await rm(conjunto.raiz, { recursive: true, force: true });
    }
  });

  it("exige resolucao melhor que 1 fps para eventos rapidos", async () => {
    const conjunto = await montarConjunto({ metodo: "amostragem-manual-1fps" });
    try {
      const resultado = await validarConjuntoEval({ raiz: conjunto.raiz });
      expect(resultado.valido).toBe(false);
      expect(
        resultado.erros.some((erro) => erro.includes("exige anotacao melhor que 1 fps"))
      ).toBe(true);
    } finally {
      await rm(conjunto.raiz, { recursive: true, force: true });
    }
  });

  it("aceita evento rapido anotado a 5 fps", async () => {
    const conjunto = await montarConjunto({ metodo: "amostragem-manual-5fps" });
    try {
      const resultado = await validarConjuntoEval({ raiz: conjunto.raiz });
      expect(resultado.valido).toBe(true);
    } finally {
      await rm(conjunto.raiz, { recursive: true, force: true });
    }
  });

  it("rejeita alvo marcado como positivo e negativo no mesmo clipe", async () => {
    const conjunto = await montarConjunto();
    try {
      const caminho = path.join(
        conjunto.raiz,
        "bench",
        "clipes",
        "eval",
        "gesture-eval.json"
      );
      const anotacao = JSON.parse(await readFile(caminho, "utf8"));
      anotacao.negativos = ["gesto.aceno"];
      await writeFile(caminho, `${JSON.stringify(anotacao, null, 2)}\n`, "utf8");
      const resultado = await validarConjuntoEval({ raiz: conjunto.raiz });
      expect(resultado.valido).toBe(false);
      expect(
        resultado.erros.some((erro) =>
          erro.includes("gesto.aceno nao pode ser positivo e negativo no mesmo clipe")
        )
      ).toBe(true);
    } finally {
      await rm(conjunto.raiz, { recursive: true, force: true });
    }
  });
});
