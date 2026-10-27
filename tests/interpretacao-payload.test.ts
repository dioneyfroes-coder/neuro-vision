import { describe, expect, it } from "vitest";
import type { PacoteCiclo } from "../src/domain/cycle";
import type { EventoTemporal, ObservacaoFrame } from "../src/domain";
import { indisponivel } from "../src/domain/perception";
import { montarContextoCiclo } from "../public/interpretation/contexto";
import { montarPromptInterpretacao } from "../public/interpretation/prompt";
import { normalizarInterpretacao } from "../public/interpretation/normalizar";
import {
  InterpretadorCiclo,
  type RequisicaoMultimodal,
} from "../public/interpretation/interpretador-ciclo";

const OBS_BASE: ObservacaoFrame = {
  sessionId: "s1",
  cycleId: "s1-c1",
  frameId: "f1",
  capturadoEm: "2026-10-17T12:00:00.000Z",
  capturadoEmMs: 0,
  imagem: "data:image/jpeg;base64,AAAA",
  deteccoes: { deteccoes: [{ nome: "pessoa", rotulo: "person", score: 0.9, caixa: { xmin: 0, ymin: 0, xmax: 100, ymax: 100 } }], modelo: "d" },
  pose: indisponivel("pose", "desativado"),
  maos: indisponivel("maos", "desativado"),
  metricas: {},
};

const PACOTE: PacoteCiclo = {
  sessionId: "s1",
  cycleId: "s1-c1",
  iniciadoEm: "2026-10-17T12:00:00.000Z",
  concluidoEm: "2026-10-17T12:00:00.500Z",
  observacoes: [OBS_BASE],
  eventosTemporais: [],
  resumoTemporal: { eventos: [], entidadesAtivas: 1 },
  metricas: {},
};

describe("montarContextoCiclo", () => {
  it("mantem as imagens na ordem e associa indice 1-based", () => {
    const o1: ObservacaoFrame = { ...OBS_BASE, frameId: "f1", capturadoEmMs: 0, imagem: "img1" };
    const o2: ObservacaoFrame = { ...OBS_BASE, frameId: "f2", capturadoEmMs: 500, imagem: "img2" };
    const pacote: PacoteCiclo = { ...PACOTE, observacoes: [o1, o2] };
    const { imagens, contexto } = montarContextoCiclo(pacote, { maxImagens: 4 });
    expect(imagens).toEqual(["img1", "img2"]);
    expect(contexto.frames).toHaveLength(2);
    expect(contexto.frames[0].indice).toBe(1);
    expect(contexto.frames[0].frameId).toBe("f1");
    expect(contexto.frames[1].indice).toBe(2);
    expect(contexto.frames[1].frameId).toBe("f2");
    expect(contexto.janelaMs).toBe(500);
  });

  it("ordena os frames cronologicamente e sinaliza indisponibilidade", () => {
    const o1: ObservacaoFrame = { ...OBS_BASE, frameId: "f1", capturadoEmMs: 500, imagem: "img1", pose: indisponivel("pose", "timeout") };
    const o2: ObservacaoFrame = { ...OBS_BASE, frameId: "f2", capturadoEmMs: 0, imagem: "img2" };
    const pacote: PacoteCiclo = { ...PACOTE, observacoes: [o1, o2] };
    const { imagens, contexto } = montarContextoCiclo(pacote);
    expect(imagens).toEqual(["img2", "img1"]);
    expect(contexto.indisponibilidades.some((i) => i.includes("pose indisponivel (timeout)"))).toBe(true);
  });

  it("limita o numero de imagens e arredonda dados numericos", () => {
    const obs = Array.from({ length: 5 }, (_, i) => ({
      ...OBS_BASE,
      frameId: `f${i}`,
      capturadoEmMs: i * 100,
      imagem: `img${i}`,
      deteccoes: {
        deteccoes: [
          { nome: "pessoa", rotulo: "person", score: 0.91234, caixa: { xmin: 0, ymin: 0, xmax: 100, ymax: 100 } },
        ],
        dimensoes: { largura: 200, altura: 200 },
      },
    }));
    const pacote: PacoteCiclo = { ...PACOTE, observacoes: obs };
    const { imagens, contexto } = montarContextoCiclo(pacote, { maxImagens: 3, decimais: 2 });
    expect(imagens).toHaveLength(3);
    // score arredondado a 2 decimais e caixa normalizada em [0,1]
    expect(contexto.frames[0].deteccoes[0].score).toBe(0.91);
    expect(contexto.frames[0].deteccoes[0].caixa).toEqual({
      xmin: 0,
      ymin: 0,
      xmax: 0.5,
      ymax: 0.5,
    });
  });

  it("sem dados locais (variante B) envia so imagens + cronologia", () => {
    const o1: ObservacaoFrame = { ...OBS_BASE, frameId: "f1", capturadoEmMs: 0, imagem: "img1" };
    const o2: ObservacaoFrame = { ...OBS_BASE, frameId: "f2", capturadoEmMs: 100, imagem: "img2" };
    const evento: EventoTemporal = {
      eventoId: "e1",
      sessionId: "s1",
      cycleId: "s1-c1",
      tipo: "gesto_detectado",
      inicioEm: "2026-10-17T12:00:00.000Z",
      descricao: "Gesto confirmado",
      origens: ["maos"],
      frameIds: ["f1"],
      estado: "confirmado",
    };
    const pacote: PacoteCiclo = {
      ...PACOTE,
      observacoes: [o1, o2],
      eventosTemporais: [evento],
    };
    const { imagens, contexto } = montarContextoCiclo(pacote, {}, { incluirDadosLocais: false });

    expect(imagens).toEqual(["img1", "img2"]);
    expect(contexto.versao).toBe("contexto-1");
    expect(contexto.frames[0]).toMatchObject({
      frameId: "f1",
      indice: 1,
      deteccoes: [],
      pessoas: [],
      maos: [],
      movimento: [],
    });
    expect(contexto.frames[0].subsistemas.deteccao.status).toBe("nao_carregado");
    expect(contexto.frames[1].offsetMs).toBe(100);
    expect(contexto.eventosTemporais).toEqual([]);
    expect(contexto.indisponibilidades).toEqual([]);
    expect(contexto.resumoTemporal.entidadesAtivas).toBe(0);
  });
});

