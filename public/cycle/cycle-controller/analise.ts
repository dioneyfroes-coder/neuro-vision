import type { MarcacaoNsfwLog, MotivoAnalise } from "../../../src/types";
import { colapsarRepeticoes } from "../../../src/texto";
import { entradaDeResultado } from "../../../src/percepcao";
import type { ResultadoPercepcao } from "../../../src/percepcao";
import { ehCancelamento } from "../../../src/erros";
import { comMotivo, rotuloMotivo } from "../../../src/politica-analise";
import { resumirMarcacoesNsfw } from "../../../src/nsfw-prompt";
import { CONFIG_CAPTURA_PADRAO } from "../../capture/webcam-capture";
import { dimensoesReduzidas, gerarId } from "./tipos";
import { BaseCycleController } from "./base";

export class CycleController extends BaseCycleController {
  protected async analisarComVisao(
    signal: AbortSignal,
    ehRoteiro: boolean,
    motivo?: MotivoAnalise | null,
    capturaVisao?: {
      imagem: string;
      thumb: string;
      capturadoEm: string;
      /** NSFW ja avaliado no mesmo frame (fluxo de eventos); evita repetir. */
      nsfw?: MarcacaoNsfwLog[];
      nsfwAvaliado?: boolean;
    }
  ): Promise<void> {
    const camera = this.deps.camera;
    const capturadoEm = capturaVisao?.capturadoEm ?? new Date().toISOString();
    const dataUrl = capturaVisao?.imagem ?? camera.capturarFrame(512);
    if (dataUrl === null) return;
    const width = camera.largura;
    const height = camera.altura;
    this.deps.aoUi({ tipo: "preparar_canvas", largura: width, altura: height });
    this.deps.aoUi({ tipo: "limpar_canvas" });

    const base64 = dataUrl.split(",")[1] ?? "";
    // `capturarFrame(512)` reduz a imagem; as caixas NSFW precisam das
    // dimensoes da imagem efetivamente analisada para normalizar.
    const dimensoes = capturaVisao
      ? { largura: width, altura: height }
      : dimensoesReduzidas(width, height, 512);
    let nsfw = capturaVisao?.nsfw;
    if (capturaVisao?.nsfwAvaliado !== true) {
      nsfw = await this.avaliarNsfw(dataUrl, dimensoes);
    }
    if (signal.aborted) return;

    this.status(`LM Studio analisando frame... (pode demorar)`);

    const motor = this.deps.criarMotorVisao({
      modo: ehRoteiro ? "roteiro" : "descricao",
      modelo: this.deps.obterModeloVisao(),
      ...(this.frameIdAtual ? { frameIds: [this.frameIdAtual] } : {}),
      roteiro: ehRoteiro ? this.roteiroBeats.slice(-8).join(" ").slice(0, 1200) : undefined,
      base: ehRoteiro ? this.roteiroPrimeiro : undefined,
      anterior: ehRoteiro ? undefined : this.ultimaDescricao,
      motivo: motivo ?? undefined,
      contexto: this.deps.obterContexto?.(),
      nsfw,
    });

    let resultado: ResultadoPercepcao | null;
    try {
      resultado = await motor.analisar(
        { imagem: base64, snapshot: dataUrl, capturadoEm },
        signal,
        (parcial) => this.status(`LM Studio: ${colapsarRepeticoes(parcial)}`)
      );
    } catch (err) {
      if (ehCancelamento(err) || signal.aborted) return;
      this.registrarOperacional("erro", "visao", (err as Error).message);
      this.status((err as Error).message);
      return;
    }
    if (signal.aborted || !resultado) return;
    this.ultimaDuracaoMsValor = resultado.duracaoMs;

    if (ehRoteiro && resultado.confianca?.semMudanca) {
      this.status(`Sem mudancas neste intervalo (${resultado.duracaoMs} ms).`);
      return;
    }

    if (ehRoteiro) {
      if (this.roteiroPrimeiro) this.roteiroPrimeiro = false;
      this.roteiroBeats.push(colapsarRepeticoes(resultado.descricao ?? ""));
      if (this.roteiroBeats.length > 64) this.roteiroBeats.splice(0, this.roteiroBeats.length - 64);
    }

    const entry = comMotivo(
      {
        ...entradaDeResultado(resultado, ehRoteiro ? "roteiro" : "descricao"),
        frameId: this.frameIdAtual ?? undefined,
        nsfw,
      },
      motivo
    );
    this.ultimaDescricao = resultado.descricao ?? "";
    this.deps.aoUi({ tipo: "exibir_entrada", entrada: entry });
    if (nsfw !== undefined) {
      this.deps.aoUi({ tipo: "desenhar_caixas", objetos: [], nsfw });
    }

    const tokens = resultado.confianca?.tokens;
    if (tokens) {
      const tokS = resultado.duracaoMs > 0 ? Math.round(tokens / (resultado.duracaoMs / 1000)) : 0;
      this.status(
        `LM Studio viu: ${resultado.descricao} (${resultado.duracaoMs} ms · ${tokens} toks · ${tokS} tok/s)`
      );
    } else {
      this.status(`LM Studio viu: ${resultado.descricao} (${resultado.duracaoMs} ms)`);
    }
  }

