import { CATEGORIAS, PARTES_ENVOLVIDAS, TIPOS, VISIBILIDADES } from "./constantes.mjs";

/**
 * Valida e normaliza uma anotacao (eventos esperados de um clipe).
 *
 * Formato aceito:
 *   { "clip": "sala.mp4", "inicio": "<ISO>", "duracaoMs": 60000,
 *     "eventos": [{ "tipo": "aparicao", "em": 5000, "descricao": "pessoa entra" }] }
 *
 * `em` e o instante do evento em **ms desde o inicio da gravacao**. `tipo` pode
 * ser um dos tipos de `EventoVisual` ou `"qualquer"` (casa com qualquer mudanca).
 * A versao 2 tambem guarda intervalos e metadados para avaliacao humana; os
 * campos continuam opcionais para preservar as anotacoes legadas.
 *
 * A base dos offsets vem, por precedencia: do sidecar `<eventos>.inicio` (ISO
 * gravado junto ao JSONL; sidecars legados podem substituir `.jsonl` por
 * `.inicio`), do campo `inicio` da anotacao, ou do timestamp detectado mais
 * antigo.
 */
export function carregarAnotacao(dados) {
  if (typeof dados !== "object" || dados === null || Array.isArray(dados)) {
    throw new Error("anotacao invalida: esperado um objeto JSON");
  }
  const versaoEsquema = dados.versaoEsquema ?? 1;
  if (versaoEsquema !== 1 && versaoEsquema !== 2) {
    throw new Error(`versao de anotacao desconhecida: ${dados.versaoEsquema}`);
  }
  const revisao =
    typeof dados.revisao === "object" && dados.revisao !== null && !Array.isArray(dados.revisao)
      ? dados.revisao
      : undefined;
  if (versaoEsquema === 2) {
    if (!["eval", "tuning"].includes(dados.conjunto)) {
      throw new Error('anotacao v2 precisa de "conjunto" igual a eval ou tuning');
    }
    if (
      !revisao ||
      !["rascunho", "revisada"].includes(revisao.status) ||
      typeof revisao.metodo !== "string" ||
      revisao.metodo.trim() === ""
    ) {
      throw new Error('anotacao v2 precisa de "revisao.status" e "revisao.metodo"');
    }
  }
  const duracaoMs =
    Number.isFinite(dados.duracaoMs) && dados.duracaoMs > 0 ? dados.duracaoMs : undefined;
  const eventos = Array.isArray(dados.eventos) ? dados.eventos : [];
  const negativos = dados.negativos ?? [];
  if (
    !Array.isArray(negativos) ||
    negativos.some((alvo) => typeof alvo !== "string" || alvo.trim() === "") ||
    new Set(negativos).size !== negativos.length
  ) {
    throw new Error('"negativos" deve ser uma lista sem duplicatas de alvos categoria.classe');
  }
  if (
    versaoEsquema === 2 &&
    dados.conjunto === "eval" &&
    eventos.length === 0 &&
    dados.casoNegativo !== true &&
    negativos.length === 0
  ) {
    throw new Error(
      'anotacao EVAL sem eventos precisa declarar "casoNegativo": true ou "negativos" por classe'
    );
  }
  if (versaoEsquema === 2 && dados.casoNegativo === true && eventos.length > 0) {
    throw new Error('"casoNegativo" nao pode coexistir com eventos positivos');
  }
  const normalizados = eventos.map((e, i) => {
    if (typeof e !== "object" || e === null || Array.isArray(e)) {
      throw new Error(`evento ${i} invalido: esperado um objeto`);
    }
    if (typeof e.tipo !== "string") throw new Error(`evento ${i} sem "tipo"`);
    const tipo = e.tipo.toLowerCase();
    if (tipo !== "qualquer" && !TIPOS.includes(tipo)) {
      throw new Error(`evento ${i} com tipo desconhecido: ${e.tipo}`);
    }
    const inicioMs = e.inicioMs ?? e.em;
    const fimMs = e.fimMs ?? e.em ?? inicioMs;
    const em = e.em ?? inicioMs;
    for (const [campo, valor] of [
      ["inicioMs", inicioMs],
      ["fimMs", fimMs],
      ["em", em],
    ]) {
      if (typeof valor !== "number" || !Number.isFinite(valor) || valor < 0) {
        throw new Error(`evento ${i} precisa de "${campo}" em ms (>= 0)`);
      }
    }
    if (inicioMs > fimMs) {
      throw new Error(`evento ${i} invalido: "inicioMs" deve ser <= "fimMs"`);
    }
    if (em < inicioMs || em > fimMs) {
      throw new Error(`evento ${i} invalido: "em" deve estar dentro do intervalo`);
    }
    if (duracaoMs && fimMs > duracaoMs) {
      throw new Error(`evento ${i} excede "duracaoMs"`);
    }
    if (e.categoria !== undefined && !CATEGORIAS.includes(e.categoria)) {
      throw new Error(`evento ${i} com categoria desconhecida: ${e.categoria}`);
    }
    if (e.visibilidade !== undefined && !VISIBILIDADES.includes(e.visibilidade)) {
      throw new Error(`evento ${i} com visibilidade desconhecida: ${e.visibilidade}`);
    }
    if (e.parteEnvolvida !== undefined && !PARTES_ENVOLVIDAS.includes(e.parteEnvolvida)) {
      throw new Error(`evento ${i} com parte envolvida desconhecida: ${e.parteEnvolvida}`);
    }
    if (e.determinavel !== undefined && typeof e.determinavel !== "boolean") {
      throw new Error(`evento ${i}: "determinavel" deve ser booleano`);
    }
    if (
      versaoEsquema === 2 &&
      (!Number.isFinite(e.inicioMs) ||
        !Number.isFinite(e.fimMs) ||
        !CATEGORIAS.includes(e.categoria) ||
        typeof e.classe !== "string" ||
        e.classe.trim() === "" ||
        !VISIBILIDADES.includes(e.visibilidade) ||
        !PARTES_ENVOLVIDAS.includes(e.parteEnvolvida) ||
        typeof e.determinavel !== "boolean")
    ) {
      throw new Error(`evento ${i}: anotacao v2 precisa dos metadados humanos completos`);
    }
    return {
      tipo,
      em,
      descricao: typeof e.descricao === "string" ? e.descricao : "",
      ...(inicioMs !== em || e.inicioMs !== undefined ? { inicioMs } : {}),
      ...(fimMs !== em || e.fimMs !== undefined ? { fimMs } : {}),
      ...(e.categoria !== undefined ? { categoria: e.categoria } : {}),
      ...(typeof e.classe === "string" ? { classe: e.classe } : {}),
      ...(e.visibilidade !== undefined ? { visibilidade: e.visibilidade } : {}),
      ...(e.parteEnvolvida !== undefined ? { parteEnvolvida: e.parteEnvolvida } : {}),
      ...(e.determinavel !== undefined ? { determinavel: e.determinavel } : {}),
    };
  });
  return {
    clip: typeof dados.clip === "string" ? dados.clip : "",
    versaoEsquema,
    conjunto: typeof dados.conjunto === "string" ? dados.conjunto : undefined,
    casoNegativo: dados.casoNegativo === true,
    negativos,
    revisao,
    inicio: typeof dados.inicio === "string" ? dados.inicio : undefined,
    duracaoMs,
    notas: typeof dados.notas === "string" ? dados.notas : "",
    eventos: normalizados,
  };
}
