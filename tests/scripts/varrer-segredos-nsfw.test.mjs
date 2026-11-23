import { describe, expect, it } from "vitest";

import { gerarRelatorioSeguranca } from "../../scripts/varrer-segredos-nsfw.mjs";

describe("harness de varredura de segredos (NSFW)", () => {
  it("não afirma limpeza sem trechos examinados", () => {
    const relatorio = gerarRelatorioSeguranca();
    expect(relatorio.status).toBe("SEM_CANDIDATOS");
    expect(relatorio.atual.status).toBe("sem_dados");
    expect(relatorio.historico.status).toBe("sem_dados");
    expect(relatorio.atual.totalAchados).toBe(0);
    expect(relatorio.observacoes).toContain("SEM_CANDIDATOS nao prova ausencia de segredos");
  });

  it("separa conteúdo atual, histórico e caminhos sensíveis", () => {
    const relatorio = gerarRelatorioSeguranca({
      trechosAtuais: [{ caminho: "src/a.ts", linha: 3, texto: "const x = 1;", origem: "atual" }],
      trechosHistorico: [
        { caminho: "antigo.ts", linha: 9, texto: "AKIA1234567890ABCDEF", origem: "historico" },
      ],
      caminhosHistorico: ["src/a.ts", "bench/imagens/antiga.png"],
      commits: 12,
    });
    expect(relatorio.commits).toBe(12);
    expect(relatorio.status).toBe("CANDIDATOS");
    expect(relatorio.atual.status).toBe("limpo");
    expect(relatorio.historico.totalAchados).toBe(1);
    expect(relatorio.historico.achados[0].origem).toBe("historico");
    expect(relatorio.caminhosHistorico.caminhosSensiveis).toEqual(["bench/imagens/antiga.png"]);
  });

  it("sinaliza caminhos sensíveis mesmo sem candidato de conteúdo", () => {
    const relatorio = gerarRelatorioSeguranca({
      trechosAtuais: [{ caminho: "src/a.ts", linha: 1, texto: "ok", origem: "atual" }],
      caminhosHistorico: ["logs/antigo.jsonl"],
    });
    expect(relatorio.status).toBe("ATENCAO");
    expect(relatorio.caminhosHistorico.status).toBe("atencao");
  });
});