  protected async analisarDeteccao(signal: AbortSignal): Promise<void> {
    const camera = this.deps.camera;
    const width = camera.largura;
    const height = camera.altura;
    if (!width || !height) return;
    this.deps.aoUi({ tipo: "preparar_canvas", largura: width, altura: height });

    // Captura o frame UMA unica vez: o mesmo instante alimenta a analise, o
    // snapshot do historico e a assinatura de cena.
    const capturadoMs = performance.now();
    const capturadoEm = new Date().toISOString();
    const captura = camera.capturarQuadro(0, 240);
    if (captura === null) return;
    const assinatura = camera.assinaturaDeCena();

    this.status("Analisando frame...");
    let resultado: ResultadoPercepcao | null;
    let nsfw: MarcacaoNsfwLog[] | undefined;
    try {
      if (!this.motorAtual) return;
      [resultado, nsfw] = await Promise.all([
        this.motorAtual.analisar(
          {
            imagem: captura.imagem,
            snapshot: captura.thumb,
            capturadoEm,
            dimensoes: { largura: width, altura: height },
          },
          signal
        ),
        this.avaliarNsfw(captura.imagem, { largura: width, altura: height }),
      ]);
    } catch (err) {
      if (ehCancelamento(err) || signal.aborted) return;
      this.registrarOperacional("erro", "detector", (err as Error).message);
      this.status(`Erro na inferencia: ${(err as Error).message}`);
      return;
    }
    if (signal.aborted || !resultado) return;
    this.ultimaDuracaoMsValor = resultado.duracaoMs;

    const agora = capturadoMs;
    const timestamp = capturadoEm;
    const quadro = this.rastreador.processar(resultado.objetos, agora, {
      timestamp,
      snapshot: resultado.snapshot,
      modelo: resultado.modelo,
      sessaoId: this.sessaoId,
    });
    const sinalCena = this.detectorCena.avaliar(assinatura, agora, {
      timestamp,
      snapshot: resultado.snapshot,
      modelo: resultado.modelo,
      sessaoId: this.sessaoId,
    });
    const eventos = sinalCena ? [...quadro.eventos, sinalCena] : quadro.eventos;
    this.deps.aoUi({ tipo: "desenhar_caixas", objetos: quadro.objetos, nsfw });

    const entry = {
      ...entradaDeResultado(resultado, "deteccao"),
      frameId: this.frameIdAtual ?? undefined,
      nsfw,
    };
    const item = this.deps.aoUi({ tipo: "exibir_entrada", entrada: entry });
    const resumoEventos = eventos.map((e) => e.descricao).join(", ");
    const resumoNsfw = nsfw?.length ? ` · NSFW: ${resumirMarcacoesNsfw(nsfw)}` : "";
    this.status(
      `Viu: ${entry.resumo}  (${resultado.duracaoMs} ms)${resumoEventos ? ` · ${resumoEventos}` : ""}${resumoNsfw}`
    );

    for (const evt of eventos) this.persistirEvento(evt);

    this.persistirEntrada(entry, item);
  }

