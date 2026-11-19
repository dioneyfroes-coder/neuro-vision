import {
  GravadorSegmentos,
  type RecorderLike,
} from "../../public/monitoramento/gravador-segmentos";
import {
  ControladorMonitoramento,
  type ApiMonitoramentoCliente,
  type EstadoMonitoramento,
  type UploadPendente,
} from "../../public/monitoramento/controlador-monitoramento";
import type { QuadroGravado, SessaoMonitoramento } from "../../src/domain";

/**
 * Gravador e controlador do cliente (Fase 3). Relógio, MediaRecorder, API e
 * agendador são falsos: nenhum teste lê o relógio de parede nem depende de
 * `MediaRecorder` do navegador.
 */
export const BASE = 1_700_000_000_000;

export class GravadorFalso implements RecorderLike {
  readonly mimeType: string;
  state = "inactive";
  ondataavailable: ((evento: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((evento: unknown) => void) | null = null;
  /** Quando verdadeiro, `stop` sinaliza erro em vez de `onstop`. */
  falharAoFechar = false;
  /** Conteúdo emitido assim que `start` é chamado (após o wrapper ligar os eventos). */
  conteudoInicial = "";
  /** Quando verdadeiro, `stop` não dispara `onstop` (o teste dispara manualmente). */
  stopManual = false;

  constructor(mimeType: string) {
    this.mimeType = mimeType;
  }

  start(): void {
    if (this.state === "recording") throw new Error("ja gravando");
    this.state = "recording";
    if (this.conteudoInicial) this.emitir(this.conteudoInicial);
  }

  stop(): void {
    this.state = "inactive";
    if (this.falharAoFechar) this.onerror?.(new Error("falha"));
    else if (!this.stopManual) this.onstop?.();
  }

  emitir(conteudo: string): void {
    this.ondataavailable?.({ data: new Blob([conteudo], { type: this.mimeType }) });
  }
}

export function sessao(): SessaoMonitoramento {
  return {
    sessaoId: "sessao-1",
    ambiente: "sala",
    iniciadaEm: new Date(BASE).toISOString(),
    iniciadaEmMs: BASE,
    estado: "ativa",
    duracaoSegmentoMs: 300_000,
    retencaoPreEventoMs: 30_000,
    limiarLacunaMs: 5_000,
  };
}

export interface ConfigHarness {
  segmentos: string[];
  falharVideo: boolean;
  falharQuadros: boolean;
  rejeitarQuadros: boolean;
  falharCriarGravador: boolean;
}

export interface Harness {
  controlador: ControladorMonitoramento;
  gravadores: GravadorFalso[];
  uploads: UploadPendente[];
  quadros: QuadroGravado[][];
  chamadas: string[];
  erros: Error[];
  estados: EstadoMonitoramento[];
  segmentosNotificados: (string | null)[];
  cfg: ConfigHarness;
  tick: () => Promise<void>;
  cancelado: () => boolean;
  adiantar: (ms: number) => void;
}

export function criarHarness(opcoes: Partial<ConfigHarness> = {}): Harness {
  const cfg: ConfigHarness = {
    segmentos: ["seg-1"],
    falharVideo: false,
    falharQuadros: false,
    rejeitarQuadros: false,
    falharCriarGravador: false,
    ...opcoes,
  };
  const filaSegmentos = [...cfg.segmentos];
  let ultimoSegmento = filaSegmentos[0] ?? "seg-1";
  let agora = BASE;
  const gravadores: GravadorFalso[] = [];
  const uploads: UploadPendente[] = [];
  const quadros: QuadroGravado[][] = [];
  const chamadas: string[] = [];
  const erros: Error[] = [];
  const estados: EstadoMonitoramento[] = [];
  const segmentosNotificados: (string | null)[] = [];

  const api: ApiMonitoramentoCliente = {
    async iniciar(opcoesInicio) {
      chamadas.push(`iniciar:${opcoesInicio.ambiente}:${opcoesInicio.agoraMs}`);
      return sessao();
    },
    async enviarQuadros(lote) {
      quadros.push(lote.map((q) => ({ ...q })));
      if (cfg.falharQuadros) throw new Error("indice indisponivel");
      const segmentoId = filaSegmentos.shift() ?? ultimoSegmento;
      ultimoSegmento = segmentoId;
      return {
        sessao: sessao(),
        atribuicoes: lote.map((q) => ({
          frameId: q.frameId,
          segmentoId,
          sequenciaSegmento: 1,
          offsetMs: 0,
        })),
        rejeitados: cfg.rejeitarQuadros
          ? lote.map((q) => ({ frameId: q.frameId, motivo: "sem_sessao" as const, erro: "x" }))
          : [],
      };
    },
    async pausar(sessaoId) {
      chamadas.push(`pausar:${sessaoId}`);
      return sessao();
    },
    async retomar(sessaoId) {
      chamadas.push(`retomar:${sessaoId}`);
      return sessao();
    },
    async encerrar(sessaoId, agoraMs) {
      chamadas.push(`encerrar:${sessaoId}:${agoraMs}`);
      return sessao();
    },
    async interromper(sessaoId, agoraMs, motivo) {
      chamadas.push(`interromper:${sessaoId}:${motivo}`);
      return sessao();
    },
    async enviarVideo(opcoesVideo) {
      chamadas.push(`video:${opcoesVideo.segmentoId}`);
      if (cfg.falharVideo) throw new Error("upload falhou");
      uploads.push(opcoesVideo);
      return {};
    },
  };

  let tickFn: (() => Promise<void>) | null = null;
  let cancelada = false;
  const controlador = new ControladorMonitoramento({
    api,
    agoraMs: () => agora,
    criarGravador: () => {
      if (cfg.falharCriarGravador) throw new Error("MediaRecorder indisponivel");
      const recorder = new GravadorFalso("video/webm");
      // Emitido em `start()`, depois que o GravadorSegmentos liga `ondataavailable`.
      recorder.conteudoInicial = `bytes-${gravadores.length}`;
      gravadores.push(recorder);
      return new GravadorSegmentos({
        stream: {},
        criarRecorder: () => recorder,
        agoraMs: () => agora,
        mimeType: "video/webm",
        aoErro: (erro) => erros.push(erro),
      });
    },
    agendarTick: (tick) => {
      tickFn = tick;
      cancelada = false;
      return () => {
        cancelada = true;
      };
    },
    periodoMs: 1000,
    aoEstado: (estado) => estados.push(estado),
    aoSegmento: (segmento) => segmentosNotificados.push(segmento),
    aoErro: (erro) => erros.push(erro),
  });

  return {
    controlador,
    gravadores,
    uploads,
    quadros,
    chamadas,
    erros,
    estados,
    segmentosNotificados,
    cfg,
    tick: () => tickFn?.() ?? Promise.resolve(),
    cancelado: () => cancelada,
    adiantar: (ms) => {
      agora += ms;
    },
  };
}
