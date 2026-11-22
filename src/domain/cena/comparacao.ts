import { statusEvidenciaCena } from "../evidencia";
import type {
  ItemCena,
  MudancaCena,
  OpcoesComparacaoCena,
  ReferenciaCena,
  RegiaoCena,
  TipoMudancaCena,
} from "./tipos";
import { finito, itemCenaValido } from "./validacao";

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

/** `instanciaId` quando disponível; `objetoId` é o fallback dos lotes legados. */
function idInstancia(item: ItemCena): string {
  return item.instanciaId ?? item.objetoId;
}

function mesmaInstancia(
  anterior: ItemCena,
  observado: ItemCena,
  porInstancia: boolean
): boolean {
  if (!porInstancia) return false;
  if (anterior.instanciaId !== undefined && observado.instanciaId !== undefined) {
    return anterior.instanciaId === observado.instanciaId;
  }
  return idInstancia(anterior) === idInstancia(observado);
}

interface CandidatoAvaliado {
  item: ItemCena;
  iou: number;
  distancia: number;
  pontuacao: number;
  identico: boolean;
  plausivel: boolean;
}

/**
 * Compara a cena atual com a referência.
 *
 * - só `confirmado`/`possivel` sustentam detecções diretas; `possivel` limita a
 *   confiança da mudança a 0,6;
 * - ausência explícita (`nao_observado`) vira hipótese (`observado: false`) e
 *   **falta de menção não é mudança**;
 * - o mesmo rótulo com IoU alto e estado físico diferente gera
 *   `estado_alterado`; com IoU baixo e centros próximos, `objeto_movido`;
 * - quando `instanciaId` existe, ele tem prioridade sobre proximidade espacial.
 *   Sem evidência de identidade, duas associações igualmente prováveis viram
 *   `associacao: "ambiga"`, nunca certeza.
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
  const porInstancia = opcoes.associacaoPorInstancia ?? true;
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
  const ausentes = new Map(
    observados
      .filter((item) => item.confirmacao === "nao_observado")
      .map((item) => [item.rotulo, item] as const)
  );
  const usados = new Set<string>();
  const associadas = new Set<number>();
  const mudancas: MudancaCena[] = [];

  const confiancaDireta = (item: ItemCena) =>
    item.confirmacao === "possivel" ? Math.min(item.confianca, 0.6) : item.confianca;

  const acrescentar = (mudanca: Omit<MudancaCena, "mudancaId">, evidencia?: ItemCena) => {
    const frameIds = evidencia
      ? [
          ...new Set([
            ...(evidencia.frameIds ?? []),
            ...(evidencia.frameId ? [evidencia.frameId] : []),
          ]),
        ].sort()
      : [];
    const primeira = evidencia?.primeiraObservacaoEmMs ?? evidencia?.observadoEmMs;
    const ultima = evidencia?.ultimaObservacaoEmMs ?? evidencia?.observadoEmMs;
    mudancas.push({
      ...mudanca,
      ...(frameIds.length > 0 ? { frameIds } : {}),
      ...(primeira !== undefined && finito(primeira) ? { primeiraObservacaoEmMs: primeira } : {}),
      ...(ultima !== undefined && finito(ultima) ? { ultimaObservacaoEmMs: ultima } : {}),
      mudancaId: idMudancaCena(
        mudanca.sessaoId,
        mudanca.tipo,
        mudanca.objetoId,
        mudanca.referenciaEmMs
      ),
    });
  };

  const avaliar = (anterior: ItemCena, item: ItemCena): CandidatoAvaliado => {
    const sobreposicao = iou(anterior.caixa, item.caixa);
    const separacao = distancia(anterior.caixa, item.caixa);
    const proximidade =
      distanciaMaxima > 0 ? Math.max(0, 1 - separacao / distanciaMaxima) : 0;
    const identico = mesmaInstancia(anterior, item, porInstancia);
    return {
      item,
      iou: sobreposicao,
      distancia: separacao,
      // O bônus de identidade não remove a necessidade de proximidade: um ID
      // conhecido ainda precisa estar na vizinhança da referência.
      pontuacao: Math.max(sobreposicao, proximidade) + (identico ? 2 : 0),
      identico,
      plausivel: sobreposicao >= iouMinimo || separacao <= distanciaMaxima,
    };
  };

  const melhorMaisProximo = (a: CandidatoAvaliado, b: CandidatoAvaliado) =>
    b.pontuacao - a.pontuacao ||
    a.distancia - b.distancia ||
    a.item.objetoId.localeCompare(b.item.objetoId);

  for (const [indice, anterior] of referencia.itens.entries()) {
    const candidatos = diretos
      .filter((item) => item.rotulo === anterior.rotulo && !usados.has(item.objetoId))
      .map((item) => avaliar(anterior, item))
      .filter((candidato) => candidato.plausivel)
      .sort(melhorMaisProximo);
    const melhor = candidatos[0];
    if (!melhor) {
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
          statusEvidencia: "nao_observado",
        }, ausentes.get(anterior.rotulo));
      }
      continue;
    }

    const segundo = candidatos[1];
    // Sem ID de instância, duas caixas quase equivalentemente próximas não provam
    // qual objeto da referência foi visto. Registramos a ambiguidade.
    const ambiguo =
      !melhor.identico &&
      segundo !== undefined &&
      !segundo.identico &&
      segundo.pontuacao >= melhor.pontuacao - 0.05;
    const confiancaBase = Math.min(anterior.confianca, confiancaDireta(melhor.item));
    const confianca = ambiguo ? Math.min(confiancaBase, 0.6) : confiancaBase;
    const statusEvidencia = ambiguo ? "possivel" : statusEvidenciaCena(melhor.item.confirmacao);
    const associacao = ambiguo ? ("ambiga" as const) : ("estavel" as const);

    usados.add(melhor.item.objetoId);
    associadas.add(indice);

    if (melhor.iou >= iouMinimo) {
      if (anterior.estadoObjeto !== melhor.item.estadoObjeto) {
        acrescentar({
          sessaoId: referencia.sessaoId,
          tipo: "estado_alterado",
          objetoId: melhor.item.objetoId,
          rotulo: melhor.item.rotulo,
          confianca,
          observado: !ambiguo,
          detectadoEmMs,
          referenciaEmMs: anterior.observadoEmMs ?? referencia.criadaEmMs,
          caixaAnterior: { ...anterior.caixa },
          caixaAtual: { ...melhor.item.caixa },
          estadoAnterior: anterior.estadoObjeto,
          estadoAtual: melhor.item.estadoObjeto,
          associacao,
          statusEvidencia,
        }, melhor.item);
      }
      continue;
    }
    if (melhor.distancia <= distanciaMaxima) {
      const fator = distanciaMaxima > 0 ? 1 - melhor.distancia / distanciaMaxima : 1;
      acrescentar({
        sessaoId: referencia.sessaoId,
        tipo: "objeto_movido",
        objetoId: melhor.item.objetoId,
        rotulo: melhor.item.rotulo,
        confianca: Math.max(0.01, confianca * fator),
        observado: !ambiguo,
        detectadoEmMs,
        referenciaEmMs: anterior.observadoEmMs ?? referencia.criadaEmMs,
        deslocamento: melhor.distancia,
        caixaAnterior: { ...anterior.caixa },
        caixaAtual: { ...melhor.item.caixa },
        associacao,
        statusEvidencia,
      }, melhor.item);
    }
  }

  const referenciasPendentes = new Set(
    referencia.itens
      .filter((_, indice) => !associadas.has(indice))
      .map((item) => item.rotulo)
  );
  for (const item of diretos) {
    // Um rótulo pendente pode ser a mesma instância que não apareceu neste
    // frame; só afirmamos uma nova instância quando não há referência livre.
    if (usados.has(item.objetoId) || referenciasPendentes.has(item.rotulo)) continue;
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
      statusEvidencia: fraco ? "possivel" : "observado",
    }, item);
  }

  return mudancas.sort(
    (a, b) => b.confianca - a.confianca || a.mudancaId.localeCompare(b.mudancaId)
  );
}
