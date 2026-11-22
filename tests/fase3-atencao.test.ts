import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  CADENCIAS_ATENCAO_PADRAO,
  cadenciaParaEstadoAtencao,
  estadoInicialAtencao,
  intervaloDeteccaoAtencao,
  pontoCentral,
  reduzirAtencaoSeguranca,
  zonaDeTexto,
  zonaParaCaixa,
  type SinalAtencao,
} from "../src/domain/seguranca-atencao";
import {
  acumularCustoAtencao,
  resumoVazioCustoAtencao,
} from "../src/domain/custo-atencao";
import {
  BufferCircularQuadros,
  QuadroRejeitadoError,
} from "../src/monitoramento/buffer-circular";
import {
  acrescentarQuadroEvidencia,
  congelarJanelaEvidencia,
  criarJanelaEvidencia,
  janelaEvidenciaParaRegistro,
} from "../src/monitoramento/janela-evidencia";
import { montarRegistroAtencao } from "../src/http/validacao/atencao";
import { ServicoAtencao } from "../src/monitoramento/servico-atencao";

const BASE = 1_700_000_000_000;
const CONFIG = { manterAposUltimaEvidenciaMs: 1_000, framesParaEstabilidade: 2 };

function avancar(
  estado: ReturnType<typeof estadoInicialAtencao>,
  sinais: SinalAtencao[]
): ReturnType<typeof estadoInicialAtencao> {
  return sinais.reduce(
    (atual, sinal) => reduzirAtencaoSeguranca(atual, sinal, CONFIG).estado,
    estado
  );
}

describe("Fase 3 — motor de atenção da segurança", () => {
  it("sobe de passivo para atenção com presença estável e registra transições", () => {
    const inicial = estadoInicialAtencao();
    const primeiro = reduzirAtencaoSeguranca(
      inicial,
      { tempoMs: BASE, pessoasAtivas: 1 },
      CONFIG
    );
    expect(primeiro.estado.estado).toBe("atividade_detectada");
    expect(primeiro.mudou).toBe(true);
    expect(primeiro.motivo).toBe("presenca");
    expect(inicial.estado).toBe("passivo");

    const segundo = reduzirAtencaoSeguranca(
      primeiro.estado,
      { tempoMs: BASE + 200, pessoasAtivas: 1 },
      CONFIG
    );
    expect(segundo.estado.estado).toBe("atencao");
    expect(segundo.estado.transicoes).toBe(2);
    expect(segundo.estado.ultimaEvidenciaMs).toBe(BASE + 200);
  });

  it("eleva para interação somente com repetição e não confunde ruído com estabilidade", () => {
    const estado = avancar(estadoInicialAtencao(), [
      { tempoMs: BASE, pessoasAtivas: 1 },
      { tempoMs: BASE + 100, pessoasAtivas: 1 },
    ]);
    const primeiro = reduzirAtencaoSeguranca(
      estado,
      { tempoMs: BASE + 200, interacao: true },
      CONFIG
    );
    expect(primeiro.estado.estado).toBe("atencao");
    const segundo = reduzirAtencaoSeguranca(
      primeiro.estado,
      { tempoMs: BASE + 300, interacao: true },
      CONFIG
    );
    expect(segundo.estado.estado).toBe("interacao");
  });

  it("exige calma por tempo e quadros antes de pos_evento e retornar a passivo", () => {
    let estado = avancar(estadoInicialAtencao(), [
      { tempoMs: BASE, pessoasAtivas: 1 },
      { tempoMs: BASE + 100, pessoasAtivas: 1 },
    ]);
    estado = reduzirAtencaoSeguranca(
      estado,
      { tempoMs: BASE + 200, pessoasAtivas: 0 },
      CONFIG
    ).estado;
    expect(estado.estado).toBe("atencao");
    expect(estado.framesSemSinal).toBe(1);

    estado = reduzirAtencaoSeguranca(
      estado,
      { tempoMs: BASE + 300, pessoasAtivas: 0 },
      CONFIG
    ).estado;
    expect(estado.estado).toBe("atencao");

    const calmo = reduzirAtencaoSeguranca(
      estado,
      { tempoMs: BASE + 1_500, pessoasAtivas: 0 },
      CONFIG
    );
    expect(calmo.estado.estado).toBe("pos_evento");
    expect(calmo.motivo).toBe("estabilidade");

    const volta = avancar(calmo.estado, [
      { tempoMs: BASE + 1_600, pessoasAtivas: 0 },
      { tempoMs: BASE + 2_600, pessoasAtivas: 0 },
      { tempoMs: BASE + 3_600, pessoasAtivas: 0 },
      { tempoMs: BASE + 4_600, pessoasAtivas: 0 },
    ]);
    expect(volta.estado).toBe("passivo");
  });

  it("congela o estado quando a percepção falha, sem contar ausência", () => {
    const estado = avancar(estadoInicialAtencao(), [
      { tempoMs: BASE, pessoasAtivas: 1 },
      { tempoMs: BASE + 100, pessoasAtivas: 1 },
    ]);
    const falha = reduzirAtencaoSeguranca(
      estado,
      { tempoMs: BASE + 5_000, percepcaoIndisponivel: true },
      CONFIG
    );
    expect(falha.estado).toBe(estado);
    expect(falha.mudou).toBe(false);
    expect(falha.motivo).toBe("percepcao_indisponivel");
  });

  it("usa zonas normalizadas e prioriza entrada sobre saída sobreposta", () => {
    const zonas = [
      zonaDeTexto("entrada", "entrada", "0.1,0.1,0.6,0.6"),
      zonaDeTexto("saida", "saida", "0.2,0.2,0.9,0.9"),
    ] as const;
    expect(zonaDeTexto("ruim", "entrada", "0,0,1")).toContain("xmin,ymin,xmax,ymax");
    expect(zonas.every((zona) => typeof zona !== "string")).toBe(true);
    if (zonas.some((zona) => typeof zona === "string")) return;
    expect(pontoCentral({ xmin: 0.1, ymin: 0.1, xmax: 0.3, ymax: 0.3 })).toEqual({ x: 0.2, y: 0.2 });
    expect(zonaParaCaixa(zonas, { xmin: 0.3, ymin: 0.3, xmax: 0.4, ymax: 0.4 })).toBe("entrada");
    expect(zonaParaCaixa(zonas, { xmin: 0.8, ymin: 0.8, xmax: 0.85, ymax: 0.85 })).toBe("saida");
    expect(zonaParaCaixa(zonas, { xmin: 0.01, ymin: 0.01, xmax: 0.02, ymax: 0.02 })).toBeNull();
  });

  it("reduz a cadência de detecção conforme o estado e respeita sobrescritas", () => {
    expect(intervaloDeteccaoAtencao("passivo")).toBe(10_000);
    expect(intervaloDeteccaoAtencao("interacao")).toBe(1_000);
    expect(CADENCIAS_ATENCAO_PADRAO.nsfw).toBeUndefined();
    expect(
      cadenciaParaEstadoAtencao("passivo", { cadencias: { passivo: { deteccaoMs: 7_000 } } })
        .deteccaoMs
    ).toBe(7_000);
    expect(
      cadenciaParaEstadoAtencao("passivo", { cadencias: { passivo: { deteccaoMs: 7_000 } } }).poseMs
    ).toBe(10_000);
  });
});