  /**
   * Fluxo orientado a eventos: a percepcao leve roda a cada tick; o modelo de
   * visao so e chamado quando a politica decide que ha motivo. Falha da
   * percepcao leve = estado desconhecido, nunca "sem mudanca".
   */
  protected async analisarEventos(signal: AbortSignal): Promise<void> {
    const camera = this.deps.camera;
    const width = camera.largura;
    const height = camera.altura;
    if (!width || !height) return;
    this.deps.aoUi({ tipo: "preparar_canvas", largura: width, altura: height });

    const capturadoMs = performance.now();
    const capturadoEm = new Date().toISOString();
    const captura = camera.capturarQuadro(
      CONFIG_CAPTURA_PADRAO.maxLargura,
      CONFIG_CAPTURA_PADRAO.larguraThumb,
      CONFIG_CAPTURA_PADRAO.qualidadeJpeg
    );
    if (captura === null) return;
    const assinatura = camera.assinaturaDeCena();

    const agora = capturadoMs;
    // Roda junto da percepcao leve. Mesmo que a deteccao falhe, o NSFW do
    // mesmo frame alimenta a visao acionada por `falha_percepcao`.
    const promessaNsfw = this.avaliarNsfw(captura.imagem, {
      largura: width,
      altura: height,
    });
    let resultado: ResultadoPercepcao | null;
    try {
      if (!this.motorAtual) return;
      resultado = await this.motorAtual.analisar(
        {
          imagem: captura.imagem,
          snapshot: captura.thumb,
          capturadoEm,
          dimensoes: { largura: width, altura: height },
        },
        signal
      );
    } catch (err) {
      if (ehCancelamento(err) || signal.aborted) return;
      this.registrarOperacional("erro", "detector", (err as Error).message);
      const nsfw = await promessaNsfw;
      const decisao = this.politica.avaliar({
        agora,
        eventos: [],
        melhorConfianca: null,
        percepcaoValida: false,
        manual: this.manualSolicitado,
      });
      this.frameIdAtual = gerarId();
      this.manualSolicitado = false;
      if (decisao.acionar) {
        this.politica.registrarChamada(agora);
        const motivo: MotivoAnalise | undefined =
          decisao.motivo === "sem_acao" ? undefined : decisao.motivo;
        this.status(
          `Percepcao leve falhou; acionando o modelo de visao por ${rotuloMotivo(motivo ?? "falha_percepcao")}...`
        );
        await this.analisarComVisao(signal, false, motivo, {
          imagem: captura.imagem,
          thumb: captura.thumb,
          capturadoEm,
          nsfw,
          nsfwAvaliado: true,
        });
      } else {
        this.status(`Percepcao leve falhou: ${(err as Error).message}`);
      }
      return;
    }
    if (signal.aborted || !resultado) return;
    this.ultimaDuracaoMsValor = resultado.duracaoMs;
    const nsfw = await promessaNsfw;
    if (signal.aborted) return;

    const timestamp = capturadoEm;
    const quadro = this.rastreador.processar(resultado.objetos, agora, {
      timestamp,
      snapshot: resultado.snapshot,
      modelo: resultado.modelo,
      sessaoId: this.sessaoId,
    });
    const sinalCena = this.detectorCena.avaliar(assinatura, agora, {
      timestamp,
      snapshot: resultado.snapshot,
      modelo: resultado.modelo,
      sessaoId: this.sessaoId,
    });
    const eventos = sinalCena ? [...quadro.eventos, sinalCena] : quadro.eventos;

    for (const evt of eventos) this.persistirEvento(evt);

    const menorScore =
      resultado.objetos.length > 0
        ? Math.min(...resultado.objetos.map((o) => o.score))
        : null;
    const decisao = this.politica.avaliar({
      agora,
      eventos,
      melhorConfianca: menorScore,
      percepcaoValida: true,
      manual: this.manualSolicitado,
    });
    this.frameIdAtual = gerarId();
    this.manualSolicitado = false;

    if (decisao.acionar) {
      this.politica.registrarChamada(agora);
      const motivo: MotivoAnalise | undefined =
        decisao.motivo === "sem_acao" ? undefined : decisao.motivo;
      this.status(`Modelo de visao acionado: ${rotuloMotivo(motivo ?? "manual")}...`);
      await this.analisarComVisao(signal, false, motivo, {
        imagem: captura.imagem,
        thumb: captura.thumb,
        capturadoEm,
        nsfw,
        nsfwAvaliado: true,
      });
      if (signal.aborted) return;
      // O modelo de visao limpa o canvas; desenha as caixas de novo por cima.
      this.deps.aoUi({ tipo: "desenhar_caixas", objetos: quadro.objetos, nsfw });
      return;
    }

    this.deps.aoUi({ tipo: "desenhar_caixas", objetos: quadro.objetos, nsfw });
    const entry = {
      ...entradaDeResultado(resultado, "deteccao"),
      frameId: this.frameIdAtual ?? undefined,
      nsfw,
    };
    const item = this.deps.aoUi({ tipo: "exibir_entrada", entrada: entry });
    const resumoNsfw = nsfw?.length ? ` · NSFW: ${resumirMarcacoesNsfw(nsfw)}` : "";
    this.status(
      `Viu: ${entry.resumo} (${resultado.duracaoMs} ms) · sem mudanca relevante${resumoNsfw}`
    );
    this.persistirEntrada(entry, item);
  }
}
