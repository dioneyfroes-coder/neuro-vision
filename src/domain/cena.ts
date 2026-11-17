/**
 * Contratos da referência do ambiente e da comparação de cenas (Fase 3).
 *
 * O inventário é sempre **parcial**: o que não foi detectado não vira fato. Os
 * estados de confirmação distinguem uma detecção direta (`confirmado`) de uma
 * hipótese (`possivel`), de uma região encoberta (`ocluido`) e de uma ausência
 * explícita (`nao_observado`). A comparação usa apenas detecções diretas para
 * afirmar mudança; ausência gera no máximo uma hipótese com confiança reduzida.
 */

/** Caixa normalizada em [0,1], origem no canto superior esquerdo. */
export interface RegiaoCena {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
}

export type ConfirmacaoCena =
  | "confirmado"
  | "possivel"
  | "ocluido"
  | "nao_confirmado"
  | "nao_observado";

/** Item observado do ambiente. `objetoId` é temporário e escopo de sessão. */
export interface ItemCena {
  objetoId: string;
  rotulo: string;
  caixa: RegiaoCena;
  confirmacao: ConfirmacaoCena;
  confianca: number;
  /** Estado físico observável (ex.: "aberto", "no chão"); não é confirmação. */
  estadoObjeto?: string;
  frameId?: string;
  observadoEmMs?: number;
}

/** Referência consolidada do ambiente no início de uma sessão. */
export interface ReferenciaCena {
  sessaoId: string;
  criadaEmMs: number;
  /** Quantidade de quadros usados para consolidar o inventário. */
  quadros: number;
  itens: ItemCena[];
}

export type TipoMudancaCena =
  | "objeto_adicionado"
  | "objeto_removido"
  | "objeto_movido"
  | "estado_alterado"
  | "possivel_mudanca";

/**
 * Mudança detectada entre referência e observação atual.
 *
 * `observado: false` marca inferência (ausência ou detecção fraca) — nunca deve
 * ser lido como "a mudança foi vista diretamente".
 */
export interface MudancaCena {
  /** Estável para a mesma mudança, mesmo se comparada em vários quadros. */
  mudancaId: string;
  sessaoId: string;
  tipo: TipoMudancaCena;
  objetoId: string;
  rotulo: string;
  confianca: number;
  observado: boolean;
  detectadoEmMs: number;
  referenciaEmMs: number;
  deslocamento?: number;
  caixaAnterior?: RegiaoCena;
  caixaAtual?: RegiaoCena;
  estadoAnterior?: string;
  estadoAtual?: string;
}

export interface OpcoesComparacaoCena {
  /** Sobreposição mínima para considerar "mesmo lugar" (padrão: 0,25). */
  iouMinimo?: number;
  /** Distância máxima entre centros, em coordenadas normalizadas (padrão: 0,25). */
  distanciaMaxima?: number;
}

const CONFIRMACOES: ReadonlySet<string> = new Set<ConfirmacaoCena>([
  "confirmado",
  "possivel",
  "ocluido",
  "nao_confirmado",
  "nao_observado",
]);

function finito(valor: unknown): valor is number {
  return typeof valor === "number" && Number.isFinite(valor);
}

/** Converte uma caixa em pixels para coordenadas normalizadas. */
export function normalizarCaixaCena(
  caixa: RegiaoCena,
  larguraPx: number,
  alturaPx: number
): RegiaoCena {
  if (!finito(larguraPx) || larguraPx <= 0 || !finito(alturaPx) || alturaPx <= 0) {
    throw new Error("larguraPx e alturaPx devem ser finitos e maiores que zero");
  }
  const cortar = (valor: number) => Math.max(0, Math.min(1, valor));
  const xmin = cortar(caixa.xmin / larguraPx);
  const xmax = cortar(caixa.xmax / larguraPx);
  const ymin = cortar(caixa.ymin / alturaPx);
  const ymax = cortar(caixa.ymax / alturaPx);
  return {
    xmin: Math.min(xmin, xmax),
    ymin: Math.min(ymin, ymax),
    xmax: Math.max(xmin, xmax),
    ymax: Math.max(ymin, ymax),
  };
}

export function caixaCenaValida(caixa: unknown): caixa is RegiaoCena {
  if (!caixa || typeof caixa !== "object") return false;
  const c = caixa as Record<string, unknown>;
  return (
    finito(c.xmin) &&
    finito(c.ymin) &&
    finito(c.xmax) &&
    finito(c.ymax) &&
    c.xmin >= 0 &&
    c.ymin >= 0 &&
    c.xmax <= 1 &&
    c.ymax <= 1 &&
    c.xmin <= c.xmax &&
    c.ymin <= c.ymax
  );
}

