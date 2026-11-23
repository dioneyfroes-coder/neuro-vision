import { describe, expect, it } from "vitest";
import {
  aplicarPerfilInicializacao,
  lerPerfilInicializacao,
} from "../public/ui/perfil-inicializacao";

describe("perfil de inicializacao", () => {
  it("reconhece apenas ?perfil=leve como opt-in", () => {
    expect(lerPerfilInicializacao(new URLSearchParams(""))).toBe("completo");
    expect(lerPerfilInicializacao(new URLSearchParams("?perfil=padrao"))).toBe("completo");
    expect(lerPerfilInicializacao(new URLSearchParams("?perfil=leve"))).toBe("leve");
  });

  it("mantem a habilitacao original no perfil completo", () => {
    const habilitacao = { deteccao: true, pose: true, maos: true, nsfw: true };
    expect(aplicarPerfilInicializacao(habilitacao, "completo")).toBe(habilitacao);
  });

  it("desliga pose e maos no perfil leve sem mexer em deteccao/NSFW", () => {
    const habilitacao = { deteccao: true, pose: true, maos: true, nsfw: true };
    expect(aplicarPerfilInicializacao(habilitacao, "leve")).toEqual({
      deteccao: true,
      pose: false,
      maos: false,
      nsfw: true,
    });
    // nao altera o objeto de entrada
    expect(habilitacao.pose).toBe(true);
  });

  it("nao reativa nada quando a variante ja desligou a percepcao local", () => {
    const desligado = { deteccao: false, pose: false, maos: false, nsfw: false };
    expect(aplicarPerfilInicializacao(desligado, "leve")).toEqual(desligado);
  });
});
