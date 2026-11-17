import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  gravarMudancaCena,
  gravarReferenciaCena,
  lerMudancasCena,
  lerReferenciaCena,
} from "../src/persistence/repositorio-cena";
import {
  SemReferenciaCenaError,
  ServicoCena,
} from "../src/monitoramento/servico-cena";
import {
  construirReferencia,
  idMudancaCena,
  type ItemCena,
  type MudancaCena,
  type ReferenciaCena,
} from "../src/domain/cena";

/**
 * Indice duravel da cena (Fase 3): referencia por sessao e mudancas deduplicadas.
 * Nenhum teste le o relogio — `criadaEmMs`/`detectadoEmMs` sao sinteticos.
 */
const BASE = 1_700_000_000_000;
const MAX_BYTES = 1_000_000;

let tmpDir: string;
let referenciasFile: string;
let mudancasFile: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "neuro-cena-"));
  referenciasFile = path.join(tmpDir, "cena-referencias.jsonl");
  mudancasFile = path.join(tmpDir, "cena-mudancas.jsonl");
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

function item(sobres: Partial<ItemCena> = {}): ItemCena {
  return {
    objetoId: "cadeira-1",
    rotulo: "cadeira",
    caixa: { xmin: 0.2, ymin: 0.2, xmax: 0.4, ymax: 0.4 },
    confirmacao: "confirmado",
    confianca: 0.9,
    observadoEmMs: BASE,
    ...sobres,
  };
}

function referencia(
  sessaoId = "sessao-1",
  itens: ItemCena[] = [item()],
  criadaEmMs = BASE
): ReferenciaCena {
  return construirReferencia({ sessaoId, itens, criadaEmMs, quadros: 3 });
}

function mudanca(sobres: Partial<MudancaCena> = {}): MudancaCena {
  return {
    mudancaId: idMudancaCena("sessao-1", "objeto_adicionado", "novo", BASE),
    sessaoId: "sessao-1",
    tipo: "objeto_adicionado",
    objetoId: "novo",
    rotulo: "mochila",
    confianca: 0.8,
    observado: true,
    detectadoEmMs: BASE + 100,
    referenciaEmMs: BASE,
    caixaAtual: { xmin: 0.6, ymin: 0.6, xmax: 0.8, ymax: 0.8 },
    ...sobres,
  };
}

function novoServico(): ServicoCena {
  return new ServicoCena({ referenciasFile, mudancasFile, maxBytes: MAX_BYTES });
}

async function linhas(filePath: string): Promise<number> {
  try {
    const texto = await readFile(filePath, "utf8");
    return texto.split("\n").filter((linha) => linha.trim()).length;
  } catch {
    return 0;
  }
}

describe("repositorio de cena", () => {
  it("mantem a versao mais recente da referencia por sessao, sem vazar entre sessoes", async () => {
    await gravarReferenciaCena(referencia(), referenciasFile, MAX_BYTES);
    await gravarReferenciaCena(
      referencia("sessao-2", [item({ rotulo: "mesa" })], BASE + 10),
      referenciasFile,
      MAX_BYTES
    );
    await gravarReferenciaCena(
      referencia("sessao-1", [item({ rotulo: "cadeira", confianca: 0.7 })], BASE + 20),
      referenciasFile,
      MAX_BYTES
    );

    const primeira = await lerReferenciaCena("sessao-1", referenciasFile, 100);
    expect(primeira).toMatchObject({ sessaoId: "sessao-1", criadaEmMs: BASE + 20 });
    expect(primeira?.itens[0].confianca).toBe(0.7);

    const segunda = await lerReferenciaCena("sessao-2", referenciasFile, 100);
    expect(segunda).toMatchObject({ sessaoId: "sessao-2", criadaEmMs: BASE + 10 });
    expect(segunda?.itens.map((i) => i.rotulo)).toEqual(["mesa"]);
    expect(await lerReferenciaCena("desconhecida", referenciasFile, 100)).toBeNull();
  });

  it("deduplica mudancas por mudancaId, ordena por deteccao e isola sessoes", async () => {
    const posterior = mudanca({
      mudancaId: idMudancaCena("sessao-1", "objeto_adicionado", "outro", BASE),
      objetoId: "outro",
      detectadoEmMs: BASE + 300,
    });
    await gravarMudancaCena(posterior, mudancasFile, MAX_BYTES);
    await gravarMudancaCena(mudanca(), mudancasFile, MAX_BYTES);
    // Mesmo id, instante diferente: ainda e a mesma mudanca.
    await gravarMudancaCena(
      mudanca({ detectadoEmMs: BASE + 999 }),
      mudancasFile,
      MAX_BYTES
    );
    await gravarMudancaCena(
      mudanca({ sessaoId: "sessao-2", mudancaId: idMudancaCena("sessao-2", "objeto_adicionado", "novo", BASE) }),
      mudancasFile,
      MAX_BYTES
    );

    const daSessao = await lerMudancasCena("sessao-1", mudancasFile, 100);
    expect(daSessao).toHaveLength(2);
    // Mesmo id: prevalece a versao mais recente (BASE + 999).
    expect(daSessao.map((m) => m.detectadoEmMs)).toEqual([BASE + 300, BASE + 999]);
    expect(await lerMudancasCena("sessao-2", mudancasFile, 100)).toHaveLength(1);
    expect(await lerMudancasCena("desconhecida", mudancasFile, 100)).toEqual([]);
    // O indice e append-only: a deduplicacao acontece na leitura.
    expect(await linhas(mudancasFile)).toBe(4);
  });
});