export function itemCenaValido(item: unknown): item is ItemCena {
  if (!item || typeof item !== "object") return false;
  const i = item as Record<string, unknown>;
  return (
    typeof i.objetoId === "string" &&
    i.objetoId.trim().length > 0 &&
    typeof i.rotulo === "string" &&
    i.rotulo.trim().length > 0 &&
    caixaCenaValida(i.caixa) &&
    typeof i.confirmacao === "string" &&
    CONFIRMACOES.has(i.confirmacao) &&
    finito(i.confianca) &&
    i.confianca >= 0 &&
    i.confianca <= 1 &&
    (i.estadoObjeto === undefined || typeof i.estadoObjeto === "string") &&
    (i.frameId === undefined || typeof i.frameId === "string") &&
    (i.observadoEmMs === undefined || finito(i.observadoEmMs))
  );
}

function copiarItem(item: ItemCena): ItemCena {
  return { ...item, caixa: { ...item.caixa } };
}

/** Igualdade de posição/estado ignorando o id temporário do rastro. */
export function mesmoItem(a: ItemCena, b: ItemCena): boolean {
  return (
    a.rotulo === b.rotulo &&
    a.confirmacao === b.confirmacao &&
    a.estadoObjeto === b.estadoObjeto &&
    a.caixa.xmin === b.caixa.xmin &&
    a.caixa.ymin === b.caixa.ymin &&
    a.caixa.xmax === b.caixa.xmax &&
    a.caixa.ymax === b.caixa.ymax
  );
}

/**
 * Consolida o inventário inicial. Quando há mais de uma detecção do mesmo
 * rótulo, prevalece a de maior confiança (desempate por `objetoId`) — nunca a
 * última chegada, para que o resultado não dependa da ordem do lote.
 */
export function construirReferencia(opcoes: {
  sessaoId: string;
  itens: ItemCena[];
  criadaEmMs: number;
  quadros?: number;
}): ReferenciaCena {
  if (typeof opcoes.sessaoId !== "string" || !/^[A-Za-z0-9_-]+$/.test(opcoes.sessaoId)) {
    throw new Error("sessaoId deve usar apenas letras, digitos, _ e -");
  }
  if (!finito(opcoes.criadaEmMs)) throw new Error("criadaEmMs deve ser finito");
  if (opcoes.quadros !== undefined && (!finito(opcoes.quadros) || opcoes.quadros < 1)) {
    throw new Error("quadros deve ser inteiro maior ou igual a 1");
  }
  for (const item of opcoes.itens) {
    if (!itemCenaValido(item)) throw new Error(`Item de cena invalido: ${JSON.stringify(item)}`);
  }
  const porRotulo = new Map<string, ItemCena>();
  for (const item of opcoes.itens) {
    const anterior = porRotulo.get(item.rotulo);
    if (
      !anterior ||
      item.confianca > anterior.confianca ||
      (item.confianca === anterior.confianca && item.objetoId < anterior.objetoId)
    ) {
      porRotulo.set(item.rotulo, copiarItem(item));
    }
  }
  return {
    sessaoId: opcoes.sessaoId,
    criadaEmMs: opcoes.criadaEmMs,
    quadros: Math.trunc(opcoes.quadros ?? 1),
    itens: [...porRotulo.values()].sort((a, b) => a.rotulo.localeCompare(b.rotulo)),
  };
}

function iou(a: RegiaoCena, b: RegiaoCena): number {
  const largura = Math.max(0, Math.min(a.xmax, b.xmax) - Math.max(a.xmin, b.xmin));
  const altura = Math.max(0, Math.min(a.ymax, b.ymax) - Math.max(a.ymin, b.ymin));
  const intersecao = largura * altura;
  const areaA = Math.max(0, a.xmax - a.xmin) * Math.max(0, a.ymax - a.ymin);
  const areaB = Math.max(0, b.xmax - b.xmin) * Math.max(0, b.ymax - b.ymin);
  const uniao = areaA + areaB - intersecao;
  return uniao > 0 ? intersecao / uniao : 0;
}

function distancia(a: RegiaoCena, b: RegiaoCena): number {
  const ax = (a.xmin + a.xmax) / 2;
  const ay = (a.ymin + a.ymax) / 2;
  const bx = (b.xmin + b.xmax) / 2;
  const by = (b.ymin + b.ymax) / 2;
  return Math.hypot(ax - bx, ay - by);
}

/** Id estável da mudança; repetir a comparação não cria outro registro. */
export function idMudancaCena(
  sessaoId: string,
  tipo: TipoMudancaCena,
  objetoId: string,
  referenciaEmMs: number
): string {
  return `${sessaoId}|${tipo}|${objetoId}|${referenciaEmMs}`;
}

/**
 * Compara a cena atual com a referência.
 *
 * - só `confirmado`/`possivel` sustentam detecções diretas; `possivel` limita a
 *   confiança da mudança a 0,6;
 * - ausência explícita (`nao_observado`) vira hipótese (`observado: false`) e
 *   **falta de menção não é mudança**;
 * - o mesmo rótulo com IoU alto e estado físico diferente gera
 *   `estado_alterado`; com IoU baixo e centros próximos, `objeto_movido`.
 */
