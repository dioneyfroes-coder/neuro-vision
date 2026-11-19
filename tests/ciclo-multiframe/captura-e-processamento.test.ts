import { describe, expect, it, vi } from "vitest";
import { executarCicloMultiframe } from "../../public/cycle/ciclo-multiframe";
import { ehCancelamento } from "../../src/erros";
import type { PacoteCiclo } from "../../src/domain";
import { interpretadorFalso, montar } from "../helpers/ciclo-multiframe";

describe("executarCicloMultiframe — captura e processamento de frames", () => {
  it("usa as mesmas imagens, ids e timestamps na deteccao e na interpretacao", async () => {
    const { deps, capturados, interpretados } = montar();
    const resultado = await executarCicloMultiframe(deps);

    // A captura identificou quatro frames.
    const imagensCapturadas = deps.store.quadros.map((s) => s.imagem);
    expect(imagensCapturadas).toEqual(["A", "B", "C", "D"]);

    // As imagens enviadas a deteccao sao exatamente as capturadas...
    expect(capturados).toEqual(imagensCapturadas);
    // ...e as enviadas a interpretacao tambem.
    expect(interpretados).toEqual([imagensCapturadas]);

    // Pacote: ids e timestamps preservados por observacao.
    expect(resultado.pacote.observacoes.map((o) => o.frameId)).toEqual([
      "sess0001-c1-f0",
      "sess0001-c1-f1",
      "sess0001-c1-f2",
      "sess0001-c1-f3",
    ]);
    for (const obs of resultado.pacote.observacoes) {
      expect(obs.capturadoEm).toBe("2026-10-16T10:00:00.000Z");
      expect(obs.imagem).toBe(imagensCapturadas[Number(obs.frameId.slice(-1))]);
    }
    expect(resultado.interpretacao).toBe("quatro frames analisados");
    expect(resultado.cancelado).toBe(false);
  });

  it("persiste contagens da saida real sem confundir falha com resultado vazio", async () => {
    const { deps } = montar({
      processarFrame: async () => ({
        deteccoes: {
          deteccoes: [
            { nome: "pessoa", rotulo: "person", score: 0.9, caixa: { xmin: 1, ymin: 2, xmax: 30, ymax: 40 } },
          ],
        },
        pose: {
          pessoas: [
            { pontos: Array.from({ length: 17 }, () => ({ x: 0.5, y: 0.5 })) },
            { pontos: Array.from({ length: 16 }, () => ({ x: 0.5, y: 0.5 })) },
          ],
        },
        maos: {
          maos: [
            { lateralidade: "direita", landmarks: Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 })) },
            { lateralidade: "esquerda", landmarks: Array.from({ length: 20 }, () => ({ x: 0.5, y: 0.5 })) },
          ],
        },
        metricas: {},
      }),
    });

    const resultado = await executarCicloMultiframe(deps);

    expect(resultado.pacote.metricas.resultadosPercepcao).toEqual({
      deteccao: { quadrosValidos: 4, deteccoes: 4 },
      pose: { quadrosValidos: 4, pessoas: 8, keypoints: 132, pessoasCom17Keypoints: 4 },
      maos: { quadrosValidos: 4, maos: 8, landmarks: 164, maosCom21Landmarks: 4 },
    });
  });

  it("preserva a ordem dos frames ao processar depois da captura", async () => {
    const ordem: string[] = [];
    const { deps } = montar({
      processarFrame: async (snapshot) => {
        ordem.push(`proc:${snapshot.frameId}`);
        return processamento();
      },
    });
    await executarCicloMultiframe(deps);
    expect(ordem).toEqual([
      "proc:sess0001-c1-f0",
      "proc:sess0001-c1-f1",
      "proc:sess0001-c1-f2",
      "proc:sess0001-c1-f3",
    ]);
  });

  it("processa frames em paralelo com concorrencia limitada (ordem preservada)", async () => {
    let emAndamento = 0;
    let pico = 0;
    const { deps, interpretados } = montar({
      concorrenciaFrames: 2,
      processarFrame: async () => {
        emAndamento += 1;
        pico = Math.max(pico, emAndamento);
        await new Promise((resolve) => setTimeout(resolve, 5));
        emAndamento -= 1;
        return processamento();
      },
    });

    const resultado = await executarCicloMultiframe(deps);

    // No maximo 2 frames avancam juntos (limite pedido) e pelo menos 2 de fato
    // coincidem — prova que nao rodou estritamente em serie.
    expect(pico).toBe(2);
    // A ordem das observacoes segue a ordem de captura, nao a de conclusao.
    expect(resultado.pacote.observacoes.map((o) => o.imagem)).toEqual(["A", "B", "C", "D"]);
    expect(interpretados).toEqual([["A", "B", "C", "D"]]);
  });

  it("registra falha de processamento como indisponivel sem apagar a evidencia", async () => {
    const { deps, interpretados } = montar({
      processarFrame: async () => {
        throw new Error("modelo quebrou");
      },
    });
    const resultado = await executarCicloMultiframe(deps);

    expect(resultado.erros).toHaveLength(4);
    expect(resultado.erros[0].etapa).toBe("deteccao");
    for (const obs of resultado.pacote.observacoes) {
      expect(obs.deteccoes).toMatchObject({ indisponivel: true, subsistema: "deteccao" });
      expect(obs.pose).toMatchObject({ indisponivel: true });
      expect(obs.maos).toMatchObject({ indisponivel: true });
    }
    // Mesmo com falha local, as imagens capturadas ainda vao a interpretacao.
    expect(interpretados).toEqual([["A", "B", "C", "D"]]);
  });

  it("limpa o buffer e propaga o cancelamento", async () => {
    const { deps, store } = montar();
    const controller = new AbortController();
    controller.abort();
    await expect(executarCicloMultiframe(deps, controller.signal)).rejects.toSatisfy(
      ehCancelamento
    );
    expect(store.tamanho).toBe(0);
  });

  it("nao captura a webcam dentro do interpretador (recebe so o pacote)", async () => {
    const interpretar = vi.fn(interpretadorFalso([]).interpretar);
    const { deps } = montar();
    deps.interpretador = { modelo: null, interpretar };
    await executarCicloMultiframe(deps);
    expect(interpretar).toHaveBeenCalledTimes(1);
    const pacote = interpretar.mock.calls[0][0] as PacoteCiclo;
    expect(pacote.observacoes).toHaveLength(4);
    // O interpretador nao tem acesso a uma fonte de captura: so o pacote.
    expect(Object.keys(pacote)).not.toContain("camera");
  });

});