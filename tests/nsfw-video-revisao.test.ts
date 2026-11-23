import { describe, expect, it } from "vitest";

import {
  formatarRelatorioRevisaoNsfwVideo,
  type AmostraParaRevisao,
  type MetadadosRevisaoNsfwVideo,
} from "../src/domain/relatorio-revisao-nsfw-video";

const meta: MetadadosRevisaoNsfwVideo = {
  clip: "nsfw - exemplo.mp4",
  sha256: "abc123",
  bytes: 140_001_080,
  largura: 720,
  altura: 1280,
  duracaoVideoMs: 708_943,
  duracaoMs: 30_000,
  duracaoReproduzidaMs: 30_120,
  inicio: "2026-11-23T09:00:00.000Z",
  limiar: 0.5,
  modelosSolicitados: ["nudenet_320n", "penis_yolov8m"],
  modelosObservados: ["nudenet_320n", "penis_yolov8m"],
  respostasConcluidas: 0,
  errosBackend: ["HTTP 502:Backend: connect ECONNREFUSED"],
  artefatos: ["logs/nsfw-video-real.deteccoes.jsonl"],
};

describe("folha de revisão humana do E2E NSFW com clipe real", () => {
  it("não inventa descrição nem taxa de acerto sem amostras", () => {
    const texto = formatarRelatorioRevisaoNsfwVideo(meta, []);
    expect(texto).toContain("Amostras com campo NSFW | 0");
    expect(texto).toContain("Modelo efetivo nas respostas `done` | N/A");
    expect(texto).toContain("HTTP 502");
    expect(texto).toContain("não produz precisão, recall ou F1");
    expect(texto).not.toMatch(/taxa de acerto\s*:\s*\d/);
  });

  it("não diz que a descrição ficou N/A quando o backend respondeu", () => {
    const texto = formatarRelatorioRevisaoNsfwVideo(
      { ...meta, respostasConcluidas: 2, modeloEfetivo: "gemma-4-e2b-uncensored-hauhaucs-aggressive" },
      []
    );
    expect(texto).toContain("Respostas concluídas | 2");
    expect(texto).toContain("gemma-4-e2b-uncensored-hauhaucs-aggressive");
    expect(texto).not.toContain("Sem resposta `done`");
  });

  it("converte caixa normalizada em pixels e mantém colunas vazias para revisão", () => {
    const amostra: AmostraParaRevisao = {
      offsetMs: 1234,
      capturadoEm: "2026-11-23T09:00:01.234Z",
      frameId: "frame-1",
      marcacoes: [
        {
          rotulo: "FEMALE_BREAST_EXPOSED",
          score: 0.8123,
          caixa: { xmin: 0.25, ymin: 0.1, xmax: 0.5, ymax: 0.4 },
          modelos: ["nudenet_320n", "nudenet_640m"],
        },
      ],
    };
    const texto = formatarRelatorioRevisaoNsfwVideo(meta, [amostra]);
    expect(texto).toContain("[180, 128, 360, 512]");
    expect(texto).toContain("0.812");
    expect(texto).toContain("nudenet_320n, nudenet_640m");
    expect(texto).toContain("Acerto? | Observação | Revisor | Data");
    expect(texto).toContain("| 1234 | FEMALE_BREAST_EXPOSED |");
  });

  it("escapa caracteres de tabela e avisa que make_love é indício temporal", () => {
    const amostra: AmostraParaRevisao = {
      offsetMs: 0,
      capturadoEm: "2026-11-23T09:00:00.000Z",
      marcacoes: [
        {
          rotulo: "make_love",
          score: 0.42,
          caixa: { xmin: 0, ymin: 0, xmax: 1, ymax: 1 },
          modelo: "erax|nms",
        },
      ],
    };
    const texto = formatarRelatorioRevisaoNsfwVideo(meta, [amostra]);
    expect(texto).toContain("erax\\|nms");
    expect(texto).toContain("`make_love` é indício temporal, nunca confirmação do ato.");
    expect(texto).toContain("indício temporal compatível");
  });
});
