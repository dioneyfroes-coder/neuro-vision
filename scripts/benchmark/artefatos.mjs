import { createHash } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { EXTENSOES_VIDEO, ROOT, VARIANTES_BENCHMARK } from "./constantes.mjs";

export async function existe(caminho) {
  return access(caminho).then(
    () => true,
    () => false
  );
}

export async function resolverSidecarInicioEventos(arquivoEventos) {
  const candidatos = [
    `${arquivoEventos}.inicio`,
    arquivoEventos.replace(/\.jsonl$/i, ".inicio"),
  ];
  for (const candidato of new Set(candidatos)) {
    const absoluto = path.resolve(ROOT, candidato);
    if (await existe(absoluto)) return absoluto;
  }
  return undefined;
}

/**
 * Identidade do clipe: tamanho e SHA-256. Serve para provar que as variantes
 * rodaram sobre os MESMOS bytes, nao apenas sobre nomes de arquivo iguais.
 */
export async function resumoDoClipe(caminho) {
  const abs = path.resolve(ROOT, caminho);
  const dados = await readFile(abs).catch(() => null);
  if (dados === null) return { tamanhoBytes: null, sha256: null };
  return {
    tamanhoBytes: dados.length,
    sha256: createHash("sha256").update(dados).digest("hex"),
  };
}

/**
 * Descobre os clipes e suas anotacoes em um diretorio. A anotacao e procurada,
 * por precedencia, em `anotacoesDir/<base>.json` (quando `--anotacoes-dir` e
 * informado — permite conjuntos tuning/eval com os videos em outro lugar) e
 * depois ao lado do video (`<clipe>.json`).
 */
export async function descobrirClipes(
  dir,
  explicitos = [],
  anotacoesDir = null,
  somenteAnotacoesOficiais = false
) {
  if (somenteAnotacoesOficiais && !anotacoesDir) {
    throw new Error("conjunto EVAL requer diretorio de anotacoes oficial");
  }
  const acharAnotacao = async (abs, base) => {
    const candidatos = [];
    if (anotacoesDir) candidatos.push(path.resolve(ROOT, anotacoesDir, `${base}.json`));
    if (!somenteAnotacoesOficiais) {
      candidatos.push(`${abs.slice(0, abs.length - path.extname(abs).length)}.json`);
    }
    for (const c of candidatos) {
      if (await existe(c)) return path.relative(ROOT, c);
    }
    return null;
  };
  const paraPar = async (caminhoRel) => {
    const abs = path.resolve(ROOT, caminhoRel);
    const base = path.basename(abs).replace(EXTENSOES_VIDEO, "");
    return {
      nome: path.basename(abs),
      base,
      caminho: path.relative(ROOT, abs),
      anotacao: await acharAnotacao(abs, base),
      ...(await resumoDoClipe(abs)),
    };
  };

  if (explicitos.length) return Promise.all(explicitos.map(paraPar));

  const absoluta = path.resolve(ROOT, dir);
  const anotacoesOficiais = somenteAnotacoesOficiais
    ? new Set(
        (await readdir(path.resolve(ROOT, anotacoesDir)))
          .filter((arquivo) => arquivo.endsWith(".json") && arquivo !== "manifest.json")
          .map((arquivo) => arquivo.slice(0, -".json".length))
      )
    : null;
  const arquivos = (await readdir(absoluta).catch(() => []))
    .filter((f) => EXTENSOES_VIDEO.test(f))
    .filter(
      (f) =>
        !anotacoesOficiais ||
        anotacoesOficiais.has(f.slice(0, f.lastIndexOf(".")))
    )
    .sort();
  return Promise.all(arquivos.map((f) => paraPar(path.join(dir, f))));
}

/** Le `logs/ciclos.jsonl` (RegistroCiclo), ignorando linhas corrompidas. */
export async function lerCiclos(caminho) {
  const abs = path.resolve(ROOT, caminho);
  const texto = await readFile(abs, "utf8").catch(() => null);
  if (texto === null) return { registros: [], encontrado: false };
  const registros = [];
  for (const linha of texto.split(/\r?\n/)) {
    const limpa = linha.trim();
    if (!limpa) continue;
    try {
      const reg = JSON.parse(limpa);
      if (typeof reg?.sessionId === "string" && typeof reg?.cycleId === "string") registros.push(reg);
    } catch {
      // linha corrompida: ignora
    }
  }
  return { registros, encontrado: true };
}

/**
 * Identifica a variante pelo id persistido na configuracao do ciclo,
 * recorrendo ao `sessionId` apenas para registros legados. B/C sao checados
 * antes de D na heuristica porque "percepcao" tambem aparece nos ids B/C.
 */
