import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  compararCena,
  construirReferencia,
  itensCenaDeDeteccoes,
  registrarConfirmacaoMudanca,
  revisarMudanca,
  type ItemCena,
  type MudancaCena,
} from "../src/domain";
import { indisponivel, naoAmostrado, type Deteccao } from "../src/domain/perception";
import { SemMudancaCenaError, ServicoCena } from "../src/monitoramento/servico-cena";
import { montarComparacaoCena, montarConsolidacaoCena } from "../src/http/validacao";
import {
  coletarReferenciaInventario,
  compararObservacaoInventario,
} from "../public/monitoramento/inventario/inventario";

const BASE = 1_700_000_000_000;
const DIMENSOES = { largura: 640, altura: 480 };

function deteccao(sobres: Partial<Deteccao> = {}): Deteccao {
  return {
    nome: "cadeira",
    rotulo: "chair",
    score: 0.9,
    caixa: { xmin: 100, ymin: 100, xmax: 200, ymax: 200 },
    ...sobres,
  };
}

function item(sobres: Partial<ItemCena> = {}): ItemCena {
  return {
    objetoId: "cadeira-1",
    rotulo: "cadeira",
    caixa: { xmin: 0.15, ymin: 0.2, xmax: 0.3, ymax: 0.4 },
    confirmacao: "confirmado",
    confianca: 0.9,
    observadoEmMs: BASE,
    ...sobres,
  };
}

describe("Fase 2 — ponte YOLO → inventário", () => {
  it("normaliza caixa, instância e evidência temporal da detecção", () => {
    const itens = itensCenaDeDeteccoes({
      deteccoes: {
        deteccoes: [deteccao({ entidadeId: "track-7" })],
        dimensoes: DIMENSOES,
      },
      frameId: "f1",
      capturadoEmMs: BASE + 25,
    });
    expect(itens).toHaveLength(1);
    expect(itens[0]).toMatchObject({
      objetoId: "track-7",
      instanciaId: "track-7",
      rotulo: "cadeira",
      classe: "chair",
      caixa: { xmin: 0.15625, ymin: 0.20833333333333334, xmax: 0.3125, ymax: 0.4166666666666667 },
      confirmacao: "confirmado",
      confianca: 0.9,
      frameId: "f1",
      frameIds: ["f1"],
      observadoEmMs: BASE + 25,
      primeiraObservacaoEmMs: BASE + 25,
      ultimaObservacaoEmMs: BASE + 25,
      statusEvidencia: "observado",
    });
  });

  it("mantém duas instâncias da mesma classe quando o rastreador não deu ID", () => {
    const itens = itensCenaDeDeteccoes({
      deteccoes: {
        deteccoes: [
          deteccao({ caixa: { xmin: 20, ymin: 20, xmax: 80, ymax: 80 } }),
          deteccao({ caixa: { xmin: 500, ymin: 20, xmax: 560, ymax: 80 } }),
        ],
        dimensoes: DIMENSOES,
      },
      frameId: "f1",
      capturadoEmMs: BASE,
    });
    expect(itens.map((i) => i.instanciaId)).toEqual(["chair@1:1", "chair@8:1"]);
    expect(new Set(itens.map((i) => i.objetoId)).size).toBe(2);
  });

  it("separa detecção fraca de detecção direta", () => {
    const itens = itensCenaDeDeteccoes({
      deteccoes: { deteccoes: [deteccao({ score: 0.3 })], dimensoes: DIMENSOES },
      frameId: "f1",
      capturadoEmMs: BASE,
    });
    expect(itens[0]).toMatchObject({ confirmacao: "possivel", statusEvidencia: "possivel" });
  });

  it("não transforma falha, frame pulado ou resultado ausente em ausência observada", () => {
    const base = { frameId: "f1", capturadoEmMs: BASE };
    expect(itensCenaDeDeteccoes({ ...base, deteccoes: indisponivel("deteccao", "falha") })).toEqual(
      []
    );
    expect(itensCenaDeDeteccoes({ ...base, deteccoes: naoAmostrado("deteccao") })).toEqual([]);
    expect(itensCenaDeDeteccoes({ ...base, deteccoes: undefined })).toEqual([]);
  });

  it("recusa converter detecções sem dimensões da imagem", () => {
    expect(() =>
      itensCenaDeDeteccoes({
        deteccoes: { deteccoes: [deteccao()] },
        frameId: "f1",
        capturadoEmMs: BASE,
      })
    ).toThrow(/dimensoes da imagem/);
  });

  it("consolida três quadros preservando instâncias e toda a evidência", () => {
    const itens = [0, 1, 2].flatMap((indice) =>
      itensCenaDeDeteccoes({
        deteccoes: {
          deteccoes: [
            deteccao({ entidadeId: "cadeira-esq" }),
            deteccao({
              entidadeId: "cadeira-dir",
              caixa: { xmin: 400, ymin: 100, xmax: 500, ymax: 200 },
            }),
          ],
          dimensoes: DIMENSOES,
        },
        frameId: `f${indice}`,
        capturadoEmMs: BASE + indice * 100,
      })
    );
    const referencia = construirReferencia({
      sessaoId: "s",
      itens,
      criadaEmMs: BASE,
      quadros: 3,
    });
    expect(referencia.itens.map((i) => i.instanciaId)).toEqual(["cadeira-dir", "cadeira-esq"]);
    expect(referencia.itens[0].frameIds).toEqual(["f0", "f1", "f2"]);
    expect(referencia.itens[0].primeiraObservacaoEmMs).toBe(BASE);
    expect(referencia.itens[0].ultimaObservacaoEmMs).toBe(BASE + 200);
    expect(referencia.itens.every((i) => i.confiancaAssociacao === 1)).toBe(true);
  });

  it("liga a mudança aos quadros que a sustentam", () => {
    const referencia = construirReferencia({
      sessaoId: "s",
      criadaEmMs: BASE,
      itens: [item({ instanciaId: "c1", frameId: "f0", observadoEmMs: BASE })],
    });
    const mudancas = compararCena(
      referencia,
      [
        item({
          instanciaId: "c1",
          objetoId: "c1",
          caixa: { xmin: 0.35, ymin: 0.2, xmax: 0.5, ymax: 0.4 },
          frameIds: ["f1", "f2"],
          observadoEmMs: BASE + 100,
          primeiraObservacaoEmMs: BASE + 100,
          ultimaObservacaoEmMs: BASE + 200,
        }),
      ],
      BASE + 200
    );
    expect(mudancas).toHaveLength(1);
    expect(mudancas[0]).toMatchObject({
      tipo: "objeto_movido",
      frameIds: ["f1", "f2"],
      primeiraObservacaoEmMs: BASE + 100,
      ultimaObservacaoEmMs: BASE + 200,
      statusEvidencia: "observado",
    });
  });
});

