/**
 * Painel e controlador local do motor de atenção da segurança (Fase 3).
 *
 * Toda decisão vem das regras puras de `src/domain/seguranca-atencao.ts`. Este
 * módulo só liga sinais já observados (YOLO COCO, zonas e inventário), mede
 * custo com `performance.now()` e publica telemetria opcional. A captura e o
 * MediaRecorder continuam independentes: nenhuma falha aqui pausa a gravação.
 */
import * as api from "../api";
import {
  RETENCAO_PRE_EVENTO_PADRAO_MS,
  cadenciaParaEstadoAtencao,
  estadoInicialAtencao,
  intervaloDeteccaoAtencao,
  reduzirAtencaoSeguranca,
  zonaDeTexto,
  zonaParaCaixa,
  type RegiaoCena,
  type EstadoAtencaoSeguranca,
  type SinalAtencao,
  type TipoZonaAtencao,
  type ZonaAtencao,
} from "../../src/domain";
import { acumularCustoAtencao, resumoVazioCustoAtencao } from "../../src/domain/custo-atencao";
import type { MudancaCena } from "../../src/domain/cena";
import { BufferCircularQuadros } from "../../src/monitoramento/buffer-circular";
import {
  acrescentarQuadroEvidencia,
  congelarJanelaEvidencia,
  criarJanelaEvidencia,
  janelaEvidenciaParaRegistro,
  type JanelaEvidencia,
} from "../../src/monitoramento/janela-evidencia";
import {
  atencaoCadenciaEl,
  atencaoCustoEl,
  atencaoEntradaInput,
  atencaoEstadoEl,
  atencaoJanelaEl,
  atencaoSaidaInput,
  atencaoZonaAplicarBtn,
} from "./elementos";

const CHAVE_ZONAS = "neuro-visao-zonas-atencao-v1";
const INTERVALO_TELEMETRIA_AMOSTRAS = 10;
const POS_EVENTO_MS = 2_000;

interface QuadroBuffer {
  imagem: string;
  capturadoEmMs: number;
}

export interface SinalQuadroAtencao {
  capturadoEmMs: number;
  /** Miniatura do quadro realmente capturado; nunca sintetizada. */
  imagem?: string;
  pessoasAtivas: number;
  /** Caixas normalizadas de pessoas detectadas, usadas pelas zonas. */
  caixasPessoas?: RegiaoCena[];
  zona?: TipoZonaAtencao | null;
  interacao?: boolean;
  /** Duração total medida do processamento do quadro, em ms. */
  duracaoMs?: number;
  /** Duração medida da inferência deste quadro, em ms. */
  inferenciaMs?: number;
  /** Falha de percepção congela o estado e não entra no buffer. */
  indisponivel?: boolean;
}

