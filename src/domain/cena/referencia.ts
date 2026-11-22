import { statusEvidenciaCena } from "../evidencia";
import type { ConsolidacaoReferenciaCena, ItemCena, ReferenciaCena } from "./tipos";
import { copiarItem, finito, itemCenaValido } from "./validacao";

const MODOS_CONSOLIDACAO: ReadonlySet<string> = new Set<ConsolidacaoReferenciaCena>([
  "automatica",
  "instancia",
  "rotulo",
]);

export interface OpcoesConstruirReferencia {
  sessaoId: string;
  itens: ItemCena[];
  criadaEmMs: number;
  quadros?: number;
  /**
   * `automatica` preserva o contrato legado quando nenhum item traz
   * `instanciaId`; `instancia` separa explicitamente cada objeto detectado.
   */
  consolidacao?: ConsolidacaoReferenciaCena;
}

function chaveGrupo(
  item: ItemCena,
  consolidacao: ConsolidacaoReferenciaCena,
  usarInstancia: boolean
): string {
  if (consolidacao === "rotulo" || !usarInstancia) return `rotulo:${item.rotulo}`;
  return `instancia:${item.rotulo}:${item.instanciaId ?? item.objetoId}`;
}

/**
 * Escolhe a melhor observação do grupo sem depender da ordem do lote e reúne
 * as evidências das demais. A confiança do item consolidado é a maior do grupo;
 * a associação entre observações da mesma instância é marcada como estável.
 */
function consolidarGrupo(grupo: ItemCena[], porInstancia: boolean): ItemCena {
  let melhor = grupo[0];
  for (const item of grupo.slice(1)) {
    if (
      item.confianca > melhor.confianca ||
      (item.confianca === melhor.confianca && item.objetoId < melhor.objetoId)
    ) {
      melhor = item;
    }
  }

  const consolidado = copiarItem(melhor);
  const frameIds = new Set<string>();
  const primeiras: number[] = [];
  const ultimas: number[] = [];
  for (const item of grupo) {
    if (item.frameId) frameIds.add(item.frameId);
    for (const id of item.frameIds ?? []) frameIds.add(id);
    const inicio = item.primeiraObservacaoEmMs ?? item.observadoEmMs;
    const fim = item.ultimaObservacaoEmMs ?? item.observadoEmMs;
    if (inicio !== undefined && finito(inicio)) primeiras.push(inicio);
    if (fim !== undefined && finito(fim)) ultimas.push(fim);
  }
  if (frameIds.size > 0) consolidado.frameIds = [...frameIds].sort();
  if (primeiras.length > 0) consolidado.primeiraObservacaoEmMs = Math.min(...primeiras);
  if (ultimas.length > 0) consolidado.ultimaObservacaoEmMs = Math.max(...ultimas);
  consolidado.statusEvidencia = statusEvidenciaCena(consolidado.confirmacao);
  if (porInstancia) {
    consolidado.confiancaAssociacao ??= 1;
    consolidado.associacao ??= "estavel";
  }
  return consolidado;
}

/**
 * Consolida o inventário inicial em entidades individuais.
 *
 * O modo `automatica` (padrão) mantém compatibilidade com lotes antigos, que
 * não têm `instanciaId`: agrupa por rótulo como antes. Quando `instanciaId`
 * existe — ou quando `consolidacao: "instancia"` é explícito — duas instâncias
 * da mesma classe permanecem separadas. Nunca a última chegada decide o
 * resultado; o desempate é determinístico por confiança e `objetoId`.
 */
export function construirReferencia(opcoes: OpcoesConstruirReferencia): ReferenciaCena {
  if (typeof opcoes.sessaoId !== "string" || !/^[A-Za-z0-9_-]+$/.test(opcoes.sessaoId)) {
    throw new Error("sessaoId deve usar apenas letras, digitos, _ e -");
  }
  if (!finito(opcoes.criadaEmMs)) throw new Error("criadaEmMs deve ser finito");
  if (opcoes.quadros !== undefined && (!finito(opcoes.quadros) || opcoes.quadros < 1)) {
    throw new Error("quadros deve ser inteiro maior ou igual a 1");
  }
  const consolidacao = opcoes.consolidacao ?? "automatica";
  if (!MODOS_CONSOLIDACAO.has(consolidacao)) {
    throw new Error(`consolidacao invalida: ${String(consolidacao)}`);
  }
  for (const item of opcoes.itens) {
    if (!itemCenaValido(item)) throw new Error(`Item de cena invalido: ${JSON.stringify(item)}`);
  }

  const usarInstancia =
    consolidacao === "instancia" ||
    (consolidacao === "automatica" && opcoes.itens.some((item) => item.instanciaId !== undefined));
  const grupos = new Map<string, ItemCena[]>();
  for (const item of opcoes.itens) {
    const chave = chaveGrupo(item, consolidacao, usarInstancia);
    const grupo = grupos.get(chave);
    if (grupo) grupo.push(item);
    else grupos.set(chave, [item]);
  }

  const itens = [...grupos.values()]
    .map((grupo) => consolidarGrupo(grupo, usarInstancia))
    .sort(
      (a, b) =>
        a.rotulo.localeCompare(b.rotulo) ||
        (a.instanciaId ?? a.objetoId).localeCompare(b.instanciaId ?? b.objetoId)
    );

  return {
    sessaoId: opcoes.sessaoId,
    criadaEmMs: opcoes.criadaEmMs,
    quadros: Math.trunc(opcoes.quadros ?? 1),
    itens,
  };
}