describe("Fase 3 — custo por estado", () => {
  it("agrega somente medições reais e mantém ausentes como ausentes", () => {
    let resumo = resumoVazioCustoAtencao();
    resumo = acumularCustoAtencao(resumo, {
      estado: "atencao",
      duracaoMs: 1_000,
      amostras: { deteccao: 2, pose: 4 },
      naoAmostrados: { maos: 2 },
      inferenciaMs: { deteccao: 40 },
      picoMemoriaBytes: 100,
    });
    resumo = acumularCustoAtencao(resumo, {
      estado: "atencao",
      duracaoMs: 1_000,
      amostras: { deteccao: 2 },
      inferenciaMs: { deteccao: 60 },
      picoMemoriaBytes: 80,
      mudancasCena: 1,
      quadrosCorrelatos: 3,
      bytesCorrelatos: 300,
    });
    const custo = resumo.porEstado.atencao!;
    expect(custo.amostras).toBe(2);
    expect(custo.duracaoMs).toBe(2_000);
    expect(custo.fpsEfetivo).toBe(1);
    expect(custo.amostrasPorSubsistema).toMatchObject({ deteccao: 4, pose: 4 });
    expect(custo.naoAmostradosPorSubsistema).toMatchObject({ maos: 2 });
    expect(custo.inferenciaMediaMs?.deteccao).toBe(50);
    expect(custo.inferenciaMediaMs?.pose).toBeUndefined();
    expect(custo.picoMemoriaBytes).toBe(100);
    expect(custo.mudancasCena).toBe(1);
    expect(custo.quadrosCorrelatos).toBe(3);
    expect(custo.bytesCorrelatos).toBe(300);
    expect(resumo.totalAmostras).toBe(2);
  });
});