export function criarModuloAtencaoSeguranca(opcoes: {
  obterSessaoId: () => string | null;
}): {
  registrarEventos: () => void;
  reiniciar: () => void;
  registrarQuadro: (sinal: SinalQuadroAtencao) => void;
  registrarMudancas: (mudancas: MudancaCena[]) => void;
  intervaloAnaliseMs: () => number;
  get estado(): EstadoAtencaoSeguranca;
} {
  let estado = estadoInicialAtencao();
  let custo = resumoVazioCustoAtencao();
  let zonas: ZonaAtencao[] = [];
  let janelas: JanelaEvidencia<QuadroBuffer>[] = [];
  let amostrasDesdeTelemetria = 0;
  const buffer = new BufferCircularQuadros<QuadroBuffer>({
    retencaoMs: RETENCAO_PRE_EVENTO_PADRAO_MS,
    capacidadeMaxima: 300,
    clonarItem: (item) => ({ ...item }),
  });

  function sessaoId(): string | null {
    return opcoes.obterSessaoId();
  }

  function registrar(mensagem: string, detalhe?: string): void {
    const id = sessaoId();
    if (!id) return;
    void api
      .gravarOperacional({
        nivel: "aviso",
        origem: "atencao",
        mensagem,
        detalhe,
      })
      .catch(() => undefined);
  }

  function publicar(payload: Parameters<typeof api.gravarAtencaoSeguranca>[0]): void {
    void api.gravarAtencaoSeguranca(payload).catch((erro: unknown) => {
      registrar("Falha ao publicar telemetria de atenção", (erro as Error).message);
    });
  }

  function renderizar(): void {
    const atual = custo.porEstado[estado.estado];
    atencaoEstadoEl.textContent = estado.estado.replaceAll("_", " ");
    atencaoCadenciaEl.textContent = `${Math.round(intervaloDeteccaoAtencao(estado.estado) / 100) / 10}s por quadro de análise`;
    atencaoCustoEl.textContent = atual
      ? `${atual.amostras} amostra(s) · ${Math.round((atual.fpsEfetivo ?? 0) * 100) / 100} FPS efetivo · ${
          atual.quadrosSemCobertura
        } quadro(s) sem cobertura`
      : "sem amostras neste estado";
    atencaoJanelaEl.textContent = `${janelas.length} janela(s) de evidência congelada(s)`;
  }

  function publicarCusto(): void {
    const id = sessaoId();
    const valor = custo.porEstado[estado.estado];
    if (!id || !valor) return;
    publicar({
      sessaoId: id,
      tipo: "custo",
      registradoEmMs: Date.now(),
      // O agregado carrega o estado em que as amostras foram medidas.
      estado: valor.estado,
      custo: valor,
    });
  }

  function aplicarSinal(sinal: SinalAtencao): void {
    const resultado = reduzirAtencaoSeguranca(estado, sinal);
    estado = resultado.estado;
    if (!resultado.mudou) return;
    const id = sessaoId();
    if (id) {
      publicar({
        sessaoId: id,
        tipo: "estado",
        registradoEmMs: sinal.tempoMs,
        estado: estado.estado,
        motivo: resultado.motivo,
        cadencia: cadenciaParaEstadoAtencao(estado.estado),
      });
      publicarCusto();
    }
    amostrasDesdeTelemetria = 0;
    renderizar();
  }

  function carregarZonas(): void {
    try {
      const bruto = localStorage.getItem(CHAVE_ZONAS);
      if (!bruto) return;
      const dados = JSON.parse(bruto) as unknown;
      if (!Array.isArray(dados)) return;
      const normalizadas: ZonaAtencao[] = [];
      for (const item of dados) {
        const p = item as Partial<ZonaAtencao>;
        if (!p.zonaId || (p.tipo !== "entrada" && p.tipo !== "saida") || !p.caixa) continue;
        const { xmin, ymin, xmax, ymax } = p.caixa;
        if ([xmin, ymin, xmax, ymax].some((valor) => typeof valor !== "number" || !Number.isFinite(valor))) continue;
        normalizadas.push({ zonaId: p.zonaId, tipo: p.tipo, caixa: { xmin, ymin, xmax, ymax } });
      }
      zonas = normalizadas;
    } catch {
      zonas = [];
    }
  }

  function aplicarZonas(): void {
    const entradas = [
      zonaDeTexto("entrada-1", "entrada", atencaoEntradaInput.value.trim() || "0,0,1,1"),
      zonaDeTexto("saida-1", "saida", atencaoSaidaInput.value.trim() || "0,0,1,1"),
    ];
    const invalida = entradas.find((zona) => typeof zona === "string");
    if (invalida) {
      registrar("Zona de atenção inválida", String(invalida));
      return;
    }
    zonas = entradas as ZonaAtencao[];
    try {
      localStorage.setItem(CHAVE_ZONAS, JSON.stringify(zonas));
    } catch {
      // Zonas continuam válidas na memória mesmo sem armazenamento local.
    }
    const id = sessaoId();
    if (id) {
      publicar({ sessaoId: id, tipo: "zonas", registradoEmMs: Date.now(), zonas });
    }
    renderizar();
  }

  function congelarProntas(tempoMs: number): void {
    const prontas = janelas.filter(
      (janela) => janela.congeladaEmMs === undefined && tempoMs >= janela.fimMs
    );
    if (prontas.length === 0) return;
    const restantes: JanelaEvidencia<QuadroBuffer>[] = [];
    for (const janela of prontas) {
      const congelada = congelarJanelaEvidencia(janela, tempoMs);
      void api
        .listarSegmentosMonitoramento({
          inicio: congelada.inicioMs,
          fim: congelada.fimMs,
          limite: 200,
        })
        .then((segmentos) => {
          const id = sessaoId();
          if (!id) return;
          const registro = janelaEvidenciaParaRegistro(congelada);
          publicar({
            sessaoId: id,
            tipo: "evidencia",
            registradoEmMs: tempoMs,
            janela: {
              ...registro,
              segmentos: segmentos.map((segmento) => segmento.segmentoId),
            },
          });
        })
        .catch((erro: unknown) =>
          registrar("Falha ao correlacionar janela de evidência", (erro as Error).message)
        );
      restantes.push(congelada);
    }
    janelas = [...restantes, ...janelas.filter((janela) => !prontas.includes(janela))];
    renderizar();
  }

  function registrarQuadro(sinal: SinalQuadroAtencao): void {
    if (sinal.indisponivel) {
      aplicarSinal({ tempoMs: sinal.capturadoEmMs, percepcaoIndisponivel: true });
      custo = acumularCustoAtencao(custo, {
        estado: estado.estado,
        duracaoMs: sinal.duracaoMs ?? 0,
        falhas: 1,
      });
      return;
    }
    if (sinal.imagem) {
      try {
        buffer.adicionar({ imagem: sinal.imagem, capturadoEmMs: sinal.capturadoEmMs }, sinal.capturadoEmMs);
      } catch (erro) {
        registrar("Quadro ignorado pelo buffer de atenção", (erro as Error).message);
      }
    }
    janelas = janelas.map((janela) =>
      sinal.imagem
        ? acrescentarQuadroEvidencia(janela, { imagem: sinal.imagem, capturadoEmMs: sinal.capturadoEmMs }, sinal.capturadoEmMs)
        : janela
    );
    const zonasObservadas = (sinal.caixasPessoas ?? []).map((caixa) => zonaParaCaixa(zonas, caixa));
    const zona =
      sinal.zona ??
      zonasObservadas.find((observada) => observada === "entrada") ??
      zonasObservadas.find((observada) => observada !== null) ??
      null;
    aplicarSinal({
      tempoMs: sinal.capturadoEmMs,
      pessoasAtivas: sinal.pessoasAtivas,
      zona,
      ...(sinal.interacao ? { interacao: true } : {}),
    });
    custo = acumularCustoAtencao(custo, {
      estado: estado.estado,
      duracaoMs: sinal.duracaoMs ?? 0,
      amostras: { deteccao: 1 },
      ...(sinal.inferenciaMs === undefined ? {} : { inferenciaMs: { deteccao: sinal.inferenciaMs } }),
    });
    amostrasDesdeTelemetria += 1;
    if (amostrasDesdeTelemetria >= INTERVALO_TELEMETRIA_AMOSTRAS) {
      publicarCusto();
      amostrasDesdeTelemetria = 0;
    }
    congelarProntas(sinal.capturadoEmMs);
    renderizar();
  }

  function registrarMudancas(mudancas: MudancaCena[]): void {
    const confirmadas = mudancas.filter(
      (mudanca) =>
        mudanca.observado &&
        mudanca.revisao !== "rejeitada" &&
        mudanca.statusEvidencia !== "possivel"
    );
    if (confirmadas.length === 0) return;
    aplicarSinal({ tempoMs: Date.now(), mudancaCena: true });
    for (const mudanca of confirmadas) {
      const gatilhoEmMs = mudanca.confirmadoEmMs ?? mudanca.detectadoEmMs;
      janelas.push(
        criarJanelaEvidencia(
          mudanca.mudancaId,
          gatilhoEmMs,
          buffer.instantaneo(),
          { preMs: RETENCAO_PRE_EVENTO_PADRAO_MS, posMs: POS_EVENTO_MS }
        )
      );
    }
    renderizar();
  }

  function registrarEventosInterno(): void {
    atencaoEntradaInput.value = zonas.find((zona) => zona.tipo === "entrada")
      ? descreverZona(zonas.find((zona) => zona.tipo === "entrada")!)
      : "";
    atencaoSaidaInput.value = zonas.find((zona) => zona.tipo === "saida")
      ? descreverZona(zonas.find((zona) => zona.tipo === "saida")!)
      : "";
  }

  function registrarEventos(): void {
    carregarZonas();
    atencaoZonaAplicarBtn.addEventListener("click", aplicarZonas);
    registrarEventosInterno();
    renderizar();
  }

  function reiniciar(): void {
    estado = estadoInicialAtencao();
    custo = resumoVazioCustoAtencao();
    janelas = [];
    amostrasDesdeTelemetria = 0;
    buffer.limpar();
    renderizar();
  }

  return {
    registrarEventos,
    reiniciar,
    registrarQuadro,
    registrarMudancas,
    intervaloAnaliseMs: () => intervaloDeteccaoAtencao(estado.estado),
    get estado() {
      return estado;
    },
  };
}

function descreverZona(zona: ZonaAtencao): string {
  const { xmin, ymin, xmax, ymax } = zona.caixa;
  return [xmin, ymin, xmax, ymax].map((valor) => String(Math.round(valor * 1_000) / 1_000)).join(",");
}
