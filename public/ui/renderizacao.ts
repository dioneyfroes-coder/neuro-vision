import type {
  Caixa,
  EntradaLog,
  MarcacaoNsfwLog,
  ReferenciaVideoEventoApi,
} from "../../src/types";
import { rotuloMotivo } from "../../src/politica-analise";
import {
  clearLogBtn,
  ctx,
  evidenciaInfoEl,
  evidenciaVideoEl,
  exportBtn,
  logCountEl,
  logEl,
  overlay,
} from "./elementos";
export function drawBoxes(
  objetos: ReadonlyArray<{ nome: string; score: number; caixa: Caixa }>,
  nsfw: ReadonlyArray<MarcacaoNsfwLog> = []
): void {
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  ctx.lineWidth = 3;
  ctx.font = "16px 'Segoe UI', sans-serif";
  ctx.textBaseline = "top";

  for (const o of objetos) {
    const { xmin, ymin, xmax, ymax } = o.caixa;
    ctx.strokeStyle = "#4f9cf9";
    ctx.strokeRect(xmin, ymin, xmax - xmin, ymax - ymin);

    const label = `${o.nome} ${(o.score * 100).toFixed(0)}%`;
    const textWidth = ctx.measureText(label).width;
    ctx.fillStyle = "#4f9cf9";
    ctx.fillRect(xmin, ymin, textWidth + 12, 22);
    ctx.fillStyle = "#fff";
    ctx.fillText(label, xmin + 6, ymin + 3);
  }

  // NSFW: caixas normalizadas [0,1] relativas ao frame; cor distinta para nao
  // se confundirem com as deteccoes COCO (pixels).
  for (const m of nsfw) {
    const { xmin, ymin, xmax, ymax } = m.caixa;
    const x = xmin * overlay.width;
    const y = ymin * overlay.height;
    const w = (xmax - xmin) * overlay.width;
    const h = (ymax - ymin) * overlay.height;
    ctx.strokeStyle = "#ff4d6d";
    ctx.strokeRect(x, y, w, h);

    const label = `NSFW ${m.rotulo} ${(m.score * 100).toFixed(0)}%`;
    const textWidth = ctx.measureText(label).width;
    ctx.fillStyle = "#ff4d6d";
    ctx.fillRect(x, y, textWidth + 12, 22);
    ctx.fillStyle = "#fff";
    ctx.fillText(label, x + 6, y + 3);
  }
}

export function atualizarContagem(): void {
  const total = logEl.children.length;
  logCountEl.textContent = String(total);
  clearLogBtn.disabled = total === 0;
  exportBtn.disabled = total === 0;
}

/** Entradas novas ainda nao passaram pelo servidor: `segmentos` e opcional. */
export type EntradaComVideoOpcional = EntradaLog & {
  segmentos?: readonly ReferenciaVideoEventoApi[];
};

/**
 * Abre o trecho evidenciado no player compartilhado. O offset vem do servidor;
 * a interface nao calcula segmento nem usa relogio proprio.
 */
export function reproduzirTrecho(ref: ReferenciaVideoEventoApi, rotulo: string): void {
  evidenciaVideoEl.pause();
  const inicioS = ref.offsetMs / 1000;
  const fimS = ref.ateMs / 1000;
  const descrever = () => {
    evidenciaVideoEl.currentTime = inicioS;
    const trecho = `${rotulo} · trecho ${ref.sequencia} de ${ref.segmentoId}: ${formatarMs(ref.offsetMs)}–${formatarMs(ref.ateMs)}`;
    evidenciaInfoEl.textContent = ref.incompleto
      ? `${trecho} · segmento incompleto: há lacuna de gravação registrada.`
      : trecho;
  };

  if (evidenciaVideoEl.dataset.segmentoId === ref.segmentoId) {
    descrever();
  } else {
    evidenciaVideoEl.addEventListener("loadedmetadata", descrever, { once: true });
    evidenciaVideoEl.dataset.segmentoId = ref.segmentoId;
    evidenciaVideoEl.src = ref.url;
    evidenciaVideoEl.load();
  }

  evidenciaVideoEl.ontimeupdate = () => {
    if (evidenciaVideoEl.currentTime >= fimS) {
      evidenciaVideoEl.pause();
      evidenciaVideoEl.ontimeupdate = null;
    }
  };
  void evidenciaVideoEl.play().catch(() => undefined);
}

/** Botoes de trecho reaproveitados pela linha do tempo e pelo historico. */
export function adicionarBotoesEvidencia(
  container: HTMLElement,
  segmentos: readonly ReferenciaVideoEventoApi[],
  rotulo: string
): void {
  if (segmentos.length === 0) return;
  const trechos = document.createElement("div");
  trechos.className = "timeline-trechos";
  for (const ref of segmentos) {
    const botao = document.createElement("button");
    botao.type = "button";
    botao.className = "ghost";
    botao.textContent = `Vídeo · trecho ${ref.sequencia} · ${formatarMs(ref.offsetMs)}–${formatarMs(ref.ateMs)}`;
    botao.title = `${ref.segmentoId}${ref.incompleto ? " (segmento incompleto)" : ""}`;
    botao.addEventListener("click", () => reproduzirTrecho(ref, rotulo));
    trechos.appendChild(botao);
  }
  container.appendChild(trechos);
}

