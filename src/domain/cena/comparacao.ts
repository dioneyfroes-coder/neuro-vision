import type { ItemCena, MudancaCena, OpcoesComparacaoCena, ReferenciaCena, RegiaoCena, TipoMudancaCena } from "./tipos";
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
