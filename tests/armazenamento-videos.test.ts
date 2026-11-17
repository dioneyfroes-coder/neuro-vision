import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  ArmazenadorVideos,
  ArquivoVideoError,
} from "../src/persistence/armazenador-videos";
import type { VideoSegment } from "../src/domain";

/** O relogio nunca e lido: todos os instantes sao sinteticos. */
const BASE = 1_700_000_000_000;

let dir: string;

function segmento(sobres: Partial<VideoSegment> = {}): VideoSegment {
  return {
    segmentoId: "seg-1",
    sessaoId: "sessao-1",
    sequencia: 1,
    inicioEm: new Date(BASE).toISOString(),
    inicioMs: BASE,
    fimEm: new Date(BASE + 1000).toISOString(),
    fimMs: BASE + 1000,
    duracaoMs: 1000,
    quadros: 5,
    estado: "fechado",
    motivoFim: "duracao",
    lacunas: [],
    ...sobres,
  };
}

const upload = (bytes: Uint8Array, criadoEmMs = BASE) => ({
  bytes,
  contentType: "video/webm;codecs=vp9",
  criadoEmMs,
});

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "neuro-videos-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("ArmazenadorVideos", () => {
  it("guarda bytes e metadados de um segmento fechado", async () => {
    const armazenador = new ArmazenadorVideos({ dir });
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const arquivo = await armazenador.guardar(segmento(), upload(bytes));

    expect(arquivo).toMatchObject({
      segmentoId: "seg-1",
      sessaoId: "sessao-1",
      nomeArquivo: "seg-1.video",
      contentType: "video/webm",
      bytes: 4,
      criadoEmMs: BASE,
      inicioMs: BASE,
      fimMs: BASE + 1000,
      estado: "fechado",
      motivoFim: "duracao",
      quadros: 5,
    });
    expect(await readFile(path.join(dir, "seg-1.video"))).toEqual(Buffer.from(bytes));
    expect((await readdir(dir)).sort()).toEqual(["seg-1.json", "seg-1.video"]);
  });

  it("reescrever o mesmo tamanho e idempotente; tamanho diferente e conflito", async () => {
    const armazenador = new ArmazenadorVideos({ dir });
    const primeiro = await armazenador.guardar(segmento(), upload(new Uint8Array([1, 2, 3])));
    const repetido = await armazenador.guardar(segmento(), upload(new Uint8Array([9, 8, 7])));
    expect(repetido).toEqual(primeiro);
    expect(await readFile(path.join(dir, "seg-1.video"))).toEqual(Buffer.from([1, 2, 3]));

    await expect(
      armazenador.guardar(segmento(), upload(new Uint8Array([1, 2])))
    ).rejects.toMatchObject({ motivo: "conflito" });
  });

  it("recusa segmento aberto, sem bytes, formato fora da lista e limite excedido", async () => {
    const armazenador = new ArmazenadorVideos({ dir, maxBytesPorArquivo: 4 });
    await expect(
      armazenador.guardar(segmento({ estado: "gravando" }), upload(new Uint8Array([1])))
    ).rejects.toMatchObject({ motivo: "segmento_aberto" });
    await expect(armazenador.guardar(segmento(), upload(new Uint8Array()))).rejects.toMatchObject({
      motivo: "bytes_invalidos",
    });
    await expect(
      armazenador.guardar(segmento(), { ...upload(new Uint8Array([1])), contentType: "text/plain" })
    ).rejects.toMatchObject({ motivo: "formato_invalido" });
    await expect(
      armazenador.guardar(segmento(), upload(new Uint8Array([1, 2, 3, 4, 5])))
    ).rejects.toMatchObject({ motivo: "bytes_acima_do_limite" });
    await expect(armazenador.guardar(segmento({ fimMs: BASE - 1 }), upload(new Uint8Array([1])))).rejects.toMatchObject({
      motivo: "segmento_invalido",
    });
  });

  it("rejeita ids com separadores de caminho", async () => {
    const armazenador = new ArmazenadorVideos({ dir });
    await expect(
      armazenador.guardar(segmento({ segmentoId: "../seg" }), upload(new Uint8Array([1])))
    ).rejects.toMatchObject({ motivo: "id_invalido" });
    await expect(armazenador.obter("..")).rejects.toBeInstanceOf(ArquivoVideoError);
    await expect(armazenador.excluirSessao("sessao/1")).rejects.toBeInstanceOf(ArquivoVideoError);
    expect(await readdir(dir)).toEqual([]);
  });

  it("lista somente videos completos e filtra por sessao", async () => {
    const armazenador = new ArmazenadorVideos({ dir });
    await armazenador.guardar(segmento(), upload(new Uint8Array([1])));
    await armazenador.guardar(
      segmento({ segmentoId: "seg-2", sessaoId: "sessao-2", sequencia: 2 }),
      upload(new Uint8Array([2]), BASE + 1000)
    );
    await unlink(path.join(dir, "seg-2.video")); // metadata sem bytes nao e cobertura

    expect((await armazenador.listar()).map((a) => a.segmentoId)).toEqual(["seg-1"]);
    expect(await armazenador.listar("sessao-2")).toEqual([]);
    expect(await armazenador.obter("seg-2")).toBeNull();
  });

  it("retencao por idade e por quantidade usa apenas instantes informados", async () => {
    const armazenador = new ArmazenadorVideos({ dir, retencaoMs: 1000 });
    await armazenador.guardar(segmento(), upload(new Uint8Array([1]), BASE));
    await armazenador.guardar(
      segmento({ segmentoId: "seg-2", sequencia: 2, inicioMs: BASE + 1000, fimMs: BASE + 2000 }),
      upload(new Uint8Array([2]), BASE + 1000)
    );

    const removidos = await armazenador.aplicarRetencao(BASE + 1500);
    expect(removidos.map((a) => a.segmentoId)).toEqual(["seg-1"]);
    expect((await armazenador.listar()).map((a) => a.segmentoId)).toEqual(["seg-2"]);

    const limitado = new ArmazenadorVideos({
      dir: path.join(dir, "limitado"),
      maxArquivos: 1,
    });
    await limitado.guardar(segmento(), upload(new Uint8Array([1]), BASE));
    await limitado.guardar(
      segmento({ segmentoId: "seg-2", sequencia: 2 }),
      upload(new Uint8Array([2]), BASE + 1000)
    );
    const removidosPorContagem = await limitado.aplicarRetencao(BASE + 1000);
    expect(removidosPorContagem.map((a) => a.segmentoId)).toEqual(["seg-1"]);
    expect((await limitado.listar()).map((a) => a.segmentoId)).toEqual(["seg-2"]);
  });

  it("exclui um video ou todos os de uma sessao", async () => {
    const armazenador = new ArmazenadorVideos({ dir });
    await armazenador.guardar(segmento(), upload(new Uint8Array([1])));
    await armazenador.guardar(
      segmento({ segmentoId: "seg-2", sequencia: 2 }),
      upload(new Uint8Array([2]))
    );

    expect(await armazenador.excluir("seg-1")).toBe(true);
    expect(await armazenador.excluir("seg-1")).toBe(false);
    const removidos = await armazenador.excluirSessao("sessao-1");
    expect(removidos.map((a) => a.segmentoId)).toEqual(["seg-2"]);
    expect(await armazenador.listar()).toEqual([]);
  });
});
