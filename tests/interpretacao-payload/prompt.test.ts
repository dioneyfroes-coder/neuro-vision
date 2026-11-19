import { describe, expect, it } from "vitest";
import type { PacoteCiclo } from "../../src/domain/cycle";
import type {
  EventoTemporal,
  ObservacaoFrame,
} from "../../src/domain";
import { montarContextoCiclo } from "../../public/interpretation/contexto";
import { montarPromptInterpretacao } from "../../public/interpretation/prompt";
import { OBS_BASE, PACOTE } from "../helpers/interpretacao-payload";

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

  it("inclui instrucao de acao multiframe e schema com tipo/natureza/confianca", () => {
    const obsNsfw = (frameId: string, ms: number, imagem: string): ObservacaoFrame => ({
      ...OBS_BASE,
      frameId,
      capturadoEmMs: ms,
      imagem,
      nsfw: { marcacoes: [] },
      metricas: {
        subsistemas: {
          deteccao: { status: "ok" },
          pose: { status: "ok" },
          maos: { status: "ok" },
          nsfw: { status: "ok" },
        },
      },
    });
    const pacote: PacoteCiclo = {
      ...PACOTE,
      observacoes: [obsNsfw("f1", 0, "img1"), obsNsfw("f2", 500, "img2")],
    };
    const { contexto } = montarContextoCiclo(pacote);
    const prompt = montarPromptInterpretacao(contexto);
    expect(prompt).toContain("ACAO SEXUAL EM MULTIFRAME");
    expect(prompt).toContain("Imagens neste ciclo: 2");
    expect(prompt).toContain('"tipo": "masturbacao|sexo_oral|penetracao|outra"');
    expect(prompt).toContain('"natureza": "observada|inferida"');
    expect(prompt).toContain('"confianca": 0.0');
  });

  it("nao pede inferencia de acao sexual com uma unica imagem", () => {
    const obs: ObservacaoFrame = {
      ...OBS_BASE,
      nsfw: { marcacoes: [] },
      metricas: {
        subsistemas: {
          deteccao: { status: "ok" },
          pose: { status: "ok" },
          maos: { status: "ok" },
          nsfw: { status: "ok" },
        },
      },
    };
    const { contexto } = montarContextoCiclo({ ...PACOTE, observacoes: [obs] });
    const prompt = montarPromptInterpretacao(contexto);
    expect(prompt).toContain("CONTEUDO ADULTO (NSFW)");
    expect(prompt).not.toContain("ACAO SEXUAL EM MULTIFRAME");
    expect(prompt).not.toContain('"natureza": "observada|inferida"');
  });

  it("pede participantes da cena sem inferir identidade trans pela aparencia", () => {
    const { contexto } = montarContextoCiclo({ ...PACOTE, observacoes: [OBS_BASE] });
    const prompt = montarPromptInterpretacao(contexto);
    expect(prompt).toContain('"participantes"');
    expect(prompt).toContain("apresentacao");
    expect(prompt).toContain("identidadeDeclarada");
    expect(prompt).toMatch(/nunca deduza `pessoa_trans`/i);
  });

  it("explica a geometria dos dedos e os limites das estimativas locais 2D", () => {
    const { contexto } = montarContextoCiclo({ ...PACOTE, observacoes: [OBS_BASE] });
    const prompt = montarPromptInterpretacao(contexto);
    expect(prompt).toContain("dedosEstendidos");
    expect(prompt).toContain("totalEstendidos");
    expect(prompt).toContain("configuracao");
    expect(prompt).toMatch(/estimativas locais 2D/i);
    expect(prompt).toMatch(/nao sao medidas clinicas nem 3D/i);
  });

  it("instrui o modelo a tratar falhas locais, divergencias e casos inconclusivos como incerteza", () => {
    const { contexto } = montarContextoCiclo({ ...PACOTE, observacoes: [OBS_BASE] });
    const prompt = montarPromptInterpretacao(contexto);
    expect(prompt).toMatch(/dados locais podem falhar|podem falhar ou vir incompletos/i);
    expect(prompt).toMatch(/divergir|divergencia/i);
    expect(prompt).toMatch(/inconclusiv/i);
    expect(prompt).toContain("incertezas");
  });

  it("avisa explicitamente quando o contexto foi compactado e quais grupos saíram", () => {
    const deteccoes = Array.from({ length: 20 }, (_, i) => ({
      nome: `objeto-${i}`,
      rotulo: `object-${i}`,
      score: 0.9,
      caixa: { xmin: 0, ymin: 0, xmax: 10, ymax: 10 },
    }));
    const obs = Array.from({ length: 4 }, (_, i) => ({
      ...OBS_BASE,
      frameId: `f${i}`,
      capturadoEmMs: i * 100,
      imagem: `img${i}`,
      deteccoes: { deteccoes, dimensoes: { largura: 100, altura: 100 } },
    }));
    const pacote = { ...PACOTE, observacoes: obs };
    const completo = montarContextoCiclo(pacote).contexto;
    const bytesCompletos = new TextEncoder().encode(JSON.stringify(completo)).length;
    const { contexto } = montarContextoCiclo(pacote, {
      maxBytesContexto: bytesCompletos - 400,
    });
    expect(contexto.truncamento?.ocorreu).toBe(true);
    const prompt = montarPromptInterpretacao(contexto);
    expect(prompt).toContain("contexto local foi compactado");
    expect(prompt).toContain("Grupos podados:");
    expect(prompt).toContain(contexto.truncamento!.gruposRemovidos[0].grupo);
  });

  it("inclui motivo de encerramento, continuidade e evidencias textuais dos eventos", () => {
    const evento: EventoTemporal = {
      eventoId: "ev-fim",
      sessionId: "s1",
      tipo: "transicao_acao",
      inicioEm: "2026-10-17T12:00:00.000Z",
      fimEm: "2026-10-17T12:00:00.500Z",
      descricao: "Transicao concluida",
      origens: ["movimento"],
      frameIds: ["f1"],
      estado: "encerrado",
      motivoEncerramento: "sem_sinal",
      continuidadeValida: false,
      evidencias: ["velocidadeY:-0.6/s"],
    };
    const { contexto } = montarContextoCiclo({
      ...PACOTE,
      observacoes: [OBS_BASE],
      eventosTemporais: [evento],
    });
    const prompt = montarPromptInterpretacao(contexto);
    expect(prompt).toContain("motivoEncerramento sem_sinal");
    expect(prompt).toContain("continuidadeValida false");
    expect(prompt).toContain("velocidadeY:-0.6/s");
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