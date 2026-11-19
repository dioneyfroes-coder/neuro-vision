import { describe, expect, it } from "vitest";
import type { PacoteCiclo } from "../../src/domain/cycle";
import type { ObservacaoFrame } from "../../src/domain";
import { InterpretadorCiclo, type RequisicaoMultimodal } from "../../public/interpretation/interpretador-ciclo";
import { OBS_BASE, PACOTE } from "../helpers/interpretacao-payload";

describe("InterpretadorCiclo", () => {
  it("expõe a configuração efetiva de modelo e limites do contexto", () => {
    const interpreter = new InterpretadorCiclo({
      modelo: () => "modelo-configurado",
      limites: { maxImagens: 2, maxBytesContexto: 8000 },
      incluirDadosLocais: false,
      serializacao: { landmarksCompletos: true, maxMaosPorFrame: 3 },
      enviar: async () => ({ texto: "ok" }),
    });

    expect(interpreter.diagnostico).toMatchObject({
      modeloSolicitado: "modelo-configurado",
      incluirDadosLocais: false,
      limites: { maxImagens: 2, maxBytesContexto: 8000 },
      serializacao: { landmarksCompletos: true, maxMaosPorFrame: 3 },
    });
  });

  it("envia as imagens na ordem correta e devolve resultado normalizado", async () => {
    const o1: ObservacaoFrame = { ...OBS_BASE, frameId: "f1", capturadoEmMs: 0, imagem: "img1" };
    const o2: ObservacaoFrame = { ...OBS_BASE, frameId: "f2", capturadoEmMs: 100, imagem: "img2" };
    const pacote: PacoteCiclo = { ...PACOTE, observacoes: [o1, o2] };
    const enviou: Array<{
      imagens: string[];
      prompt: string;
      modelo?: string;
    }> = [];
    const interpreter = new InterpretadorCiclo({
      modelo: "m",
      agora: () => 1000,
      enviar: async (req) => {
        enviou.push(req);
        return {
          texto: '{"resumo":"janela com duas imagens","acoes":[],"evidencias":["f1","f2"],"incertezas":[],"contradicacoes":[]}',
          modelo: "m",
          duracaoMs: 50,
        };
      },
    });
    const res = await interpreter.interpretar(pacote);
    expect(enviou).toHaveLength(1);
    expect(enviou[0].imagens).toEqual(["img1", "img2"]);
    expect(res.resumo).toContain("janela com duas imagens");
    expect(res.evidencias).toEqual(["f1", "f2"]);
    expect(res.duracaoMs).toBe(50);
    expect(res.modelo).toBe("m");
    // Diagnostico de compactacao disponivel para as metricas do ciclo.
    expect(res.contextoMultimodal).toMatchObject({
      maxBytes: 16_000,
      truncado: false,
      excedeuTeto: false,
      gruposRemovidos: [],
    });
  });

  it("valida evidencias dos participantes contra o contexto", async () => {
    const o1: ObservacaoFrame = { ...OBS_BASE, frameId: "f1", capturadoEmMs: 0, imagem: "img1" };
    const pacote: PacoteCiclo = { ...PACOTE, observacoes: [o1] };
    const interpreter = new InterpretadorCiclo({
      enviar: async () => ({
        texto: JSON.stringify({
          resumo: "pessoa adulta na cena",
          acoes: [],
          participantes: [
            {
              descricao: "mulher adulta",
              apresentacao: "feminina",
              evidencias: ["f1", "f9"],
            },
          ],
          evidencias: ["f1"],
          incertezas: [],
          contradicoes: [],
        }),
        modelo: "m",
      }),
    });
    const res = await interpreter.interpretar(pacote);
    expect(res.participantes?.[0].evidencias).toEqual(["f1"]);
    expect(res.participantes?.[0].evidenciasInvalidas).toEqual(["f9"]);
  });

  it("usa 'parcial' como texto no transporte e o interpretador normaliza", async () => {
    const o1: ObservacaoFrame = { ...OBS_BASE, frameId: "f1", capturadoEmMs: 0, imagem: "img1" };
    const pacote: PacoteCiclo = { ...PACOTE, observacoes: [o1] };
    const interpreter = new InterpretadorCiclo({
      modelo: "m",
      enviar: async () => ({
        texto: '{"resumo":"ok","acoes":[],"evidencias":["f1"],"incertezas":[],"contradicacoes":[]}',
        modelo: "m",
      }),
    });
    const res = await interpreter.interpretar(pacote);
    expect(res.resumo).toBe("ok");
    expect(res.duracaoMs).toBeGreaterThanOrEqual(0);
  });

  it("aceita fallback para bruto quando JSON invalido", async () => {
    const o1: ObservacaoFrame = { ...OBS_BASE, frameId: "f1", capturadoEmMs: 0, imagem: "img1" };
    const pacote: PacoteCiclo = { ...PACOTE, observacoes: [o1] };
    const interpreter = new InterpretadorCiclo({
      enviar: async () => ({ texto: "nao era json", modelo: "m" }),
    });
    const res = await interpreter.interpretar(pacote);
    expect(res.bruto).toBe("nao era json");
    expect(res.incertezas).toContain("resposta nao estruturada");
  });

  it("incluirDadosLocais=false envia contexto apenas com imagens e cronologia", async () => {
    const o1: ObservacaoFrame = { ...OBS_BASE, frameId: "f1", capturadoEmMs: 0, imagem: "img1" };
    const pacote: PacoteCiclo = { ...PACOTE, observacoes: [o1] };
    let requisicao: RequisicaoMultimodal | null = null;
    const interpreter = new InterpretadorCiclo({
      incluirDadosLocais: false,
      enviar: async (req) => {
        requisicao = req;
        return {
          texto: '{"resumo":"ok","acoes":[],"evidencias":["f1"],"incertezas":[],"contradicacoes":[]}',
          modelo: "m",
        };
      },
    });
    await interpreter.interpretar(pacote);

    expect(requisicao).not.toBeNull();
    expect(requisicao!.imagens).toEqual(["img1"]);
    expect(requisicao!.frameIds).toEqual(["f1"]);
    expect(requisicao!.contexto.frames[0].deteccoes).toEqual([]);
    expect(requisicao!.contexto.frames[0].pessoas).toEqual([]);
    expect(requisicao!.contexto.frames[0].maos).toEqual([]);
    expect(requisicao!.contexto.indisponibilidades).toEqual([]);
  });

  it("resolve o modelo a cada interpretacao quando passado como funcao", async () => {
    const o1: ObservacaoFrame = { ...OBS_BASE, frameId: "f1", capturadoEmMs: 0, imagem: "img1" };
    const pacote: PacoteCiclo = { ...PACOTE, observacoes: [o1] };
    let selecionado: string | undefined = "modelo-inicial";
    const enviados: Array<string | undefined> = [];
    const interpreter = new InterpretadorCiclo({
      modelo: () => selecionado,
      enviar: async (req) => {
        enviados.push(req.modelo);
        return {
          texto: '{"resumo":"ok","acoes":[],"evidencias":["f1"],"incertezas":[],"contradicacoes":[]}',
          modelo: selecionado,
        };
      },
    });
    expect(interpreter.modelo).toBe("modelo-inicial");
    await interpreter.interpretar(pacote);
    // Troca de modelo no meio da sessao vale a partir do proximo ciclo.
    selecionado = "qwen2.5-vl-3b-instruct";
    expect(interpreter.modelo).toBe("qwen2.5-vl-3b-instruct");
    await interpreter.interpretar(pacote);
    expect(enviados).toEqual(["modelo-inicial", "qwen2.5-vl-3b-instruct"]);
  });

  it("encaminha nsfwAtivo ao transporte quando o NSFW esta ligado", async () => {
    const o1: ObservacaoFrame = { ...OBS_BASE, frameId: "f1", capturadoEmMs: 0, imagem: "img1" };
    const pacote: PacoteCiclo = { ...PACOTE, observacoes: [o1] };
    let nsfwRecebido: boolean | undefined;
    let modeloRecebido: string | undefined;
    const interpreter = new InterpretadorCiclo({
      modelo: "gemma-4-e2b-uncensored-hauhaucs-aggressive",
      nsfwAtivo: () => true,
      enviar: async (req) => {
        nsfwRecebido = req.nsfwAtivo;
        modeloRecebido = req.modelo;
        return {
          texto: '{"resumo":"ok","acoes":[],"evidencias":["f1"],"incertezas":[],"contradicacoes":[]}',
        };
      },
    });
    await interpreter.interpretar(pacote);
    expect(nsfwRecebido).toBe(true);
    expect(modeloRecebido).toBe("gemma-4-e2b-uncensored-hauhaucs-aggressive");
  });
});