describe("Fase 3 — buffer e janela de evidência", () => {
  it("descarta quadros fora de ordem e devolve cópias do buffer", () => {
    const buffer = new BufferCircularQuadros<{ id: string }>({
      retencaoMs: 1_000,
      clonarItem: (item) => ({ ...item }),
    });
    buffer.adicionar({ id: "a" }, BASE);
    buffer.adicionar({ id: "b" }, BASE + 500);
    expect(() => buffer.adicionar({ id: "c" }, BASE + 400)).toThrow(QuadroRejeitadoError);
    const copia = buffer.instantaneo();
    copia[0].item.id = "modificado";
    expect(buffer.instantaneo()[0].item.id).toBe("a");
    buffer.adicionar({ id: "d" }, BASE + 2_000);
    expect(buffer.instantaneo().map((quadro) => quadro.item.id)).toEqual(["d"]);
  });

  it("congela pré/durante/pós sem inventar quadros e registra lacunas", () => {
    const buffer = new BufferCircularQuadros<string>({ retencaoMs: 10_000 });
    for (const [tempo, quadro] of [
      [BASE - 4_000, "a"],
      [BASE - 1_000, "b"],
      [BASE, "c"],
      [BASE + 500, "d"],
    ] as const) {
      buffer.adicionar(quadro, tempo);
    }
    const janela = criarJanelaEvidencia("mudanca-1", BASE, buffer.instantaneo(), {
      preMs: 5_000,
      posMs: 1_000,
    });
    expect(janela.quadros.map((quadro) => quadro.item)).toEqual(["a", "b", "c"]);
    expect(janela.lacunas).toEqual([{ inicioMs: BASE - 4_000, fimMs: BASE - 1_000 }]);

    const comPos = acrescentarQuadroEvidencia(janela, "d", BASE + 500);
    expect(comPos.quadros.map((quadro) => quadro.fase)).toEqual(["pre", "pre", "durante", "pos"]);
    expect(comPos.quadros).toHaveLength(4);
    const congelada = congelarJanelaEvidencia(comPos, BASE + 600);
    expect(acrescentarQuadroEvidencia(congelada, "e", BASE + 800)).toBe(congelada);
    expect(janelaEvidenciaParaRegistro(congelada)).toMatchObject({
      eventoId: "mudanca-1",
      congeladaEmMs: BASE + 600,
      quadros: [
        { capturadoEmMs: BASE - 4_000, fase: "pre" },
        { capturadoEmMs: BASE - 1_000, fase: "pre" },
        { capturadoEmMs: BASE, fase: "durante" },
        { capturadoEmMs: BASE + 500, fase: "pos" },
      ],
    });
  });
});

describe("Fase 3 — telemetria aditiva", () => {
  const diretorios: string[] = [];
  afterEach(async () => {
    await Promise.all(diretorios.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("valida registro de estado e rejeita zonas fora de coordenadas normalizadas", () => {
    const estado = montarRegistroAtencao({
      sessaoId: "s1",
      tipo: "estado",
      registradoEmMs: BASE,
      estado: "atencao",
      motivo: "presenca",
      cadencia: { deteccaoMs: 2_000 },
    });
    expect(estado).toMatchObject({
      sessaoId: "s1",
      estado: "atencao",
      motivo: "presenca",
      cadencia: { deteccaoMs: 2_000 },
    });
    expect(typeof estado === "string" ? estado : estado.registroId.length).toBeGreaterThan(0);

    const invalido = montarRegistroAtencao({
      sessaoId: "s1",
      tipo: "zonas",
      registradoEmMs: BASE,
      zonas: [{ zonaId: "z", tipo: "entrada", caixa: { xmin: 0, ymin: 0, xmax: 1.2, ymax: 1 } }],
    });
    expect(invalido).toContain("entre 0 e 1");
  });

  it("persiste e filtra registros por sessão sem alterar a sessão", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "neuro-atencao-"));
    diretorios.push(dir);
    const servico = new ServicoAtencao({ arquivo: path.join(dir, "atencao.jsonl"), maxBytes: 1_000_000 });
    for (const sessaoId of ["s1", "s2", "s1"]) {
      const registro = montarRegistroAtencao({
        sessaoId,
        tipo: "estado",
        registradoEmMs: BASE,
        estado: "passivo",
      });
      if (typeof registro === "string") throw new Error(registro);
      await servico.registrar(registro);
    }
    expect(await servico.listar("s1")).toHaveLength(2);
    expect(await servico.listar("s2")).toHaveLength(1);
    expect(await servico.listar()).toHaveLength(3);
  });
});
