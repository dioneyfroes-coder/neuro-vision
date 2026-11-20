import type { UploadPendente } from "../tipos";
import { ControladorMonitoramentoBase } from "./base";

export class ControladorMonitoramento extends ControladorMonitoramentoBase {
  /**
   * Suspende apenas os metadados de captura durante uma queda da camera. Os
   * bytes ja gravados nao sao descartados e a sessao continua ativa; quando o
   * sinal voltar, `renovarGravador` fecha o segmento anterior como `pausa` e
   * abre outro. Pausa intencional nao e lacuna: lacunas com motivo `sem_quadros`
   * surgem apenas quando o servidor detecta ausencia de quadros sem pausa.
   */
  suspenderCaptura(motivo: string): void {
    if (this.estado !== "gravando" || this.capturaSuspensa) return;
    this.capturaSuspensa = true;
    this.motivoSuspensao = motivo;
    this.avisarErro(new Error(`Camera sem sinal: ${motivo}`));
    this.deps.aoSinal?.(false, motivo);
  }

  /** Registra falha do gravador sem derrubar a sessao. */
  notarFalhaGravador(erro: Error): void {
    this.avisarErro(erro);
  }

  /**
   * Troca o `MediaRecorder` depois de uma reconexao da camera: pausa e retoma o
   * indice para abrir um segmento novo, fecha o anterior no ultimo quadro real e
   * cria o gravador com o stream atual. A pausa explicita fecha o segmento como
   * `pausa` (sem lacunas[]); o servidor so calcula `lacuna` quando ha ausencia de
   * quadros sem essa pausa.
   */
  renovarGravador(): Promise<void> {
    return this.enfileirar(() => this.renovarGravadorNaFila());
  }

  /** Retoma os relatorios e dispara um tick imediato no novo segmento. */
  retomarCaptura(): Promise<void> {
    if (this.estado !== "gravando" || !this.capturaSuspensa) return Promise.resolve();
    this.capturaSuspensa = false;
    const motivo = this.motivoSuspensao;
    this.motivoSuspensao = undefined;
    this.deps.aoSinal?.(true, motivo);
    return this.tick();
  }

  /** Abre uma sessao, inicia o gravador e passa a reportar capturas. */
  iniciar(ambiente: string, duracaoSegmentoMs?: number): Promise<void> {
    return this.enfileirar(async () => {
      if (this.estado === "gravando" || this.estado === "iniciando") {
        throw new Error("Ja ha uma sessao de monitoramento ativa");
      }
      this.definirEstado("iniciando");
      this.limparSinal();
      try {
        const sessao = await this.deps.api.iniciar({
          ambiente,
          agoraMs: this.deps.agoraMs(),
          ...(duracaoSegmentoMs !== undefined ? { duracaoSegmentoMs } : {}),
        });
        this.sessao = sessao;
        this.definirSegmento(null);
        this.sequenciaFrame = 0;
        const gravador = this.deps.criarGravador();
        this.gravador = gravador;
        gravador.iniciar();
        this.cancelarTick = this.deps.agendarTick(() => this.tick(), this.deps.periodoMs ?? 1000);
        this.definirEstado("gravando");
      } catch (err) {
        this.avisarErro(err);
        await this.desfazerInicio();
        this.limparSinal();
        this.definirEstado("erro");
        throw err;
      }
    });
  }

  /** Pausa o indice e fecha o segmento sem iniciar outro. */
  pausar(): Promise<void> {
    return this.enfileirar(async () => {
      if (this.estado !== "gravando" || !this.sessao) return;
      await this.deps.api.pausar(this.sessao.sessaoId);
      this.pararTick();
      const fechado = this.segmentoAtualId;
      this.definirSegmento(null);
      await this.fecharGravadorAtual(fechado);
      this.limparSinal();
      this.definirEstado("pausada");
    });
  }

  /** Retoma com um gravador novo: pausa nao e lacuna, mas troca de segmento. */
  retomar(): Promise<void> {
    return this.enfileirar(async () => {
      if (this.estado !== "pausada" || !this.sessao) return;
      await this.deps.api.retomar(this.sessao.sessaoId);
      this.iniciarGravador();
      this.cancelarTick = this.deps.agendarTick(() => this.tick(), this.deps.periodoMs ?? 1000);
      this.definirEstado("gravando");
    });
  }

  /** Encerra a sessao no indice e fecha o ultimo segmento. */
  encerrar(): Promise<void> {
    return this.enfileirar(async () => {
      if (this.estado !== "gravando" && this.estado !== "pausada") return;
      const sessao = this.sessao;
      if (!sessao) return;
      await this.deps.api.encerrar(sessao.sessaoId, this.deps.agoraMs());
      this.pararTick();
      const fechado = this.segmentoAtualId;
      this.definirSegmento(null);
      await this.fecharGravadorAtual(fechado);
      this.sessao = null;
      this.limparSinal();
      this.definirEstado("encerrada");
    });
  }

