import { uuid, type LacunaGravacao, type MotivoFimSegmento, type SessaoMonitoramento, type VideoSegment } from "../../domain";
import type { ConfigGerenciadorGravacao } from "./tipos";
import { instanteValido, paraIso } from "./util";

export class BaseGerenciadorGravacao {
  protected sessao: SessaoMonitoramento | null = null;
  protected segmentos: VideoSegment[] = [];
  protected atual: VideoSegment | null = null;
  protected ultimoFrameMs: number | null = null;

  constructor(protected readonly config: ConfigGerenciadorGravacao = {}) {}

  protected exigirSessao(): SessaoMonitoramento {
    if (!this.sessao) throw new Error("Nenhuma sessao de monitoramento iniciada");
    return this.sessao;
  }

  protected validarFim(agoraMs: number, sessao: SessaoMonitoramento): void {
    if (!instanteValido(agoraMs) || agoraMs < sessao.iniciadaEmMs) {
      throw new Error("Instante de encerramento invalido ou anterior ao inicio");
    }
    if (this.ultimoFrameMs !== null && agoraMs < this.ultimoFrameMs) {
      throw new Error("Instante de encerramento anterior ao ultimo quadro gravado");
    }
  }

  protected avancarSegmentoSeNecessario(capturadoEmMs: number): void {
    const sessao = this.sessao;
    const atual = this.atual;
    if (!sessao || !atual) return;

    const limite = atual.inicioMs + sessao.duracaoSegmentoMs;
    if (capturadoEmMs < limite) return;

    // Um salto que atravessa um segmento inteiro sem quadros não pode ser
    // coberto por rotação normal: é lacuna, com fim no último quadro real.
    if (capturadoEmMs >= limite + sessao.duracaoSegmentoMs) {
      this.registrarLacuna(capturadoEmMs);
      return;
    }

    this.fecharSegmento("duracao", limite);
    this.iniciarSegmento(limite);
  }

  protected registrarLacuna(capturadoEmMs: number): void {
    if (!this.atual || this.ultimoFrameMs === null) return;
    const ultimo = this.ultimoFrameMs;
    if (capturadoEmMs <= ultimo) return;
    this.atual.lacunas.push(this.criarLacuna(ultimo, capturadoEmMs, "sem_quadros"));
    this.fecharSegmento("lacuna", ultimo);
  }

  protected criarLacuna(
    inicioMs: number,
    fimMs: number,
    motivo: LacunaGravacao["motivo"]
  ): LacunaGravacao {
    return {
      inicioEm: paraIso(inicioMs),
      inicioMs,
      fimEm: paraIso(fimMs),
      fimMs,
      duracaoMs: fimMs - inicioMs,
      motivo,
    };
  }

  protected iniciarSegmento(inicioMs: number): void {
    const sessao = this.sessao;
    if (!sessao) throw new Error("Nenhuma sessao de monitoramento iniciada");
    const segmento: VideoSegment = {
      segmentoId: uuid(),
      sessaoId: sessao.sessaoId,
      sequencia: this.segmentos.length + 1,
      inicioEm: paraIso(inicioMs),
      inicioMs,
      fimEm: paraIso(inicioMs),
      fimMs: inicioMs,
      duracaoMs: 0,
      quadros: 0,
      estado: "gravando",
      lacunas: [],
    };
    this.segmentos.push(segmento);
    this.atual = segmento;
  }

  protected fecharSegmento(motivo: MotivoFimSegmento, fimMs: number): void {
    const segmento = this.atual;
    if (!segmento) return;
    const fim = Math.max(fimMs, segmento.inicioMs);
    segmento.fimMs = fim;
    segmento.fimEm = paraIso(fim);
    segmento.duracaoMs = fim - segmento.inicioMs;
    segmento.motivoFim = motivo;
    segmento.estado = motivo === "lacuna" ? "incompleto" : "fechado";
    this.atual = null;
  }
}
