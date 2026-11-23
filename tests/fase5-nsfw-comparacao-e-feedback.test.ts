import { describe, expect, it } from "vitest";
import {
  camposMidIADescartados,
  marcarFeedbackRevisado,
  mesclarFeedbackNsfw,
  normalizarFeedbackNsfw,
  removerFeedbackNsfw,
  resumoFeedbackNsfw,
} from "../src/domain/feedback-local";
import {
  formatarComparacao,
  formatarItemFeedback,
  formatarResumoFeedback,
} from "../src/domain/formatacao-revisao";
import { compararDescricoes } from "../src/domain/comparacao-descricoes";
import {
  CHAVE_FEEDBACK_NSFW,
  criarRepositorioFeedbackLocal,
  type ArmazenamentoFeedback,
} from "../public/ui/feedback-local";

function armazenamentoMemoria(): ArmazenamentoFeedback & { conteudo(): string | null } {
  let valor: string | null = null;
  return {
    ler: () => valor,
    gravar: (novo) => {
      valor = novo;
    },
    remover: () => {
      valor = null;
    },
    conteudo: () => valor,
  };
}

const registro = (id: string, tipo = "descricao_incorreta") => ({
  id,
  tipo,
  criadoEm: "2026-11-23T12:00:00.000Z",
  revisado: false,
});

describe("Fase 5 — comparação lexical de descrições", () => {
  it("devolve sem_dados quando falta uma descrição, nunca zero", () => {
    const sem = compararDescricoes("uma cena", undefined);
    expect(sem.status).toBe("sem_dados");
    expect(sem.semelhancaLexica).toBeNull();
    expect(formatarComparacao(sem)).toContain("N/A");
  });

  it("separa termos comuns e exclusivos e aceita sinônimos declarados", () => {
    const comparacao = compararDescricoes(
      "Pessoa com membro visível e camiseta",
      "Pessoa com penis visivel e calca",
      { sinonimos: { penis: ["membro"] } }
    );
    expect(comparacao.status).toBe("comparado");
    expect(comparacao.comuns).toContain("penis");
    expect(comparacao.comuns).toContain("pessoa");
    expect(comparacao.somenteSfw).toContain("camiseta");
    expect(comparacao.somenteEspecializada).toContain("calca");
    expect(comparacao.semelhancaLexica).toBeGreaterThan(0);
    expect(comparacao.semelhancaLexica).toBeLessThan(1);
  });

  it("normaliza acentos e ignora palavras vazias", () => {
    const comparacao = compararDescricoes("ação", "acao");
    expect(comparacao.comuns).toEqual(["acao"]);
  });
});

describe("Fase 5 — feedback local", () => {
  it("valida campos e descarta mídia sem persisti-la", () => {
    const entrada = {
      ...registro("fb-1"),
      frameId: "f2",
      descricao: "A descrição omitiu a mão.",
      imagem: "data:image/png;base64,AAAA",
      weights: "segredo",
    };
    const normalizado = normalizarFeedbackNsfw(entrada);
    expect(normalizado).toMatchObject({ id: "fb-1", frameId: "f2" });
    expect(normalizado).not.toHaveProperty("imagem");
    expect(camposMidIADescartados(entrada)).toEqual(["imagem", "weights"]);
  });

  it("rejeita tipo inválido, id ausente e data inválida", () => {
    expect(normalizarFeedbackNsfw({ ...registro("x"), tipo: "invalido" })).toBeNull();
    expect(normalizarFeedbackNsfw({ ...registro(""), criadoEm: "ontem" })).toBeNull();
  });

  it("dedup por id, marca revisado e remove sem duplicar", () => {
    const lista = mesclarFeedbackNsfw([registro("a")], [registro("a"), registro("b")]);
    expect(lista.map((r) => r.id)).toEqual(["a", "b"]);
    expect(marcarFeedbackRevisado(lista, "b").find((r) => r.id === "b")?.revisado).toBe(true);
    expect(removerFeedbackNsfw(lista, "a").map((r) => r.id)).toEqual(["b"]);
  });

  it("resumo não transforma ausência em falha", () => {
    expect(resumoFeedbackNsfw([])).toMatchObject({
      total: 0,
      pendentes: 0,
      revisados: 0,
    });
    expect(formatarResumoFeedback(resumoFeedbackNsfw([]))).toBe("sem feedback");
    expect(formatarItemFeedback(registro("a"))).toContain("descricao_incorreta");
  });

  it("repositório persiste somente metadados e sobrevive a leitura corrompida", () => {
    const armazenamento = armazenamentoMemoria();
    const repositorio = criarRepositorioFeedbackLocal(armazenamento);
    repositorio.adicionar({ ...registro("fb-9"), imagem: "nao-gravar" });
    const conteudo = armazenamento.conteudo() ?? "";
    expect(conteudo).toContain("fb-9");
    expect(conteudo).not.toContain("nao-gravar");
    expect(JSON.parse(conteudo).registros).toHaveLength(1);

    armazenamento.gravar("{invalido");
    expect(repositorio.listar()).toEqual([]);
    expect(repositorio.resumo().total).toBe(0);
  });

  it("usa chave versionada e permite limpar", () => {
    expect(CHAVE_FEEDBACK_NSFW).toBe("neuro.feedback.nsfw.v1");
    const armazenamento = armazenamentoMemoria();
    const repositorio = criarRepositorioFeedbackLocal(armazenamento);
    repositorio.adicionar(registro("fb-1"));
    repositorio.limpar();
    expect(repositorio.listar()).toEqual([]);
  });
});
