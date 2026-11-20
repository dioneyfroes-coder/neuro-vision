import * as api from "../api";
import {
  camera,
  gravacaoIndicadorEl,
  gravacaoTextoEl,
  monitorAvisoEl,
  monitorEncerrarBtn,
  monitorExcluirSessaoBtn,
  monitorEstadoEl,
  monitorIniciarBtn,
  monitorPausarBtn,
  monitorReenviarBtn,
  monitorRetencaoBtn,
  monitorRetomarBtn,
  monitorAmbienteInput,
} from "./elementos";
import { ControladorMonitoramento } from "../monitoramento/controlador-monitoramento";
import type { EstadoMonitoramento } from "../monitoramento/controlador-monitoramento";
import { apiMonitoramentoCliente } from "../monitoramento/adaptador-api";
import {
  ErroGravacaoSegmento,
  GravadorSegmentos,
  escolherMimeTypeVideo,
  type RecorderLike,
} from "../monitoramento/gravador-segmentos";

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
  obterRodando: () => boolean;
  atualizarDiagnostico: () => void;
}

export function criarModuloMonitoramento({
  setStatus,
  obterRodando,
  atualizarDiagnostico,
}: DependenciasMonitoramento) {
  let ultimaSessaoMonitoramentoId: string | null = null;

  /** MediaRecorder nativo adaptado à superfície injetável do gravador de segmentos. */
  function criarRecorderNativo(stream: unknown, mimeType: string): RecorderLike {
    const recorder = new MediaRecorder(stream as MediaStream, { mimeType });
    // BlobEvent/ErrorEvent são estruturalmente compatíveis em tempo de execução;
    // as typings do DOM não casam com a assinatura simplificada e injetável.
    return recorder as unknown as RecorderLike;
  }

  /**
   * Câmera de Segurança (Fase 3): gravação em segmentos, independente do ciclo de
   * análise. A câmera precisa estar ligada porque o `MediaRecorder` usa o mesmo
   * stream do elemento `<video>`.
   */
  const monitoramento = new ControladorMonitoramento({
    api: apiMonitoramentoCliente,
    agoraMs: () => Date.now(),
    criarGravador: () => {
      const stream = camera.obterStream();
      if (!stream) throw new ErroGravacaoSegmento("Ligue a webcam antes de gravar");
      const mimeType = escolherMimeTypeVideo();
      return new GravadorSegmentos({
        stream,
        criarRecorder: criarRecorderNativo,
        agoraMs: () => Date.now(),
        mimeType,
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
    const cameraPronta = obterRodando() && camera.ativa;
    const podeIniciar = estado === "parada" || estado === "erro" || estado === "encerrada";
    const ativo = monitorAtivo();
    const pendentes = monitoramento.uploadsPendentes;

    monitorAmbienteInput.disabled = ativo;
    monitorIniciarBtn.disabled = !cameraPronta || !podeIniciar;
    monitorPausarBtn.disabled = estado !== "gravando";
    monitorRetomarBtn.disabled = estado !== "pausada";
    monitorEncerrarBtn.disabled = estado !== "gravando" && estado !== "pausada";
    monitorReenviarBtn.disabled = pendentes === 0;
    monitorReenviarBtn.textContent =
      pendentes > 0 ? `Reenviar pendentes (${pendentes})` : "Reenviar pendentes";
    // Exclusao so depois de encerrar: apagar enquanto grava deixaria a sessao
    // ativa sem os bytes que o indice ainda referencia.
    monitorExcluirSessaoBtn.disabled =
      ultimaSessaoMonitoramentoId === null || ativo;
  }

  async function iniciarMonitoramento(): Promise<void> {
    monitorAvisoEl.hidden = true;
    const ambiente = monitorAmbienteInput.value.trim() || "sala";
    monitorAmbienteInput.value = ambiente;
    try {
      await monitoramento.iniciar(ambiente);
      setStatus(`Gravando "${ambiente}" em segmentos de 5 minutos.`);
    } catch (err) {
      setStatus(`Falha ao iniciar a gravação: ${(err as Error).message}`);
    }
  }

  async function encerrarMonitoramento(): Promise<void> {
    try {
      await monitoramento.encerrar();
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

  function registrarEventos(): void {
  monitorIniciarBtn.addEventListener("click", () => void iniciarMonitoramento());
  monitorPausarBtn.addEventListener("click", () =>
    void comandoMonitoramento(() => monitoramento.pausar(), "Gravação pausada.")
  );
  monitorRetomarBtn.addEventListener("click", () =>
    void comandoMonitoramento(() => monitoramento.retomar(), "Gravação retomada.")
  );
  monitorEncerrarBtn.addEventListener("click", () => void encerrarMonitoramento());
  monitorReenviarBtn.addEventListener("click", () =>
    void (async () => {
      const enviados = await monitoramento.reenviarPendentes();
      atualizarBotoesMonitoramento();
      atualizarDiagnostico();
      if (enviados > 0) monitorAvisoEl.hidden = true;
      const restante = monitoramento.uploadsPendentes;
      setStatus(
        restante > 0
          ? `${enviados} gravação(ões) reenviada(s); ${restante} ainda pendente(s).`
          : `${enviados} gravação(ões) reenviada(s).`
      );
    })()
  );

  monitorRetencaoBtn.addEventListener("click", () =>
    void (async () => {
      try {
        const removidos = await api.aplicarRetencaoVideos();
        setStatus(`Retenção aplicada: ${removidos.length} vídeo(s) removido(s).`);
      } catch (err) {
        setStatus(`Falha na retenção: ${(err as Error).message}`);
      }
    })()
  );

  monitorExcluirSessaoBtn.addEventListener("click", () => {
    const sessaoId = ultimaSessaoMonitoramentoId;
    if (!sessaoId || monitorAtivo()) return;
    if (!window.confirm(`Excluir todos os vídeos da sessão ${sessaoId}?`)) return;
    void (async () => {
      try {
        const total = await api.excluirVideosDaSessao(sessaoId);
        setStatus(`${total} vídeo(s) da sessão ${sessaoId} excluído(s).`);
      } catch (err) {
        setStatus(`Falha ao excluir vídeos: ${(err as Error).message}`);
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