export function identificarVarianteDoRegistro(registro) {
  const idsConfiguracao = {
    baseline: "A",
    deteccao: "A",
    eventos: "A",
    sequencia: "B",
    fundida: "C",
    completa: "D",
  };
  const configurada = idsConfiguracao[registro?.configuracao?.varianteId];
  if (configurada) return configurada;

  const texto = `${registro?.sessionId ?? ""} ${registro?.cycleId ?? ""}`.toLowerCase();
  const ordem = ["B", "C", "D", "A"];
  for (const letra of ordem) {
    const variante = VARIANTES_BENCHMARK.find((v) => v.letra === letra);
    if (variante.sessoes.some((trecho) => texto.includes(trecho))) return letra;
  }
  return null;
}

/** Registros de uma variante: filtro explicito (`--sessao-X`) ou heuristica. */
export function filtrarCiclosDaVariante(registros, letra, sessaoExplicita) {
  if (sessaoExplicita) {
    const trecho = sessaoExplicita.toLowerCase();
    return registros.filter((r) => `${r.sessionId} ${r.cycleId}`.toLowerCase().includes(trecho));
  }
  return registros.filter((r) => identificarVarianteDoRegistro(r) === letra);
}

/**
 * Resolve o arquivo de eventos de uma variante: `--eventos-X` >
 * `logs/eventos-<variante>.jsonl` > `logs/eventos-<id>.jsonl` > `--eventos` >
 * `logs/eventos.jsonl`.
 */
export async function resolverArquivoEventos(variante, args, clipe) {
  const especifico = clipe
    ? args.eventosPorClipeVariante?.[variante.letra]?.[clipe]
    : undefined;
  const candidatos = [
    especifico,
    args.eventosPorVariante[variante.letra],
    ...(clipe ? [] : Object.values(args.eventosPorClipeVariante?.[variante.letra] ?? {})),
    `logs/eventos-${variante.letra}.jsonl`,
    `logs/eventos-${variante.id}.jsonl`,
    args.eventos,
  ].filter(Boolean);
  for (const c of candidatos) {
    if (await existe(path.resolve(ROOT, c))) return c;
  }
  return null;
}

export async function resolverArquivoEventosDoClipe(variante, clipe, args) {
  if (args.conjunto === "eval") {
    const caminho = args.eventosPorClipeVariante?.[variante.letra]?.[clipe];
    return caminho && (await existe(path.resolve(ROOT, caminho))) ? caminho : null;
  }
  return resolverArquivoEventos(variante, args, clipe);
}

/** Resolve o arquivo de ciclos de uma variante (`--ciclos-X` > `--ciclos`). */
export async function resolverArquivoCiclos(variante, args) {
  const candidatos = [args.ciclosPorVariante[variante.letra], args.ciclos].filter(Boolean);
  for (const c of candidatos) {
    if (await existe(path.resolve(ROOT, c))) return c;
  }
  return candidatos[0] ?? args.ciclos;
}

// ---------------------------------------------------------------------------
// Garantia de mesmo clipe e mesma versao do modelo multimodal
// ---------------------------------------------------------------------------

/** Le um JSONL generico e devolve os valores distintos do campo `modelo`. */
export async function extrairModelosDoJsonl(caminho) {
  if (!caminho) return [];
  const abs = path.resolve(ROOT, caminho);
  const texto = await readFile(abs, "utf8").catch(() => null);
  if (texto === null) return [];
  const modelos = new Set();
  for (const linha of texto.split(/\r?\n/)) {
    const limpa = linha.trim();
    if (!limpa) continue;
    try {
      const reg = JSON.parse(limpa);
      if (typeof reg?.modelo === "string" && reg.modelo.trim()) modelos.add(reg.modelo.trim());
    } catch {
      // linha corrompida: ignora
    }
  }
  return [...modelos].sort();
}

/**
 * Modelos citados nas observacoes (`logs/visao.jsonl`, campo `modelo`) dos
 * frames de uma variante. A inferencia registra `frameIds` no log e
 * `RegistroCiclo.frameIds` identifica os frames que o compuseram; isto prova
 * qual modelo os ciclos realmente usaram (`--modelo-visao` apenas REGISTRA).
 */
export async function modelosDosFrames(caminhoVisao, frameIds) {
  const alvo = new Set((frameIds ?? []).filter((f) => typeof f === "string" && f));
  if (!alvo.size) return [];
  const abs = path.resolve(ROOT, caminhoVisao);
  const texto = await readFile(abs, "utf8").catch(() => null);
  if (texto === null) return [];
  const modelos = new Set();
  for (const linha of texto.split(/\r?\n/)) {
    const limpa = linha.trim();
    if (!limpa) continue;
    try {
      const reg = JSON.parse(limpa);
      const frameIds = [
        ...(typeof reg?.frameId === "string" ? [reg.frameId] : []),
        ...(Array.isArray(reg?.frameIds) ? reg.frameIds : []),
      ];
      if (
        frameIds.some((frameId) => alvo.has(frameId)) &&
        typeof reg?.modelo === "string" &&
        reg.modelo.trim()
      ) {
        modelos.add(reg.modelo.trim());
      }
    } catch {
      // linha corrompida: ignora
    }
  }
  return [...modelos].sort();
}
