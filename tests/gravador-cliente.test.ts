import { describe, expect, it } from "vitest";
import {
  ErroGravacaoSegmento,
  GravadorSegmentos,
  escolherMimeTypeVideo,
  type RecorderLike,
} from "../public/monitoramento/gravador-segmentos";
import {
  ControladorMonitoramento,
  type ApiMonitoramentoCliente,
  type EstadoMonitoramento,
  type UploadPendente,
} from "../public/monitoramento/controlador-monitoramento";
import type { QuadroGravado, SessaoMonitoramento } from "../src/domain";

/**
 * Gravador e controlador do cliente (Fase 3). Relógio, MediaRecorder, API e
 * agendador são falsos: nenhum teste lê o relógio de parede nem depende de
 * `MediaRecorder` do navegador.
 */
const BASE = 1_700_000_000_000;

/** MediaRecorder falso: emite dados e dispara `stop` quando solicitado. */
class GravadorFalso implements RecorderLike {
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

describe("escolherMimeTypeVideo", () => {
  it("prefere o primeiro formato suportado e cai para vazio", () => {
    expect(escolherMimeTypeVideo(() => true)).toBe("video/webm;codecs=vp9");
    expect(escolherMimeTypeVideo((m) => m === "video/webm")).toBe("video/webm");
    expect(escolherMimeTypeVideo(() => false)).toBe("");
  });
});

describe("GravadorSegmentos", () => {
  const MIME = "video/webm;codecs=vp8";

  function novo(agora: () => number = () => BASE) {
    const recorder = new GravadorFalso(MIME);
    const gravador = new GravadorSegmentos({
      stream: {},
      criarRecorder: () => recorder,
      agoraMs: agora,
      mimeType: MIME,
    });
    return { recorder, gravador };
  }

  it("junta os pedacos e devolve o blob com o instante injetado", async () => {
    let agora = BASE;
    const { recorder, gravador } = novo(() => agora);
    expect(gravador.ativo).toBe(false);
    expect(gravador.mimeType).toBe(MIME);

    gravador.iniciar();
    expect(gravador.ativo).toBe(true);
    recorder.emitir("parte-1");
    recorder.emitir("parte-2");
    agora = BASE + 1234;

    const fechado = await gravador.fechar();
    expect(fechado).toMatchObject({ contentType: MIME, criadoEmMs: BASE + 1234 });
    expect(await fechado?.bytes.text()).toBe("parte-1parte-2");
    expect(fechado?.bytes.type).toBe(MIME);
    expect(gravador.ativo).toBe(false);
    expect(recorder.state).toBe("inactive");
  });

  it("espera o evento stop antes de resolver", async () => {
    const { recorder, gravador } = novo();
    gravador.iniciar();
    recorder.emitir("dados");
    // O MediaRecorder real dispara `onstop` de forma assíncrona: o falso só
    // dispara quando o teste pede, para provar que `fechar()` espera por ele.
    recorder.stopManual = true;

    let resolvido = false;
    const promessa = gravador.fechar().then((valor) => {
      resolvido = true;
      return valor;
    });
    await Promise.resolve();
    expect(resolvido).toBe(false);
    recorder.onstop?.();
    expect(await promessa).toMatchObject({ criadoEmMs: BASE });
    expect(resolvido).toBe(true);
  });

  it("devolve null sem segmento ativo ou sem bytes", async () => {
    const { gravador } = novo();
    expect(await gravador.fechar()).toBeNull();
    gravador.iniciar();
    expect(await gravador.fechar()).toBeNull();
  });

  it("recusa iniciar duas vezes, sem formato ou com falha do navegador", () => {
    const { recorder, gravador } = novo();
    gravador.iniciar();
    expect(() => gravador.iniciar()).toThrow(ErroGravacaoSegmento);

    const semFormato = new GravadorSegmentos({
      stream: {},
      criarRecorder: () => recorder,
      agoraMs: () => BASE,
      mimeType: "",
    });
    expect(() => semFormato.iniciar()).toThrow(/formato/);
  });

  it("propaga falha ao fechar como ErroGravacaoSegmento", async () => {
    const { recorder, gravador } = novo();
    gravador.iniciar();
    recorder.falharAoFechar = true;
    await expect(gravador.fechar()).rejects.toBeInstanceOf(ErroGravacaoSegmento);
    expect(gravador.ativo).toBe(false);
  });
});

function sessao(): SessaoMonitoramento {
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

interface ConfigHarness {
  segmentos: string[];
  falharVideo: boolean;
  falharQuadros: boolean;
  rejeitarQuadros: boolean;
  falharCriarGravador: boolean;
}

interface Harness {
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

function criarHarness(opcoes: Partial<ConfigHarness> = {}): Harness {
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

describe("ControladorMonitoramento", () => {
  it("reporta so metadados no tick e associa o primeiro gravador ao segmento", async () => {
    const h = criarHarness();
    await h.controlador.iniciar("sala");
    expect(h.estados.at(-1)).toBe("gravando");
    expect(h.chamadas).toEqual([`iniciar:sala:${BASE}`]);
    expect(h.gravadores).toHaveLength(1);

    await h.tick();
    expect(h.quadros).toEqual([[{ frameId: "sessao-1-f0", capturadoEmMs: BASE }]]);
    expect(h.controlador.segmentoAtual).toBe("seg-1");
    expect(h.uploads).toHaveLength(0);
    expect(h.chamadas).not.toContain("video:seg-1");
  });

  it("rotaciona: fecha o gravador antigo, envia com o id antigo e abre o novo", async () => {
    const h = criarHarness({ segmentos: ["seg-1", "seg-2"] });
    await h.controlador.iniciar("sala");
    await h.tick();
    h.adiantar(10_000);
    await h.tick();

    expect(h.controlador.segmentoAtual).toBe("seg-2");
    expect(h.gravadores).toHaveLength(2);
    expect(h.uploads).toHaveLength(1);
    expect(h.uploads[0]).toMatchObject({ segmentoId: "seg-1", criadoEmMs: BASE + 10_000 });
    expect(await h.uploads[0].bytes.text()).toBe("bytes-0");
    expect(h.chamadas).toContain("video:seg-1");
    expect(h.chamadas).not.toContain("video:seg-2");

    // O gravador novo ja esta ativo antes do antigo ser fechado (sem lacuna).
    expect(h.gravadores[1].state).toBe("recording");
    expect(h.gravadores[0].state).toBe("inactive");
  });

  it("interrompe com falha se o gravador novo não começa na rotação", async () => {
    const h = criarHarness({ segmentos: ["seg-1", "seg-2"] });
    await h.controlador.iniciar("sala");
    await h.tick();
    h.cfg.falharCriarGravador = true;

    await h.tick();
    // A interrupção entra na fila depois do tick: drena com um comando extra.
    await h.controlador.reenviarPendentes();

    expect(h.erros.some((e) => /MediaRecorder/.test(e.message))).toBe(true);
    expect(h.chamadas).toContain("interromper:sessao-1:falha");
    expect(h.uploads.map((u) => u.segmentoId)).toEqual(["seg-1"]);
    expect(h.estados.at(-1)).toBe("encerrada");
    expect(h.gravadores).toHaveLength(1);
  });

  it("notifica a UI sobre cada segmento novo e sobre o fechamento", async () => {
    const h = criarHarness({ segmentos: ["seg-1", "seg-2"] });
    await h.controlador.iniciar("sala");
    expect(h.segmentosNotificados).toEqual([]);

    await h.tick();
    expect(h.segmentosNotificados).toEqual(["seg-1"]);
    await h.tick();
    expect(h.segmentosNotificados).toEqual(["seg-1", "seg-2"]);
    await h.tick();
    // Mesmo segmento: nenhuma notificação redundante.
    expect(h.segmentosNotificados).toEqual(["seg-1", "seg-2"]);

    await h.controlador.pausar();
    expect(h.segmentosNotificados).toEqual(["seg-1", "seg-2", null]);
  });

  it("nao reenvia o mesmo segmento em ticks repetidos", async () => {
    const h = criarHarness();
    await h.controlador.iniciar("sala");
    await h.tick();
    await h.tick();
    await h.tick();
    expect(h.uploads).toHaveLength(0);
    expect(h.quadros.map((lote) => lote[0].frameId)).toEqual([
      "sessao-1-f0",
      "sessao-1-f1",
      "sessao-1-f2",
    ]);
  });

  it("pausa fecha o segmento, retoma abre outro e encerra nao reinicia", async () => {
    const h = criarHarness({ segmentos: ["seg-1", "seg-2"] });
    await h.controlador.iniciar("sala");
    await h.tick();

    await h.controlador.pausar();
    expect(h.cancelado()).toBe(true);
    expect(h.estados.at(-1)).toBe("pausada");
    expect(h.uploads.map((u) => u.segmentoId)).toEqual(["seg-1"]);
    expect(h.gravadores).toHaveLength(1);

    await h.controlador.retomar();
    expect(h.estados.at(-1)).toBe("gravando");
    expect(h.gravadores).toHaveLength(2);
    expect(h.cancelado()).toBe(false);

    h.adiantar(5000);
    await h.controlador.encerrar();
    expect(h.chamadas).toContain(`encerrar:sessao-1:${BASE + 5000}`);
    expect(h.estados.at(-1)).toBe("encerrada");
    expect(h.controlador.sessaoAtual).toBeNull();
    expect(h.uploads.map((u) => u.segmentoId)).toEqual(["seg-1"]);
    // Nenhum segmento foi atribuido apos retomar (sem tick), entao nada novo.
    expect(h.gravadores).toHaveLength(2);
  });

  it("falha de upload vai para pendentes e reenviarPendentes reenvia", async () => {
    const h = criarHarness({ segmentos: ["seg-1", "seg-2"], falharVideo: true });
    await h.controlador.iniciar("sala");
    await h.tick();
    await h.tick();

    expect(h.uploads).toHaveLength(0);
    expect(h.controlador.uploadsPendentes).toBe(1);
    expect(h.erros).toHaveLength(1);

    h.cfg.falharVideo = false;
    expect(await h.controlador.reenviarPendentes()).toBe(1);
    expect(h.controlador.uploadsPendentes).toBe(0);
    expect(h.uploads.map((u) => u.segmentoId)).toEqual(["seg-1"]);
    expect(await h.uploads[0].bytes.text()).toBe("bytes-0");
  });

  it("falha do indice nao interrompe a gravacao nem inventa segmento", async () => {
    const h = criarHarness({ falharQuadros: true });
    await h.controlador.iniciar("sala");
    await h.tick();
    await h.tick();

    expect(h.estados.at(-1)).toBe("gravando");
    expect(h.controlador.segmentoAtual).toBeNull();
    expect(h.erros).toHaveLength(2);
    expect(h.uploads).toEqual([]);
  });

  it("sobrevive a sessao prolongada com rotacoes e uploads sucessivos", async () => {
    const segmentos = Array.from({ length: 30 }, (_, i) => `seg-${i + 1}`);
    const h = criarHarness({ segmentos });
    await h.controlador.iniciar("sala");

    for (let minuto = 0; minuto < 30; minuto += 1) {
      h.adiantar(60_000);
      await h.tick();
    }

    expect(h.quadros).toHaveLength(30);
    expect(h.gravadores).toHaveLength(30);
    expect(h.uploads.map((u) => u.segmentoId)).toEqual(segmentos.slice(0, 29));
    expect(h.controlador.uploadsPendentes).toBe(0);
    expect(h.estados.at(-1)).toBe("gravando");
    expect(h.controlador.segmentoAtual).toBe("seg-30");
  });

  it("grava durante queda da camera e indisponibilidade da analise", async () => {
    const h = criarHarness({ segmentos: ["seg-1", "seg-2"] });
    await h.controlador.iniciar("sala");
    await h.tick();
    expect(h.controlador.segmentoAtual).toBe("seg-1");

    // Workers/IA indisponíveis e camera sem sinal ao mesmo tempo.
    h.cfg.falharQuadros = true;
    h.controlador.suspenderCaptura("trilha_encerrada");
    h.adiantar(5_000);
    await h.tick();

    expect(h.estados.at(-1)).toBe("gravando");
    expect(h.controlador.semSinal).toBe(true);
    expect(h.quadros).toHaveLength(1);
    expect(h.uploads).toEqual([]);

    // Analise e camera voltam: o proximo quadro rotaciona para um novo segmento.
    h.cfg.falharQuadros = false;
    await h.controlador.retomarCaptura();

    expect(h.controlador.semSinal).toBe(false);
    expect(h.quadros.at(-1)?.[0].capturadoEmMs).toBe(BASE + 5_000);
    expect(h.uploads.map((u) => u.segmentoId)).toEqual(["seg-1"]);
    expect(h.gravadores).toHaveLength(2);
    expect(h.estados.at(-1)).toBe("gravando");
  });

  it("renova o gravador no retorno por reconexao antes de relatar quadros", async () => {
    const h = criarHarness({ segmentos: ["seg-1", "seg-2"] });
    await h.controlador.iniciar("sala");
    await h.tick();

    h.controlador.suspenderCaptura("trilha_encerrada");
    h.adiantar(5_000);
    await h.controlador.renovarGravador();

    expect(h.chamadas).toContain("pausar:sessao-1");
    expect(h.chamadas).toContain("retomar:sessao-1");
    expect(h.uploads.map((u) => u.segmentoId)).toEqual(["seg-1"]);
    expect(h.gravadores).toHaveLength(2);
    expect(h.controlador.segmentoAtual).toBeNull();

    await h.controlador.retomarCaptura();
    expect(h.controlador.segmentoAtual).toBe("seg-2");
    expect(h.gravadores).toHaveLength(2);
    expect(h.estados.at(-1)).toBe("gravando");
  });

  it("erro do MediaRecorder durante o segmento renova o gravador sem encerrar", async () => {
    const h = criarHarness({ segmentos: ["seg-1", "seg-2"] });
    await h.controlador.iniciar("sala");
    await h.tick();
    expect(h.controlador.segmentoAtual).toBe("seg-1");

    h.gravadores[0].onerror?.(new Error("MediaRecorder parou"));
    await h.tick();
    await h.tick();

    expect(h.chamadas).toContain("pausar:sessao-1");
    expect(h.chamadas).toContain("retomar:sessao-1");
    expect(h.uploads.map((u) => u.segmentoId)).toEqual(["seg-1"]);
    expect(h.gravadores).toHaveLength(2);
    expect(h.controlador.segmentoAtual).toBe("seg-2");
    expect(h.estados.at(-1)).toBe("gravando");
    expect(h.erros.some((erro) => /MediaRecorder parou|gravacao/.test(erro.message))).toBe(true);
  });

  it("registra rejeicoes sem descartar o lote", async () => {
    const h = criarHarness({ rejeitarQuadros: true });
    await h.controlador.iniciar("sala");
    await h.tick();
    expect(h.controlador.segmentoAtual).toBe("seg-1");
    expect(h.erros[0].message).toMatch(/recusado/);
  });

  it("interromper por falha encerra sem gerar novo gravador", async () => {
    const h = criarHarness();
    await h.controlador.iniciar("sala");
    await h.tick();
    await h.controlador.interromper("falha");

    expect(h.chamadas).toContain("interromper:sessao-1:falha");
    expect(h.estados.at(-1)).toBe("encerrada");
    expect(h.uploads.map((u) => u.segmentoId)).toEqual(["seg-1"]);
    expect(h.gravadores).toHaveLength(1);
  });

  it("recusa iniciar uma segunda sessao ativa", async () => {
    const h = criarHarness();
    await h.controlador.iniciar("sala");
    await expect(h.controlador.iniciar("garagem")).rejects.toThrow(/ativa/);
    expect(h.chamadas).toHaveLength(1);
  });

  it("limpa o gravador e interrompe a sessao se iniciar falhar depois de abri-la", async () => {
    const h = criarHarness({ falharCriarGravador: true });
    await expect(h.controlador.iniciar("sala")).rejects.toThrow(/MediaRecorder/);

    expect(h.chamadas).toEqual([`iniciar:sala:${BASE}`, "interromper:sessao-1:falha"]);
    expect(h.estados.at(-1)).toBe("erro");
    expect(h.controlador.sessaoAtual).toBeNull();
    expect(h.controlador.segmentoAtual).toBeNull();
    // Nenhum tick foi agendado: a falha ocorreu antes de `agendarTick`.
    expect(h.cancelado()).toBe(false);
    expect(h.erros.some((e) => /MediaRecorder/.test(e.message))).toBe(true);
  });
});