  /** Interrompe por falha de gravacao, preservando os segmentos ja enviados. */
  interromper(motivo: "falha" | "sem_quadros" = "falha"): Promise<void> {
    return this.enfileirar(async () => {
      if (this.estado !== "gravando" && this.estado !== "pausada") return;
      const sessao = this.sessao;
      if (!sessao) return;
      await this.deps.api.interromper(sessao.sessaoId, this.deps.agoraMs(), motivo);
      this.pararTick();
      const fechado = this.segmentoAtualId;
      this.definirSegmento(null);
      await this.fecharGravadorAtual(fechado);
      this.sessao = null;
      this.limparSinal();
      this.definirEstado("encerrada");
    });
  }

  /** Tenta reenviar os blobs cujo upload falhou; devolve quantos conseguiram. */
  reenviarPendentes(): Promise<number> {
    return this.enfileirar(async () => {
      const restantes: UploadPendente[] = [];
      let enviados = 0;
      for (const pendente of this.pendentes) {
        try {
          await this.enviar(pendente);
          enviados += 1;
        } catch (err) {
          restantes.push(pendente);
          this.avisarErro(err);
        }
      }
      this.pendentes = restantes;
      return enviados;
    });
  }

  /**
   * Um tick reporta apenas metadados de captura; os bytes vem do
   * `MediaRecorder`, que continua gravando mesmo se a analise estiver lenta.
   */
  private tick(): Promise<void> {
    return this.enfileirar(async () => {
      if (this.estado !== "gravando" || !this.sessao) return;
      if ((this.gravador as { falhouDuranteGravacao?: boolean } | null)?.falhouDuranteGravacao) {
        await this.renovarGravadorNaFila();
        return;
      }
      // Sem sinal, reportar quadros inventaria cobertura para o periodo da queda.
      if (this.capturaSuspensa) return;
      const capturadoEmMs = this.deps.agoraMs();
      const frameId = `${this.sessao.sessaoId}-f${this.sequenciaFrame++}`;
      let resultado;
      try {
        resultado = await this.deps.api.enviarQuadros([{ frameId, capturadoEmMs }]);
      } catch (err) {
        // Falha do indice nao interrompe a gravacao dos bytes.
        this.avisarErro(err);
        return;
      }
      for (const rejeitado of resultado.rejeitados) {
        this.avisarErro(new Error(`Quadro ${rejeitado.frameId} recusado: ${rejeitado.motivo}`));
      }
      const segmentoId = resultado.atribuicoes.at(-1)?.segmentoId;
      if (!segmentoId) return;
      if (this.segmentoAtualId === null) {
        // Primeiro quadro: o gravador aberto em `iniciar` pertence a este segmento.
        this.definirSegmento(segmentoId);
        return;
      }
      if (segmentoId !== this.segmentoAtualId) {
        const anterior = this.segmentoAtualId;
        this.definirSegmento(segmentoId);
        await this.rotacionar(anterior);
      }
    });
  }

  /** Implementacao de `renovarGravador`, ja dentro da fila de serializacao. */
  private async renovarGravadorNaFila(): Promise<void> {
    if (this.estado !== "gravando" || !this.sessao) return;
    const sessaoId = this.sessao.sessaoId;
    const anterior = this.segmentoAtualId;
    try {
      await this.deps.api.pausar(sessaoId);
    } catch (err) {
      this.avisarErro(err);
      return;
    }
    try {
      await this.deps.api.retomar(sessaoId);
    } catch (err) {
      this.avisarErro(err);
      this.limparSinal();
      this.definirEstado("pausada");
      return;
    }

    this.definirSegmento(null);
    const antigo = this.gravador;
    this.gravador = null;
    await this.fecharGravador(anterior, antigo);
    try {
      this.iniciarGravador();
    } catch (err) {
      this.avisarErro(err);
      void this.interromper("falha").catch((interrupcao) => this.avisarErro(interrupcao));
    }
  }

  /**
   * Troca de segmento: inicia o gravador novo **antes** de fechar o antigo para
   * nao perder quadros no intervalo, e envia o blob com o id do segmento que
   * termina (`anterior`), nunca com o id novo.
   */
  private async rotacionar(anterior: string): Promise<void> {
    const gravadorAntigo = this.gravador;
    try {
      this.iniciarGravador();
    } catch (err) {
      // Sem gravador novo nao ha como seguir acumulando bytes: preserva o
      // segmento que termina e interrompe a sessao com motivo de falha.
      this.avisarErro(err);
      await this.fecharGravador(anterior, gravadorAntigo);
      void this.interromper("falha").catch((interrupcao) => this.avisarErro(interrupcao));
      return;
    }
    await this.fecharGravador(anterior, gravadorAntigo);
  }

  private async desfazerInicio(): Promise<void> {
    this.pararTick();
    try {
      if (this.gravador?.ativo) await this.gravador.fechar();
    } catch (err) {
      this.avisarErro(err);
    }
    this.gravador = null;
    const sessao = this.sessao;
    this.sessao = null;
    this.definirSegmento(null);
    if (sessao) {
      try {
        await this.deps.api.interromper(sessao.sessaoId, this.deps.agoraMs(), "falha");
      } catch (err) {
        this.avisarErro(err);
      }
    }
  }
}
