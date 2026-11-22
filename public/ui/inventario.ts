/**
 * Interface de revisão do inventário (Fase 2).
 *
 * Só manipula o DOM e delega as regras para `public/monitoramento/inventario`.
 * O painel nunca afirma que a cena foi entendida: mostra itens detectados,
 * quadros de origem, status de evidência e mudanças pendentes de revisão.
 */
import * as api from "../api";
import type {
  DecisaoRevisaoMudanca,
  MudancaCena,
  ReferenciaCena,
} from "../../src/domain/cena";
import type { Dimensoes } from "../perception/contracts";
import type { AdaptadorDetectorObjetos } from "../perception/adapters/object-detector.adapter";
import {
  coletarReferenciaInventario,
  compararObservacaoInventario,
  type DeteccoesInventario,
} from "../monitoramento/inventario/inventario";
import {
  camera,
  inventarioAtualizarBtn,
  inventarioAvisoEl,
  inventarioColetarBtn,
  inventarioItensEl,
  inventarioMudancasEl,
  inventarioResumoEl,
} from "./elementos";

const QUADROS_REFERENCIA = 3;
const INTERVALO_QUADROS_MS = 500;
const LIMITE_CONFIANCA = 0.45;
const ROTULOS_REVISAO: Record<MudancaCena["revisao"] & string, string> = {
  pendente: "pendente",
  confirmada: "confirmada",
  rejeitada: "rejeitada",
};

export interface OpcoesModuloInventario {
  setStatus: (texto: string) => void;
  obterSessaoId: () => string | null;
  detector: AdaptadorDetectorObjetos;
  garantirDetector: () => Promise<void>;
  /** Chamado quando uma mudança nova é confirmada pela repetição. */
  aoRegistrarMudanca?: (mudancas: MudancaCena[], capturadoEmMs: number) => void;
}

function textoItem(item: ReferenciaCena["itens"][number]): string {
  const instancia = item.instanciaId ? ` · instância ${item.instanciaId}` : "";
  const estado = item.estadoObjeto ? ` · ${item.estadoObjeto}` : "";
  const quadros = item.frameIds?.length ?? (item.frameId ? 1 : 0);
  return `${item.rotulo}${instancia}${estado} · confiança ${item.confianca.toFixed(2)} · ${
    item.statusEvidencia ?? "desconhecido"
  } · ${quadros} quadro(s)`;
}

function textoMudanca(mudanca: MudancaCena): string {
  const revisao = ROTULOS_REVISAO[mudanca.revisao ?? "pendente"];
  const confirmacoes = mudanca.confirmacoes ? ` · ${mudanca.confirmacoes} confirmação(ões)` : "";
  const quadros = mudanca.frameIds?.length ? ` · ${mudanca.frameIds.length} quadro(s)` : "";
  return `${mudanca.tipo} · ${mudanca.rotulo} · confiança ${mudanca.confianca.toFixed(2)} · ${
    mudanca.statusEvidencia ?? "desconhecido"
  } · ${revisao}${confirmacoes}${quadros}`;
}