export function criarItem(entry: EntradaComVideoOpcional): HTMLLIElement {
  const li = document.createElement("li");

  if (entry.snapshot) {
    const img = document.createElement("img");
    img.className = "thumb";
    img.src = entry.snapshot;
    img.alt = "frame capturado";
    img.loading = "lazy";
    if (entry.capturadoEm) {
      img.title = `Frame capturado às ${new Date(entry.capturadoEm).toLocaleTimeString("pt-BR")}`;
    }
    li.appendChild(img);
  }

  const corpo = document.createElement("div");
  corpo.className = "corpo";

  const cabecalho = document.createElement("div");
  cabecalho.className = "cabecalho";
  const time = document.createElement("span");
  time.className = "time";
  // O horario exibido e o da CAPTURA do frame; `timestamp` e o fim da analise.
  const capturadoEm = entry.capturadoEm ? new Date(entry.capturadoEm) : null;
  const analisadoEm = new Date(entry.timestamp);
  time.textContent = (capturadoEm ?? analisadoEm).toLocaleTimeString("pt-BR");
  if (capturadoEm) {
    const atrasoS = (analisadoEm.getTime() - capturadoEm.getTime()) / 1000;
    time.title =
      atrasoS >= 1
        ? `Frame capturado às ${capturadoEm.toLocaleTimeString("pt-BR")} · analisado ${atrasoS.toFixed(1)}s depois`
        : `Frame capturado às ${capturadoEm.toLocaleTimeString("pt-BR")}`;
  }
  cabecalho.appendChild(time);
  if (entry.modelo) {
    const meta = document.createElement("span");
    meta.className = "meta";
    let texto = entry.modelo;
    if (entry.ms && entry.tokens) {
      const tokS = Math.round(entry.tokens / (entry.ms / 1000));
      texto += ` · ${entry.tokens} toks em ${Math.round(entry.ms / 1000)}s (${tokS} tok/s)`;
    }
    if (capturadoEm && analisadoEm.getTime() - capturadoEm.getTime() >= 1000) {
      texto += ` · frame analisado ${((analisadoEm.getTime() - capturadoEm.getTime()) / 1000).toFixed(1)}s depois`;
    }
    if (entry.motivo) {
      texto += ` · por ${rotuloMotivo(entry.motivo)}`;
    }
    meta.textContent = texto;
    cabecalho.appendChild(meta);
  }
  corpo.appendChild(cabecalho);

  const objs = document.createElement("div");
  objs.className = "objs";
  if (entry.tipo === "descricao" || entry.tipo === "roteiro") {
    if (entry.tipo === "roteiro") {
      const badge = document.createElement("span");
      badge.className = "tag papel";
      badge.textContent = entry.papel === "base" ? "roteiro base" : "roteiro +";
      objs.appendChild(badge);
    }
    const span = document.createElement("span");
    span.className = "desc";
    span.textContent = entry.resumo;
    objs.appendChild(span);
  } else if (entry.objetos.length === 0) {
    const span = document.createElement("span");
    span.className = "empty";
    span.textContent = "nada reconhecido";
    objs.appendChild(span);
  } else {
    for (const o of entry.objetos) {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = `${o.nome} ${(o.score * 100).toFixed(0)}%`;
      objs.appendChild(tag);
    }
  }
  corpo.appendChild(objs);
  if (entry.nsfw && entry.nsfw.length > 0) {
    const nsfw = document.createElement("div");
    nsfw.className = "objs";
    for (const m of entry.nsfw) {
      const tag = document.createElement("span");
      tag.className = "tag nsfw";
      tag.textContent = `NSFW ${m.rotulo} ${(m.score * 100).toFixed(0)}%`;
      nsfw.appendChild(tag);
    }
    corpo.appendChild(nsfw);
  }
  const rotuloEvidencia =
    entry.tipo === "descricao" || entry.tipo === "roteiro" ? "Descrição" : "Detecção";
  adicionarBotoesEvidencia(corpo, entry.segmentos ?? [], rotuloEvidencia);
  li.appendChild(corpo);
  return li;
}

/** Fase 5: filtro de texto aceita epoch ms ou ISO; vazio significa sem filtro. */
export function valorFiltroTimeline(input: HTMLInputElement): string | number | undefined {
  const bruto = input.value.trim();
  if (!bruto) return undefined;
  return /^\d+$/.test(bruto) ? Number(bruto) : bruto;
}

export function rotuloInstante(iso: string): string {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms).toLocaleString() : iso;
}

export function formatarMs(ms: number): string {
  const segundos = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(segundos / 60)).padStart(2, "0")}:${String(segundos % 60).padStart(2, "0")}`;
}