import { describe, expect, it } from "vitest";
import {
  compararPerfisCorpo,
  compararPromptsCorpo,
  normalizarTextoCorpo,
} from "../src/domain/avaliacao-perfis-corpo";
import type { AnotacaoCorpo, RespostaCorpo } from "../src/domain/avaliacao-perfis-corpo";
import type { QuadroNsfwPrompt } from "../src/nsfw-prompt";

const quadros: QuadroNsfwPrompt[] = [
  {
    indice: 1,
    marcacoes: [
      {
        rotulo: "male_breast_exposed",
        score: 0.62,
        caixa: { xmin: 0.1, ymin: 0.2, xmax: 0.5, ymax: 0.8 },
      },
    ],
  },
];

describe("comparacao de perfis corporais (Fase 2)", () => {
  it("compara SFW, neutro e NSFW com as mesmas marcacoes, sem medir modelo", () => {
    const comparacao = compararPromptsCorpo(quadros, "clipe de praia");
    expect(comparacao.blocosDistintos).toBe(true);
    expect(comparacao.tamanhos.sfw).toBe(0);
    expect(comparacao.neutroContemInstrucaoCorporal).toBe(true);
    expect(comparacao.neutroContemInstrucaoNsfw).toBe(false);
    expect(comparacao.blocos.neutro).toContain("male_breast_exposed (peitoral masculino exposto) 0.620");
    expect(comparacao.blocos.nsfw).toContain("CONTEUDO ADULTO (NSFW)");
    expect(comparacao.blocos.neutro).toContain("clipe de praia");
    expect(comparacao.blocos.nsfw).toContain("clipe de praia");
  });

  it("nao divulga omissoes ou sexualizacao sem anotacao revisada", () => {
    const vazio = compararPerfisCorpo([], []);
    expect(vazio.status).toBe("sem_dados");
    expect(vazio.motivo).toContain("sem anotacao humana revisada");

    const respostas: RespostaCorpo[] = [
      { id: "f1", perfil: "neutro", descricao: "Pessoa sem camisa." },
    ];
    const semRevisao = compararPerfisCorpo(
      [{ id: "f1", rotulos: ["torso_exposto"], conteudoSexualExplicito: false }],
      respostas
    );
    expect(semRevisao.status).toBe("sem_dados");
    expect(semRevisao.motivo).toContain("sem revisao");
    expect(semRevisao.porPerfil.neutro.omissoes).toBe(0);

    const soAnotacao = compararPerfisCorpo(
      [{ id: "f1", rotulos: ["torso_exposto"], conteudoSexualExplicito: false, revisao: { status: "revisada" } }],
      []
    );
    expect(soAnotacao.status).toBe("sem_dados");
    expect(soAnotacao.motivo).toContain("sem respostas coletadas");
  });

  it("conta omissoes e sexualizacao indevida apenas com anotacao revisada", () => {
    const anotacoes: AnotacaoCorpo[] = [
      {
        id: "f1",
        rotulos: ["torso_exposto", "roupa_aberta"],
        conteudoSexualExplicito: false,
        revisao: { status: "revisada" },
      },
      {
        id: "f2",
        rotulos: ["conteudo_sexual_explicito"],
        conteudoSexualExplicito: true,
        revisao: { status: "revisada" },
      },
    ];
    const respostas: RespostaCorpo[] = [
      { id: "f1", perfil: "neutro", descricao: "Homem com camisa aberta e torso exposto." },
      { id: "f1", perfil: "nsfw", descricao: "Cena pornografica." },
      { id: "f2", perfil: "nsfw", descricao: "Ato sexual explicito visivel." },
      { id: "extra", perfil: "sfw", descricao: "Sem anotacao." },
    ];
    const resultado = compararPerfisCorpo(anotacoes, respostas);

    expect(resultado.status).toBe("avaliado");
    expect(resultado.base).toBe("comparacao-lexica");
    expect(resultado.respostasSemAnotacao).toBe(1);
    expect(resultado.porPerfil.neutro.omissoes).toBe(0);
    expect(resultado.porPerfil.neutro.sexualizacoesIndevidas).toBe(0);
    expect(resultado.porPerfil.nsfw.omissoes).toBe(2);
    expect(resultado.porPerfil.nsfw.sexualizacoesIndevidas).toBe(1);
    expect(resultado.porPerfil.sfw.semResposta).toBe(2);
  });

  it("normaliza acentos e caixa antes da comparacao lexica", () => {
    expect(normalizarTextoCorpo("Abdômen Exposto!")).toContain("abdomen exposto");
  });
});