describe("Fase 2 — confirmação de mudança", () => {
  function mudancaPossivel(sobres: Partial<MudancaCena> = {}): MudancaCena {
    return {
      mudancaId: "s|estado_alterado|cadeira-1|" + BASE,
      sessaoId: "s",
      tipo: "estado_alterado",
      objetoId: "cadeira-1",
      rotulo: "cadeira",
      confianca: 0.5,
      observado: true,
      detectadoEmMs: BASE + 100,
      referenciaEmMs: BASE,
      statusEvidencia: "possivel",
      ...sobres,
    };
  }

  it("promove hipótese direta após observações repetidas e para de escrever depois", () => {
    const primeira = registrarConfirmacaoMudanca(mudancaPossivel(), BASE + 100);
    expect(primeira.confirmacoes).toBe(1);
    expect(primeira.revisao).toBeUndefined();

    const segunda = registrarConfirmacaoMudanca(primeira, BASE + 200);
    expect(segunda).toMatchObject({
      confirmacoes: 2,
      confirmadoEmMs: BASE + 200,
      revisao: "confirmada",
      statusEvidencia: "observado",
    });
    expect(segunda.confianca).toBeGreaterThan(0.6);
    expect(registrarConfirmacaoMudanca(segunda, BASE + 300)).toBe(segunda);
  });

  it("nunca transforma ausência informada em observing direto", () => {
    const mudanca = mudancaPossivel({
      tipo: "objeto_removido",
      observado: false,
      statusEvidencia: "nao_observado",
    });
    const confirmada = registrarConfirmacaoMudanca(
      registrarConfirmacaoMudanca(mudanca, BASE + 100),
      BASE + 200
    );
    expect(confirmada.statusEvidencia).toBe("nao_observado");
    expect(confirmada.revisao).toBe("confirmada");
  });

  it("respeita a rejeição manual", () => {
    const rejeitada = revisarMudanca(mudancaPossivel(), "rejeitada", BASE + 300);
    expect(rejeitada.revisao).toBe("rejeitada");
    expect(registrarConfirmacaoMudanca(rejeitada, BASE + 400)).toBe(rejeitada);
  });
});