export function criarModuloInventario({
  setStatus,
  obterSessaoId,
  detector,
  garantirDetector,
  aoRegistrarMudanca,
}: OpcoesModuloInventario) {
  let referencia: ReferenciaCena | null = null;
  let sequencia = 0;
  let coletando = false;

  function aviso(texto: string | null): void {
    inventarioAvisoEl.textContent = texto ?? "";
    inventarioAvisoEl.hidden = !texto;
  }

  function renderizar(mudancas: MudancaCena[]): void {
    inventarioResumoEl.textContent = referencia
      ? `${referencia.itens.length} item(ns) · ${referencia.quadros} quadro(s)`
      : "sem inventário";
    inventarioItensEl.replaceChildren(
      ...(referencia?.itens ?? []).map((item) => {
        const li = document.createElement("li");
        li.textContent = textoItem(item);
        return li;
      })
    );
    if ((referencia?.itens.length ?? 0) === 0) {
      const li = document.createElement("li");
      li.textContent = "Nenhum objeto detectado nos quadros de referência.";
      inventarioItensEl.append(li);
    }
    inventarioMudancasEl.replaceChildren(
      ...mudancas.map((mudanca) => {
        const li = document.createElement("li");
        const texto = document.createElement("span");
        texto.textContent = textoMudanca(mudanca);
        li.append(texto);
        for (const decisao of ["confirmada", "rejeitada"] as const) {
          const botao = document.createElement("button");
          botao.type = "button";
          botao.className = "ghost";
          botao.dataset.decisao = decisao;
          botao.dataset.mudancaId = mudanca.mudancaId;
          botao.textContent = decisao === "confirmada" ? "Aprovar" : "Rejeitar";
          botao.disabled = mudanca.revisao === decisao;
          li.append(botao);
        }
        return li;
      })
    );
    if (mudancas.length === 0) {
      const li = document.createElement("li");
      li.textContent = "Nenhuma mudança registrada.";
      inventarioMudancasEl.append(li);
    }
  }

  async function atualizarPainel(): Promise<void> {
    const sessaoId = obterSessaoId();
    if (!sessaoId) {
      referencia = null;
      renderizar([]);
      return;
    }
    try {
      const [atual, mudancas] = await Promise.all([
        api.obterReferenciaCena(sessaoId),
        api.listarMudancasCena(sessaoId),
      ]);
      referencia = atual;
      renderizar(mudancas);
    } catch (err) {
      aviso(`Falha ao ler o inventário: ${(err as Error).message}`);
    }
  }

  async function coletar(): Promise<void> {
    const sessaoId = obterSessaoId();
    if (!sessaoId || coletando) return;
    coletando = true;
    inventarioColetarBtn.disabled = true;
    aviso(null);
    try {
      await garantirDetector();
      referencia = await coletarReferenciaInventario({
        sessaoId,
        quadros: QUADROS_REFERENCIA,
        intervaloMs: INTERVALO_QUADROS_MS,
        capturar: async () => {
          const capturadoEmMs = Date.now();
          const quadro = camera.capturarQuadro(640, 240, 0.82);
          const dimensoes = camera.dimensoesQuadro(640);
          if (!quadro || !dimensoes) return null;
          sequencia += 1;
          return {
            frameId: `${sessaoId}-inv-${sequencia}`,
            imagem: quadro.imagem,
            capturadoEmMs,
            dimensoes,
          };
        },
        detectar: async (quadro) =>
          detector.detectar(
            { imagem: quadro.imagem, dimensoes: quadro.dimensoes },
            { threshold: LIMITE_CONFIANCA, percentage: false }
          ),
        definirReferencia: api.definirReferenciaCena,
        limiteConfianca: LIMITE_CONFIANCA,
        aoErro: (erro) => aviso(`Quadro ignorado: ${erro.message}`),
      });
      await atualizarPainel();
      setStatus(
        `Inventário consolidado com ${referencia.itens.length} item(ns) em ${referencia.quadros} quadro(s).`
      );
    } catch (err) {
      aviso(`Falha ao capturar o inventário: ${(err as Error).message}`);
      setStatus(`Falha ao capturar o inventário: ${(err as Error).message}`);
    } finally {
      coletando = false;
      sincronizarBotoes();
    }
  }

  async function registrarObservacao(opcoes: {
    dimensoes: Dimensoes;
    imagem: string;
    capturadoEmMs: number;
    deteccoes: DeteccoesInventario;
  }): Promise<void> {
    const sessaoId = obterSessaoId();
    if (!sessaoId || !referencia) return;
    sequencia += 1;
    try {
      const resultado = await compararObservacaoInventario({
        sessaoId,
        quadro: {
          frameId: `${sessaoId}-obs-${sequencia}`,
          imagem: opcoes.imagem,
          capturadoEmMs: opcoes.capturadoEmMs,
          dimensoes: opcoes.dimensoes,
        },
        deteccoes: opcoes.deteccoes,
        comparar: api.compararCenaMonitoramento,
        limiteConfianca: LIMITE_CONFIANCA,
      });
      if (resultado.novas.length > 0 || resultado.confirmadas.length > 0) {
        const confirmadas = [...resultado.novas, ...resultado.confirmadas];
        aoRegistrarMudanca?.(confirmadas, opcoes.capturadoEmMs);
        await atualizarPainel();
      }
    } catch (err) {
      void api
        .gravarOperacional({
          nivel: "aviso",
          origem: "inventario",
          mensagem: "Falha ao comparar a observação com o inventário",
          detalhe: (err as Error).message,
        })
        .catch(() => undefined);
    }
  }

  async function revisar(mudancaId: string, decisao: DecisaoRevisaoMudanca): Promise<void> {
    const sessaoId = obterSessaoId();
    if (!sessaoId) return;
    try {
      await api.revisarMudancaCena({ sessaoId, mudancaId, decisao });
      await atualizarPainel();
      setStatus(`Mudança ${decisao === "confirmada" ? "aprovada" : "rejeitada"}.`);
    } catch (err) {
      setStatus(`Falha ao revisar a mudança: ${(err as Error).message}`);
    }
  }

  function sincronizarBotoes(): void {
    const ativo = obterSessaoId() !== null;
    inventarioColetarBtn.disabled = !ativo || coletando;
    inventarioAtualizarBtn.disabled = !ativo || coletando;
  }

  function registrarEventos(): void {
    inventarioColetarBtn.addEventListener("click", () => void coletar());
    inventarioAtualizarBtn.addEventListener("click", () => void atualizarPainel());
    inventarioMudancasEl.addEventListener("click", (evento) => {
      const alvo = (evento.target as HTMLElement).closest("button[data-mudanca-id]") as
        | HTMLButtonElement
        | null;
      if (!alvo) return;
      const id = alvo.dataset.mudancaId;
      const decisao = alvo.dataset.decisao;
      if (!id || (decisao !== "confirmada" && decisao !== "rejeitada")) return;
      void revisar(id, decisao);
    });
    sincronizarBotoes();
    renderizar([]);
  }

  function reiniciar(): void {
    referencia = null;
    aviso(null);
    renderizar([]);
    sincronizarBotoes();
  }

  return {
    registrarEventos,
    atualizarPainel,
    registrarObservacao,
    reiniciar,
    sincronizarBotoes,
    get pronto(): boolean {
      return referencia !== null;
    },
  };
}