describe("montarPromptInterpretacao", () => {
  it("produz prompt que instrui narrativa cronologica, evidencias e incertezas", () => {
    const o1: ObservacaoFrame = { ...OBS_BASE, frameId: "f1", capturadoEmMs: 0, imagem: "img1" };
    const pacote: PacoteCiclo = { ...PACOTE, observacoes: [o1] };
    const { contexto } = montarContextoCiclo(pacote);
    const prompt = montarPromptInterpretacao(contexto);
    expect(prompt).toContain("NARRATIVA CRONOLOGICA");
    expect(prompt).toContain("evidencias");
    expect(prompt).toContain("incertezas");
    expect(prompt).toMatch(/nao adivinhe|nao invente|nao visto/i);
    expect(prompt).toContain("Imagem 1");
  });

  it("inclui eventos temporais e ID dos frames", () => {
    const o1: ObservacaoFrame = { ...OBS_BASE, frameId: "f1", capturadoEmMs: 0, imagem: "img1" };
    const evento: EventoTemporal = {
      eventoId: "ev1",
      sessionId: "s1",
      tipo: "braco_levantado",
      inicioEm: "2026-10-17T12:00:00.000Z",
      descricao: "Braco levantado",
      origens: ["pose"],
      frameIds: ["f1"],
      estado: "confirmado",
    };
    const pacote: PacoteCiclo = { ...PACOTE, observacoes: [o1], eventosTemporais: [evento] };
    const { contexto } = montarContextoCiclo(pacote);
    const prompt = montarPromptInterpretacao(contexto);
    expect(prompt).toContain("braco_levantado");
    expect(prompt).toContain("f1");
  });

  it("inclui bloco NSFW explicito por imagem quando o subsistema rodou", () => {
    const o1: ObservacaoFrame = {
      ...OBS_BASE,
      frameId: "f1",
      capturadoEmMs: 0,
      imagem: "img1",
      nsfw: {
        marcacoes: [
          {
            rotulo: "porn",
            score: 0.87,
            caixa: { xmin: 0.1, ymin: 0.2, xmax: 0.5, ymax: 0.8 },
          },
        ],
      },
      metricas: {
        subsistemas: {
          deteccao: { status: "ok" },
          pose: { status: "ok" },
          maos: { status: "ok" },
          nsfw: { status: "ok" },
        },
      },
    };
    const pacote: PacoteCiclo = { ...PACOTE, observacoes: [o1] };
    const { contexto } = montarContextoCiclo(pacote);
    const prompt = montarPromptInterpretacao(contexto);
    expect(prompt).toContain("CONTEUDO ADULTO (NSFW)");
    expect(prompt).toContain("sem eufemismos");
    expect(prompt).toContain("Imagem 1 (frameId f1): porn 0.870");
    expect(prompt).toContain("nsfw=[");
  });

  it("sem dados locais (variante B) o prompt marca subsistemas como nao_carregado", () => {
    const o1: ObservacaoFrame = { ...OBS_BASE, frameId: "f1", capturadoEmMs: 0, imagem: "img1" };
    const pacote: PacoteCiclo = { ...PACOTE, observacoes: [o1] };
    const { contexto } = montarContextoCiclo(pacote, {}, { incluirDadosLocais: false });
    const prompt = montarPromptInterpretacao(contexto);
    expect(prompt).toContain("Imagem 1");
    // Sem dados locais: nenhuma deteccao/pessoa/mao e enviada.
    expect(prompt).not.toContain("det=[");
    expect(prompt).not.toContain("pessoas=");
    expect(prompt).not.toContain("maos=[");
    expect(prompt).toContain("det=nao_carregado");
  });
});

describe("normalizarInterpretacao", () => {
  it("extrai JSON estruturado e devolve ResultadoInterpretacao valido", () => {
    const json = '{"resumo": "A pessoa levantou o braco","acoes":[{"descricao":"levantar braco","inicioEm":"2026-10-17T12:00:00.000Z","evidencias":["f1"]}],"evidencias":["f1"],"incertezas":[],"contradicacoes":[]}';
    const res = normalizarInterpretacao(json, "qwen2.5-vl");
    expect(res.resumo).toBe("A pessoa levantou o braco");
    expect(res.acoes).toHaveLength(1);
    expect(res.evidencias).toEqual(["f1"]);
    expect(res.modelo).toBe("qwen2.5-vl");
  });

  it("extrai JSON em bloco fenced", () => {
    const texto = '```json\n{"resumo":"x","acoes":[],"evidencias":[],"incertezas":[],"contradicacoes":[]}\n```';
    const res = normalizarInterpretacao(texto);
    expect(res.resumo).toBe("x");
  });

  it("devolve bruto e incerteza quando nao e JSON valido", () => {
    const res = normalizarInterpretacao("texto puro sem estrutura", "m1");
    expect(res.bruto).toBe("texto puro sem estrutura");
    expect(res.resumo).toBe("texto puro sem estrutura");
    expect(res.incertezas).toEqual(["resposta nao estruturada"]);
    expect(res.modelo).toBe("m1");
  });
});

describe("InterpretadorCiclo", () => {
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
});