describe("Fase 2 — coleta e comparação automática no cliente", () => {
  it("coleta quadros distribuídos e consolida o inventário com a evidência de cada um", async () => {
    let relogio = BASE;
    const definicoes: Array<{ criadaEmMs: number; quadros: number; itens: ItemCena[] }> = [];
    const referencia = await coletarReferenciaInventario({
      sessaoId: "s",
      quadros: 3,
      intervaloMs: 100,
      agoraMs: () => relogio,
      esperar: async (ms) => {
        relogio += ms;
      },
      capturar: async () => ({
        frameId: `f${relogio}`,
        imagem: "data:image/jpeg;base64,A",
        capturadoEmMs: relogio + 10,
        dimensoes: DIMENSOES,
      }),
      detectar: async (quadro) => ({
        deteccoes: [deteccao({ entidadeId: "track-1" })],
        dimensoes: quadro.dimensoes,
      }),
      definirReferencia: async (opcoes) => {
        definicoes.push(opcoes);
        return construirReferencia(opcoes);
      },
    });
    expect(definicoes).toHaveLength(1);
    expect(definicoes[0]).toMatchObject({ sessaoId: "s", criadaEmMs: BASE, quadros: 3 });
    expect(definicoes[0].itens).toHaveLength(3);
    expect(referencia.itens[0].frameIds).toHaveLength(3);
    expect(referencia.quadros).toBe(3);
  });

  it("ignora quadros sem câmera sem inventar ausência", async () => {
    const erros: string[] = [];
    let capturas = 0;
    const referencia = await coletarReferenciaInventario({
      sessaoId: "s",
      quadros: 3,
      capturar: async () => {
        capturas += 1;
        if (capturas === 2) return null;
        return {
          frameId: `f${capturas}`,
          imagem: "data:image/jpeg;base64,A",
          capturadoEmMs: BASE + capturas,
          dimensoes: DIMENSOES,
        };
      },
      detectar: async () => ({ deteccoes: [deteccao()], dimensoes: DIMENSOES }),
      definirReferencia: async (opcoes) => construirReferencia(opcoes),
      aoErro: (erro) => erros.push(erro.message),
    });
    expect(referencia.quadros).toBe(2);
    expect(erros).toHaveLength(1);
    expect(erros[0]).toMatch(/Quadro 2 indisponível/);
  });

  it("rejeita coleta com zero quadros", async () => {
    await expect(
      coletarReferenciaInventario({
        sessaoId: "s",
        quadros: 0,
        capturar: async () => null,
        detectar: async () => ({ deteccoes: [] }),
        definirReferencia: async (opcoes) => construirReferencia(opcoes),
      })
    ).rejects.toThrow(/quadros/);
  });

  it("comparação reaproveita o instante do quadro e pede confirmação automática", async () => {
    let chamada: {
      sessaoId: string;
      itens: ItemCena[];
      agoraMs: number;
      comparacao: { associacaoPorInstancia?: boolean };
      confirmarRepeticao: boolean;
    } | null = null;
    await compararObservacaoInventario({
      sessaoId: "s",
      quadro: {
        frameId: "f9",
        imagem: "data:image/jpeg;base64,A",
        capturadoEmMs: BASE + 50,
        dimensoes: DIMENSOES,
      },
      deteccoes: { deteccoes: [deteccao()], dimensoes: DIMENSOES },
      comparar: async (opcoes) => {
        chamada = opcoes;
        return { mudancas: [], novas: [], confirmadas: [] };
      },
    });
    expect(chamada).not.toBeNull();
    expect(chamada?.agoraMs).toBe(BASE + 50);
    expect(chamada?.itens[0].frameId).toBe("f9");
    expect(chamada?.comparacao.associacaoPorInstancia).toBe(true);
    expect(chamada?.confirmarRepeticao).toBe(true);
  });
});

