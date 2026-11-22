import * as api from "../api";
import {
  camera,
  gravacaoIndicadorEl,
  gravacaoTextoEl,
  monitorAvisoEl,
  monitorEncerrarBtn,
  monitorExcluirSessaoBtn,
  monitorExportarCenasBtn,
  monitorEstadoEl,
  monitorIniciarBtn,
  monitorPausarBtn,
  monitorReenviarBtn,
  monitorRetencaoBtn,
  monitorRetomarBtn,
  monitorAmbienteInput,
  video,
} from "./elementos";
import type { EntradaLog, EntradaLogComVideo } from "../../src/types";
import { normalizarCaixaCena, type RegistroCiclo, type VideoSegment } from "../../src/domain";
import { AdaptadorDetectorObjetos } from "../perception/adapters/object-detector.adapter";
import { descreverDeteccoes } from "../detector";
import { MODELO_YOLO_PADRAO } from "../yolo-onnx";
import { ControladorMonitoramento } from "../monitoramento/controlador-monitoramento";
import type { EstadoMonitoramento } from "../monitoramento/controlador-monitoramento";
import { apiMonitoramentoCliente } from "../monitoramento/adaptador-api";
import { criarModuloAtencaoSeguranca } from "./atencao-seguranca";
import {
  ErroGravacaoSegmento,
  GravadorSegmentos,
  escolherMimeTypeVideo,
  type OpcoesCriarRecorder,
  type RecorderLike,
} from "../monitoramento/gravador-segmentos";
import { criarFonteTimelapse } from "../monitoramento/fonte-timelapse";
import { criarModuloInventario } from "./inventario";

const ROTULOS_ESTADO_MONITORAMENTO: Record<EstadoMonitoramento, string> = {
  parada: "Parada",
  iniciando: "Iniciando…",
  gravando: "Gravando",
  pausada: "Pausada",
  encerrada: "Encerrada",
  erro: "Erro",
};

interface DependenciasMonitoramento {
  setStatus: (texto: string) => void;
  atualizarDiagnostico: () => void;
  obterDescricaoAtual?: () => string | undefined;
}