export function compararCena(
  referencia: ReferenciaCena,
  observados: ItemCena[],
  detectadoEmMs: number,
  opcoes: OpcoesComparacaoCena = {}
): MudancaCena[] {
  if (!finito(detectadoEmMs)) throw new Error("detectadoEmMs deve ser finito");
  const iouMinimo = opcoes.iouMinimo ?? 0.25;
  const distanciaMaxima = opcoes.distanciaMaxima ?? 0.25;
  if (!finito(iouMinimo) || iouMinimo < 0 || iouMinimo > 1) {
    throw new Error("iouMinimo deve estar em [0, 1]");
  }
  if (!finito(distanciaMaxima) || distanciaMaxima < 0 || distanciaMaxima > 2) {
    throw new Error("distanciaMaxima deve estar em [0, 2]");
  }
  for (const item of observados) {
    if (!itemCenaValido(item)) throw new Error(`Item de cena invalido: ${JSON.stringify(item)}`);
  }

  const diretos = observados.filter(
    (item) => item.confirmacao === "confirmado" || item.confirmacao === "possivel"
  );
  const ausentes = new Set(
    observados.filter((item) => item.confirmacao === "nao_observado").map((item) => item.rotulo)
  );
  const usados = new Set<string>();
  const mudancas: MudancaCena[] = [];

  const confiancaDireta = (item: ItemCena) =>
    item.confirmacao === "possivel" ? Math.min(item.confianca, 0.6) : item.confianca;

  const acrescentar = (mudanca: Omit<MudancaCena, "mudancaId">) => {
    mudancas.push({
      ...mudanca,
      mudancaId: idMudancaCena(
        mudanca.sessaoId,
        mudanca.tipo,
        mudanca.objetoId,
        mudanca.referenciaEmMs
      ),
    });
  };

  for (const anterior of referencia.itens) {
    const candidatos = diretos.filter(
      (item) => item.rotulo === anterior.rotulo && !usados.has(item.objetoId)
    );
    let melhor: ItemCena | undefined;
    let melhorIoU = -1;
    let melhorDistancia = Infinity;
    for (const item of candidatos) {
      const s = iou(anterior.caixa, item.caixa);
      const d = distancia(anterior.caixa, item.caixa);
      if (s > melhorIoU || (s === melhorIoU && d < melhorDistancia)) {
        melhor = item;
        melhorIoU = s;
        melhorDistancia = d;
      }
    }

    if (melhor) {
      usados.add(melhor.objetoId);
      const confianca = Math.min(anterior.confianca, confiancaDireta(melhor));
      if (melhorIoU >= iouMinimo) {
        if (anterior.estadoObjeto !== melhor.estadoObjeto) {
          acrescentar({
            sessaoId: referencia.sessaoId,
            tipo: "estado_alterado",
            objetoId: melhor.objetoId,
            rotulo: melhor.rotulo,
            confianca,
            observado: true,
            detectadoEmMs,
            referenciaEmMs: anterior.observadoEmMs ?? referencia.criadaEmMs,
            caixaAnterior: { ...anterior.caixa },
            caixaAtual: { ...melhor.caixa },
            estadoAnterior: anterior.estadoObjeto,
            estadoAtual: melhor.estadoObjeto,
          });
        }
        continue;
      }
      if (melhorDistancia <= distanciaMaxima) {
        const fator = distanciaMaxima > 0 ? 1 - melhorDistancia / distanciaMaxima : 1;
        acrescentar({
          sessaoId: referencia.sessaoId,
          tipo: "objeto_movido",
          objetoId: melhor.objetoId,
          rotulo: melhor.rotulo,
          confianca: Math.max(0.01, confianca * fator),
          observado: true,
          detectadoEmMs,
          referenciaEmMs: anterior.observadoEmMs ?? referencia.criadaEmMs,
          deslocamento: melhorDistancia,
          caixaAnterior: { ...anterior.caixa },
          caixaAtual: { ...melhor.caixa },
        });
      }
      continue;
    }

    if (ausentes.has(anterior.rotulo)) {
      acrescentar({
        sessaoId: referencia.sessaoId,
        tipo: "objeto_removido",
        objetoId: anterior.objetoId,
        rotulo: anterior.rotulo,
        confianca: Math.min(anterior.confianca, 0.55),
        observado: false,
        detectadoEmMs,
        referenciaEmMs: anterior.observadoEmMs ?? referencia.criadaEmMs,
        caixaAnterior: { ...anterior.caixa },
      });
    }
  }

  const rotulosNaReferencia = new Set(referencia.itens.map((item) => item.rotulo));
  for (const item of diretos) {
    if (usados.has(item.objetoId) || rotulosNaReferencia.has(item.rotulo)) continue;
    const fraco = item.confirmacao === "possivel";
    acrescentar({
      sessaoId: referencia.sessaoId,
      tipo: fraco ? "possivel_mudanca" : "objeto_adicionado",
      objetoId: item.objetoId,
      rotulo: item.rotulo,
      confianca: confiancaDireta(item),
      observado: !fraco,
      detectadoEmMs,
      referenciaEmMs: referencia.criadaEmMs,
      caixaAtual: { ...item.caixa },
    });
  }

  return mudancas.sort(
    (a, b) => b.confianca - a.confianca || a.mudancaId.localeCompare(b.mudancaId)
  );
}
