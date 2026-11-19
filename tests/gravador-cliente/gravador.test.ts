import { describe, expect, it } from "vitest";

import {
  ErroGravacaoSegmento,
  GravadorSegmentos,
  escolherMimeTypeVideo,
} from "../../public/monitoramento/gravador-segmentos";

import { BASE, GravadorFalso } from "../helpers/gravador-cliente";

describe("escolherMimeTypeVideo", () => {
  it("prefere o primeiro formato suportado e cai para vazio", () => {
    expect(escolherMimeTypeVideo(() => true)).toBe("video/webm;codecs=vp9");
    expect(escolherMimeTypeVideo((m) => m === "video/webm")).toBe("video/webm");
    expect(escolherMimeTypeVideo(() => false)).toBe("");
  });
});

describe("GravadorSegmentos", () => {
  const MIME = "video/webm;codecs=vp8";

  function novo(agora: () => number = () => BASE) {
    const recorder = new GravadorFalso(MIME);
    const gravador = new GravadorSegmentos({
      stream: {},
      criarRecorder: () => recorder,
      agoraMs: agora,
      mimeType: MIME,
    });
    return { recorder, gravador };
  }

  it("junta os pedacos e devolve o blob com o instante injetado", async () => {
    let agora = BASE;
    const { recorder, gravador } = novo(() => agora);
    expect(gravador.ativo).toBe(false);
    expect(gravador.mimeType).toBe(MIME);

    gravador.iniciar();
    expect(gravador.ativo).toBe(true);
    recorder.emitir("parte-1");
    recorder.emitir("parte-2");
    agora = BASE + 1234;

    const fechado = await gravador.fechar();
    expect(fechado).toMatchObject({ contentType: MIME, criadoEmMs: BASE + 1234 });
    expect(await fechado?.bytes.text()).toBe("parte-1parte-2");
    expect(fechado?.bytes.type).toBe(MIME);
    expect(gravador.ativo).toBe(false);
    expect(recorder.state).toBe("inactive");
  });

  it("espera o evento stop antes de resolver", async () => {
    const { recorder, gravador } = novo();
    gravador.iniciar();
    recorder.emitir("dados");
    // O MediaRecorder real dispara `onstop` de forma assíncrona: o falso só
    // dispara quando o teste pede, para provar que `fechar()` espera por ele.
    recorder.stopManual = true;

    let resolvido = false;
    const promessa = gravador.fechar().then((valor) => {
      resolvido = true;
      return valor;
    });
    await Promise.resolve();
    expect(resolvido).toBe(false);
    recorder.onstop?.();
    expect(await promessa).toMatchObject({ criadoEmMs: BASE });
    expect(resolvido).toBe(true);
  });

  it("devolve null sem segmento ativo ou sem bytes", async () => {
    const { gravador } = novo();
    expect(await gravador.fechar()).toBeNull();
    gravador.iniciar();
    expect(await gravador.fechar()).toBeNull();
  });

  it("recusa iniciar duas vezes, sem formato ou com falha do navegador", () => {
    const { recorder, gravador } = novo();
    gravador.iniciar();
    expect(() => gravador.iniciar()).toThrow(ErroGravacaoSegmento);

    const semFormato = new GravadorSegmentos({
      stream: {},
      criarRecorder: () => recorder,
      agoraMs: () => BASE,
      mimeType: "",
    });
    expect(() => semFormato.iniciar()).toThrow(/formato/);
  });

  it("propaga falha ao fechar como ErroGravacaoSegmento", async () => {
    const { recorder, gravador } = novo();
    gravador.iniciar();
    recorder.falharAoFechar = true;
    await expect(gravador.fechar()).rejects.toBeInstanceOf(ErroGravacaoSegmento);
    expect(gravador.ativo).toBe(false);
  });
});
