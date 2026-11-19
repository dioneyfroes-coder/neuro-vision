import type { PacoteCiclo } from "../../src/domain/cycle";
import type { EventoTemporal, ObservacaoFrame } from "../../src/domain";
import { NOMES_KEYPOINTS_COCO } from "../../public/interpretation/esquema";

/** 17 keypoints COCO sinteticos, com confianca decrescente por indice. */
export function pontosCoco(baseX: number, baseY: number): ObservacaoFrame["pose"] {
  const pontos = NOMES_KEYPOINTS_COCO.map((_, i) => ({
    x: baseX + i * 0.01,
    y: baseY + i * 0.01,
    confianca: Math.max(0.1, 0.95 - i * 0.05),
  }));
  return { pessoas: [{ entidadeId: "pes-1", pontos, confianca: 0.9 }] };
}

export function observacao(parcial: Partial<ObservacaoFrame> = {}): ObservacaoFrame {
  return {
    sessionId: "s1",
    cycleId: "s1-c1",
    frameId: "f1",
    capturadoEm: "2026-10-17T12:00:00.000Z",
    capturadoEmMs: 0,
    imagem: "img1",
    deteccoes: {
      deteccoes: [
        { nome: "pessoa", rotulo: "person", score: 0.8, caixa: { xmin: 10, ymin: 20, xmax: 110, ymax: 220 } },
      ],
      dimensoes: { largura: 200, altura: 400 },
    },
    pose: pontosCoco(0.2, 0.3),
    maos: {
      maos: [
        {
          entidadeId: "mao-1",
          lateralidade: "direita",
          gesto: { nome: "polegar_para_cima", confianca: 0.77 },
          landmarks: Array.from({ length: 21 }, (_, i) => ({ x: 0.5 + i * 0.001, y: 0.6 })),
        },
      ],
    },
    metricas: {
      subsistemas: {
        deteccao: { status: "ok", modelo: "yolov10n" },
        pose: { status: "ok", modelo: "yolov8n-pose" },
        maos: { status: "ok", modelo: "mediapipe" },
      },
    },
    ...parcial,
  };
}

export function pacote(observacoes: ObservacaoFrame[], eventos: EventoTemporal[] = []): PacoteCiclo {
  return {
    sessionId: "s1",
    cycleId: "s1-c1",
    iniciadoEm: "2026-10-17T12:00:00.000Z",
    concluidoEm: "2026-10-17T12:00:01.000Z",
    observacoes,
    eventosTemporais: eventos,
    resumoTemporal: {
      eventos,
      tracksAtivos: 1,
      pessoasAtivas: 1,
      maosAtivas: 0,
      objetosAtivos: 0,
    },
    metricas: {},
  };
}