import { vi } from "vitest";

import type { CameraCaptura } from "../../../public/cycle/cycle-controller";
import type { PercepcaoMultiframe } from "../../../public/cycle/ciclo-percepcao-controller";
import type { ConfiguracaoParcial, ModelosPercepcao } from "../../../public/perception/local-perception-pipeline";
import { processamento } from "./constantes";

export function cameraFalsa(opcoes: { falhaAoIniciar?: Error; semFrame?: boolean } = {}): {
  camera: CameraCaptura;
  estado: { iniciadas: number; encerradas: number };
} {
  const estado = { iniciadas: 0, encerradas: 0 };
  const camera: CameraCaptura = {
    ativa: true,
    largura: 640,
    altura: 480,
    iniciar: async () => {
      estado.iniciadas += 1;
      if (opcoes.falhaAoIniciar) throw opcoes.falhaAoIniciar;
    },
    encerrar: () => {
      estado.encerradas += 1;
    },
    capturarFrame: () => "data:image/jpeg;base64,AAAA",
    capturarQuadro: () =>
      opcoes.semFrame
        ? null
        : {
            imagem: "data:image/jpeg;base64,AAAA",
            thumb: "data:image/jpeg;base64,thumb",
          },
    assinaturaDeCena: () => [0, 0],
  };
  return { camera, estado };
}

export function percepcaoFalsa(configuracao?: ConfiguracaoParcial): {
  percepcao: PercepcaoMultiframe;
  modelosVistos: ModelosPercepcao[];
  encerramentos: ReturnType<typeof vi.fn>;
} {
  const modelosVistos: ModelosPercepcao[] = [];
  const encerramentos = vi.fn();
  const percepcao: PercepcaoMultiframe = {
    processarFrame: async () => processamento(),
    configurar: async (_aoStatus, modelos) => {
      modelosVistos.push(modelos ?? {});
      return configuracao ?? { carregados: ["deteccao", "pose", "maos"], falhas: [] };
    },
    encerrar: encerramentos,
  };
  return { percepcao, modelosVistos, encerramentos };
}