export function criarModuloMonitoramento({
  setStatus,
  atualizarDiagnostico,
}: DependenciasMonitoramento) {
  let ultimaSessaoMonitoramentoId: string | null = null;
  // Declarado antes dos callbacks de estado: o ControladorMonitoramento pode
  // disparar `aoEstado` durante a construção, antes do módulo ser criado.
  let moduloInventario: ReturnType<typeof criarModuloInventario> | null = null;
  let moduloAtencao: ReturnType<typeof criarModuloAtencaoSeguranca> | null = null;

  /** Perfil timelapse (opção 3): baixo uso de espaço, <= 10 fps. */
  const TIMELAPSE_FPS = 2;
  const TIMELAPSE_VIDEO_BITRATE = 180_000;

  /** MediaRecorder nativo adaptado à superfície injetável do gravador de segmentos. */
  function criarRecorderNativo(
    stream: unknown,
    mimeType: string,
    opcoes?: OpcoesCriarRecorder
  ): RecorderLike {
    const init: MediaRecorderOptions = { mimeType };
    if (opcoes?.videoBitsPerSecond !== undefined) {
      init.videoBitsPerSecond = opcoes.videoBitsPerSecond;
    }
    const recorder = new MediaRecorder(stream as MediaStream, init);
    // BlobEvent/ErrorEvent são estruturalmente compatíveis em tempo de execução;
    // as typings do DOM não casam com a assinatura simplificada e injetável.
    return recorder as unknown as RecorderLike;
  }

  /**
   * Câmera de Segurança (Fase 3, opção 3): gravação em segmentos independente do
   * ciclo de análise. Usa timelapse (canvas em baixa taxa, <=10 fps, bitrate
   * reduzido) para minimizar espaço, mantendo o stream da câmera para preview.
   */
  const monitoramento = new ControladorMonitoramento({
    api: apiMonitoramentoCliente,
    agoraMs: () => Date.now(),
    criarGravador: () => {
      const stream = camera.obterStream();
      if (!stream) {
        throw new ErroGravacaoSegmento("Camera indisponivel para gravar");
      }
      const mimeType = escolherMimeTypeVideo();
      const fonte = criarFonteTimelapse(video, {
        fps: TIMELAPSE_FPS,
        larguraMax: 480,
        alturaMax: 360,
      });
      return new GravadorSegmentos({
        stream: fonte.stream,
        criarRecorder: criarRecorderNativo,
        agoraMs: () => Date.now(),
        mimeType,
        videoBitsPerSecond: TIMELAPSE_VIDEO_BITRATE,
        liberarFonte: fonte.liberar,
        aoErro: (erro) => monitoramento.notarFalhaGravador(erro),
      });
    },
    agendarTick: (tick, periodoMs) => {
      const id = window.setInterval(() => void tick(), periodoMs);
      return () => window.clearInterval(id);
    },
    aoEstado: (estado) => {
      if (monitoramento.sessaoAtual) {
        ultimaSessaoMonitoramentoId = monitoramento.sessaoAtual.sessaoId;
      }
      atualizarIndicadorGravacao(estado);
      atualizarBotoesMonitoramento();
      atualizarDiagnostico();
    },
    aoSegmento: () => {
      atualizarIndicadorGravacao(monitoramento.estadoAtual);
      atualizarDiagnostico();
    },
    aoSinal: () => {
      atualizarIndicadorGravacao(monitoramento.estadoAtual);
      atualizarBotoesMonitoramento();
      atualizarDiagnostico();
    },
    aoErro: (erro) => {
      const mensagem = erro.message;
      monitorAvisoEl.textContent =
        monitoramento.semSinal && /camera sem sinal/i.test(mensagem)
          ? `${mensagem} A sessão continua ativa e a gravação será retomada automaticamente.`
          : mensagem;
      monitorAvisoEl.hidden = false;
      // Caminho unico "falha -> operacional": o monitoramento continua gravando,
      // mas a falha nao pode viver apenas na UI.
      void api.gravarOperacional({
        nivel: "erro",
        origem: "monitoramento",
        mensagem: "Falha de gravacao/indice",
        detalhe: erro.message,
      });
      // Uma falha de upload cria um pendente sem mudar o estado da sessão.
      atualizarBotoesMonitoramento();
      atualizarDiagnostico();
    },
  });

  /**
   * Queda/retorno da camera (Fase 6): a gravacao nao e encerrada. Na queda,
   * suspendemos apenas os metadados de captura para nao inventar cobertura; no
   * retorno, o proximo tick registra a lacuna e rotaciona o segmento.
   */
  camera.aoQueda = (motivo) => {
    if (monitorAtivo()) {
      // `suspenderCaptura` ja dispara `aoErro`, que persiste em operacional.
      monitoramento.suspenderCaptura(motivo);
      setStatus("Câmera sem sinal. A sessão continua ativa; aguardando retorno para retomar.");
    } else {
      void api.gravarOperacional({
        nivel: "erro",
        origem: "camera",
        mensagem: "Camera sem sinal; gravacao preservada",
        detalhe: motivo,
      });
      setStatus("Câmera sem sinal.");
    }
  };

  camera.aoRetorno = (motivo) => {
    void api.gravarOperacional({
      nivel: "info",
      origem: "camera",
      mensagem: "Camera recuperada",
      detalhe: motivo,
    });
    if (monitorAtivo()) {
      const retomar = () => monitoramento.retomarCaptura();
      const retomarDepoisDeRenovar =
        motivo === "reconexao"
          ? monitoramento.renovarGravador().then(retomar)
          : retomar();
      void retomarDepoisDeRenovar
        .then(() => {
          if (!monitoramento.semSinal) monitorAvisoEl.hidden = true;
          atualizarBotoesMonitoramento();
          atualizarDiagnostico();
          setStatus("Câmera recuperada. A gravação foi retomada automaticamente.");
        })
        .catch((erro: unknown) => {
          monitorAvisoEl.textContent = (erro as Error).message;
          monitorAvisoEl.hidden = false;
        });
      return;
    }
    atualizarBotoesMonitoramento();
  };

  function monitorAtivo(): boolean {
    const estado = monitoramento.estadoAtual;
    return estado === "iniciando" || estado === "gravando" || estado === "pausada";
  }

  function atualizarIndicadorGravacao(estado: EstadoMonitoramento): void {
    monitorEstadoEl.dataset.estado = estado;
    monitorEstadoEl.textContent = ROTULOS_ESTADO_MONITORAMENTO[estado];

    const visivel = estado === "gravando" || estado === "pausada";
    gravacaoIndicadorEl.hidden = !visivel;

    if (estado === "pausada") {
      gravacaoIndicadorEl.dataset.estado = "pausada";
      gravacaoTextoEl.textContent = monitoramento.segmentoAtual
        ? `Pausada · segmento ${monitoramento.segmentoAtual}`
        : "Pausada";
      return;
    }

    if (estado !== "gravando") {
      delete gravacaoIndicadorEl.dataset.estado;
      return;
    }

    gravacaoIndicadorEl.dataset.estado = monitoramento.semSinal ? "sem-sinal" : "gravando";
    if (monitoramento.semSinal) {
      gravacaoTextoEl.textContent = "Gravando · sem sinal da câmera";
      return;
    }
    const segmento = monitoramento.segmentoAtual;
    gravacaoTextoEl.textContent = segmento
      ? `Gravando · segmento ${segmento}`
      : "Gravando · aguardando primeiro quadro";
  }

  function atualizarBotoesMonitoramento(): void {
    const estado = monitoramento.estadoAtual;
    const podeIniciar = estado === "parada" || estado === "erro" || estado === "encerrada";
    const ativo = monitorAtivo();
    const pendentes = monitoramento.uploadsPendentes;
    const sessaoId = monitoramento.sessaoAtual?.sessaoId ?? ultimaSessaoMonitoramentoId;

    monitorAmbienteInput.disabled = ativo;
    monitorIniciarBtn.disabled = !podeIniciar;
    monitorPausarBtn.disabled = estado !== "gravando";
    monitorRetomarBtn.disabled = estado !== "pausada";
    monitorEncerrarBtn.disabled = estado !== "gravando" && estado !== "pausada";
    monitorExportarCenasBtn.disabled = !sessaoId;
    monitorReenviarBtn.disabled = pendentes === 0;
    monitorReenviarBtn.textContent =
      pendentes > 0 ? `Reenviar pendentes (${pendentes})` : "Reenviar pendentes";
    monitorExcluirSessaoBtn.disabled = ultimaSessaoMonitoramentoId === null || ativo;
    moduloInventario?.sincronizarBotoes();
  }

  async function garantirCameraParaMonitoramento(): Promise<void> {
    if (camera.ativa && camera.obterStream()) return;
    await camera.iniciar();
  }

  async function iniciarMonitoramento(): Promise<void> {
    monitorAvisoEl.hidden = true;
    const ambiente = monitorAmbienteInput.value.trim() || "sala";
    monitorAmbienteInput.value = ambiente;
    try {
      await garantirCameraParaMonitoramento();
      await monitoramento.iniciar(ambiente);
      await moduloInventario?.atualizarPainel();
      iniciarAnaliseSeguranca();
      setStatus(`Câmera de Segurança ativa: gravando "${ambiente}" em timelapse (até 10 fps) com descrições de cena.`);
    } catch (err) {
      pararAnaliseSeguranca();
      setStatus(`Falha ao iniciar a gravação: ${(err as Error).message}`);
    }
  }

  async function encerrarMonitoramento(): Promise<void> {
    try {
      await monitoramento.encerrar();
      pararAnaliseSeguranca();
      moduloInventario?.reiniciar();
      moduloAtencao?.reiniciar();
      monitorAvisoEl.hidden = true;
      setStatus("Gravação encerrada.");
    } catch (err) {
      setStatus(`Falha ao encerrar a gravação: ${(err as Error).message}`);
    }
  }

  /** Executa um comando de gravação e mantém botões/diagnóstico sincronizados. */
  async function comandoMonitoramento(acao: () => Promise<void>, mensagem: string): Promise<void> {
    monitorAvisoEl.hidden = true;
    try {
      await acao();
      atualizarBotoesMonitoramento();
      atualizarDiagnostico();
      setStatus(mensagem);
    } catch (err) {
      setStatus(`Falha no comando de gravação: ${(err as Error).message}`);
    }
  }

  function instanteMs(valor?: string): number | null {
    if (!valor) return null;
    const ms = Date.parse(valor);
    return Number.isFinite(ms) ? ms : null;
  }


  // Análise de cena independente do modo principal: detector COCO padrão (Fase 2),
  // agora com cadência derivada do motor de atenção da Fase 3.
  const detectorSeguranca = new AdaptadorDetectorObjetos();
  async function garantirDetectorSeguranca(): Promise<void> {
    if (!detectorSeguranca.modelo) {
      await detectorSeguranca.carregar(MODELO_YOLO_PADRAO, () => {});
    }
  }
  moduloAtencao = criarModuloAtencaoSeguranca({
    obterSessaoId: () => monitoramento.sessaoAtual?.sessaoId ?? ultimaSessaoMonitoramentoId,
  });
  moduloInventario = criarModuloInventario({
    setStatus,
    obterSessaoId: () => monitoramento.sessaoAtual?.sessaoId ?? ultimaSessaoMonitoramentoId,
    detector: detectorSeguranca,
    garantirDetector: garantirDetectorSeguranca,
    aoRegistrarMudanca: (mudancas) => moduloAtencao?.registrarMudancas(mudancas),
  });
  let analiseSegurancaTimer: number | null = null;
  let analiseSegurancaEmAndamento = false;
  let ultimoResumoSeguranca = "";

  async function analisarCenaSeguranca(): Promise<void> {
    if (!monitorAtivo() || analiseSegurancaEmAndamento) return;
    if (monitoramento.estadoAtual !== "gravando" || monitoramento.semSinal) return;
    if (!camera.ativa) return;
    analiseSegurancaEmAndamento = true;
    let capturadoEmMs = Date.now();
    const inicioAnalise = performance.now();
    try {
      await garantirDetectorSeguranca();
      // Instante da captura, antes da inferência: o mesmo quadro alimenta a
      // descrição de segurança, o inventário e o buffer pré-evento.
      capturadoEmMs = Date.now();
      const quadro = camera.capturarQuadro(640, 320, 0.82);
      const dimensoes = quadro ? camera.dimensoesQuadro(640) : null;
      if (!quadro || !dimensoes) {
        moduloAtencao?.registrarQuadro({
          capturadoEmMs,
          pessoasAtivas: 0,
          indisponivel: true,
          duracaoMs: performance.now() - inicioAnalise,
        });
        return;
      }
      const inicioInferencia = performance.now();
      const resultado = await detectorSeguranca.detectar(
        { imagem: quadro.imagem, dimensoes },
        { threshold: 0.45, percentage: false }
      );
      const inferenciaMs = performance.now() - inicioInferencia;
      const pessoas = resultado.deteccoes.filter(
        (deteccao) => deteccao.rotulo === "person" || deteccao.nome === "pessoa"
      );
      const caixasPessoas = pessoas.map((deteccao) =>
        normalizarCaixaCena(deteccao.caixa, dimensoes.largura, dimensoes.altura)
      );
      moduloAtencao?.registrarQuadro({
        capturadoEmMs,
        imagem: quadro.thumb,
        pessoasAtivas: pessoas.length,
        caixasPessoas,
        inferenciaMs,
        duracaoMs: performance.now() - inicioAnalise,
      });
      if (moduloInventario?.pronto) {
        void moduloInventario.registrarObservacao({
          imagem: quadro.imagem,
          dimensoes,
          capturadoEmMs,
          deteccoes: resultado,
        });
      }
      const { objetos, resumo } = descreverDeteccoes(resultado.deteccoes as unknown as Parameters<typeof descreverDeteccoes>[0]);
      const resumoLimpo = typeof resumo === "string" ? resumo.replace(/\bundefined\b/g, "").replace(/\s{2,}/g, " ").trim() : "";
      const descricaoBruta = resumoLimpo && resumoLimpo !== "2x" && resumoLimpo !== "0x"
        ? resumoLimpo
        : objetos.length > 0
          ? objetos.map((o) => o.nome).filter(Boolean).join(", ")
          : "Nenhum objeto relevante detectado.";
      const descricao = descricaoBruta || "Nenhum objeto relevante detectado.";
      if (descricao === ultimoResumoSeguranca) return;
      ultimoResumoSeguranca = descricao;
      const sessaoId = monitoramento.sessaoAtual?.sessaoId ?? ultimaSessaoMonitoramentoId;
      const entrada: EntradaLog = {
        timestamp: new Date(capturadoEmMs).toISOString(),
        capturadoEm: new Date(capturadoEmMs).toISOString(),
        modelo: detectorSeguranca.modelo ?? MODELO_YOLO_PADRAO,
        objetos,
        resumo: descricao,
        tipo: "deteccao",
        sessaoId: sessaoId ?? undefined,
        snapshot: quadro.thumb,
      };
      await api.gravarEntrada(entrada);
    } catch (err) {
      moduloAtencao?.registrarQuadro({
        capturadoEmMs,
        pessoasAtivas: 0,
        indisponivel: true,
        duracaoMs: performance.now() - inicioAnalise,
      });
      void api.gravarOperacional({ nivel: "aviso", origem: "monitoramento", mensagem: "Falha ao analisar cena da camera de seguranca", detalhe: (err as Error).message }).catch(() => undefined);
    } finally {
      analiseSegurancaEmAndamento = false;
    }
  }

  function agendarAnaliseSeguranca(atrasoMs: number): void {
    if (analiseSegurancaTimer !== null) window.clearTimeout(analiseSegurancaTimer);
    analiseSegurancaTimer = window.setTimeout(() => {
      analiseSegurancaTimer = null;
      if (monitoramento.estadoAtual !== "gravando" || monitoramento.semSinal || !camera.ativa) return;
      void analisarCenaSeguranca().finally(() =>
        agendarAnaliseSeguranca(moduloAtencao?.intervaloAnaliseMs() ?? 5_000)
      );
    }, Math.max(0, atrasoMs));
  }

  function iniciarAnaliseSeguranca(): void {
    if (analiseSegurancaTimer !== null) return;
    agendarAnaliseSeguranca(0);
  }

  function pararAnaliseSeguranca(): void {
    if (analiseSegurancaTimer !== null) window.clearTimeout(analiseSegurancaTimer);
    analiseSegurancaTimer = null;
    analiseSegurancaEmAndamento = false;
  }
  function segmentosCorrelacionados(ms: number | null, segmentos: VideoSegment[]): string[] {
    if (ms === null) return [];
    return segmentos
      .filter((s) => ms >= s.inicioMs && ms <= s.fimMs)
      .map((s) => s.segmentoId);
  }

  function baixarArquivo(nome: string, conteudo: string, tipo: string): void {
    const blob = new Blob([conteudo], { type: tipo });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nome;
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function exportarLogDescricaoCenas(): Promise<void> {
    const sessaoId = monitoramento.sessaoAtual?.sessaoId ?? ultimaSessaoMonitoramentoId;
    if (!sessaoId) {
      setStatus("Nenhuma sessao de monitoramento para exportar.");
      return;
    }
    setStatus("Coletando descricoes da sessao...");
    try {
      const [segmentos, ciclos, entradas] = await Promise.all([
        api.listarSegmentosDaSessao(sessaoId, 500),
        api.listarCiclos(500).catch(() => [] as RegistroCiclo[]),
        api.listarEntradas(500).catch(() => [] as EntradaLogComVideo[]),
      ]);
      const segmentosOrdenados = [...segmentos].sort((a, b) => a.inicioMs - b.inicioMs);
      const itens: Array<Record<string, unknown>> = [];

      for (const ciclo of ciclos) {
        if (ciclo.sessionId !== sessaoId) continue;
        const resumo = ciclo.interpretacao;
        if (!resumo) continue;
        const ms = instanteMs(ciclo.iniciadoEm) ?? instanteMs(ciclo.concluidoEm);
        itens.push({
          tipo: "ciclo",
          sessaoId,
          cycleId: ciclo.cycleId,
          timestamp: ciclo.iniciadoEm,
          timestampMs: ms,
          descricao: resumo,
          segmentosRelacionados: segmentosCorrelacionados(ms, segmentosOrdenados),
        });
      }

      for (const entrada of entradas) {
        const ms = instanteMs(entrada.capturadoEm ?? entrada.timestamp);
        const segmentosDaEntrada = Array.isArray(entrada.segmentos)
          ? entrada.segmentos.map((t) => t.segmentoId)
          : [];
        const correlacionados =
          segmentosDaEntrada.length > 0 ? segmentosDaEntrada : segmentosCorrelacionados(ms, segmentosOrdenados);
        itens.push({
          tipo: "entrada",
          sessaoId,
          timestamp: entrada.capturadoEm ?? entrada.timestamp,
          timestampMs: ms,
          tipoEntrada: entrada.tipo,
          descricao: entrada.resumo,
          objetos: entrada.objetos ?? null,
          segmentosRelacionados: correlacionados,
        });
      }

      itens.sort((a, b) => {
        const ta = typeof a.timestampMs === "number" ? a.timestampMs : Number.MAX_SAFE_INTEGER;
        const tb = typeof b.timestampMs === "number" ? b.timestampMs : Number.MAX_SAFE_INTEGER;
        return ta - tb;
      });

      const cabecalho = {
        tipo: "descricao-cenas",
        versao: 1,
        sessaoId,
        geradoEm: new Date().toISOString(),
        perfilGravacao: { modo: "timelapse", fps: TIMELAPSE_FPS, videoBitsPerSecond: TIMELAPSE_VIDEO_BITRATE },
        segmentos: segmentosOrdenados.map((s) => ({
          segmentoId: s.segmentoId,
          sequencia: s.sequencia,
          inicioEm: s.inicioEm,
          fimEm: s.fimEm,
          inicioMs: s.inicioMs,
          fimMs: s.fimMs,
          estado: s.estado,
          motivoFim: s.motivoFim,
        })),
        totalDescricoes: itens.length,
      };
      const linhas = [JSON.stringify(cabecalho), ...itens.map((i) => JSON.stringify(i))];
      const nome = `descricao-cenas-${sessaoId}.jsonl`;
      baixarArquivo(nome, `${linhas.join("\n")}\n`, "application/x-ndjson;charset=utf-8");
      setStatus(
        `Log de cenas exportado (${itens.length} descricao(oes), ${segmentosOrdenados.length} segmento(s)).`
      );
    } catch (err) {
      setStatus(`Falha ao exportar log de cenas: ${(err as Error).message}`);
    }
  }

  function registrarEventos(): void {
    moduloInventario?.registrarEventos();
    moduloAtencao?.registrarEventos();
    const sincronizarAnalise = () => {
      if (monitoramento.estadoAtual === "gravando" && !monitoramento.semSinal) iniciarAnaliseSeguranca();
      else pararAnaliseSeguranca();
    };
    window.setInterval(sincronizarAnalise, 1500);
    monitorIniciarBtn.addEventListener("click", () => void iniciarMonitoramento());
    monitorPausarBtn.addEventListener("click", () =>
      void comandoMonitoramento(async () => { await monitoramento.pausar(); pararAnaliseSeguranca(); }, "Gravação pausada.")
    );
    monitorRetomarBtn.addEventListener("click", () =>
      void comandoMonitoramento(async () => { await monitoramento.retomar(); iniciarAnaliseSeguranca(); }, "Gravação retomada.")
    );
    monitorEncerrarBtn.addEventListener("click", () => void encerrarMonitoramento());
    monitorExportarCenasBtn.addEventListener("click", () => void exportarLogDescricaoCenas());
    monitorReenviarBtn.addEventListener("click", () =>
      void (async () => {
        const enviados = await monitoramento.reenviarPendentes();
        atualizarBotoesMonitoramento();
        atualizarDiagnostico();
        if (enviados > 0) monitorAvisoEl.hidden = true;
        const restante = monitoramento.uploadsPendentes;
        setStatus(
          restante > 0
            ? `${enviados} gravacao(oes) reenviada(s); ${restante} ainda pendente(s).`
            : `${enviados} gravacao(oes) reenviada(s).`
        );
      })()
    );

    monitorRetencaoBtn.addEventListener("click", () =>
      void (async () => {
        try {
          const removidos = await api.aplicarRetencaoVideos();
          setStatus(`Retencao aplicada: ${removidos.length} video(s) removido(s).`);
        } catch (err) {
          setStatus(`Falha na retencao: ${(err as Error).message}`);
        }
      })()
    );

    monitorExcluirSessaoBtn.addEventListener("click", () => {
      const sessaoId = ultimaSessaoMonitoramentoId;
      if (!sessaoId || monitorAtivo()) return;
      if (!window.confirm(`Excluir todos os videos da sessao ${sessaoId}?`)) return;
      void (async () => {
        try {
          const total = await api.excluirVideosDaSessao(sessaoId);
          setStatus(`${total} video(s) da sessao ${sessaoId} excluido(s).`);
        } catch (err) {
          setStatus(`Falha ao excluir videos: ${(err as Error).message}`);
        }
      })();
    });
  }

  // Garante estado visual consistente antes do primeiro tick/evento.
  atualizarIndicadorGravacao(monitoramento.estadoAtual);
  atualizarBotoesMonitoramento();

  return {
    monitoramento,
    monitorAtivo,
    atualizarIndicadorGravacao,
    atualizarBotoesMonitoramento,
    iniciarMonitoramento,
    encerrarMonitoramento,
    comandoMonitoramento,
    registrarEventos,
    obterUltimaSessaoMonitoramentoId: () => ultimaSessaoMonitoramentoId,
  };
}