describe("Fase 2 — serviço e validação", () => {
  let tmpDir: string;
  let servico: ServicoCena;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "neuro-fase2-"));
    servico = new ServicoCena({
      referenciasFile: path.join(tmpDir, "referencias.jsonl"),
      mudancasFile: path.join(tmpDir, "mudancas.jsonl"),
      maxBytes: 1_000_000,
    });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("acumula confirmação na mudança já persistida sem duplicar a linha do tempo", async () => {
    await servico.definirReferencia({
      sessaoId: "s",
      itens: [item({ instanciaId: "c1", objetoId: "c1", estadoObjeto: "fechado" })],
      criadaEmMs: BASE,
    });
    const observado = [
      item({
        instanciaId: "c1",
        objetoId: "c1",
        estadoObjeto: "aberto",
        confirmacao: "possivel",
        confianca: 0.5,
        observadoEmMs: BASE + 100,
      }),
    ];
    const primeira = await servico.comparar({
      sessaoId: "s",
      itens: observado,
      detectadoEmMs: BASE + 100,
      confirmarRepeticao: true,
    });
    expect(primeira.novas[0]).toMatchObject({
      statusEvidencia: "possivel",
      observado: true,
      confirmacoes: 1,
    });

    const segunda = await servico.comparar({
      sessaoId: "s",
      itens: observado,
      detectadoEmMs: BASE + 200,
      confirmarRepeticao: true,
    });
    expect(segunda.confirmadas).toHaveLength(1);
    expect(segunda.mudancas[0]).toMatchObject({
      statusEvidencia: "observado",
      confirmacoes: 2,
      revisao: "confirmada",
      confirmadoEmMs: BASE + 200,
    });

    const terceira = await servico.comparar({
      sessaoId: "s",
      itens: observado,
      detectadoEmMs: BASE + 300,
      confirmarRepeticao: true,
    });
    expect(terceira.confirmadas).toEqual([]);
    const historico = await servico.listarMudancas("s");
    expect(historico).toHaveLength(1);
    expect(historico[0].confirmacoes).toBe(2);
  });

  it("persiste a rejeição e recusa revisar id desconhecido", async () => {
    await servico.definirReferencia({ sessaoId: "s", itens: [item()], criadaEmMs: BASE });
    const { novas } = await servico.comparar({
      sessaoId: "s",
      itens: [
        item(),
        item({ objetoId: "nova", rotulo: "mochila", confianca: 0.9, observadoEmMs: BASE + 100 }),
      ],
      detectadoEmMs: BASE + 100,
    });
    const id = novas[0].mudancaId;
    const rejeitada = await servico.revisar({
      sessaoId: "s",
      mudancaId: id,
      decisao: "rejeitada",
      agoraMs: BASE + 200,
    });
    expect(rejeitada.revisao).toBe("rejeitada");

    const posterior = await servico.comparar({
      sessaoId: "s",
      itens: [
        item(),
        item({ objetoId: "nova", rotulo: "mochila", confianca: 0.9, observadoEmMs: BASE + 100 }),
      ],
      detectadoEmMs: BASE + 300,
      confirmarRepeticao: true,
    });
    expect(posterior.confirmadas).toEqual([]);
    expect((await servico.listarMudancas("s"))[0].revisao).toBe("rejeitada");

    await expect(
      servico.revisar({
        sessaoId: "s",
        mudancaId: "inexistente",
        decisao: "confirmada",
        agoraMs: BASE + 400,
      })
    ).rejects.toBeInstanceOf(SemMudancaCenaError);
  });

  it("valida opções de associação e consolidação vindas da API", () => {
    expect(montarComparacaoCena({ associacaoPorInstancia: false })).toEqual({
      associacaoPorInstancia: false,
    });
    expect(montarComparacaoCena({ associacaoPorInstancia: "sim" })).toMatch(/booleano/);
    expect(montarConsolidacaoCena({ consolidacao: "instancia" })).toEqual({
      ok: true,
      valor: "instancia",
    });
    expect(montarConsolidacaoCena({ consolidacao: "inesperada" })).toMatchObject({
      ok: false,
      erro: expect.stringMatching(/consolidacao/),
    });
    expect(montarConsolidacaoCena({})).toEqual({ ok: true });
  });
});