describe("ServicoCena", () => {
  it("persiste a referencia e recusa comparar sem ela", async () => {
    const servico = novoServico();
    await expect(
      servico.comparar({ sessaoId: "sessao-1", itens: [item()], detectadoEmMs: BASE + 1 })
    ).rejects.toBeInstanceOf(SemReferenciaCenaError);

    const salva = await servico.definirReferencia({
      sessaoId: "sessao-1",
      itens: [item()],
      criadaEmMs: BASE,
      quadros: 3,
    });
    expect(salva).toEqual(referencia());
    expect(await servico.obterReferencia("sessao-1")).toEqual(salva);

    await servico.definirReferencia({
      sessaoId: "sessao-1",
      itens: [item({ confianca: 0.6 })],
      criadaEmMs: BASE + 50,
    });
    const atual = await servico.obterReferencia("sessao-1");
    expect(atual?.criadaEmMs).toBe(BASE + 50);
    expect(atual?.itens[0].confianca).toBe(0.6);
    // Reescrever a referencia nao apaga a linha do tempo de mudancas.
    expect(await linhas(referenciasFile)).toBe(2);
  });

  it("grava apenas mudancas novas e deduplica comparacoes repetidas", async () => {
    const servico = novoServico();
    await servico.definirReferencia({
      sessaoId: "sessao-1",
      itens: [item()],
      criadaEmMs: BASE,
    });
    const atual = [
      item(),
      item({ objetoId: "novo", rotulo: "mochila", confianca: 0.9, caixa: { xmin: 0.6, ymin: 0.6, xmax: 0.8, ymax: 0.8 } }),
    ];

    const primeira = await servico.comparar({
      sessaoId: "sessao-1",
      itens: atual,
      detectadoEmMs: BASE + 100,
    });
    expect(primeira.mudancas).toHaveLength(1);
    expect(primeira.novas).toHaveLength(1);
    expect(primeira.novas[0]).toMatchObject({ tipo: "objeto_adicionado", objetoId: "novo" });

    // O id e estavel (deriva da referencia), mesmo com outro instante de deteccao.
    const segunda = await servico.comparar({
      sessaoId: "sessao-1",
      itens: atual,
      detectadoEmMs: BASE + 5000,
    });
    expect(segunda.mudancas).toHaveLength(1);
    expect(segunda.novas).toEqual([]);
    expect(segunda.mudancas[0].mudancaId).toBe(primeira.mudancas[0].mudancaId);

    expect(await servico.listarMudancas("sessao-1")).toHaveLength(1);
    expect(await linhas(mudancasFile)).toBe(1);
  });

  it("serializa comparacoes concorrentes sem duplicar a mudanca", async () => {
    const servico = novoServico();
    await servico.definirReferencia({
      sessaoId: "sessao-1",
      itens: [item()],
      criadaEmMs: BASE,
    });
    const atual = [
      item(),
      item({ objetoId: "novo", rotulo: "mochila", confianca: 0.9, caixa: { xmin: 0.6, ymin: 0.6, xmax: 0.8, ymax: 0.8 } }),
    ];

    const [a, b, c] = await Promise.all([
      servico.comparar({ sessaoId: "sessao-1", itens: atual, detectadoEmMs: BASE + 1 }),
      servico.comparar({ sessaoId: "sessao-1", itens: atual, detectadoEmMs: BASE + 2 }),
      servico.comparar({ sessaoId: "sessao-1", itens: atual, detectadoEmMs: BASE + 3 }),
    ]);
    expect([a.novas.length, b.novas.length, c.novas.length].sort()).toEqual([0, 0, 1]);
    expect(await linhas(mudancasFile)).toBe(1);
    expect(await servico.listarMudancas("sessao-1")).toHaveLength(1);
  });

  it("ausencia explicita vira hipotese e nao muda o estado da referencia", async () => {
    const servico = novoServico();
    await servico.definirReferencia({
      sessaoId: "sessao-1",
      itens: [item()],
      criadaEmMs: BASE,
      quadros: 3,
    });
    const resultado = await servico.comparar({
      sessaoId: "sessao-1",
      itens: [item({ confirmacao: "nao_observado", confianca: 1 })],
      detectadoEmMs: BASE + 100,
    });
    expect(resultado.novas).toMatchObject([
      { tipo: "objeto_removido", observado: false, confianca: 0.55 },
    ]);
    expect(await servico.obterReferencia("sessao-1")).toEqual(referencia());
  });
});
