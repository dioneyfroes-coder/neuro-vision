import { describe, expect, it } from "vitest";

import {
  varrerTrechosSegredos,
  type TrechoVarreduraSegredos,
} from "../src/domain/varredura-segredos";

/** Valores fictícios, curtos ou com Entropy suficiente apenas para exercitar o detector. */
function trecho(texto: string, origem: "atual" | "historico" = "atual"): TrechoVarreduraSegredos {
  return { caminho: "src/exemplo.ts", linha: 7, texto, origem };
}

describe("Fase 6 — varredura heurística de segredos", () => {
  it("devolve sem_dados quando não há trechos", () => {
    const relatorio = varrerTrechosSegredos();
    expect(relatorio.status).toBe("sem_dados");
    expect(relatorio.observacoes.join(" ")).toMatch(/nao concluir/);
  });

  it("detecta padrões conhecidos sem devolver o valor original", () => {
    const segredo = "Zx9Qv2Lm8Rt6Yw4Bn1Kd5Fs3";
    const relatorio = varrerTrechosSegredos([
      trecho(`const apiKey = "${segredo}";`),
      trecho("-----BEGIN RSA PRIVATE KEY-----"),
      trecho("AKIA1234567890ABCDEF"),
      trecho("Authorization: Bearer AbCdEfGhIjKlMnOpQrStUvWx"),
    ]);
    expect(relatorio.status).toBe("candidatos");
    expect(relatorio.totalAchados).toBeGreaterThanOrEqual(4);
    const serializado = JSON.stringify(relatorio);
    expect(serializado).not.toContain(segredo);
    expect(serializado).not.toContain("AKIA1234567890ABCDEF");
    expect(relatorio.achados.every((achado) => achado.valorRedigido.includes("chars") || achado.valorRedigido === "***"))
      .toBe(true);
  });

  it("ignora placeholders de documentação e testes", () => {
    const relatorio = varrerTrechosSegredos([
      trecho('NEURO_API_TOKEN="<token>"'),
      trecho('const token = "exemplo-exemplo-exemplo-exemplo";'),
      trecho("Authorization: Bearer xxxxxxxxxxxxxxxxxxxxxxxxxxxx"),
      trecho("apiKey: ${NEURO_API_KEY}"),
    ]);
    expect(relatorio.status).toBe("limpo");
    expect(relatorio.totalAchados).toBe(0);
  });

  it("mantém origem e linha de cada candidato e limita a lista", () => {
    const relatorio = varrerTrechosSegredos(
      [trecho("AKIA1234567890ABCDEF", "historico")],
      5
    );
    expect(relatorio.achados[0]).toMatchObject({
      origem: "historico",
      linha: 7,
      tipo: "aws_access_key",
    });
    const repetido = varrerTrechosSegredos([
      trecho("AKIA1234567890ABCDEF"),
      trecho("AKIA1234567890ABCDEF"),
    ]);
    expect(repetido.totalAchados).toBe(1);
  });
});
